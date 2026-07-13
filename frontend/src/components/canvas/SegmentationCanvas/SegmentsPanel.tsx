import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSegmentationStore, useLabelStats, type ColorMode } from '@/store/segmentationStore';
import { instanceDisplayId } from './instanceNaming';
import type { Taxonomy, TaskStage, AnnotationReview } from '@/types';

const ISSUE_TYPE_LABELS: Record<string, string> = {
  box_too_loose: 'Too loose',
  box_too_tight: 'Too tight',
  wrong_class: 'Wrong class',
  wrong_orientation: 'Wrong orientation',
  missing_attributes: 'Missing attributes',
  tracking_error: 'Tracking error',
  position_incorrect: 'Position incorrect',
  size_incorrect: 'Size incorrect',
  occlusion_wrong: 'Occlusion wrong',
  incomplete_segmentation: 'Incomplete',
  over_segmentation: 'Over-segmented',
  boundary_error: 'Boundary error',
  other: 'Other',
};

type SegmentReviewStatus = 'pending' | 'approved' | 'rejected';

interface SpatialIssue {
  id: string;
  x: number;
  y: number;
  z: number;
  issueTypes: string[];
  notes?: string;
  reviewedAt?: string;
  annotator_resolved?: boolean;
}

type PanelTab = 'segments' | 'issues';

interface SegmentsPanelProps {
  taxonomy: Taxonomy | null;
  isQAMode?: boolean;
  taskStage?: TaskStage;
  isRevisionMode?: boolean;
  currentFrameId?: string;
  segmentReviewsMap?: Map<string, AnnotationReview>;
  onApproveSegment?: (instanceId: number) => void;
  onRejectSegment?: (instanceId: number, issueTypes: string[], notes: string) => void;
  onApproveAll?: () => void;
  isApprovingAll?: boolean;
  spatialIssues?: SpatialIssue[];
  onNavigateToIssue?: (issue: SpatialIssue) => void;
  onResolveIssue?: (issue: SpatialIssue) => void;
  canResolveIssues?: boolean;
  onClearAllAndReset?: () => Promise<void>;
}

interface SegmentEntry {
  instanceId: number;
  classId: number;
  className: string;
  displayName: string;
  color: string;
  pointCount: number;
}

export const SegmentsPanel: React.FC<SegmentsPanelProps> = ({
  taxonomy,
  isQAMode = false,
  taskStage,
  isRevisionMode = false,
  currentFrameId,
  segmentReviewsMap,
  onApproveSegment,
  onRejectSegment,
  onApproveAll,
  isApprovingAll = false,
  spatialIssues = [],
  onNavigateToIssue,
  onResolveIssue,
  canResolveIssues = false,
  onClearAllAndReset,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('segments');

  useEffect(() => {
    if (isRevisionMode && spatialIssues.length > 0) {
      setActiveTab('issues');
    }
  }, [isRevisionMode, spatialIssues.length]);

  const labelStats = useLabelStats();
  const segmentationMode = useSegmentationStore((s) => s.segmentationMode);
  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  const frameSegmentations = useSegmentationStore((s) => s.frameSegmentations);
  const getInstancesForFrame = useSegmentationStore((s) => s.getInstancesForFrame);
  const deleteInstance = useSegmentationStore((s) => s.deleteInstance);
  const beginSplit = useSegmentationStore((s) => s.beginSplit);
  const highlightInstance = useSegmentationStore((s) => s.highlightInstance);
  const splitSourceInstanceId = useSegmentationStore((s) => s.splitSourceInstanceId);
  const selectedInstanceId = useSegmentationStore((s) => s.selectedInstanceId);

  const activeRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedInstanceId == null) return;
    setActiveTab('segments');
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedInstanceId]);

  const pickedInstanceIds = useSegmentationStore((s) => s.pickedInstanceIds);
  const togglePickedInstance = useSegmentationStore((s) => s.togglePickedInstance);
  const clearPickedInstances = useSegmentationStore((s) => s.clearPickedInstances);
  const mergePickedInstances = useSegmentationStore((s) => s.mergePickedInstances);
  useEffect(() => { clearPickedInstances(); }, [currentFrameIndex, clearPickedInstances]);

  const [segmentReviews, setSegmentReviews] = useState<Map<string, SegmentReviewStatus>>(new Map());
  const [rejectingInstanceId, setRejectingInstanceId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedIssueTypes, setSelectedIssueTypes] = useState<string[]>([]);

  const colorMode = useSegmentationStore((s) => s.colorMode);
  const setColorMode = useSegmentationStore((s) => s.setColorMode);
  const showOnlyLabeled = useSegmentationStore((s) => s.showOnlyLabeled);
  const setShowOnlyLabeled = useSegmentationStore((s) => s.setShowOnlyLabeled);
  const labelOpacity = useSegmentationStore((s) => s.labelOpacity);
  const setLabelOpacity = useSegmentationStore((s) => s.setLabelOpacity);

  const is4DMode = useSegmentationStore((s) => s.is4DMode);
  const setIs4DMode = useSegmentationStore((s) => s.setIs4DMode);

  const clearAllLabels = useSegmentationStore((s) => s.clearAllLabels);

  const hiddenInstances = useSegmentationStore((s) => s.hiddenInstances);
  const toggleInstanceVisibility = useSegmentationStore((s) => s.toggleInstanceVisibility);

  const segments: SegmentEntry[] = useMemo(() => {
    if (!taxonomy?.classes) return [];

    const instances = getInstancesForFrame(currentFrameIndex);
    const isInstanceMode = segmentationMode === 'instance';
    const segmentList: SegmentEntry[] = [];

    instances.forEach((data, instanceId) => {
      const cls = taxonomy.classes[data.classId];
      if (cls) {
        segmentList.push({
          instanceId,
          classId: data.classId,
          className: cls.name,
          displayName: cls.name,
          color: cls.color,
          pointCount: data.pointCount,
        });
      }
    });

    segmentList.sort((a, b) => a.instanceId - b.instanceId);

    if (isInstanceMode) {
      const perClassCount = new Map<number, number>();
      for (const seg of segmentList) {
        const n = (perClassCount.get(seg.classId) ?? 0) + 1;
        perClassCount.set(seg.classId, n);
        const prefix = taxonomy.classes[seg.classId]?.instance_prefix;
        seg.displayName = instanceDisplayId(seg.className, n, prefix);
      }
    }

    return segmentList;
  }, [taxonomy?.classes, getInstancesForFrame, currentFrameIndex, frameSegmentations, segmentationMode]);

  const handleDeleteSegment = (segment: SegmentEntry) => {
    if (confirm(`Delete ${segment.displayName} segment?`)) {
      deleteInstance(segment.instanceId);
    }
  };

  const handleMergeSelected = () => {
    if (pickedInstanceIds.size < 2) return;
    if (confirm(`Merge ${pickedInstanceIds.size} instances into one?`)) {
      mergePickedInstances();
    }
  };

  // QA Review helpers. Keys are scoped to the active layer so semantic and
  // instance verdicts are stored/looked-up separately.
  const getReviewKey = (instanceId: number) =>
    currentFrameId
      ? `${currentFrameId}-${segmentationMode}-${instanceId}`
      : `${currentFrameIndex}-${segmentationMode}-${instanceId}`;

  const getPersistedReview = (instanceId: number): AnnotationReview | undefined => {
    if (!segmentReviewsMap || !currentFrameId) return undefined;
    return segmentReviewsMap.get(`${currentFrameId}-${segmentationMode}-${instanceId}`);
  };

  const getSegmentReviewStatus = (instanceId: number): SegmentReviewStatus => {
    const localReview = segmentReviews.get(getReviewKey(instanceId));
    if (localReview) {
      return localReview;
    }

    const persistedReview = getPersistedReview(instanceId);
    if (persistedReview) {
      return persistedReview.verdict === 'approved' ? 'approved' :
             persistedReview.verdict === 'rejected' ? 'rejected' : 'pending';
    }

    return 'pending';
  };

  const handleApproveSegment = (instanceId: number) => {
    const key = getReviewKey(instanceId);
    setSegmentReviews(prev => new Map(prev).set(key, 'approved'));
    onApproveSegment?.(instanceId);
  };

  // Approve All handler - updates local state immediately for UI feedback
  const handleApproveAllSegments = () => {
    // Update local state for all segments to show approved state immediately
    const newReviews = new Map(segmentReviews);
    segments.forEach(segment => {
      const key = getReviewKey(segment.instanceId);
      if (!newReviews.has(key) || newReviews.get(key) === 'pending') {
        newReviews.set(key, 'approved');
      }
    });
    setSegmentReviews(newReviews);

    // Call parent handler to persist to backend
    onApproveAll?.();
  };

  const handleRejectSegment = (instanceId: number) => {
    setRejectingInstanceId(instanceId);
  };

  const confirmReject = () => {
    if (rejectingInstanceId !== null && (selectedIssueTypes.length > 0 || rejectReason.trim())) {
      const key = getReviewKey(rejectingInstanceId);
      setSegmentReviews(prev => new Map(prev).set(key, 'rejected'));
      const issueTypes = selectedIssueTypes.length > 0 ? selectedIssueTypes : ['other'];
      onRejectSegment?.(rejectingInstanceId, issueTypes, rejectReason);
      setRejectingInstanceId(null);
      setRejectReason('');
      setSelectedIssueTypes([]);
    }
  };

  const cancelReject = () => {
    setRejectingInstanceId(null);
    setRejectReason('');
    setSelectedIssueTypes([]);
  };

  const toggleIssueType = (issueType: string) => {
    setSelectedIssueTypes(prev =>
      prev.includes(issueType)
        ? prev.filter(t => t !== issueType)
        : [...prev, issueType]
    );
  };

  // Show QA controls when in QA or customer_qa stage
  const showQAControls = isQAMode && (taskStage === 'qa' || taskStage === 'customer_qa');

  // Calculate QA stats
  const qaStats = useMemo(() => {
    if (!showQAControls) return null;
    const total = segments.length;
    const approved = segments.filter(s => getSegmentReviewStatus(s.instanceId) === 'approved').length;
    const rejected = segments.filter(s => getSegmentReviewStatus(s.instanceId) === 'rejected').length;
    const pending = total - approved - rejected;
    return { total, approved, rejected, pending };
  }, [segments, segmentReviews, showQAControls, currentFrameIndex, segmentationMode]);

  // Calculate revision mode stats (from previous QA review)
  const revisionStats = useMemo(() => {
    if (!isRevisionMode || !currentFrameId || !segmentReviewsMap) return null;

    let approved = 0;
    let rejected = 0;

    segments.forEach(s => {
      const key = `${currentFrameId}-${segmentationMode}-${s.instanceId}`;
      const review = segmentReviewsMap.get(key);
      if (review?.verdict === 'approved') approved++;
      else if (review?.verdict === 'rejected') rejected++;
    });

    return { total: segments.length, approved, rejected, needsFix: rejected };
  }, [segments, segmentReviewsMap, currentFrameId, isRevisionMode, segmentationMode]);

  return (
    <div className="w-72 bg-dark-panel border-l border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Tab Header */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('segments')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'segments'
              ? 'text-white border-b-2 border-primary bg-dark-surface/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-dark-surface/20'
          }`}
        >
          Segments
          {segments.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'segments' ? 'bg-primary/30 text-primary-light' : 'bg-gray-700 text-gray-400'
            }`}>
              {segments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('issues')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'issues'
              ? 'text-white border-b-2 border-red-500 bg-dark-surface/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-dark-surface/20'
          }`}
        >
          Issues
          {spatialIssues.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'issues' ? 'bg-red-500/30 text-red-300' : 'bg-red-500/50 text-red-300'
            }`}>
              {spatialIssues.length}
            </span>
          )}
        </button>
      </div>

      {/* Segments Tab Content */}
      {activeTab === 'segments' && (
        <>
          {/* Stats Header */}
          <div className="px-4 py-3 border-b border-gray-700">
            {/* Revision Mode Stats */}
            {isRevisionMode && revisionStats && revisionStats.rejected > 0 ? (
              <div className="p-2 bg-red-900/20 rounded-lg border border-red-500/30">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-[10px] text-red-300 font-medium">Revision Required</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400">✓ {revisionStats.approved} approved</span>
                  <span className="text-red-400">✗ {revisionStats.rejected} to fix</span>
                </div>
              </div>
            ) : isRevisionMode && revisionStats && revisionStats.approved > 0 ? (
              <div className="p-2 bg-green-900/20 rounded-lg border border-green-500/30">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-green-300 font-medium">All Approved!</span>
                </div>
                <p className="text-[10px] text-green-400/70 mt-0.5">All segments passed QA review</p>
              </div>
            ) : showQAControls && qaStats ? (
              <div className="p-2 bg-dark rounded-lg border border-gray-700/50">
                <div className="text-[10px] text-gray-400 mb-1">Review Progress</div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400">✓ {qaStats.approved}</span>
                  <span className="text-red-400">✗ {qaStats.rejected}</span>
                  <span className="text-gray-400">○ {qaStats.pending}</span>
                </div>
                {/* Approve All Button */}
                {qaStats.pending > 0 && onApproveAll && (
                  <button
                    onClick={handleApproveAllSegments}
                    disabled={isApprovingAll}
                    className="mt-2 w-full px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-wait text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isApprovingAll ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Approving...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        Approve All ({qaStats.pending})
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-gray-500">
                {segmentationMode === 'instance'
                  ? 'Each object is a separate instance — press Enter to finish one and start the next'
                  : 'All points of the same class are grouped together'}
              </p>
            )}
          </div>

          {/* Merge action bar — appears when 2+ instances are picked */}
          {segmentationMode === 'instance' && !showQAControls && pickedInstanceIds.size >= 2 && (
            <div className="px-4 py-2 border-b border-gray-700 bg-primary/10 flex items-center justify-between">
              <span className="text-xs text-primary-light">{pickedInstanceIds.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => clearPickedInstances()}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear
                </button>
                <button
                  onClick={handleMergeSelected}
                  className="px-2.5 py-1 text-xs bg-primary text-white rounded hover:bg-primary/80 transition-colors"
                >
                  Merge
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Content - scrollable, takes available space */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Issues Tab Content */}
        {activeTab === 'issues' && (
          <div className="p-2">
            {spatialIssues.length > 0 ? (
              <div className="space-y-2">
                {spatialIssues.map((issue, index) => {
                  const resolved = !!issue.annotator_resolved;
                  return (
                  <div
                    key={issue.id}
                    onClick={() => onNavigateToIssue?.(issue)}
                    className={`group flex flex-col px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                      resolved
                        ? 'bg-dark-surface/30 border-emerald-500/30 hover:border-emerald-500/50'
                        : 'bg-dark-surface/50 hover:bg-dark-hover border-red-500/30 hover:border-red-500/50'
                    }`}
                  >
                    {/* Issue header */}
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                          resolved ? 'bg-emerald-500/20' : 'bg-red-500/20'
                        }`}
                      >
                        {resolved ? (
                          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-xs font-bold text-red-400">#{index + 1}</span>
                        )}
                      </div>
                      <span className={`text-sm font-medium ${resolved ? 'text-gray-400 line-through' : 'text-white'}`}>
                        Issue #{index + 1}
                      </span>
                      {resolved && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">
                          Fixed
                        </span>
                      )}
                      <svg className="w-4 h-4 text-gray-500 ml-auto group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                    </div>

                    {/* Issue types */}
                    {issue.issueTypes && issue.issueTypes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 mb-1">
                        {issue.issueTypes.map((issueType, idx) => (
                          <span
                            key={idx}
                            className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              resolved
                                ? 'bg-gray-700/30 text-gray-400 border-gray-700/30'
                                : 'bg-red-500/20 text-red-300 border-red-500/20'
                            }`}
                          >
                            {ISSUE_TYPE_LABELS[issueType] || issueType}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Issue notes */}
                    {issue.notes && (
                      <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">
                        {issue.notes}
                      </p>
                    )}

                    {/* Location info */}
                    <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-500">
                      <span>x: {issue.x.toFixed(2)}</span>
                      <span>y: {issue.y.toFixed(2)}</span>
                      <span>z: {issue.z.toFixed(2)}</span>
                    </div>

                    {/* Mark as Fixed — annotator action only when revising. */}
                    {canResolveIssues && !resolved && onResolveIssue && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResolveIssue(issue);
                        }}
                        className="mt-2 w-full py-1.5 text-[11px] font-medium rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                      >
                        Mark as Fixed
                      </button>
                    )}
                  </div>
                );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                <svg className="w-12 h-12 text-green-600 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <p className="text-sm text-gray-500">No point issues</p>
                <p className="text-xs text-gray-600 mt-1">
                  Use "Add Point Issue" to flag specific locations
                </p>
              </div>
            )}
          </div>
        )}

        {/* Segments Tab Content */}
        {activeTab === 'segments' && (
          segments.length > 0 ? (
          <div className="p-2 space-y-1">
            {segments.map((segment) => {
              const reviewStatus = getSegmentReviewStatus(segment.instanceId);
              const previousReview = getPersistedReview(segment.instanceId);
              const isRejectedInRevision = isRevisionMode && previousReview?.verdict === 'rejected';
              const isApprovedInRevision = isRevisionMode && previousReview?.verdict === 'approved';
              const isHidden = hiddenInstances.has(segment.instanceId);

              const statusBorder = reviewStatus === 'approved' || isApprovedInRevision
                ? 'border-l-4 border-l-green-500'
                : reviewStatus === 'rejected' || isRejectedInRevision
                  ? 'border-l-4 border-l-red-500'
                  : '';

              const isActive = segmentationMode === 'instance' && segment.instanceId === selectedInstanceId;
              return (
                <div
                  key={segment.instanceId}
                  ref={isActive ? activeRowRef : undefined}
                  onClick={segmentationMode === 'instance' && splitSourceInstanceId === null ? () => highlightInstance(segment.instanceId) : undefined}
                  className={`group flex flex-col px-3 py-2 rounded-lg border transition-all ${statusBorder} ${isHidden ? 'opacity-50' : ''} ${segmentationMode === 'instance' ? 'cursor-pointer' : ''} ${isActive ? 'bg-primary/20 border-primary ring-1 ring-primary/60' : 'bg-dark-surface/50 hover:bg-dark-hover border-gray-700/50'}`}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-2">
                    {/* QA Status indicator (for QA mode) */}
                    {showQAControls && (
                      <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center ${
                        reviewStatus === 'approved' ? 'bg-green-500' :
                        reviewStatus === 'rejected' ? 'bg-red-500' :
                        'bg-gray-600'
                      }`}>
                        {reviewStatus === 'approved' && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {reviewStatus === 'rejected' && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* Revision mode status indicator */}
                    {isRevisionMode && !showQAControls && previousReview && (
                      <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center ${
                        isApprovedInRevision ? 'bg-green-500' :
                        isRejectedInRevision ? 'bg-red-500' :
                        'bg-gray-600'
                      }`}>
                        {isApprovedInRevision && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {isRejectedInRevision && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* Merge selection checkbox (instance mode, annotation only) */}
                    {segmentationMode === 'instance' && !showQAControls && (
                      <input
                        type="checkbox"
                        checked={pickedInstanceIds.has(segment.instanceId)}
                        onChange={() => togglePickedInstance(segment.instanceId)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 flex-shrink-0 accent-primary cursor-pointer"
                        title="Select for merge"
                      />
                    )}

                    {/* Color indicator */}
                    <div
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/20"
                      style={{ backgroundColor: segment.color }}
                    />

                    {/* Segment name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white truncate block">
                        {segment.displayName}
                      </span>
                    </div>

                    {/* Point count */}
                    <span className="text-[10px] text-gray-500">
                      {segment.pointCount.toLocaleString()} pts
                    </span>

                    {/* Action buttons (show on hover - only in annotation mode) */}
                    {!showQAControls && (
                      <div className={`flex items-center gap-1 transition-opacity ${isHidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleInstanceVisibility(segment.instanceId);
                          }}
                          className={`p-1 rounded hover:bg-dark-hover ${isHidden ? 'text-yellow-500 hover:text-yellow-400' : 'text-gray-400 hover:text-white'}`}
                          title={isHidden ? "Show segment" : "Hide segment"}
                        >
                          {isHidden ? (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                        {segmentationMode === 'instance' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              beginSplit(segment.instanceId);
                            }}
                            className="p-1 rounded hover:bg-dark-hover text-gray-400 hover:text-white"
                            title="Split — select the points to separate into a new instance"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 3v6m0 6v6" />
                              <path d="M6 15l6-6 6 6" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteSegment(segment)}
                          className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400"
                          title="Delete segment"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* QA Review buttons row */}
                  {showQAControls && reviewStatus === 'pending' && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
                      <button
                        onClick={() => handleApproveSegment(segment.instanceId)}
                        className="flex-1 px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs rounded border border-green-500/30 transition-colors flex items-center justify-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        Accept
                      </button>
                      <button
                        onClick={() => handleRejectSegment(segment.instanceId)}
                        className="flex-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded border border-red-500/30 transition-colors flex items-center justify-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Reject
                      </button>
                    </div>
                  )}

                  {/* Revision Mode: Show previous QA feedback */}
                  {isRevisionMode && previousReview && (
                    <div className={`mt-2 pt-2 border-t ${
                      isRejectedInRevision ? 'border-red-500/30' : 'border-green-500/30'
                    }`}>
                      {/* Status badge */}
                      <div className="flex items-center gap-2 mb-1">
                        {isApprovedInRevision ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                            ✓ Approved
                          </span>
                        ) : isRejectedInRevision ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                            ✗ Needs Revision
                          </span>
                        ) : null}
                      </div>

                      {/* Issue types for rejected segments */}
                      {isRejectedInRevision && previousReview.issue_types && previousReview.issue_types.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {previousReview.issue_types.map((issue: string, idx: number) => (
                            <span
                              key={idx}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20"
                            >
                              {ISSUE_TYPE_LABELS[issue] || issue}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Notes for rejected segments */}
                      {isRejectedInRevision && previousReview.notes && (
                        <div className="mt-1.5 p-2 bg-red-500/5 rounded border border-red-500/20">
                          <p className="text-[10px] text-red-300/90 leading-relaxed">
                            <span className="text-red-400 font-medium">Issue: </span>
                            {previousReview.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <svg className="w-12 h-12 text-gray-600 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            <p className="text-sm text-gray-500">No segments yet</p>
            <p className="text-xs text-gray-600 mt-1">
              Use brush or lasso tools to label points
            </p>
          </div>
        ))}

        {/* Footer stats */}
        {activeTab === 'segments' && segments.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-700 bg-dark-surface/30">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Total labeled:</span>
              <span className="text-white font-medium">
                {labelStats.labeled.toLocaleString()} points
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-400">Progress:</span>
              <span className="text-emerald-400 font-medium">
                {labelStats.total > 0 ? ((labelStats.labeled / labelStats.total) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Settings - pinned to bottom */}
      <div className="flex-shrink-0 border-t border-gray-700 bg-dark-panel mt-auto">
        {/* View Settings */}
        <div className="px-4 py-3">
          <h3 className="text-xs text-gray-400 mb-3">View Settings</h3>

          {/* Unlabeled Points Color */}
          <div className="mb-3">
            <label className="text-xs text-gray-300 block mb-1.5">Unlabeled Points Color</label>
            <select
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as ColorMode)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-primary"
            >
              <option value="height" className="bg-gray-800 text-gray-200">Height (Rainbow)</option>
              <option value="intensity" className="bg-gray-800 text-gray-200">Intensity</option>
              <option value="rgb" className="bg-gray-800 text-gray-200">RGB (File color)</option>
              <option value="none" className="bg-gray-800 text-gray-200">None (Gray)</option>
            </select>
          </div>

          {/* Dim Unlabeled Points */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-300">Dim Unlabeled Points</span>
            <button
              onClick={() => setShowOnlyLabeled(!showOnlyLabeled)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                showOnlyLabeled ? 'bg-primary' : 'bg-gray-600'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                  showOnlyLabeled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Label Opacity */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-300">Label Opacity</span>
              <span className="text-xs text-primary-light font-medium">{Math.round(labelOpacity * 100)}%</span>
            </div>
            <div className="relative h-3 bg-gray-700 rounded-full">
              <div
                className="absolute h-3 bg-primary rounded-full"
                style={{ width: `${labelOpacity * 100}%` }}
              />
              <input
                type="range"
                min="0"
                max="100"
                value={labelOpacity * 100}
                onChange={(e) => setLabelOpacity(Number(e.target.value) / 100)}
                className="absolute inset-0 w-full h-3 opacity-0 cursor-pointer"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md border-2 border-primary"
                style={{ left: `calc(${labelOpacity * 100}% - 8px)` }}
              />
            </div>
          </div>
        </div>

        {/* 4D Mode */}
        <div className="border-t border-gray-700 px-4 py-3">
          <h3 className="text-xs text-gray-400 mb-3">4D Mode (Multi-Frame)</h3>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-300">Enable 4D Overlay</span>
            <button
              onClick={() => setIs4DMode(!is4DMode)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                is4DMode ? 'bg-primary' : 'bg-gray-600'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                  is4DMode ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Clear All Labels - only show when not in QA mode */}
        {!showQAControls && (
          <div className="border-t border-gray-700 px-4 py-3">
            <button
              onClick={async () => {
                if (confirm('Are you sure you want to clear all labels, issues, and comments? This will reset the task to a fresh annotation state and cannot be undone.')) {
                  if (onClearAllAndReset) {
                    await onClearAllAndReset();
                  } else {
                    clearAllLabels();
                  }
                }
              }}
              className="w-full py-2 bg-transparent border border-red-500/50 text-red-400 hover:bg-red-500/10 rounded-lg text-sm transition-colors"
            >
              Clear All Labels
            </button>
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      {rejectingInstanceId !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="bg-dark-panel border border-gray-600 rounded-lg shadow-xl max-w-md w-full mx-4 p-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Reject Segment</h3>

            {/* Issue Type Selection */}
            <div className="mb-4">
              <p className="text-sm text-gray-400 mb-2">Select issue type(s):</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'incomplete_segmentation', label: 'Incomplete' },
                  { id: 'over_segmentation', label: 'Over-segmented' },
                  { id: 'boundary_error', label: 'Boundary error' },
                  { id: 'wrong_class', label: 'Wrong class' },
                  { id: 'position_incorrect', label: 'Position incorrect' },
                  { id: 'other', label: 'Other' },
                ].map(issue => (
                  <button
                    key={issue.id}
                    onClick={() => toggleIssueType(issue.id)}
                    className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                      selectedIssueTypes.includes(issue.id)
                        ? 'bg-red-500/30 border-red-500 text-red-300'
                        : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {issue.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm text-gray-400 mb-2">
              Additional notes (optional):
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter additional details..."
              className="w-full px-3 py-2 bg-dark border border-gray-600 rounded-lg text-sm text-gray-200 resize-none h-20 focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={cancelReject}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmReject}
                disabled={selectedIssueTypes.length === 0 && !rejectReason.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SegmentsPanel;
