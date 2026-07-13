import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { taxonomyApi } from '@/api/client';
import type { ClassDefinition, AttributeDefinition, AnnotationType, Taxonomy, SharedAttributeDefinition } from '@/types';
import { getEffectiveAttributesForClass, sharedAttributeAppliesToClass } from '@/utils/taxonomyUtils';
import { AppLayout } from '@/components/layout';

const CLASS_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];


const ANNOTATION_TYPES: AnnotationType[] = [
  'cuboid', 'box2d', 'polyline', 'polygon', 'keypoints', 'segmentation_3d', 'segmentation_2d'
];

const ATTRIBUTE_TYPES: AttributeDefinition['type'][] = ['boolean', 'string', 'number', 'enum'];


const incrementVersion = (version: string, type: 'major' | 'minor' | 'patch' = 'patch'): string => {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3) return `${version}.1`;

  if (type === 'major') {
    return `${parts[0] + 1}.0.0`;
  } else if (type === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`;
  } else {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
};

// =============================================================================
// ATTRIBUTE EDITOR COMPONENT
// =============================================================================

interface AttributeEditorProps {
  attributes: Record<string, AttributeDefinition>;
  onChange: (attributes: Record<string, AttributeDefinition>) => void;
}

const AttributeEditor: React.FC<AttributeEditorProps> = ({ attributes, onChange }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAttr, setEditingAttr] = useState<string | null>(null);
  const [expandedAttr, setExpandedAttr] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AttributeDefinition['type']>('string');
  const [formRequired, setFormRequired] = useState(false);
  const [formMutable, setFormMutable] = useState(true);
  const [formDefault, setFormDefault] = useState('');
  const [formOptions, setFormOptions] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormType('string');
    setFormRequired(false);
    setFormMutable(true);
    setFormDefault('');
    setFormOptions('');
    setFormDescription('');
    setShowAddForm(false);
    setEditingAttr(null);
  };

  const handleSaveAttribute = () => {
    if (!formName.trim()) return;

    const attrId = formName.toLowerCase().replace(/\s+/g, '_');
    let defaultValue: unknown = formDefault || undefined;
    if (formType === 'boolean') defaultValue = formDefault === 'true';
    else if (formType === 'number' && formDefault) defaultValue = parseFloat(formDefault) || 0;

    const newAttr: AttributeDefinition = {
      type: formType,
      required: formRequired,
      mutable: formMutable,
      default: defaultValue,
      description: formDescription || undefined,
    };

    if (formType === 'enum') {
      newAttr.options = formOptions.split(',').map(o => o.trim()).filter(Boolean);
    }

    const newAttrs = { ...attributes };
    if (editingAttr && editingAttr !== attrId) delete newAttrs[editingAttr];
    newAttrs[attrId] = newAttr;
    onChange(newAttrs);
    resetForm();
  };

  const handleEdit = (attrId: string) => {
    const attr = attributes[attrId];
    setFormName(attrId);
    setFormType(attr.type);
    setFormRequired(attr.required ?? false);
    setFormMutable(attr.mutable ?? true);
    setFormDefault(String(attr.default ?? ''));
    setFormOptions(attr.options?.join(', ') || '');
    setFormDescription(attr.description || '');
    setEditingAttr(attrId);
    setShowAddForm(true);
  };

  const handleDelete = (attrId: string) => {
    const newAttrs = { ...attributes };
    delete newAttrs[attrId];
    onChange(newAttrs);
  };

  const toggleMutable = (attrId: string) => {
    const attr = attributes[attrId];
    onChange({
      ...attributes,
      [attrId]: { ...attr, mutable: !(attr.mutable ?? true) }
    });
  };

  return (
    <div className="space-y-2">
      {Object.entries(attributes).map(([attrId, attr]) => (
        <div key={attrId} className="bg-gray-800 rounded overflow-hidden">
          {/* Attribute Header */}
          <div
            className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-700/50"
            onClick={() => setExpandedAttr(expandedAttr === attrId ? null : attrId)}
          >
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedAttr === attrId ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm text-white font-medium">{attrId}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              attr.type === 'enum' ? 'bg-purple-500/30 text-purple-300' :
              attr.type === 'boolean' ? 'bg-blue-500/30 text-blue-300' :
              attr.type === 'number' ? 'bg-green-500/30 text-green-300' :
              'bg-gray-600 text-gray-300'
            }`}>{attr.type}</span>
            {attr.required && <span className="px-1.5 py-0.5 bg-red-500/30 text-red-300 rounded text-[10px]">required</span>}
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              attr.mutable === false ? 'bg-orange-500/30 text-orange-300' : 'bg-cyan-500/30 text-cyan-300'
            }`}>
              {attr.mutable === false ? 'immutable' : 'mutable'}
            </span>
            <div className="flex-1" />
          <button onClick={(e) => { e.stopPropagation(); handleEdit(attrId); }} className="p-1 text-gray-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(attrId); }} className="p-1 text-gray-400 hover:text-red-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Expanded Details Section */}
        {expandedAttr === attrId && (
          <div className="px-3 pb-3 pt-1 bg-gray-800/50 border-t border-gray-700/50">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Type:</span>
                <span className="ml-2 text-gray-300">{attr.type}</span>
              </div>
              <div>
                <span className="text-gray-500">Required:</span>
                <span className="ml-2 text-gray-300">{attr.required ? 'Yes' : 'No'}</span>
              </div>
              <div>
                <span className="text-gray-500">Default:</span>
                <span className="ml-2 text-gray-300">{attr.default !== undefined ? String(attr.default) : '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Mutable:</span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMutable(attrId); }}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                    attr.mutable === false
                      ? 'bg-orange-500/30 text-orange-300 hover:bg-orange-500/50'
                      : 'bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50'
                  }`}
                >
                  {attr.mutable === false ? 'immutable (same across frames)' : 'mutable (can vary per frame)'}
                </button>
              </div>
              {attr.type === 'enum' && attr.options && (
                <div className="col-span-2">
                  <span className="text-gray-500">Options:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {attr.options.map(opt => (
                      <span key={opt} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px]">{opt}</span>
                    ))}
                  </div>
                </div>
              )}
              {attr.description && (
                <div className="col-span-2">
                  <span className="text-gray-500">Description:</span>
                  <p className="mt-1 text-gray-400">{attr.description}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      ))}

      {showAddForm ? (
        <div className="p-3 bg-gray-800/80 rounded border border-primary/30 space-y-2">
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
            placeholder="Attribute name"
            autoFocus
          />
          <div className="grid grid-cols-4 gap-1">
            {ATTRIBUTE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setFormType(type)}
                className={`px-2 py-1.5 rounded text-xs ${formType === type ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                {type}
              </button>
            ))}
          </div>
          {formType === 'enum' && (
            <input
              type="text"
              value={formOptions}
              onChange={(e) => setFormOptions(e.target.value)}
              className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
              placeholder="Options (comma-separated)"
            />
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={formDefault}
              onChange={(e) => setFormDefault(e.target.value)}
              className="flex-1 px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
              placeholder="Default value"
            />
            <label className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded">
              <input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} />
              <span className="text-xs text-gray-400">Required</span>
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 flex-1 px-3 py-2 bg-gray-700/50 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={formMutable}
                onChange={(e) => setFormMutable(e.target.checked)}
                className="w-4 h-4"
              />
              <div className="flex flex-col">
                <span className="text-xs text-white">Mutable</span>
                <span className="text-[10px] text-gray-400">
                  {formMutable ? 'Can vary per frame in tracks' : 'Same across all frames in tracks'}
                </span>
              </div>
            </label>
          </div>
          <textarea
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm resize-none"
            placeholder="Description (optional)"
            rows={2}
          />
          <div className="flex gap-2">
            <button onClick={handleSaveAttribute} className="flex-1 py-2 bg-primary text-white rounded text-sm">
              {editingAttr ? 'Update' : 'Add'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-gray-700 text-gray-300 rounded text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-2 border border-dashed border-gray-600 rounded text-gray-400 hover:border-primary hover:text-primary text-sm"
        >
          + Add Attribute
        </button>
      )}
    </div>
  );
};

// =============================================================================
// SHARED ATTRIBUTE EDITOR COMPONENT
// =============================================================================

interface SharedAttributeEditorProps {
  sharedAttributes: SharedAttributeDefinition[];
  classes: ClassDefinition[];
  onChange: (attrs: SharedAttributeDefinition[]) => void;
  isEditing: boolean;
}

const SharedAttributeEditor: React.FC<SharedAttributeEditorProps> = ({
  sharedAttributes,
  classes,
  onChange,
  isEditing
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AttributeDefinition['type']>('boolean');
  const [formRequired, setFormRequired] = useState(false);
  const [formMutable, setFormMutable] = useState(true);
  const [formDefault, setFormDefault] = useState('');
  const [formOptions, setFormOptions] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAppliesTo, setFormAppliesTo] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);

  const resetForm = () => {
    setFormName('');
    setFormType('boolean');
    setFormRequired(false);
    setFormMutable(true);
    setFormDefault('');
    setFormOptions('');
    setFormDescription('');
    setFormAppliesTo([]);
    setSelectAll(true);
    setShowAddForm(false);
    setEditingIndex(null);
  };

  const handleEdit = (index: number) => {
    const attr = sharedAttributes[index];
    setFormName(attr.name);
    setFormType(attr.type);
    setFormRequired(attr.required ?? false);
    setFormMutable(attr.mutable ?? true);
    setFormDefault(String(attr.default ?? ''));
    setFormOptions(attr.options?.join(', ') || '');
    setFormDescription(attr.description || '');
    const appliesTo = attr.applies_to || [];
    if (appliesTo.length === 0 || appliesTo.includes('__all__')) {
      setSelectAll(true);
      setFormAppliesTo([]);
    } else {
      setSelectAll(false);
      setFormAppliesTo(appliesTo);
    }
    setEditingIndex(index);
    setShowAddForm(true);
  };

  const handleDelete = (index: number) => {
    const newAttrs = sharedAttributes.filter((_, i) => i !== index);
    onChange(newAttrs);
  };

  const handleSave = () => {
    if (!formName.trim()) return;

    let defaultValue: unknown = formDefault || undefined;
    if (formType === 'boolean') defaultValue = formDefault === 'true';
    else if (formType === 'number' && formDefault) defaultValue = parseFloat(formDefault) || 0;

    const newAttr: SharedAttributeDefinition = {
      name: formName.toLowerCase().replace(/\s+/g, '_'),
      type: formType,
      required: formRequired,
      mutable: formMutable,
      default: defaultValue,
      description: formDescription || undefined,
      applies_to: selectAll ? ['__all__'] : formAppliesTo,
    };

    if (formType === 'enum') {
      newAttr.options = formOptions.split(',').map(o => o.trim()).filter(Boolean);
    }

    let newAttrs: SharedAttributeDefinition[];
    if (editingIndex !== null) {
      newAttrs = [...sharedAttributes];
      newAttrs[editingIndex] = newAttr;
    } else {
      newAttrs = [...sharedAttributes, newAttr];
    }

    onChange(newAttrs);
    resetForm();
  };

  const toggleClassSelection = (classId: string) => {
    if (formAppliesTo.includes(classId)) {
      setFormAppliesTo(formAppliesTo.filter(id => id !== classId));
    } else {
      setFormAppliesTo([...formAppliesTo, classId]);
    }
  };

  const getClassesForAttribute = (attr: SharedAttributeDefinition): string => {
    if (!attr.applies_to || attr.applies_to.length === 0 || attr.applies_to.includes('__all__')) {
      return 'All classes';
    }
    if (attr.applies_to.length <= 3) {
      return attr.applies_to.map(id => {
        const cls = classes.find(c => c.id === id);
        return cls?.name || id;
      }).join(', ');
    }
    return `${attr.applies_to.length} classes`;
  };

  return (
    <div className="space-y-3">
      {/* List of shared attributes */}
      {sharedAttributes.map((attr, index) => (
        <div key={`${attr.name}-${index}`} className="bg-gray-800 rounded overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center gap-2 p-3 cursor-pointer hover:bg-gray-700/50"
            onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
          >
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedIndex === index ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm text-white font-medium">{attr.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              attr.type === 'enum' ? 'bg-purple-500/30 text-purple-300' :
              attr.type === 'boolean' ? 'bg-blue-500/30 text-blue-300' :
              attr.type === 'number' ? 'bg-green-500/30 text-green-300' :
              'bg-gray-600 text-gray-300'
            }`}>{attr.type}</span>

            {/* Class assignment badge */}
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px]">
              {getClassesForAttribute(attr)}
            </span>

            {attr.required && (
              <span className="px-1.5 py-0.5 bg-red-500/30 text-red-300 rounded text-[10px]">required</span>
            )}

            <div className="flex-1" />

            {isEditing && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(index); }}
                  className="p-1 text-gray-400 hover:text-white"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(index); }}
                  className="p-1 text-gray-400 hover:text-red-400"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Expanded Details */}
          {expandedIndex === index && (
            <div className="px-4 pb-4 pt-1 bg-gray-800/50 border-t border-gray-700/50">
              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div>
                  <span className="text-gray-500">Type:</span>
                  <span className="ml-2 text-gray-300">{attr.type}</span>
                </div>
                <div>
                  <span className="text-gray-500">Required:</span>
                  <span className="ml-2 text-gray-300">{attr.required ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Mutable:</span>
                  <span className="ml-2 text-gray-300">{attr.mutable === false ? 'No (same across frames)' : 'Yes'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Default:</span>
                  <span className="ml-2 text-gray-300">{attr.default !== undefined ? String(attr.default) : '-'}</span>
                </div>
                {attr.type === 'enum' && attr.options && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Options:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {attr.options.map(opt => (
                        <span key={opt} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px]">{opt}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Show assigned classes */}
              <div className="border-t border-gray-700 pt-3">
                <span className="text-xs text-gray-500 block mb-2">Applies to classes:</span>
                <div className="flex flex-wrap gap-1">
                  {(!attr.applies_to || attr.applies_to.length === 0 || attr.applies_to.includes('__all__')) ? (
                    <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-xs">All classes</span>
                  ) : (
                    attr.applies_to.map(classId => {
                      const cls = classes.find(c => c.id === classId);
                      return (
                        <span
                          key={classId}
                          className="px-2 py-1 rounded text-xs flex items-center gap-1"
                          style={{ backgroundColor: cls?.color + '30', color: cls?.color || '#ccc' }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cls?.color }} />
                          {cls?.name || classId}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {attr.description && (
                <div className="border-t border-gray-700 pt-3 mt-3">
                  <span className="text-xs text-gray-500">Description:</span>
                  <p className="mt-1 text-xs text-gray-400">{attr.description}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Add/Edit Form */}
      {isEditing && showAddForm && (
        <div className="p-4 bg-gray-800/80 rounded-lg border border-primary/30 space-y-3">
          <h4 className="text-sm font-medium text-white mb-2">
            {editingIndex !== null ? 'Edit Shared Attribute' : 'Add Shared Attribute'}
          </h4>

          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
            placeholder="Attribute name (e.g., occluded)"
            autoFocus
          />

          <div className="grid grid-cols-4 gap-1">
            {ATTRIBUTE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setFormType(type)}
                className={`px-2 py-1.5 rounded text-xs ${formType === type ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                {type}
              </button>
            ))}
          </div>

          {formType === 'enum' && (
            <input
              type="text"
              value={formOptions}
              onChange={(e) => setFormOptions(e.target.value)}
              className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
              placeholder="Options (comma-separated)"
            />
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={formDefault}
              onChange={(e) => setFormDefault(e.target.value)}
              className="flex-1 px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm"
              placeholder="Default value"
            />
            <label className="flex items-center gap-2 px-3 py-1 bg-gray-700/50 rounded">
              <input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} />
              <span className="text-xs text-gray-400">Required</span>
            </label>
            <label className="flex items-center gap-2 px-3 py-1 bg-gray-700/50 rounded">
              <input type="checkbox" checked={formMutable} onChange={(e) => setFormMutable(e.target.checked)} />
              <span className="text-xs text-gray-400">Mutable</span>
            </label>
          </div>

          <textarea
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm resize-none"
            placeholder="Description (optional)"
            rows={2}
          />

          {/* Class Selection */}
          <div className="border-t border-gray-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Applies to classes:</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={(e) => {
                    setSelectAll(e.target.checked);
                    if (e.target.checked) setFormAppliesTo([]);
                  }}
                />
                <span className="text-xs text-gray-400">All classes</span>
              </label>
            </div>

            {!selectAll && (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-900/50 rounded">
                {classes.length === 0 ? (
                  <span className="text-xs text-gray-500 italic">No classes defined yet</span>
                ) : (
                  classes.map(cls => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => toggleClassSelection(cls.id)}
                      className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                        formAppliesTo.includes(cls.id)
                          ? 'ring-2 ring-white'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: cls.color + (formAppliesTo.includes(cls.id) ? '40' : '20'),
                        color: cls.color
                      }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cls.color }} />
                      {cls.name}
                      {formAppliesTo.includes(cls.id) && (
                        <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            {!selectAll && formAppliesTo.length === 0 && classes.length > 0 && (
              <p className="text-xs text-yellow-400 mt-1">⚠️ Select at least one class, or check "All classes"</p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={!formName.trim() || (!selectAll && formAppliesTo.length === 0)}
              className="flex-1 py-2 bg-primary text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingIndex !== null ? 'Update' : 'Add'} Shared Attribute
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-gray-700 text-gray-300 rounded text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add Button */}
      {isEditing && !showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-3 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-primary hover:text-primary text-sm flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Shared Attribute
        </button>
      )}

      {/* Empty state for view mode */}
      {!isEditing && sharedAttributes.length === 0 && (
        <div className="text-center py-6 text-gray-500 text-sm">
          No shared attributes defined
        </div>
      )}
    </div>
  );
};

// =============================================================================
// CLASS EDITOR COMPONENT
// =============================================================================

interface ClassEditorProps {
  cls: ClassDefinition;
  sharedAttributes: SharedAttributeDefinition[];
  onUpdate: (cls: ClassDefinition) => void;
  onDelete: () => void;
}

const ClassEditor: React.FC<ClassEditorProps> = ({ cls, sharedAttributes, onUpdate, onDelete }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(cls.name);

  const handleToggleType = (type: AnnotationType) => {
    const newTypes = cls.type.includes(type)
      ? cls.type.filter(t => t !== type)
      : [...cls.type, type];
    onUpdate({ ...cls, type: newTypes });
  };

  const handleSaveName = () => {
    onUpdate({ ...cls, name });
    setEditingName(false);
  };

  return (
    <div className="bg-dark rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <input
          type="color"
          value={cls.color}
          onChange={(e) => onUpdate({ ...cls, color: e.target.value })}
          className="w-8 h-8 rounded cursor-pointer border-0"
        />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-2 py-1 bg-dark border border-gray-600 rounded text-white text-sm"
                autoFocus
                onBlur={handleSaveName}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              />
            </div>
          ) : (
            <h4
              className="text-white font-medium cursor-pointer hover:text-primary"
              onClick={() => setEditingName(true)}
            >
              {cls.name}
              <span className="text-gray-500 ml-2 text-sm">({cls.id})</span>
            </h4>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 text-gray-400 hover:text-white"
        >
          <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-700 space-y-4">
          {/* Annotation Types */}
          <div className="mt-4">
            <h5 className="text-xs text-gray-400 font-medium mb-2">Annotation Types</h5>
            <div className="flex flex-wrap gap-2">
              {ANNOTATION_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => handleToggleType(type)}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    cls.type.includes(type)
                      ? 'bg-primary text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Attributes */}
          <div>
            <h5 className="text-xs text-gray-400 font-medium mb-2">Attributes</h5>
            <AttributeEditor
              attributes={cls.attributes}
              onChange={(attrs) => onUpdate({ ...cls, attributes: attrs })}
            />
          </div>

          {/* Inherited shared attributes — read-only here; edit them in the
              Shared Attributes section above. Shown so the annotator-facing
              effective attribute set is visible at a glance. */}
          {(() => {
            const inherited = sharedAttributes.filter(a => sharedAttributeAppliesToClass(a, cls.id));
            if (inherited.length === 0) return null;
            return (
              <div>
                <h5 className="text-xs text-gray-400 font-medium mb-2">
                  Inherited from shared attributes
                </h5>
                <div className="flex flex-wrap gap-2">
                  {inherited.map(attr => (
                    <span
                      key={attr.name}
                      className="px-2 py-1 rounded text-xs text-gray-300 bg-indigo-500/15 border border-indigo-500/30"
                      title="Defined in Shared Attributes above. Edit it there."
                    >
                      {attr.name}: <span className="text-gray-500">{attr.type}</span>
                      <span className="ml-1.5 text-[10px] text-indigo-300">shared</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Default Dimensions */}
          <div>
            <h5 className="text-xs text-gray-400 font-medium mb-2">Default Dimensions (meters)</h5>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Length</label>
                <input
                  type="number"
                  step="0.1"
                  value={cls.default_dimensions?.[0] ?? ''}
                  onChange={(e) => {
                    const dims = cls.default_dimensions || [0, 0, 0];
                    onUpdate({ ...cls, default_dimensions: [parseFloat(e.target.value) || 0, dims[1], dims[2]] });
                  }}
                  className="w-full px-2 py-1.5 bg-dark border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Width</label>
                <input
                  type="number"
                  step="0.1"
                  value={cls.default_dimensions?.[1] ?? ''}
                  onChange={(e) => {
                    const dims = cls.default_dimensions || [0, 0, 0];
                    onUpdate({ ...cls, default_dimensions: [dims[0], parseFloat(e.target.value) || 0, dims[2]] });
                  }}
                  className="w-full px-2 py-1.5 bg-dark border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Height</label>
                <input
                  type="number"
                  step="0.1"
                  value={cls.default_dimensions?.[2] ?? ''}
                  onChange={(e) => {
                    const dims = cls.default_dimensions || [0, 0, 0];
                    onUpdate({ ...cls, default_dimensions: [dims[0], dims[1], parseFloat(e.target.value) || 0] });
                  }}
                  className="w-full px-2 py-1.5 bg-dark border border-gray-600 rounded text-white text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// TAXONOMY DETAIL PAGE
// =============================================================================

export const TaxonomyDetail: React.FC = () => {
  const { taxonomyId } = useParams<{ taxonomyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editedTaxonomy, setEditedTaxonomy] = useState<Taxonomy | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [versionBumpType, setVersionBumpType] = useState<'patch' | 'minor' | 'major'>('patch');

  // Add class form
  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassId, setNewClassId] = useState('');

  // Common attributes that apply to all classes
  const [commonAttributes, setCommonAttributes] = useState<Record<string, AttributeDefinition>>({});

  const { data: taxonomy, isLoading, error } = useQuery({
    queryKey: ['taxonomy', taxonomyId],
    queryFn: () => taxonomyApi.get(taxonomyId!),
    enabled: !!taxonomyId,
  });

  // Initialize edit state when taxonomy loads
  useEffect(() => {
    if (taxonomy && !editedTaxonomy) {
      setEditedTaxonomy(taxonomy);
    }
  }, [taxonomy, editedTaxonomy]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Taxonomy>) => taxonomyApi.update(taxonomyId!, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['taxonomy', taxonomyId] });
      queryClient.invalidateQueries({ queryKey: ['taxonomies'] });
      setEditedTaxonomy(updated);
      setHasChanges(false);
      setIsEditing(false);
    },
    onError: (error: unknown) => {
      console.error('[TaxonomyDetail] Update failed:', error);
      // Log full error details for debugging
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { data?: unknown; status?: number } };
        console.error('[TaxonomyDetail] Response status:', axiosError.response?.status);
        console.error('[TaxonomyDetail] Response data:', JSON.stringify(axiosError.response?.data, null, 2));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => taxonomyApi.delete(taxonomyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxonomies'] });
      navigate('/taxonomies');
    },
  });

  const handleStartEditing = () => {
    setEditedTaxonomy(taxonomy!);
    setIsEditing(true);
    setHasChanges(false);
  };

  const handleCancelEditing = () => {
    setEditedTaxonomy(taxonomy!);
    setIsEditing(false);
    setHasChanges(false);
  };

  const handleSave = () => {
    if (!editedTaxonomy || !hasChanges) return;

    // Increment version
    const newVersion = incrementVersion(editedTaxonomy.version, versionBumpType);

    const updateData = {
      name: editedTaxonomy.name,
      description: editedTaxonomy.description,
      version: newVersion,
      classes: editedTaxonomy.classes,
      annotation_rules: editedTaxonomy.annotation_rules,
      annotation_mode: editedTaxonomy.annotation_mode,
      shared_attributes: editedTaxonomy.shared_attributes,
    };

    console.log('[TaxonomyDetail] Saving taxonomy with data:', JSON.stringify(updateData, null, 2));

    updateMutation.mutate(updateData);
  };

  const updateField = <K extends keyof Taxonomy>(field: K, value: Taxonomy[K]) => {
    if (!editedTaxonomy) return;
    setEditedTaxonomy({ ...editedTaxonomy, [field]: value });
    setHasChanges(true);
  };

  const handleUpdateClass = (index: number, updatedClass: ClassDefinition) => {
    if (!editedTaxonomy) return;
    const newClasses = [...editedTaxonomy.classes];
    newClasses[index] = updatedClass;
    updateField('classes', newClasses);
  };

  const handleDeleteClass = (index: number) => {
    if (!editedTaxonomy) return;
    const newClasses = editedTaxonomy.classes.filter((_, i) => i !== index);
    updateField('classes', newClasses);
  };

  // Apply common attributes to all classes
  const applyCommonAttributesToAllClasses = () => {
    if (!editedTaxonomy || Object.keys(commonAttributes).length === 0) return;
    const updatedClasses = editedTaxonomy.classes.map(cls => ({
      ...cls,
      attributes: { ...commonAttributes, ...cls.attributes }
    }));
    updateField('classes', updatedClasses);
  };

  const handleAddClass = () => {
    if (!editedTaxonomy || !newClassName.trim() || !newClassId.trim()) return;

    const newClass: ClassDefinition = {
      id: newClassId.toLowerCase().replace(/\s+/g, '_'),
      name: newClassName,
      color: CLASS_COLORS[editedTaxonomy.classes.length % CLASS_COLORS.length],
      type: ['cuboid'],
      attributes: {},
    };

    updateField('classes', [...editedTaxonomy.classes, newClass]);
    setNewClassName('');
    setNewClassId('');
    setShowAddClass(false);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400">Loading taxonomy...</div>
        </div>
      </AppLayout>
    );
  }

  if (error || !taxonomy || !editedTaxonomy) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <h2 className="text-xl text-white mb-2">Taxonomy not found</h2>
          <Link to="/taxonomies" className="text-primary hover:underline">Back to Taxonomies</Link>
        </div>
      </div>
      </AppLayout>
    );
  }

  const displayTaxonomy = isEditing ? editedTaxonomy : taxonomy;

  // Breadcrumb only — edit controls go in headerActions to avoid overlapping the center logo
  const headerContent = (
    <nav className="flex items-center gap-2 text-sm">
      <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <Link to="/taxonomies" className="text-gray-400 hover:text-white transition-colors">Taxonomies</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      {isEditing ? (
        <input
          type="text"
          value={editedTaxonomy.name}
          onChange={(e) => updateField('name', e.target.value)}
          className="text-white font-medium bg-transparent border-b border-primary focus:outline-none"
        />
      ) : (
        <span className="text-white font-medium">{displayTaxonomy.name}</span>
      )}
      <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300 ml-2">
        v{displayTaxonomy.version}
      </span>
      {isEditing && hasChanges && (
        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
          → v{incrementVersion(editedTaxonomy.version, versionBumpType)}
        </span>
      )}
    </nav>
  );

  const headerActions = isEditing ? (
    <>
      <select
        value={versionBumpType}
        onChange={e => setVersionBumpType(e.target.value as 'patch' | 'minor' | 'major')}
        className="bg-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5 border border-gray-700 focus:outline-none focus:border-primary"
        title="Version bump type"
      >
        <option value="patch">patch</option>
        <option value="minor">minor</option>
        <option value="major">major</option>
      </select>
      <button
        onClick={handleCancelEditing}
        className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
      >
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={!hasChanges || updateMutation.isPending}
        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
      >
        {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </>
  ) : (
    <>
      <button
        onClick={handleStartEditing}
        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 text-sm"
      >
        Edit Taxonomy
      </button>
      <button
        onClick={() => {
          if (confirm('Are you sure you want to delete this taxonomy?')) {
            deleteMutation.mutate();
          }
        }}
        className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm"
      >
        Delete
      </button>
    </>
  );

  return (
    <AppLayout headerContent={headerContent} headerActions={headerActions}>
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Description */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-400 mb-2">Description</h2>
          {isEditing ? (
            <textarea
              value={editedTaxonomy.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
              rows={3}
              className="w-full px-4 py-3 bg-dark-panel border border-gray-700 rounded-lg text-white resize-none focus:border-primary focus:outline-none"
              placeholder="Add a description..."
            />
          ) : (
            <p className="text-gray-300">
              {displayTaxonomy.description || <span className="text-gray-500 italic">No description</span>}
            </p>
          )}
        </div>

        {/* Annotation Mode */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-400 mb-2">Annotation Mode</h2>
          {isEditing ? (
            <div className="grid grid-cols-3 gap-4 max-w-3xl">
              <button
                type="button"
                onClick={() => updateField('annotation_mode', 'fusion_3d')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  editedTaxonomy.annotation_mode === 'fusion_3d'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                  <span className={`font-medium ${editedTaxonomy.annotation_mode === 'fusion_3d' ? 'text-white' : 'text-gray-300'}`}>
                    3D / Fusion
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  For 3D cuboids, 4D tracking, and fusion annotations.
                </p>
              </button>

              <button
                type="button"
                onClick={() => updateField('annotation_mode', '2d_only')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  editedTaxonomy.annotation_mode === '2d_only'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className={`font-medium ${editedTaxonomy.annotation_mode === '2d_only' ? 'text-white' : 'text-gray-300'}`}>
                    2D Only
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  For pure 2D annotations like lanes, traffic signs, drivable areas.
                </p>
              </button>

              <button
                type="button"
                onClick={() => updateField('annotation_mode', 'segmentation_3d')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  editedTaxonomy.annotation_mode === 'segmentation_3d'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  <span className={`font-medium ${editedTaxonomy.annotation_mode === 'segmentation_3d' ? 'text-white' : 'text-gray-300'}`}>
                    3D Segmentation
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  For 3D point cloud semantic segmentation.
                </p>
              </button>

            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                displayTaxonomy.annotation_mode === 'fusion_3d'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : displayTaxonomy.annotation_mode === 'segmentation_3d'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}>
                {displayTaxonomy.annotation_mode === 'fusion_3d'
                  ? '3D / Fusion'
                  : displayTaxonomy.annotation_mode === 'segmentation_3d'
                  ? '3D Segmentation'
                  : '2D Only'}
              </span>
              <span className="text-sm text-gray-500">
                {displayTaxonomy.annotation_mode === 'fusion_3d'
                  ? 'For 3D cuboids, 4D tracking, and fusion annotations'
                  : displayTaxonomy.annotation_mode === 'segmentation_3d'
                  ? 'For 3D point cloud semantic segmentation'
                  : 'For pure 2D annotations like lanes, traffic signs, drivable areas'
                }
              </span>
            </div>
          )}
        </div>

        {/* Shared Attributes - Visible in both view and edit mode */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Shared Attributes</h2>
              <p className="text-xs text-gray-500 mt-1">
                {isEditing
                  ? 'Define attributes that apply to specific classes or all classes'
                  : `${displayTaxonomy.shared_attributes?.length || 0} shared attribute(s) defined`
                }
              </p>
            </div>
          </div>
          <div className="bg-dark-panel rounded-lg border border-gray-700 p-4">
            <SharedAttributeEditor
              sharedAttributes={displayTaxonomy.shared_attributes || []}
              classes={displayTaxonomy.classes}
              onChange={(attrs) => updateField('shared_attributes', attrs)}
              isEditing={isEditing}
            />
          </div>
        </div>

        {/* Common Attributes - Only visible in edit mode (legacy quick-apply feature) */}
        {isEditing && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Quick Apply Attributes</h2>
                <p className="text-xs text-gray-500 mt-1">Define attributes here and apply them directly to class definitions</p>
              </div>
              {editedTaxonomy.classes.length > 0 && Object.keys(commonAttributes).length > 0 && (
                <button
                  onClick={applyCommonAttributesToAllClasses}
                  className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg text-sm font-medium"
                >
                  Apply to All Classes
                </button>
              )}
            </div>
            <div className="bg-dark-panel rounded-lg border border-gray-700 p-4">
              <AttributeEditor
                attributes={commonAttributes}
                onChange={setCommonAttributes}
              />
            </div>
          </div>
        )}

        {/* Classes */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Classes</h2>
            {isEditing && (
              <button
                onClick={() => setShowAddClass(true)}
                className="px-4 py-2 bg-primary/20 text-primary rounded-lg hover:bg-primary/30"
              >
                + Add Class
              </button>
            )}
          </div>

          {/* Add Class Form */}
          {showAddClass && (
            <div className="mb-4 p-4 bg-dark-panel rounded-lg border border-primary/30">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Class Name</label>
                  <input
                    type="text"
                    value={newClassName}
                    onChange={(e) => {
                      setNewClassName(e.target.value);
                      setNewClassId(e.target.value.toLowerCase().replace(/\s+/g, '_'));
                    }}
                    className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white"
                    placeholder="e.g., Pedestrian"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Class ID</label>
                  <input
                    type="text"
                    value={newClassId}
                    onChange={(e) => setNewClassId(e.target.value)}
                    className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white"
                    placeholder="e.g., pedestrian"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddClass}
                  disabled={!newClassName.trim() || !newClassId.trim()}
                  className="px-4 py-2 bg-primary text-white rounded disabled:opacity-50"
                >
                  Add Class
                </button>
                <button
                  onClick={() => { setShowAddClass(false); setNewClassName(''); setNewClassId(''); }}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {displayTaxonomy.classes.map((cls, index) => (
              isEditing ? (
                <ClassEditor
                  key={cls.id}
                  cls={cls}
                  sharedAttributes={editedTaxonomy.shared_attributes || []}
                  onUpdate={(updated) => handleUpdateClass(index, updated)}
                  onDelete={() => handleDeleteClass(index)}
                />
              ) : (
                (() => {
                  // Merge shared attributes (with applies_to matching this class)
                  // into the displayed attribute list, so the view matches what
                  // the annotation editor actually shows at runtime.
                  const effectiveAttrs = getEffectiveAttributesForClass(cls.id, displayTaxonomy);
                  const ownAttrIds = new Set(Object.keys(cls.attributes ?? {}));
                  const entries = Object.entries(effectiveAttrs);
                  return (
                    <div key={cls.id} className="bg-dark rounded-lg border border-gray-700 p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: cls.color }} />
                        <div>
                          <h4 className="text-white font-medium">{cls.name}</h4>
                          <p className="text-xs text-gray-500">{cls.id}</p>
                        </div>
                        <div className="flex gap-1 ml-auto">
                          {cls.type.map(t => (
                            <span key={t} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">{t}</span>
                          ))}
                        </div>
                      </div>
                      {entries.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
                          <p className="text-xs text-gray-500 mb-2">{entries.length} attributes</p>
                          <div className="flex flex-wrap gap-2">
                            {entries.map(([attrId, attr]) => {
                              const isShared = !ownAttrIds.has(attrId);
                              return (
                                <span
                                  key={attrId}
                                  className={`px-2 py-1 rounded text-xs text-gray-300 ${isShared ? 'bg-indigo-500/15 border border-indigo-500/30' : 'bg-gray-800'}`}
                                  title={isShared ? 'Inherited from a shared attribute' : 'Class-specific attribute'}
                                >
                                  {attrId}: <span className="text-gray-500">{attr.type}</span>
                                  {isShared && <span className="ml-1.5 text-[10px] text-indigo-300">shared</span>}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )
            ))}
          </div>
        </div>

        {/* Annotation Rules */}
        {displayTaxonomy.annotation_rules && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white mb-4">Annotation Rules</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-dark-panel rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">Min Points (Polyline)</p>
                <p className="text-white font-medium">{displayTaxonomy.annotation_rules.min_points_polyline}</p>
              </div>
              <div className="p-4 bg-dark-panel rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">Min Points (Polygon)</p>
                <p className="text-white font-medium">{displayTaxonomy.annotation_rules.min_points_polygon}</p>
              </div>
              <div className="p-4 bg-dark-panel rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">Allow Overlapping</p>
                <p className="text-white font-medium">{displayTaxonomy.annotation_rules.allow_overlapping_boxes ? 'Yes' : 'No'}</p>
              </div>
              <div className="p-4 bg-dark-panel rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">Require Track ID</p>
                <p className="text-white font-medium">{displayTaxonomy.annotation_rules.require_track_id ? 'Yes' : 'No'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default TaxonomyDetail;
