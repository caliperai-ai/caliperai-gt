import React, { useState, useCallback, useMemo } from 'react';
import { useAnnotation2DStore } from '@/store/annotation2DStore';
import { useEditorStore } from '@/store/editorStore';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';
import { annotation2DApi } from '@/api/client';

interface ClassDefinition {
  id: string;
  name: string;
  color: string;
  attributes?: Record<string, {
    type: 'boolean' | 'string' | 'enum';
    default?: unknown;
    options?: string[];
    required?: boolean;
    description?: string | null;
  }>;
}

interface FrameInfo {
  id: string;
  index: number;
}

interface ObjectsAndTracksPanelProps {
  classes: ClassDefinition[];
  frames: FrameInfo[];
  currentFrameIndex: number;
  onFrameChange: (index: number) => void;
}

const ObjectsAndTracksPanel: React.FC<ObjectsAndTracksPanelProps> = ({
  classes,
  frames,
  currentFrameIndex,
  onFrameChange,
}) => {
  const [activeTab, setActiveTab] = useState<'objects' | 'tracks'>('objects');

  const {
    annotations,
    selectedIds,
    select,
    toggleVisibility,
    toggleLock,
    deleteAnnotation,
    updateAnnotation,
  } = useAnnotation2DStore();

  const { taxonomy } = useEditorStore();

  const selectedAnnotation = useMemo(() => {
    if (selectedIds.length === 0) return null;
    return annotations.get(selectedIds[0]) || null;
  }, [selectedIds, annotations]);

  const currentFrameAnnotations = React.useMemo(() => {
    const currentFrame = frames[currentFrameIndex];
    if (!currentFrame) return [];

    return Array.from(annotations.values()).filter(
      (ann) => ann.frameId === currentFrame.id
    );
  }, [annotations, frames, currentFrameIndex]);

  const handleAttrChange = useCallback((annId: string, mergedAttributes: Record<string, unknown>) => {
    updateAnnotation(annId, { attributes: mergedAttributes });
    annotation2DApi.update(annId, { attributes: mergedAttributes }).catch((err) => {
      console.error('[AttrUpdate] Failed to save attribute:', err);
    });
  }, [updateAnnotation]);

  const getClassInfo = useCallback((classId: string) => {
    return classes.find((c) => c.id === classId) || { id: classId, name: classId, color: '#6b7280' };
  }, [classes]);

  const formatAnnotationType = (type: string) => {
    const typeLabels: Record<string, string> = {
      'box': 'Box',
      'rotated_box': 'Rotated Box',
      'ellipse': 'Ellipse',
      'polygon': 'Polygon',
      'polyline': 'Polyline',
      'points': 'Points',
      'mask': 'Mask',
      'semantic_segment': 'Semantic Segment',
    };
    return typeLabels[type] || type;
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Tab Header */}
      <div className="flex border-b border-gray-700">
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'objects'
              ? 'text-white border-b-2 border-primary'
              : 'text-gray-400 hover:text-white'
          }`}
          onClick={() => setActiveTab('objects')}
        >
          Objects ({currentFrameAnnotations.length})
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'tracks'
              ? 'text-white border-b-2 border-primary'
              : 'text-gray-400 hover:text-white'
          }`}
          onClick={() => setActiveTab('tracks')}
        >
          Tracks
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'objects' ? (
          <>
            {/* Attributes Panel for Selected Annotation */}
            {selectedAnnotation && (() => {
              // Get effective attributes (merging shared + class-specific)
              const effectiveAttributes = getEffectiveAttributesForClass(selectedAnnotation.classId, taxonomy);
              return Object.keys(effectiveAttributes).length > 0 ? (
                <div className="p-3 border-b border-gray-700 bg-dark-panel/50">
                  <h4 className="text-xs font-medium text-gray-300 mb-3 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Attributes
                  </h4>
                  <div className="space-y-3">
                    {Object.entries(effectiveAttributes).map(([key, def]) => (
                      <div key={key}>
                        <label className="text-[10px] text-gray-400 block mb-1.5">{key}</label>
                        {def.type === 'boolean' ? (
                          <label className="flex items-center gap-3 cursor-pointer">
                            <div className="relative">
                              <input
                                type="checkbox"
                                checked={(selectedAnnotation.attributes?.[key] as boolean) ?? def.default ?? false}
                                onChange={(e) => handleAttrChange(selectedAnnotation.id, { ...(selectedAnnotation.attributes || {}), [key]: e.target.checked })}
                                className="sr-only"
                              />
                              <div className={`w-10 h-5 rounded-full transition-colors ${
                                selectedAnnotation.attributes?.[key] ? 'bg-primary' : 'bg-gray-600'
                              }`}>
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                  selectedAnnotation.attributes?.[key] ? 'translate-x-5' : ''
                                }`} />
                              </div>
                            </div>
                            <span className="text-xs text-white">{selectedAnnotation.attributes?.[key] ? 'Yes' : 'No'}</span>
                          </label>
                        ) : def.type === 'enum' && def.options ? (
                          <select
                            value={(selectedAnnotation.attributes?.[key] as string) ?? def.default ?? ''}
                            onChange={(e) => handleAttrChange(selectedAnnotation.id, { ...(selectedAnnotation.attributes || {}), [key]: e.target.value })}
                            className="w-full bg-dark border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                          >
                            {def.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={(selectedAnnotation.attributes?.[key] as string) ?? ''}
                            onChange={(e) => handleAttrChange(selectedAnnotation.id, { ...(selectedAnnotation.attributes || {}), [key]: e.target.value })}
                            className="w-full bg-dark border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                            placeholder="Enter value"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Annotations List */}
            <div className="p-2 space-y-1">
              {currentFrameAnnotations.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No annotations on this frame.
                </p>
              ) : (
                currentFrameAnnotations.map((ann) => {
                const classInfo = getClassInfo(ann.classId);
                const isSelected = selectedIds.includes(ann.id);

                return (
                  <div
                    key={ann.id}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary/20 border border-primary/50'
                        : 'hover:bg-gray-800 border border-transparent'
                    } ${ann.isHidden ? 'opacity-50' : ''}`}
                    onClick={() => select(ann.id)}
                  >
                    <div className="flex items-center gap-2">
                      {/* Color indicator */}
                      <div
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: classInfo.color }}
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${ann.isHidden ? 'text-gray-500 line-through' : 'text-white'}`}>
                          {classInfo.name}
                        </p>
                        <p className={`text-xs ${ann.type === 'semantic_segment' ? 'text-purple-400' : 'text-gray-500'}`}>
                          {formatAnnotationType(ann.type)}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisibility(ann.id);
                          }}
                          className={`p-1 rounded ${ann.isHidden ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
                          title={ann.isHidden ? 'Show' : 'Hide'}
                        >
                          {ann.isHidden ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLock(ann.id);
                          }}
                          className={`p-1 rounded ${ann.isLocked ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
                          title={ann.isLocked ? 'Unlock' : 'Lock'}
                        >
                          {ann.isLocked ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this annotation?')) {
                              deleteAnnotation(ann.id);
                            }
                          }}
                          className="p-1 rounded text-gray-400 hover:text-red-400"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
                })
              )}
            </div>
          </>
        ) : (
          <div className="p-4 text-center text-gray-500">
            <p className="text-sm">Track management coming soon.</p>
            <p className="text-xs mt-1">Use the main editor for tracking features.</p>
          </div>
        )}
      </div>

      {/* Frame Navigator */}
      <div className="border-t border-gray-700 p-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFrameChange(Math.max(0, currentFrameIndex - 1))}
            disabled={currentFrameIndex === 0}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="flex-1 text-center text-xs text-gray-400">
            Frame {currentFrameIndex + 1} / {frames.length}
          </span>
          <button
            onClick={() => onFrameChange(Math.min(frames.length - 1, currentFrameIndex + 1))}
            disabled={currentFrameIndex >= frames.length - 1}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ObjectsAndTracksPanel;
