import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEditorStore } from '@/store/editorStore';
import { useQAStore, useQASuggestions } from '@/store/qaStore';
import { annotation3DApi, annotationApi, Annotation3DData, qaApi } from '@/api/client';
import { FlagModal } from './FlagModal';
import type { AnnotationReview } from '@/types';
import {
  calculateTrackMetrics,
  calculateTrackDifficulty,
  getDifficultyLevel,
  type DifficultyScore,
} from '@/utils/trackDifficultyScorer';
import type { Annotation, ClassDefinition } from '@/types';


const PlayIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const StepBackIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const StepForwardIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const LoopIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);


type PlaybackSpeed = 0.5 | 1 | 2 | 4;
type SortMode = 'difficulty' | 'frames' | 'class';
type TrackStatus = 'pending' | 'in_progress' | 'approved' | 'rejected';

interface TrackData {
  trackId: string;
  annotations: Annotation[];
  frameIndices: number[];
  frameIndexToAnnotation: Map<number, Annotation>;
  difficulty: DifficultyScore;
  className: string;
  classColor: string;
  firstFrameIndex: number;
  lastFrameIndex: number;
  previousIssues: AnnotationReview[];
  suggestions: any[];
  suggestionCount: number;
  uniqueIssueCount: number;
}

interface TrackReviewTabProps {
  onJumpToAnnotation: (annotationId: string, frameId: string, zoomLevel?: number) => void;
  onSelectTrack: (trackId: string) => void;
}


function useTrackStatus(annotations: Annotation[]): TrackStatus {
  const { annotationReviews } = useQAStore();

  return useMemo(() => {
    let reviewed = 0;
    let hasRejectedOrFlagged = false;

    for (const ann of annotations) {
      const review = annotationReviews.get(ann.id);
      if (review?.verdict && review.verdict !== 'pending') {
        reviewed++;
        if (review.verdict === 'rejected' || review.verdict === 'flagged') {
          hasRejectedOrFlagged = true;
        }
      }
    }

    if (hasRejectedOrFlagged) return 'rejected';
    if (reviewed === annotations.length && reviewed > 0) return 'approved';
    if (reviewed > 0) return 'in_progress';
    return 'pending';
  }, [annotations, annotationReviews]);
}


interface TrackPlayerProps {
  track: TrackData;
  onApproveBox: (annotationId: string) => Promise<void>;
  onRejectBox: (annotationId: string) => void;
  onFlagBox: (annotationId: string) => void;
  onApproveTrack: () => Promise<void>;
  onRejectTrack: () => void;
  autoAdvance: boolean;
  onJumpToAnnotation: (annotationId: string, frameId: string, zoomLevel?: number) => void;
}

export const TrackPlayer: React.FC<TrackPlayerProps> = ({
  track,
  onApproveBox,
  onRejectBox,
  onFlagBox,
  onApproveTrack,
  onRejectTrack,
  autoAdvance,
  onJumpToAnnotation,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [isLooping, setIsLooping] = useState(false);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);

  const currentFrameIndex = useEditorStore((s) => s.currentFrameIndex);
  const goToFrame = useEditorStore((s) => s.goToFrame);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const frames = useEditorStore((s) => s.frames);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const taskId = useEditorStore((s) => s.task?.id);
  const { getAnnotationReview, annotationReviews } = useQAStore();
  const queryClient = useQueryClient();

  const totalFrames = frames.length;
  const currentAnnotation = track.frameIndexToAnnotation.get(currentFrameIndex);
  const isTrackVisibleInCurrentFrame = !!currentAnnotation;

  const annotationData = currentAnnotation?.data as {
    center?: { x: number; y: number; z: number };
    position?: { x: number; y: number; z: number };
    dimensions?: { length: number; width: number; height: number };
    rotation?: { yaw: number; pitch?: number; roll?: number };
  } | undefined;
  const center = annotationData?.center || annotationData?.position;
  const dims = annotationData?.dimensions;
  const rotation = annotationData?.rotation;

  const classDef = taxonomy?.classes?.find(c => c.id === currentAnnotation?.class_id);
  const attributeEntries = classDef?.attributes ? Object.entries(classDef.attributes) : [];
  const storedAttributes = ((currentAnnotation?.attributes || {}) as Record<string, unknown>);

  const handleUpdateAttributes = useCallback(async (attrName: string, value: unknown) => {
    if (!currentAnnotation) return;
    try {
      const newAttributes = { ...storedAttributes, [attrName]: value };
      await annotation3DApi.update(currentAnnotation.id, { attributes: newAttributes });
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations', taskId] });
    } catch (error) {
      console.error('Failed to update annotation attributes:', error);
    }
  }, [currentAnnotation, storedAttributes, taskId, queryClient]);

  const trackStats = useMemo(() => {
    let reviewed = 0;
    let approved = 0;
    let rejected = 0;
    let flagged = 0;

    track.annotations.forEach(ann => {
      const review = annotationReviews.get(ann.id);
      if (review?.verdict && review.verdict !== 'pending') {
        reviewed++;
        if (review.verdict === 'approved') approved++;
        else if (review.verdict === 'rejected') rejected++;
        else if (review.verdict === 'flagged') flagged++;
      }
    });

    return { total: track.annotations.length, reviewed, approved, rejected, flagged };
  }, [track.annotations, annotationReviews]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      setIsPlaying(true);
    }
  }, [isPlaying, stopPlayback]);

  const stepToNextTrackFrame = useCallback(() => {
    const nextFrameIdx = track.frameIndices.find(idx => idx > currentFrameIndex);
    if (nextFrameIdx !== undefined) {
      goToFrame(nextFrameIdx);
    } else if (isLooping && track.frameIndices.length > 0) {
      goToFrame(track.frameIndices[0]);
    }
  }, [currentFrameIndex, track.frameIndices, goToFrame, isLooping]);

  const stepToPrevTrackFrame = useCallback(() => {
    const prevFrameIdx = [...track.frameIndices].reverse().find(idx => idx < currentFrameIndex);
    if (prevFrameIdx !== undefined) {
      goToFrame(prevFrameIdx);
    } else if (isLooping && track.frameIndices.length > 0) {
      goToFrame(track.frameIndices[track.frameIndices.length - 1]);
    }
  }, [currentFrameIndex, track.frameIndices, goToFrame, isLooping]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = 400 / playbackSpeed;

    playbackRef.current = setTimeout(() => {
      const currentTrackFrameIdx = track.frameIndices.indexOf(currentFrameIndex);

      if (currentTrackFrameIdx < track.frameIndices.length - 1) {
        goToFrame(track.frameIndices[currentTrackFrameIdx + 1]);
      } else if (isLooping) {
        goToFrame(track.frameIndices[0]);
      } else {
        setIsPlaying(false);
      }
    }, interval);

    return () => {
      if (playbackRef.current) {
        clearTimeout(playbackRef.current);
        playbackRef.current = null;
      }
    };
  }, [isPlaying, currentFrameIndex, track.frameIndices, playbackSpeed, isLooping, goToFrame]);

  useEffect(() => {
    if (currentAnnotation) {
      const timeoutId = setTimeout(() => {
        selectAnnotation(currentAnnotation.id);
        focusOnAnnotation(currentAnnotation.id);
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [currentAnnotation, selectAnnotation, focusOnAnnotation]);

  const currentVerdict = currentAnnotation ? getAnnotationReview(currentAnnotation.id)?.verdict : undefined;
  const isPending = !currentVerdict || currentVerdict === 'pending';

  const handleApproveCurrentBox = useCallback(async () => {
    if (!currentAnnotation) return;
    await onApproveBox(currentAnnotation.id);

    if (autoAdvance) {
      setTimeout(() => {
        stepToNextTrackFrame();
      }, 100);
    }
  }, [currentAnnotation, onApproveBox, autoAdvance, stepToNextTrackFrame]);

  const currentPosition = totalFrames > 1 ? (currentFrameIndex / (totalFrames - 1)) * 100 : 0;

  return (
    <div className="bg-gray-800/50 border-t border-gray-700/50">
      {/* Track info bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/30">
        <div className="flex items-center gap-2">
          {isTrackVisibleInCurrentFrame ? (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-600/30 text-green-300 text-xs rounded">
              <EyeIcon /> Visible
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-gray-400 text-xs rounded">
              <EyeOffIcon /> Not in frame
            </span>
          )}
          <span className="text-xs text-gray-500">
            Frame {(frames[currentFrameIndex]?.frame_index ?? currentFrameIndex) + 1} / {totalFrames}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">{trackStats.reviewed}/{trackStats.total}</span>
          {trackStats.approved > 0 && <span className="text-green-400">✓{trackStats.approved}</span>}
          {trackStats.rejected > 0 && <span className="text-red-400">✗{trackStats.rejected}</span>}
          {trackStats.flagged > 0 && <span className="text-yellow-400">!{trackStats.flagged}</span>}
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Step & Play */}
          <button
            onClick={stepToPrevTrackFrame}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Previous track frame"
          >
            <StepBackIcon />
          </button>

          <button
            onClick={togglePlayPause}
            className={`p-1.5 rounded ${isPlaying ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            onClick={stepToNextTrackFrame}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Next track frame"
          >
            <StepForwardIcon />
          </button>

          {/* Speed */}
          <div className="flex items-center gap-0.5 ml-2">
            {([0.5, 1, 2, 4] as PlaybackSpeed[]).map(s => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`px-1.5 py-0.5 text-xs rounded ${
                  playbackSpeed === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Loop */}
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`p-1.5 rounded ${isLooping ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-white'}`}
            title="Loop"
          >
            <LoopIcon />
          </button>
        </div>

        {/* Current box actions */}
        {isTrackVisibleInCurrentFrame && (
          <div className="flex items-center gap-1">
            {isPending ? (
              <>
                <button
                  onClick={handleApproveCurrentBox}
                  className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs text-white"
                  title="Approve this box (1)"
                >
                  <CheckIcon /> Box
                </button>
                <button
                  onClick={() => onRejectBox(currentAnnotation!.id)}
                  className="p-1.5 bg-red-600/60 hover:bg-red-600 rounded text-red-100"
                  title="Reject this box (2)"
                >
                  <XIcon />
                </button>
                <button
                  onClick={() => onFlagBox(currentAnnotation!.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600/70 hover:bg-yellow-600 rounded text-sm text-yellow-50 font-medium shadow-lg"
                  title="Flag this box (3)"
                >
                  <FlagIcon /> Flag
                </button>
              </>
            ) : (
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                currentVerdict === 'approved' ? 'bg-green-500/30 text-green-400' :
                currentVerdict === 'rejected' ? 'bg-red-500/30 text-red-400' :
                'bg-yellow-500/30 text-yellow-400'
              }`}>
                {currentVerdict === 'approved' ? '✓' : currentVerdict === 'rejected' ? '✗' : '!'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Annotation Properties and Attributes */}
      {isTrackVisibleInCurrentFrame && currentAnnotation && (
        <div className="px-3 py-2 border-t border-gray-700/30">
          <div className="bg-gray-800/50 rounded p-2 space-y-2">
            {/* Position */}
            {center && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-10">POS</span>
                <span className="text-purple-400">X</span>
                <span className="text-white">{center.x.toFixed(2)}</span>
                <span className="text-purple-400 ml-2">Y</span>
                <span className="text-white">{center.y.toFixed(2)}</span>
                <span className="text-purple-400 ml-2">Z</span>
                <span className="text-white">{center.z.toFixed(2)}</span>
              </div>
            )}
            {/* Dimensions */}
            {dims && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-10">SIZE</span>
                <span className="text-purple-400">L</span>
                <span className="text-white">{dims.length.toFixed(2)}</span>
                <span className="text-purple-400 ml-2">W</span>
                <span className="text-white">{dims.width.toFixed(2)}</span>
                <span className="text-purple-400 ml-2">H</span>
                <span className="text-white">{dims.height.toFixed(2)}</span>
              </div>
            )}
            {/* Rotation */}
            {rotation && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-10">YAW</span>
                <span className="text-white">{((rotation.yaw || 0) * 180 / Math.PI).toFixed(1)}°</span>
              </div>
            )}

            {/* Editable Attributes */}
            {attributeEntries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                <span className="text-[10px] text-gray-500 font-semibold uppercase">Attributes</span>
                <div className="mt-1 space-y-1.5">
                  {attributeEntries.map(([attrName, attr]) => {
                    const currentValue = storedAttributes[attrName];
                    return (
                      <div key={attrName} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-gray-400">{attrName}</span>
                        {attr.type === 'boolean' ? (
                          <button
                            onClick={() => handleUpdateAttributes(attrName, !currentValue)}
                            className={`w-8 h-4 rounded-full transition-colors ${currentValue ? 'bg-green-500' : 'bg-gray-600'}`}
                          >
                            <div className={`w-3 h-3 rounded-full bg-white transform transition-transform ${currentValue ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        ) : attr.type === 'enum' && attr.options ? (
                          <select
                            value={(currentValue as string) || ''}
                            onChange={(e) => handleUpdateAttributes(attrName, e.target.value)}
                            className="bg-gray-700 text-white px-2 py-0.5 rounded text-xs border border-gray-600"
                          >
                            <option value="">--</option>
                            {attr.options.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={(currentValue as string) || ''}
                            onChange={(e) => handleUpdateAttributes(attrName, e.target.value)}
                            className="bg-gray-700 text-white px-2 py-0.5 rounded text-xs border border-gray-600 w-24"
                            placeholder="--"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mini timeline */}
      <div className="px-3 pb-2">
        <div className="relative h-4 bg-gray-900 rounded overflow-hidden">
          {/* Track span highlight */}
          {track.frameIndices.length > 0 && (
            <div
              className="absolute top-0 h-full bg-purple-900/40"
              style={{
                left: `${(track.firstFrameIndex / (totalFrames - 1)) * 100}%`,
                width: `${((track.lastFrameIndex - track.firstFrameIndex) / (totalFrames - 1)) * 100}%`,
              }}
            />
          )}

          {/* Frame dots */}
          {track.frameIndices.map(frameIdx => {
            const position = totalFrames > 1 ? (frameIdx / (totalFrames - 1)) * 100 : 50;
            const ann = track.frameIndexToAnnotation.get(frameIdx);
            const review = ann ? annotationReviews.get(ann.id) : undefined;

            let dotColor = 'bg-purple-400';
            if (review?.verdict === 'approved') dotColor = 'bg-green-500';
            else if (review?.verdict === 'rejected') dotColor = 'bg-red-500';
            else if (review?.verdict === 'flagged') dotColor = 'bg-yellow-500';

            return (
              <div
                key={frameIdx}
                onClick={() => {
                  goToFrame(frameIdx);
                  if (ann) {
                    setTimeout(() => {
                      selectAnnotation(ann.id);
                      onJumpToAnnotation(ann.id, ann.frame_id, 3);
                    }, 50);
                  }
                }}
                className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full cursor-pointer hover:scale-150 transition-transform ${dotColor}`}
                style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
                title={`Frame ${(frames[frameIdx]?.frame_index ?? frameIdx) + 1}`}
              />
            );
          })}

          {/* Current position */}
          <div
            className="absolute top-0 h-full w-0.5 bg-white"
            style={{ left: `${currentPosition}%` }}
          />
        </div>
      </div>

      {/* Approve/Reject track buttons */}
      <div className="px-3 pb-2 flex gap-2">
        <button
          onClick={onApproveTrack}
          className="flex-1 py-1.5 bg-green-600/40 hover:bg-green-600 rounded text-sm text-green-100 font-medium transition-colors"
        >
          ✓ Approve Track ({track.annotations.length})
        </button>
        <button
          onClick={onRejectTrack}
          className="flex-1 py-1.5 bg-red-600/40 hover:bg-red-600 rounded text-sm text-red-100 font-medium transition-colors"
        >
          ✗ Reject Track ({track.annotations.length})
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// PREVIOUS ISSUES SECTION COMPONENT
// ============================================================================

interface PreviousIssuesSectionProps {
  issues: AnnotationReview[];
  frames: { id: string; frame_index?: number }[];
  onJumpToFrame: (frameId: string) => void;
  onApproveIssue: (annotationId: string) => Promise<void>;
}

const PreviousIssuesSection: React.FC<PreviousIssuesSectionProps> = ({
  issues,
  frames,
  onJumpToFrame,
  onApproveIssue,
}) => {
  const [approvedIssues, setApprovedIssues] = useState<Set<string>>(new Set());
  const { annotationReviews } = useQAStore();

  // Check if issue is resolved in current session
  const isIssueResolved = useCallback((issue: AnnotationReview) => {
    if (!issue.annotation_id) return false;
    // Check if already approved in this callback's local state
    if (approvedIssues.has(issue.annotation_id)) return true;
    // Check if approved in current QA session
    const currentReview = annotationReviews.get(issue.annotation_id);
    return currentReview?.verdict === 'approved';
  }, [annotationReviews, approvedIssues]);

  const handleApprove = async (annotationId: string) => {
    await onApproveIssue(annotationId);
    setApprovedIssues(prev => new Set([...prev, annotationId]));
  };

  const getFrameName = (frameId: string | undefined) => {
    if (!frameId) return 'Unknown frame';
    const frame = frames.find(f => f.id === frameId);
    return frame?.frame_index !== undefined ? `Frame ${frame.frame_index + 1}` : `Frame ${frameId.slice(0, 8)}`;
  };

  return (
    <div className="bg-orange-900/20 border-t border-orange-700/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-orange-400 text-sm font-medium">⚠ Previous Issues</span>
        <span className="text-xs text-gray-500">from last review</span>
      </div>

      <div className="space-y-2">
        {issues.map((issue) => {
          const resolved = isIssueResolved(issue);
          return (
            <div
              key={issue.id}
              className={`
                flex items-start gap-2 p-2 rounded text-xs
                ${resolved
                  ? 'bg-green-900/20 border border-green-700/30'
                  : 'bg-gray-800/50 border border-gray-700/30'}
              `}
            >
              {/* Status dot */}
              <div
                className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                  resolved ? 'bg-green-500' :
                  issue.verdict === 'flagged' ? 'bg-yellow-500' : 'bg-red-500'
                }`}
              />

              <div className="flex-1 min-w-0">
                {/* Issue type and frame */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-medium ${
                    issue.verdict === 'flagged' ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {issue.verdict === 'flagged' ? 'Flagged' : 'Rejected'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (issue.frame_id) onJumpToFrame(issue.frame_id);
                    }}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {getFrameName(issue.frame_id)}
                  </button>
                </div>

                {/* Issue types */}
                {issue.issue_types && issue.issue_types.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {issue.issue_types.map((type: string, idx: number) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 bg-gray-700/50 text-gray-300 rounded text-xs"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {issue.notes && (
                  <p className="text-gray-400 italic">"{issue.notes}"</p>
                )}
              </div>

              {/* Action button */}
              {!resolved && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (issue.annotation_id) handleApprove(issue.annotation_id);
                  }}
                  className="flex-shrink-0 px-2 py-1 bg-green-600/60 hover:bg-green-600 text-green-100 rounded text-xs"
                  title="Approve fix"
                >
                  ✓ Fixed
                </button>
              )}

              {resolved && (
                <span className="flex-shrink-0 px-2 py-1 text-green-400 text-xs">
                  ✓ Resolved
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const TrackReviewTab: React.FC<TrackReviewTabProps> = ({
  onJumpToAnnotation,
  onSelectTrack,
}) => {
  // State
  const [sortMode, setSortMode] = useState<SortMode>('difficulty');
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const autoAdvanceRef = useRef(autoAdvance);
  const trackItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Flag modal state
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagAnnotationId, setFlagAnnotationId] = useState<string | null>(null);
  const pendingFlagRef = useRef<{ annotationId: string; trackId: string; frameId?: string; classId?: string } | null>(null);

  // Pending rejection tracking
  const pendingRejectionRef = useRef<{ annotationId: string; trackId: string; frameId?: string; classId?: string } | null>(null);
  const lastProcessedRejectionRef = useRef<string | null>(null);

  // Update ref
  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  // Store data
  const suggestions = useQASuggestions();
  const {
    approveAnnotation,
    approveAllVisible,
    openRejectionModal,
    flagAnnotation,
    getAnnotationReview,
    approveTrack,
    showRejectionModal,
    annotationReviews,
    generateSuggestions,
    isLoadingSuggestions,
  } = useQAStore();

  // Get task ID for loading all annotations across all frames
  const taskId = useEditorStore((s) => s.task?.id);
  const frames = useEditorStore((s) => s.frames);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const goToFrame = useEditorStore((s) => s.goToFrame);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const selectedAnnotationIds = useEditorStore((s) => s.selection.selectedAnnotationIds);
  const selectedAnnotationId = selectedAnnotationIds.length > 0 ? selectedAnnotationIds[0] : null;
  const currentFrameIndex = useEditorStore((s) => s.currentFrameIndex);
  const currentFrame = frames[currentFrameIndex];

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Update annotation handlers
  const handleUpdateAnnotationClass = useCallback(async (annotationId: string, classId: string) => {
    try {
      await annotation3DApi.update(annotationId, { class_id: classId });
      // Invalidate cache to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations-track-review', taskId] });
    } catch (error) {
      console.error('Failed to update annotation class:', error);
    }
  }, [taskId, queryClient]);

  const handleUpdateAnnotationAttributes = useCallback(async (annotationId: string, attributes: Record<string, unknown>) => {
    try {
      await annotation3DApi.update(annotationId, { attributes });
      // Invalidate cache to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations-track-review', taskId] });
    } catch (error) {
      console.error('Failed to update annotation attributes:', error);
    }
  }, [taskId, queryClient]);

  // Load ALL annotations for the task (from both legacy and 3D tables)
  // This is needed to show all frames in a track, not just the ones visible
  const { data: allTaskAnnotations } = useQuery({
    queryKey: ['all-annotations-track-review', taskId],
    queryFn: async () => {
      if (!taskId) return [];
      // Query both legacy annotations table and annotations_3d table
      // Use page_size=1000 (max allowed by backend) and fetch all pages
      const fetchAllLegacyAnnotations = async (): Promise<Annotation[]> => {
        const allAnns: Annotation[] = [];
        let page = 1;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          try {
            const batch = await annotationApi.list({ taskId, page, pageSize });
            allAnns.push(...batch);
            hasMore = batch.length === pageSize;
            page++;
          } catch (err) {
            console.error('[TrackReviewTab] Error fetching legacy annotations page', page, err);
            hasMore = false;
          }
        }
        return allAnns;
      };
      const [legacyAnns, ann3d] = await Promise.all([
        fetchAllLegacyAnnotations(),
        annotation3DApi.list(taskId).catch(() => [])
      ]);
      // Combine - legacy annotations have cuboids, ann3d is the newer table
      // Dedupe by ID if same annotation exists in both
      const seen = new Set<string>();
      const combined: Annotation3DData[] = [];

      // Add legacy annotations (these have track_id already)
      for (const ann of legacyAnns) {
        if (ann.type === 'cuboid' && !seen.has(ann.id)) {
          seen.add(ann.id);
          combined.push({
            id: ann.id,
            task_id: ann.task_id || taskId,
            frame_id: ann.frame_id,
            track_id: ann.track_id ?? undefined,
            type: ann.type,
            class_id: ann.class_id,
            data: ann.data as Annotation3DData['data'],
            attributes: ann.attributes ?? {},
            source: ann.source,
            is_migrated_to_fusion: false,
            is_keyframe: ann.is_keyframe ?? false,
            created_at: ann.created_at || new Date().toISOString(),
            updated_at: ann.updated_at || new Date().toISOString(),
          });
        }
      }

      // Add 3D annotations that aren't already in the set
      for (const ann of ann3d) {
        if (!seen.has(ann.id)) {
          seen.add(ann.id);
          combined.push(ann);
        }
      }

      console.log('[TrackReviewTab] Combined annotations:', {
        legacy: legacyAnns.length,
        ann3d: ann3d.length,
        combined: combined.length,
        withTrackId: combined.filter(a => a.track_id).length
      });

      return combined;
    },
    enabled: !!taskId,
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
  });

  // Get the current active review ID to exclude it from previous issues
  const { qaSession } = useQAStore();
  const currentReviewId = qaSession?.id;

  // Fetch all previous reviews for this task (completed ones that had issues)
  const { data: previousReviews } = useQuery({
    queryKey: ['previous-reviews-for-task', taskId, currentReviewId],
    queryFn: async () => {
      if (!taskId) return [];
      const reviews = await qaApi.getTaskReviews(taskId);
      // Filter to only completed reviews (not the current active one)
      // Note: status can be 'in_progress' | 'paused' | 'completed', we want completed
      return reviews.filter(r =>
        r.id !== currentReviewId &&
        r.status === 'completed'
      );
    },
    enabled: !!taskId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // Fetch all issues (rejected/flagged annotations) from previous reviews
  const { data: previousIssuesData } = useQuery({
    queryKey: ['previous-review-issues', previousReviews?.map(r => r.id).join(',')],
    queryFn: async () => {
      if (!previousReviews || previousReviews.length === 0) return [];

      const allIssues: AnnotationReview[] = [];

      for (const review of previousReviews) {
        try {
          // Fetch rejected and flagged annotations from each review
          const [rejected, flagged] = await Promise.all([
            qaApi.getAnnotationReviews(review.id, 'rejected'),
            qaApi.getAnnotationReviews(review.id, 'flagged'),
          ]);
          allIssues.push(...rejected, ...flagged);
        } catch (error) {
          console.warn(`Failed to fetch issues for review ${review.id}:`, error);
        }
      }

      return allIssues;
    },
    enabled: !!previousReviews && previousReviews.length > 0,
    staleTime: 60 * 1000, // Cache longer - previous issues don't change
    refetchOnWindowFocus: false,
  });

  // Map Annotation3DData to Annotation type for compatibility with track processing
  const allAnnotations: Annotation[] = useMemo(() => {
    if (!allTaskAnnotations) return [];

    // Debug logging to diagnose track_id issues
    const annotationsWithTrackId = allTaskAnnotations.filter((ann: Annotation3DData) => ann.track_id);
    const annotationsWithoutTrackId = allTaskAnnotations.filter((ann: Annotation3DData) => !ann.track_id);
    console.log('[TrackReviewTab] Annotations loaded:', {
      total: allTaskAnnotations.length,
      withTrackId: annotationsWithTrackId.length,
      withoutTrackId: annotationsWithoutTrackId.length,
      sampleWithTrackId: annotationsWithTrackId[0],
      sampleWithoutTrackId: annotationsWithoutTrackId[0],
    });

    return allTaskAnnotations.map((ann: Annotation3DData): Annotation => ({
      id: ann.id,
      task_id: ann.task_id,
      frame_id: ann.frame_id,
      track_id: ann.track_id,
      type: ann.type === 'bbox' ? 'box2d' : ann.type === 'point' ? 'keypoints' : ann.type as Annotation['type'],
      class_id: ann.class_id,
      data: ann.data,
      attributes: ann.attributes ?? {},
      source: 'manual' as Annotation['source'],
      is_keyframe: ann.is_keyframe,
      is_verified: false,
      created_at: ann.created_at,
      updated_at: ann.updated_at,
    }));
  }, [allTaskAnnotations]);

  // Track if we've attempted to load suggestions for this specific qaSession
  const hasAttemptedLoad = useRef<string | null>(null);

  // Ensure suggestions are loaded/generated on mount or when taskId/qaSession changes
  useEffect(() => {
    const ensureSuggestionsLoaded = async () => {
      if (!taskId || !qaSession || isLoadingSuggestions) {
        console.log('[TrackReviewTab] Skipping suggestions load:', { taskId, qaSession: !!qaSession, isLoadingSuggestions });
        return;
      }

      // Use qaSession.id to track if we've loaded for this session, not just task
      const sessionKey = `${taskId}-${qaSession.id}`;
      if (hasAttemptedLoad.current === sessionKey) {
        console.log('[TrackReviewTab] Already loaded suggestions for session:', sessionKey, 'count:', suggestions.length);
        return;
      }

      console.log('[TrackReviewTab] Loading suggestions. Current count:', suggestions.length);
      hasAttemptedLoad.current = sessionKey;

      // Always try to load suggestions, generate only if none exist
      if (suggestions.length === 0) {
        console.log('[TrackReviewTab] No suggestions found, generating for task:', taskId);
        await generateSuggestions(taskId, false);
      } else {
        console.log('[TrackReviewTab] Suggestions already loaded:', suggestions.length);
      }
    };

    ensureSuggestionsLoaded();
  }, [taskId, qaSession, isLoadingSuggestions, generateSuggestions, suggestions.length]);

  // Log suggestions change for debugging
  useEffect(() => {
    console.log('[TrackReviewTab] Suggestions updated:', suggestions.length, 'items');
    if (suggestions.length > 0) {
      const withAnnotationId = suggestions.filter(s => s.annotation_id).length;
      console.log('[TrackReviewTab] Suggestions with annotation_id:', withAnnotationId);
    }
  }, [suggestions.length]);

  // Build class lookup
  const classLookup = useMemo(() => {
    const byId = new Map<string, ClassDefinition>();
    const byName = new Map<string, ClassDefinition>();
    taxonomy?.classes.forEach(c => {
      byId.set(c.id, c);
      byName.set(c.name.toLowerCase(), c);
    });
    return { byId, byName };
  }, [taxonomy]);

  const findClass = (classId: string): { name: string; color: string } => {
    let classDef = classLookup.byId.get(classId);
    if (classDef) return { name: classDef.name, color: classDef.color };
    classDef = classLookup.byName.get(classId.toLowerCase());
    if (classDef) return { name: classDef.name, color: classDef.color };
    return { name: classId, color: '#888888' };
  };

  // Annotation suggestions (excluding false negatives)
  const annotationSuggestions = useMemo(() =>
    suggestions.filter(s => s.suggestion_type !== 'false_negative'),
    [suggestions]
  );

  // Build track data - only annotations WITH track_id
  const trackData = useMemo(() => {
    const trackMap = new Map<string, Annotation[]>();

    allAnnotations.forEach(ann => {
      if (!ann.track_id) return; // Skip standalone annotations
      const existing = trackMap.get(ann.track_id) || [];
      existing.push(ann);
      trackMap.set(ann.track_id, existing);
    });

    const tracks: TrackData[] = [];

    trackMap.forEach((annotations, trackId) => {
      const firstAnn = annotations[0];
      const classInfo = findClass(firstAnn.class_id);

      // Build frame index mapping
      const frameIndexToAnnotation = new Map<number, Annotation>();
      const frameIndices: number[] = [];

      annotations.forEach(ann => {
        const frameIdx = frames.findIndex(f => f.id === ann.frame_id);
        if (frameIdx >= 0) {
          frameIndexToAnnotation.set(frameIdx, ann);
          frameIndices.push(frameIdx);
        }
      });

      frameIndices.sort((a, b) => a - b);

      // Calculate difficulty
      const metrics = calculateTrackMetrics(annotations);
      if (!metrics) return;

      const trackSuggestions = annotationSuggestions.filter(
        s => s.annotation_id && annotations.some(a => a.id === s.annotation_id)
      );

      if (trackSuggestions.length > 0) {
        console.log('[TrackReviewTab] Track', trackId, 'has', trackSuggestions.length, 'suggestions');
      }

      const difficulty = calculateTrackDifficulty(metrics, classInfo.name, trackSuggestions);

      // Find previous issues for annotations in this track
      const annotationIds = new Set(annotations.map(a => a.id));
      const trackPreviousIssues = (previousIssuesData || []).filter(
        issue => issue.annotation_id && annotationIds.has(issue.annotation_id)
      );

      // Count unique issues by grouping by message (filter out undefined/empty messages)
      const uniqueIssues = new Set(
        trackSuggestions
          .filter(s => s.message && s.message.trim())
          .map(s => s.message)
      );

      tracks.push({
        trackId,
        annotations,
        frameIndices,
        frameIndexToAnnotation,
        difficulty,
        className: classInfo.name,
        classColor: classInfo.color,
        firstFrameIndex: frameIndices.length > 0 ? Math.min(...frameIndices) : 0,
        lastFrameIndex: frameIndices.length > 0 ? Math.max(...frameIndices) : 0,
        previousIssues: trackPreviousIssues,
        suggestions: trackSuggestions,
        suggestionCount: trackSuggestions.length,
        uniqueIssueCount: uniqueIssues.size,
      });
    });

    return tracks;
  }, [allAnnotations, annotationSuggestions, classLookup, frames, previousIssuesData]);

  // Sort tracks
  const sortedTracks = useMemo(() => {
    let sorted = [...trackData];
    switch (sortMode) {
      case 'difficulty':
        sorted.sort((a, b) => b.difficulty.totalScore - a.difficulty.totalScore);
        break;
      case 'frames':
        sorted.sort((a, b) => b.frameIndices.length - a.frameIndices.length);
        break;
      case 'class':
        sorted.sort((a, b) => a.className.localeCompare(b.className));
        break;
    }
    return sorted;
  }, [trackData, sortMode]);

  // Filter to only tracks visible in current frame
  const currentFrameTracks = useMemo(() => {
    if (!currentFrame) return [];
    return sortedTracks.filter(track =>
      track.annotations.some(ann => ann.frame_id === currentFrame.id)
    );
  }, [sortedTracks, currentFrame]);

  // Calculate overall progress for ALL tracks (needed for bulk operations)
  const qaProgress = useMemo(() => {
    let totalTracks = sortedTracks.length;
    let approvedTracks = 0;
    let rejectedTracks = 0;
    let inProgressTracks = 0;

    sortedTracks.forEach(track => {
      let reviewed = 0;
      let hasIssue = false;

      track.annotations.forEach(ann => {
        const review = annotationReviews.get(ann.id);
        if (review?.verdict && review.verdict !== 'pending') {
          reviewed++;
          if (review.verdict === 'rejected' || review.verdict === 'flagged') {
            hasIssue = true;
          }
        }
      });

      if (hasIssue) rejectedTracks++;
      else if (reviewed === track.annotations.length && reviewed > 0) approvedTracks++;
      else if (reviewed > 0) inProgressTracks++;
    });

    return { totalTracks, approvedTracks, rejectedTracks, inProgressTracks };
  }, [sortedTracks, annotationReviews]);

  // Calculate progress for current frame tracks only
  const currentFrameQaProgress = useMemo(() => {
    let totalTracks = currentFrameTracks.length;
    let approvedTracks = 0;
    let rejectedTracks = 0;
    let inProgressTracks = 0;

    currentFrameTracks.forEach(track => {
      // Only count annotations in current frame for status
      const currentFrameAnns = track.annotations.filter(ann => ann.frame_id === currentFrame?.id);
      let reviewed = 0;
      let hasIssue = false;

      currentFrameAnns.forEach(ann => {
        const review = annotationReviews.get(ann.id);
        if (review?.verdict && review.verdict !== 'pending') {
          reviewed++;
          if (review.verdict === 'rejected' || review.verdict === 'flagged') {
            hasIssue = true;
          }
        }
      });

      if (hasIssue) rejectedTracks++;
      else if (reviewed === currentFrameAnns.length && reviewed > 0) approvedTracks++;
      else if (reviewed > 0) inProgressTracks++;
    });

    return { totalTracks, approvedTracks, rejectedTracks, inProgressTracks };
  }, [currentFrameTracks, annotationReviews, currentFrame]);

  // Calculate progress for CURRENT FRAME only (tracked boxes in this frame)
  const currentFrameProgress = useMemo(() => {
    let totalBoxes = 0;
    let pendingBoxes = 0;

    sortedTracks.forEach(track => {
      track.annotations.forEach(ann => {
        if (ann.frame_id === currentFrame?.id) {
          totalBoxes++;
          const review = annotationReviews.get(ann.id);
          if (!review?.verdict || review.verdict === 'pending') {
            pendingBoxes++;
          }
        }
      });
    });

    return { total: totalBoxes, pending: pendingBoxes };
  }, [sortedTracks, annotationReviews, currentFrame]);

  // Handle bulk approve all remaining across all tracks - uses bulk API for efficiency
  const handleApproveAllRemaining = useCallback(async () => {
    const unreviewedIds: string[] = [];

    sortedTracks.forEach(track => {
      track.annotations.forEach(ann => {
        const review = annotationReviews.get(ann.id);
        if (!review?.verdict || review.verdict === 'pending') {
          unreviewedIds.push(ann.id);
        }
      });
    });

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [sortedTracks, annotationReviews, approveAllVisible]);

  // Handle bulk approve all remaining in current frame only - uses bulk API for efficiency
  const handleApproveCurrentFrame = useCallback(async () => {
    const unreviewedIds: string[] = [];

    sortedTracks.forEach(track => {
      track.annotations.forEach(ann => {
        if (ann.frame_id === currentFrame?.id) {
          const review = annotationReviews.get(ann.id);
          if (!review?.verdict || review.verdict === 'pending') {
            unreviewedIds.push(ann.id);
          }
        }
      });
    });

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [sortedTracks, annotationReviews, currentFrame, approveAllVisible]);

  // Handlers
  const handleToggleTrack = useCallback((trackId: string) => {
    if (expandedTrackId === trackId) {
      setExpandedTrackId(null);
    } else {
      setExpandedTrackId(trackId);
      onSelectTrack(trackId);

      // Jump to first frame of track
      const track = sortedTracks.find(t => t.trackId === trackId);
      if (track && track.frameIndices.length > 0) {
        goToFrame(track.frameIndices[0]);
        const firstAnn = track.frameIndexToAnnotation.get(track.frameIndices[0]);
        if (firstAnn) {
          setTimeout(() => {
            selectAnnotation(firstAnn.id);
            onJumpToAnnotation(firstAnn.id, firstAnn.frame_id, 3);
          }, 50);
        }
      }
    }
  }, [expandedTrackId, onSelectTrack, sortedTracks, goToFrame, selectAnnotation, onJumpToAnnotation]);

  const advanceToNextTrack = useCallback((currentTrackId: string) => {
    if (!autoAdvanceRef.current) return;

    const currentIdx = sortedTracks.findIndex(t => t.trackId === currentTrackId);
    if (currentIdx >= 0 && currentIdx < sortedTracks.length - 1) {
      const nextTrack = sortedTracks[currentIdx + 1];

      requestAnimationFrame(() => {
        setTimeout(() => {
          setExpandedTrackId(nextTrack.trackId);
          onSelectTrack(nextTrack.trackId);

          if (nextTrack.frameIndices.length > 0) {
            goToFrame(nextTrack.frameIndices[0]);
            const firstAnn = nextTrack.frameIndexToAnnotation.get(nextTrack.frameIndices[0]);
            if (firstAnn) {
              setTimeout(() => {
                selectAnnotation(firstAnn.id);
                onJumpToAnnotation(firstAnn.id, firstAnn.frame_id, 3);
              }, 50);
            }
          }

          // Scroll into view
          setTimeout(() => {
            const el = trackItemRefs.current.get(nextTrack.trackId);
            el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 100);
        }, 50);
      });
    }
  }, [sortedTracks, onSelectTrack, goToFrame, selectAnnotation, onJumpToAnnotation]);

  const handleApproveBox = useCallback(async (annotationId: string) => {
    // Get the annotation to extract frame_id and class_id
    const ann = allAnnotations.find(a => a.id === annotationId);
    const frameId = ann?.frame_id;
    const classId = ann?.class_id;
    await approveAnnotation(annotationId, frameId, classId);
  }, [approveAnnotation, allAnnotations]);

  const handleRejectBox = useCallback((annotationId: string, trackId: string, frameId?: string, classId?: string) => {
    // Get the annotation if frameId/classId not provided
    let resolvedFrameId = frameId;
    let resolvedClassId = classId;
    if (!resolvedFrameId || !resolvedClassId) {
      const ann = allAnnotations.find(a => a.id === annotationId);
      resolvedFrameId = resolvedFrameId || ann?.frame_id;
      resolvedClassId = resolvedClassId || ann?.class_id;
    }
    pendingRejectionRef.current = { annotationId, trackId, frameId: resolvedFrameId, classId: resolvedClassId };
    openRejectionModal(annotationId, resolvedFrameId, resolvedClassId);
  }, [openRejectionModal, allAnnotations]);

  const handleFlagBox = useCallback((annotationId: string, trackId: string, frameId?: string, classId?: string) => {
    // Get the annotation if frameId/classId not provided
    let resolvedFrameId = frameId;
    let resolvedClassId = classId;
    if (!resolvedFrameId || !resolvedClassId) {
      const ann = allAnnotations.find(a => a.id === annotationId);
      resolvedFrameId = resolvedFrameId || ann?.frame_id;
      resolvedClassId = resolvedClassId || ann?.class_id;
    }
    pendingFlagRef.current = { annotationId, trackId, frameId: resolvedFrameId, classId: resolvedClassId };
    setFlagAnnotationId(annotationId);
    setShowFlagModal(true);
  }, [allAnnotations]);

  const handleFlagSubmit = useCallback(async (annotationId: string, notes: string) => {
    // Use stored frameId/classId from pending ref, or fall back to looking up the annotation
    let frameId = pendingFlagRef.current?.frameId;
    let classId = pendingFlagRef.current?.classId;
    if (!frameId || !classId) {
      const ann = allAnnotations.find(a => a.id === annotationId);
      frameId = frameId || ann?.frame_id;
      classId = classId || ann?.class_id;
    }
    await flagAnnotation(annotationId, notes, frameId, classId);
    setShowFlagModal(false);
    setFlagAnnotationId(null);
    pendingFlagRef.current = null;
  }, [flagAnnotation, allAnnotations]);

  const handleFlagModalClose = useCallback(() => {
    setShowFlagModal(false);
    setFlagAnnotationId(null);
    pendingFlagRef.current = null;
  }, []);

  const handleApproveTrack = useCallback(async (track: TrackData) => {
    const annotationIds = track.annotations.map(a => a.id);
    await approveTrack(track.trackId, annotationIds);

    // Auto-advance to next track
    advanceToNextTrack(track.trackId);
  }, [approveTrack, advanceToNextTrack]);

  const handleRejectTrack = useCallback((track: TrackData) => {
    // Reject all annotations in the track by opening rejection modal for the first annotation
    // The modal will handle rejecting this annotation, which marks the track as rejected
    const firstAnn = track.annotations[0];
    if (firstAnn) {
      pendingRejectionRef.current = {
        annotationId: firstAnn.id,
        trackId: track.trackId,
        frameId: firstAnn.frame_id,
        classId: firstAnn.class_id
      };
      openRejectionModal(firstAnn.id, firstAnn.frame_id, firstAnn.class_id);
    }
  }, [openRejectionModal]);

  // Watch for rejection modal closing
  useEffect(() => {
    if (!showRejectionModal && pendingRejectionRef.current) {
      const { annotationId } = pendingRejectionRef.current;

      if (lastProcessedRejectionRef.current === annotationId) {
        pendingRejectionRef.current = null;
        return;
      }

      const review = getAnnotationReview(annotationId);
      if (review?.verdict === 'rejected') {
        lastProcessedRejectionRef.current = annotationId;
        pendingRejectionRef.current = null;
      } else {
        pendingRejectionRef.current = null;
      }
    }
  }, [showRejectionModal, getAnnotationReview]);

  // Get track status helper component
  const TrackStatusBadge: React.FC<{ annotations: Annotation[] }> = ({ annotations }) => {
    const status = useTrackStatus(annotations);

    const config = {
      pending: { bg: 'bg-gray-600/30', text: 'text-gray-400', label: '○' },
      in_progress: { bg: 'bg-blue-600/30', text: 'text-blue-400', label: '◐' },
      approved: { bg: 'bg-green-600/30', text: 'text-green-400', label: '✓' },
      rejected: { bg: 'bg-red-600/30', text: 'text-red-400', label: '✗' },
    };

    const c = config[status];
    return (
      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with progress */}
      <div className="flex-shrink-0 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-white">
            Frame {(currentFrame?.frame_index ?? currentFrameIndex) + 1}: {currentFrameQaProgress.approvedTracks + currentFrameQaProgress.rejectedTracks}/{currentFrameQaProgress.totalTracks} tracks
          </span>
          <span className="text-xs text-gray-400">
            {currentFrameQaProgress.totalTracks > 0
              ? Math.round(((currentFrameQaProgress.approvedTracks + currentFrameQaProgress.rejectedTracks) / currentFrameQaProgress.totalTracks) * 100)
              : 0}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-green-500 transition-all duration-300"
            style={{
              width: `${currentFrameQaProgress.totalTracks > 0
                ? ((currentFrameQaProgress.approvedTracks + currentFrameQaProgress.rejectedTracks) / currentFrameQaProgress.totalTracks) * 100
                : 0}%`
            }}
          />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 mt-1.5 text-xs">
          <span className="text-green-400">✓ {currentFrameQaProgress.approvedTracks}</span>
          <span className="text-red-400">✗ {currentFrameQaProgress.rejectedTracks}</span>
          <span className="text-blue-400">◐ {currentFrameQaProgress.inProgressTracks}</span>
          <span className="text-gray-500 ml-auto">Total: {qaProgress.approvedTracks}/{qaProgress.totalTracks}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
          >
            <option value="difficulty">Hardest first</option>
            <option value="frames">Most frames</option>
            <option value="class">By class</option>
          </select>

          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="w-3 h-3 rounded"
            />
            Auto-next
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* Approve all in current frame */}
          {currentFrameProgress.pending > 0 && (
            <button
              onClick={handleApproveCurrentFrame}
              className="px-2 py-1 bg-blue-600/40 hover:bg-blue-600 rounded text-xs text-blue-100 transition-colors"
              title="Approve all tracked boxes in current frame"
            >
              ✓ Frame ({currentFrameProgress.pending})
            </button>
          )}

          {/* Approve all remaining */}
          {qaProgress.totalTracks > 0 && qaProgress.approvedTracks < qaProgress.totalTracks && (
            <button
              onClick={handleApproveAllRemaining}
              className="px-2 py-1 bg-green-600/40 hover:bg-green-600 rounded text-xs text-green-100 transition-colors"
              title="Approve all remaining tracked boxes"
            >
              ✓ All
            </button>
          )}
        </div>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {currentFrameTracks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <p>No tracks in current frame</p>
            <p className="text-xs mt-1">Navigate to a frame with tracked annotations</p>
          </div>
        ) : (
          currentFrameTracks.map(track => {
            const isExpanded = expandedTrackId === track.trackId;
            const diffInfo = getDifficultyLevel(track.difficulty.totalScore);

            // Calculate frame range for track. frame_index is stored 0-indexed in
            // the DB; display 1-indexed scene-level numbers (e.g. F135-F200 for a
            // task covering frame_range [134, 200)).
            const actualFrameNumbers = track.frameIndices
              .map(idx => frames[idx]?.frame_index)
              .filter((f): f is number => f !== undefined);
            const firstFrame = actualFrameNumbers.length > 0 ? Math.min(...actualFrameNumbers) + 1 : 0;
            const lastFrame = actualFrameNumbers.length > 0 ? Math.max(...actualFrameNumbers) + 1 : 0;
            const frameRange = firstFrame === lastFrame ? `F${firstFrame}` : `F${firstFrame}-${lastFrame}`;

            return (
              <div
                key={track.trackId}
                className="rounded-lg overflow-hidden"
                ref={(el) => {
                  if (el) trackItemRefs.current.set(track.trackId, el);
                  else trackItemRefs.current.delete(track.trackId);
                }}
              >
                {/* Track header */}
                <div
                  onClick={() => handleToggleTrack(track.trackId)}
                  className={`
                    flex items-center gap-2 p-2 cursor-pointer transition-colors
                    ${isExpanded
                      ? 'bg-purple-600/20 border-l-2 border-purple-500'
                      : 'bg-gray-800/50 hover:bg-gray-800'}
                  `}
                >
                  <TrackStatusBadge annotations={track.annotations} />

                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: track.classColor }} />

                  <span className="flex-1 text-sm font-medium text-white truncate flex items-center gap-1.5">
                    {track.className}
                    <span className="text-[10px] text-blue-400 font-normal" title="Frame range">
                      {frameRange}
                    </span>
                  </span>

                  {/* Previous issues warning badge */}
                  {track.previousIssues.length > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs bg-orange-600/30 text-orange-400"
                      title={`${track.previousIssues.length} issue(s) from previous review`}
                    >
                      ⚠ {track.previousIssues.length}
                    </span>
                  )}

                  {/* AI Issues count */}
                  {isLoadingSuggestions ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] bg-blue-600/20 text-blue-400 border border-blue-600/30 flex-shrink-0 flex items-center gap-0.5 animate-pulse"
                      title="Loading AI issues..."
                    >
                      <span className="text-gray-400">Loading AI...</span>
                    </span>
                  ) : track.uniqueIssueCount > 0 ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-600/20 text-yellow-400 border border-yellow-600/30 flex-shrink-0 flex items-center gap-0.5"
                      title={`${track.uniqueIssueCount} unique AI-detected issue(s)`}
                    >
                      <span className="text-gray-400">Issues:</span> ⚠️{track.uniqueIssueCount}
                    </span>
                  ) : null}

                  {/* Difficulty */}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${diffInfo.bgColor} ${diffInfo.color} border-opacity-40 flex-shrink-0`} title="Difficulty score">
                    <span className="text-gray-400 font-normal">Diff:</span> {track.difficulty.totalScore.toFixed(0)}
                  </span>

                  <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <ChevronDownIcon />
                  </span>
                </div>

                {/* Expanded track player */}
                {isExpanded && (
                  <>
                    {/* AI Issues Section */}
                    {isLoadingSuggestions ? (
                      <div className="px-3 py-2 bg-blue-500/10 border-b border-gray-700">
                        <div className="text-[10px] text-blue-300 font-medium mb-1 flex items-center gap-2">
                          <span className="animate-pulse">Loading AI Issues...</span>
                        </div>
                      </div>
                    ) : track.suggestionCount > 0 && (() => {
                      // Group suggestions by message and count unique frames
                      const grouped = new Map<string, { suggestion: typeof track.suggestions[0]; frameNumbers: Set<number> }>();
                      track.suggestions.forEach(s => {
                        const frameIdx = s.frame_id ? frames.findIndex(f => f.id === s.frame_id) : -1;
                        // Display 1-indexed scene-level frame number (DB is 0-indexed).
                        const sceneFrameIndex = frameIdx >= 0 ? frames[frameIdx]?.frame_index : undefined;
                        const actualFrameNumber = sceneFrameIndex !== undefined ? sceneFrameIndex + 1 : 0;

                        if (actualFrameNumber > 0) {
                          const existing = grouped.get(s.message);
                          if (existing) {
                            existing.frameNumbers.add(actualFrameNumber);
                          } else {
                            grouped.set(s.message, {
                              suggestion: s,
                              frameNumbers: new Set([actualFrameNumber])
                            });
                          }
                        }
                      });

                      // Convert to array with sorted frame numbers
                      const groupedIssues = Array.from(grouped.values()).map(item => ({
                        suggestion: item.suggestion,
                        count: item.frameNumbers.size,
                        frameNumbers: Array.from(item.frameNumbers).sort((a, b) => a - b)
                      }));

                      return (
                        <div className="px-3 py-2 bg-orange-500/10 border-b border-gray-700">
                          <div className="text-[10px] text-orange-300 font-medium mb-1">
                            AI Issues ({groupedIssues.length}):
                          </div>
                          <div className="space-y-1 max-h-32 overflow-y-auto pr-2">
                            {groupedIssues.map(({ suggestion, count, frameNumbers }) => (
                              <div key={suggestion.id} className="text-[10px] text-orange-200 flex items-start gap-2">
                                <span className={`flex-shrink-0 ${
                                  suggestion.severity === 'critical' ? 'text-red-400' :
                                  suggestion.severity === 'high' ? 'text-orange-400' :
                                  suggestion.severity === 'medium' ? 'text-yellow-400' : 'text-gray-400'
                                }`}>
                                  {suggestion.severity === 'critical' ? '🔴' :
                                   suggestion.severity === 'high' ? '🟠' :
                                   suggestion.severity === 'medium' ? '🟡' : '⚪'}
                                </span>
                                <span className="flex-1">{suggestion.message}</span>
                                <span className="text-gray-500 flex-shrink-0 ml-2">
                                  {count > 1
                                    ? `(${count} frames)`
                                    : frameNumbers.length > 0 ? `F${frameNumbers[0]}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Bulk track actions */}
                    <div className="px-2 py-2 border-b border-gray-700 flex gap-2 bg-gray-800/30">
                      <button
                        onClick={() => handleApproveTrack(track)}
                        className="flex-1 px-2 py-1.5 bg-green-600/40 hover:bg-green-600 rounded text-xs text-green-100 transition-colors font-medium"
                      >
                        ✓ Approve Track ({track.annotations.length})
                      </button>
                      <button
                        onClick={() => handleRejectTrack(track)}
                        className="flex-1 px-2 py-1.5 bg-red-600/40 hover:bg-red-600 rounded text-xs text-red-100 transition-colors font-medium"
                      >
                        ✗ Reject Track ({track.annotations.length})
                      </button>
                    </div>

                    {/* Frame list - similar to 2D panel */}
                    <div className="max-h-64 overflow-y-auto">
                      {track.annotations
                        .map(ann => {
                          const frameIdx = frames.findIndex(f => f.id === ann.frame_id);
                          return { ann, frameIdx };
                        })
                        .sort((a, b) => a.frameIdx - b.frameIdx)
                        .map(({ ann, frameIdx }) => {
                          const review = getAnnotationReview(ann.id);
                          const isSelected = selectedAnnotationId === ann.id;
                          const isPending = !review?.verdict || review.verdict === 'pending';

                          // Calculate difficulty for this frame using track's total score divided by frames
                          const annDifficulty = track.difficulty.totalScore / track.annotations.length;
                          const diffLevel = getDifficultyLevel(annDifficulty);

                          // Display 1-indexed scene-level frame number (DB is 0-indexed).
                          const actualFrameNumber = (frames[frameIdx]?.frame_index ?? frameIdx) + 1;

                          return (
                            <div
                              key={ann.id}
                              onClick={() => {
                                goToFrame(frameIdx);
                                setTimeout(() => {
                                  selectAnnotation(ann.id);
                                  onJumpToAnnotation(ann.id, ann.frame_id, 3);
                                }, 50);
                              }}
                              className={`
                                flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-700/50 last:border-b-0
                                ${
                                  isSelected
                                    ? 'bg-blue-600/30 border-l-2 border-l-blue-500'
                                    : 'hover:bg-gray-800/50'
                                }
                              `}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-gray-400 w-8 flex-shrink-0">F{actualFrameNumber}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${diffLevel.bgColor} ${diffLevel.color}`} title="Difficulty score for this box">
                                  <span className="text-gray-400">Diff:</span> {annDifficulty.toFixed(0)}
                                </span>
                                {ann.track_id && (
                                  ann.is_keyframe ? (
                                    <span className="text-yellow-400 text-[10px] flex items-center gap-0.5" title="Keyframe (manually annotated)">
                                      <span className="text-gray-500">Keyframe</span> ⭐
                                    </span>
                                  ) : (
                                    <span className="text-purple-400 text-[10px] flex items-center gap-0.5" title="Auto-interpolated box">
                                      <span className="text-gray-500">Auto</span> 🔵
                                    </span>
                                  )
                                )}
                              </div>

                              {/* Action buttons */}
                              {isSelected && isPending ? (
                                <div className="flex gap-1 flex-shrink-0">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleApproveBox(ann.id); }}
                                    className="p-1 bg-green-600/40 hover:bg-green-600 rounded text-green-200"
                                    title="Approve (1)"
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRejectBox(ann.id, track.trackId); }}
                                    className="p-1 bg-red-600/40 hover:bg-red-600 rounded text-red-200"
                                    title="Reject (2)"
                                  >
                                    <XIcon />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFlagBox(ann.id, track.trackId); }}
                                    className="p-1 bg-yellow-600/40 hover:bg-yellow-600 rounded text-yellow-200"
                                    title="Flag (3)"
                                  >
                                    <FlagIcon />
                                  </button>
                                </div>
                              ) : review && review.verdict !== 'pending' ? (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                                  review.verdict === 'approved' ? 'bg-green-500/30 text-green-400' :
                                  review.verdict === 'rejected' ? 'bg-red-500/30 text-red-400' :
                                  'bg-yellow-500/30 text-yellow-400'
                                }`}>
                                  {review.verdict === 'approved' ? '✓' : review.verdict === 'rejected' ? '✗' : '!'}
                                </span>
                              ) : null}
                            </div>
                          );
                        })
                      }
                    </div>

                    {/* Properties Panel for Selected Annotation */}
                    {selectedAnnotationId && (() => {
                      const selectedAnn = track.annotations.find(a => a.id === selectedAnnotationId);
                      if (!selectedAnn) return null;

                      const classDef = taxonomy?.classes.find(c => c.id === selectedAnn.class_id);
                      const frameIdx = frames.findIndex(f => f.id === selectedAnn.frame_id);
                      // Display 1-indexed scene-level frame number (DB is 0-indexed).
                      const actualFrameNumber = frameIdx >= 0 ? ((frames[frameIdx]?.frame_index ?? frameIdx) + 1) : 0;

                      return (
                        <div className="border-t border-gray-700/50 bg-gray-900/50">
                          {/* Properties Header */}
                          <div className="px-3 py-2 bg-gray-800/50 border-b border-gray-700/50">
                            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Properties</h4>
                          </div>

                          <div className="px-3 py-3 space-y-3">
                            {/* Class selector */}
                            {taxonomy && (
                              <div>
                                <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Class</label>
                                <select
                                  value={selectedAnn.class_id}
                                  onChange={(e) => handleUpdateAnnotationClass(selectedAnn.id, e.target.value)}
                                  className="w-full text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white cursor-pointer hover:border-gray-500 focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                                >
                                  {taxonomy.classes.map((cls) => (
                                    <option key={cls.id} value={cls.id}>
                                      {cls.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Annotation info */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                              <div className="text-gray-500">Type:</div>
                              <div className="text-gray-300">Box</div>
                              <div className="text-gray-500">Frame:</div>
                              <div className="text-gray-300">{actualFrameNumber}</div>
                              {selectedAnn.track_id && (
                                <>
                                  <div className="text-gray-500">Track:</div>
                                  <div className="text-cyan-400 text-[10px] truncate font-mono">{selectedAnn.track_id.substring(0, 12)}...</div>
                                </>
                              )}
                            </div>

                            {/* Position, Dimensions, Heading */}
                            {(() => {
                              const data = selectedAnn.data as {
                                center?: { x: number; y: number; z: number };
                                position?: { x: number; y: number; z: number };
                                dimensions?: { length: number; width: number; height: number };
                                rotation?: { yaw: number; pitch?: number; roll?: number };
                              } | undefined;

                              if (!data) return null;
                              // 3D annotations use 'center', legacy uses 'position'
                              const positionData = data.center || data.position;

                              return (
                                <div className="space-y-2 pt-2 border-t border-gray-700/50">
                                  {/* Position */}
                                  {positionData && (
                                    <div>
                                      <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Position</label>
                                      <div className="grid grid-cols-3 gap-1">
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-cyan-400">X</span>
                                          <span className="text-xs text-white ml-1">{positionData.x.toFixed(2)}</span>
                                        </div>
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-green-400">Y</span>
                                          <span className="text-xs text-white ml-1">{positionData.y.toFixed(2)}</span>
                                        </div>
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-blue-400">Z</span>
                                          <span className="text-xs text-white ml-1">{positionData.z.toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Dimensions */}
                                  {data.dimensions && (
                                    <div>
                                      <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Dimensions</label>
                                      <div className="grid grid-cols-3 gap-1">
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-gray-400">L</span>
                                          <span className="text-xs text-white ml-1">{data.dimensions.length.toFixed(2)}</span>
                                        </div>
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-gray-400">W</span>
                                          <span className="text-xs text-white ml-1">{data.dimensions.width.toFixed(2)}</span>
                                        </div>
                                        <div className="bg-gray-800 rounded px-2 py-1">
                                          <span className="text-[9px] text-gray-400">H</span>
                                          <span className="text-xs text-white ml-1">{data.dimensions.height.toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Heading */}
                                  {data.rotation && (
                                    <div>
                                      <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Heading</label>
                                      <div className="bg-gray-800 rounded px-2 py-1 inline-block">
                                        <span className="text-xs text-white">{((data.rotation.yaw || 0) * 180 / Math.PI).toFixed(1)}°</span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Stored Attributes Values */}
                                  {selectedAnn.attributes && Object.keys(selectedAnn.attributes).length > 0 && (
                                    <div className="pt-2 border-t border-gray-700/50">
                                      <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Attributes</label>
                                      <div className="space-y-0.5">
                                        {Object.entries(selectedAnn.attributes).map(([key, value]) => (
                                          <div key={key} className="flex items-center justify-between bg-gray-800 rounded px-2 py-1">
                                            <span className="text-[10px] text-gray-400">{key}</span>
                                            <span className="text-xs text-white">{String(value)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Attributes */}
                            {classDef?.attributes && Object.keys(classDef.attributes).length > 0 && (
                              <div>
                                <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1.5">Attributes</label>
                                <div className="space-y-2">
                                  {Object.entries(classDef.attributes).map(([key, def]) => (
                                    <div key={key} className="flex items-center justify-between gap-2">
                                      <label className="text-xs text-gray-400 flex-shrink-0">{key}</label>
                                      {def.type === 'boolean' ? (
                                        <button
                                          onClick={() => {
                                            const newValue = !(selectedAnn.attributes?.[key] as boolean ?? def.default ?? false);
                                            const newAttributes = { ...(selectedAnn.attributes || {}), [key]: newValue };
                                            handleUpdateAnnotationAttributes(selectedAnn.id, newAttributes);
                                          }}
                                          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                                            selectedAnn.attributes?.[key] ? 'bg-primary' : 'bg-gray-600'
                                          }`}
                                        >
                                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                            selectedAnn.attributes?.[key] ? 'translate-x-4' : ''
                                          }`} />
                                        </button>
                                      ) : def.type === 'enum' && def.options ? (
                                        <select
                                          value={(selectedAnn.attributes?.[key] as string) ?? (def.default as string) ?? ''}
                                          onChange={(e) => {
                                            const newAttributes = { ...(selectedAnn.attributes || {}), [key]: e.target.value };
                                            handleUpdateAnnotationAttributes(selectedAnn.id, newAttributes);
                                          }}
                                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
                                        >
                                          <option value="">--</option>
                                          {def.options.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          type={def.type === 'number' ? 'number' : 'text'}
                                          value={(selectedAnn.attributes?.[key] as string) ?? (def.default as string) ?? ''}
                                          onChange={(e) => {
                                            const value = def.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                                            const newAttributes = { ...(selectedAnn.attributes || {}), [key]: value };
                                            handleUpdateAnnotationAttributes(selectedAnn.id, newAttributes);
                                          }}
                                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
                                        />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Previous Issues Section */}
                    {track.previousIssues.length > 0 && (
                      <PreviousIssuesSection
                        issues={track.previousIssues}
                        frames={frames}
                        onJumpToFrame={(frameId) => {
                          const frameIdx = frames.findIndex(f => f.id === frameId);
                          if (frameIdx >= 0) {
                            goToFrame(frameIdx);
                          }
                        }}
                        onApproveIssue={async (annotationId) => {
                          const ann = allAnnotations.find(a => a.id === annotationId);
                          await approveAnnotation(annotationId, ann?.frame_id, ann?.class_id);
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Keyboard hints */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-700/50 bg-gray-800/30">
        <div className="text-xs text-gray-600 flex gap-3">
          <span><kbd className="px-1 bg-gray-700 rounded">Space</kbd> play</span>
          <span><kbd className="px-1 bg-gray-700 rounded">1</kbd> ✓ box</span>
          <span><kbd className="px-1 bg-gray-700 rounded">2</kbd> ✗</span>
          <span><kbd className="px-1 bg-gray-700 rounded">3</kbd> !</span>
        </div>
      </div>

      {/* Flag Modal */}
      <FlagModal
        isOpen={showFlagModal}
        annotationId={flagAnnotationId}
        onClose={handleFlagModalClose}
        onSubmit={handleFlagSubmit}
      />
    </div>
  );
};

export default TrackReviewTab;
