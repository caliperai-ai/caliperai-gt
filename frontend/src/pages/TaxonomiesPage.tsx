import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { taxonomyApi, organizationApi } from '@/api/client';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import type { Taxonomy, ClassDefinition, AnnotationType, AttributeDefinition, TaxonomyAnnotationMode } from '@/types';
import { AppLayout } from '@/components/layout';
import { TAXONOMY_TEMPLATES, getTaxonomyTemplate } from '@/constants/taxonomyTemplates';


const CLASS_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF69B4', '#32CD32', '#FFD700',
];

const ANNOTATION_TYPES: AnnotationType[] = [
  'cuboid', 'box2d', 'polyline', 'polygon', 'keypoints', 'segmentation_3d', 'segmentation_2d'
];

const ATTRIBUTE_TYPES: AttributeDefinition['type'][] = ['boolean', 'string', 'number', 'enum'];


interface AttributeEditorProps {
  attributes: Record<string, AttributeDefinition>;
  onChange: (attributes: Record<string, AttributeDefinition>) => void;
}

const AttributeEditor: React.FC<AttributeEditorProps> = ({ attributes, onChange }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAttr, setEditingAttr] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AttributeDefinition['type']>('string');
  const [formRequired, setFormRequired] = useState(false);
  const [formDefault, setFormDefault] = useState('');
  const [formOptions, setFormOptions] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormType('string');
    setFormRequired(false);
    setFormDefault('');
    setFormOptions('');
    setShowAddForm(false);
    setEditingAttr(null);
  };

  const handleAddAttribute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!formName.trim()) {
      alert('Please enter an attribute name');
      return;
    }

    const attrId = formName.toLowerCase().replace(/\s+/g, '_');
    if (attributes[attrId] && !editingAttr) {
      alert('Attribute with this name already exists');
      return;
    }

    let defaultValue: unknown = formDefault || undefined;
    if (formType === 'boolean') {
      defaultValue = formDefault === 'true';
    } else if (formType === 'number' && formDefault) {
      defaultValue = parseFloat(formDefault) || 0;
    }

    const newAttr: AttributeDefinition = {
      type: formType,
      required: formRequired,
      default: defaultValue,
    };

    if (formType === 'enum') {
      const opts = formOptions.split(',').map(o => o.trim()).filter(Boolean);
      if (opts.length === 0) {
        alert('Please enter at least one enum option');
        return;
      }
      newAttr.options = opts;
      if (!opts.includes(String(defaultValue))) {
        newAttr.default = opts[0];
      }
    }

    const newAttrs = { ...attributes };
    if (editingAttr && editingAttr !== attrId) {
      delete newAttrs[editingAttr];
    }
    newAttrs[attrId] = newAttr;

    onChange(newAttrs);
    resetForm();
  };

  const handleEditAttribute = (attrId: string) => {
    const attr = attributes[attrId];
    if (!attr) return;

    setFormName(attrId);
    setFormType(attr.type);
    setFormRequired(attr.required ?? false);
    setFormDefault(String(attr.default ?? ''));
    setFormOptions(attr.options?.join(', ') || '');
    setEditingAttr(attrId);
    setShowAddForm(true);
  };

  const handleDeleteAttribute = (attrId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const newAttrs = { ...attributes };
    delete newAttrs[attrId];
    onChange(newAttrs);
  };

  const handleCopyAttribute = (attrId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const attr = attributes[attrId];
    if (!attr) return;

    let newId = `${attrId}_copy`;
    let num = 1;
    while (attributes[newId]) {
      num++;
      newId = `${attrId}_copy${num}`;
    }

    onChange({ ...attributes, [newId]: { ...attr } });
  };

  const attrList = Object.entries(attributes);

  return (
    <div className="mt-4 pt-4 border-t border-gray-600">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-300">
          Attributes ({attrList.length})
        </h4>
        {!showAddForm && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAddForm(true); }}
            className="px-3 py-1 bg-primary/20 text-primary hover:bg-primary/30 rounded text-xs font-medium"
          >
            + Add Attribute
          </button>
        )}
      </div>

      {/* Existing Attributes List */}
      {attrList.length > 0 && (
        <div className="space-y-2 mb-3">
          {attrList.map(([attrId, attr]) => (
            <div
              key={attrId}
              className="flex items-center gap-2 p-2 bg-gray-800 rounded border border-gray-700"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white font-medium">{attrId}</span>
                <div className="flex items-center gap-1 mt-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    attr.type === 'enum' ? 'bg-purple-500/30 text-purple-300' :
                    attr.type === 'boolean' ? 'bg-blue-500/30 text-blue-300' :
                    attr.type === 'number' ? 'bg-green-500/30 text-green-300' :
                    'bg-gray-600 text-gray-300'
                  }`}>
                    {attr.type}
                  </span>
                  {attr.required && (
                    <span className="px-1.5 py-0.5 bg-red-500/30 text-red-300 rounded text-[10px] font-medium">
                      required
                    </span>
                  )}
                  {attr.type === 'enum' && attr.options && (
                    <span className="text-[10px] text-gray-500 truncate max-w-[150px]">
                      [{attr.options.join(', ')}]
                    </span>
                  )}
                </div>
              </div>

              {/* Edit */}
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditAttribute(attrId); }}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                title="Edit"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>

              {/* Copy */}
              <button
                type="button"
                onClick={(e) => handleCopyAttribute(attrId, e)}
                className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/20 rounded"
                title="Copy"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={(e) => handleDeleteAttribute(attrId, e)}
                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/20 rounded"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Attribute Form */}
      {showAddForm && (
        <div className="p-3 bg-gray-800/80 rounded-lg border border-primary/30">
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-sm font-medium text-white">
              {editingAttr ? `Edit: ${editingAttr}` : 'New Attribute'}
            </h5>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); resetForm(); }}
              className="text-gray-400 hover:text-white"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm focus:border-primary focus:outline-none"
                placeholder="e.g., occlusion_level"
                autoFocus
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type *</label>
              <div className="grid grid-cols-4 gap-2">
                {ATTRIBUTE_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFormType(type); }}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                      formType === type
                        ? 'bg-primary text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Enum Options */}
            {formType === 'enum' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Options * (comma-separated)</label>
                <input
                  type="text"
                  value={formOptions}
                  onChange={(e) => setFormOptions(e.target.value)}
                  className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm focus:border-primary focus:outline-none"
                  placeholder="low, medium, high"
                />
              </div>
            )}

            {/* Default Value */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Default Value</label>
              {formType === 'boolean' ? (
                <select
                  value={formDefault}
                  onChange={(e) => setFormDefault(e.target.value)}
                  className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">No default</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : formType === 'enum' && formOptions ? (
                <select
                  value={formDefault}
                  onChange={(e) => setFormDefault(e.target.value)}
                  className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">No default</option>
                  {formOptions.split(',').map(o => o.trim()).filter(Boolean).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={formType === 'number' ? 'number' : 'text'}
                  value={formDefault}
                  onChange={(e) => setFormDefault(e.target.value)}
                  className="w-full px-3 py-2 bg-dark border border-gray-600 rounded text-white text-sm focus:border-primary focus:outline-none"
                  placeholder={formType === 'number' ? '0' : 'optional'}
                />
              )}
            </div>

            {/* Required Checkbox */}
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={formRequired}
                onChange={(e) => setFormRequired(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-dark text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span className="text-sm text-gray-300">Required (must fill)</span>
            </label>

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleAddAttribute}
              className="w-full py-2.5 bg-primary text-white rounded font-medium hover:bg-primary/90 transition-colors"
            >
              {editingAttr ? 'Update Attribute' : 'Add Attribute'}
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {attrList.length === 0 && !showAddForm && (
        <p className="text-xs text-gray-500 text-center py-2">
          No attributes defined. Click "+ Add Attribute" to create one.
        </p>
      )}
    </div>
  );
};

// =============================================================================
// CREATE TAXONOMY MODAL
// =============================================================================

interface CreateTaxonomyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreateTaxonomyModal: React.FC<CreateTaxonomyModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [annotationMode, setAnnotationMode] = useState<TaxonomyAnnotationMode>('fusion_3d');
  const [classes, setClasses] = useState<ClassDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Template selection
  const [selectedTemplate, setSelectedTemplate] = useState<string>('none');

  // Common attributes that apply to all classes
  const [commonAttributes, setCommonAttributes] = useState<Record<string, AttributeDefinition>>({});

  // New class form state
  const [newClassName, setNewClassName] = useState('');
  const [newClassId, setNewClassId] = useState('');
  const [newClassColor, setNewClassColor] = useState(CLASS_COLORS[0]);
  const [newClassTypes, setNewClassTypes] = useState<AnnotationType[]>(['cuboid']);

  const queryClient = useQueryClient();

  // Create in the currently-selected org (sidebar org switcher), not just the
  // first org the user happens to belong to. Falls back to the first org only
  // if nothing is selected. Using organizations[0] caused taxonomies to be
  // created in the wrong org and produced misleading duplicate-name 409s.
  const currentOrgId = useCurrentOrganizationId();
  const { data: organizations } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: () => organizationApi.getMyOrganizations(),
  });
  const organizationId = currentOrgId ?? organizations?.[0]?.id;

  const createMutation = useMutation({
    mutationFn: (data: Partial<Taxonomy>) => taxonomyApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxonomies'] });
      resetForm();
      onClose();
    },
    onError: (err: Error & { response?: { data?: { detail?: unknown } } }) => {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        // FastAPI validation errors return detail as an array of {loc, msg, type, input}
        const messages = detail.map((d: { msg?: string; loc?: string[] }) =>
          d.loc ? `${d.loc.slice(1).join('.')}: ${d.msg}` : d.msg
        ).filter(Boolean).join('; ');
        setError(messages || 'Validation error');
      } else if (typeof detail === 'string') {
        setError(detail);
      } else {
        setError(err.message || 'Failed to create taxonomy');
      }
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setVersion('1.0.0');
    setAnnotationMode('fusion_3d');
    setClasses([]);
    setCommonAttributes({});
    setError(null);
    setNewClassName('');
    setNewClassId('');
    setNewClassColor(CLASS_COLORS[0]);
    setNewClassTypes(['cuboid']);
    setSelectedTemplate('none');
  };

  // Apply template to form
  const applyTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);

    if (templateId === 'none') {
      return; // Keep current values
    }

    const template = getTaxonomyTemplate(templateId);
    if (!template) return;

    // Apply template values. Suffix the name with today's date so users picking
    // the same template twice don't 409 on a duplicate-name conflict — they can
    // always edit it back if they want the bare template name.
    const today = new Date().toISOString().slice(0, 10);
    setName(`${template.name} · ${today}`);
    setDescription(template.description);
    setAnnotationMode(template.annotation_mode);
    setClasses([...template.classes]);

    // Convert shared_attributes to commonAttributes format (taking the first as pattern)
    // Note: Templates use shared_attributes, but the form uses commonAttributes
    // We'll leave commonAttributes empty and the shared_attributes will be sent separately
    setCommonAttributes({});
    setError(null);
  };

  // Apply common attributes to all existing classes
  const applyCommonAttributesToClasses = () => {
    if (Object.keys(commonAttributes).length === 0) return;
    setClasses(classes.map(cls => ({
      ...cls,
      attributes: { ...commonAttributes, ...cls.attributes }
    })));
  };

  const addClass = () => {
    if (!newClassName.trim() || !newClassId.trim()) {
      setError('Class name and ID are required');
      return;
    }

    if (classes.some(c => c.id === newClassId)) {
      setError('Class ID already exists');
      return;
    }

    setClasses([...classes, {
      id: newClassId.toLowerCase().replace(/\s+/g, '_'),
      name: newClassName,
      color: newClassColor,
      type: newClassTypes,
      attributes: {},
    }]);

    setNewClassName('');
    setNewClassId('');
    setNewClassColor(CLASS_COLORS[(classes.length + 1) % CLASS_COLORS.length]);
    setNewClassTypes(['cuboid']);
    setError(null);
  };

  const removeClass = (id: string) => {
    setClasses(classes.filter(c => c.id !== id));
  };

  const toggleAnnotationType = (type: AnnotationType) => {
    if (newClassTypes.includes(type)) {
      setNewClassTypes(newClassTypes.filter(t => t !== type));
    } else {
      setNewClassTypes([...newClassTypes, type]);
    }
  };

  const updateClassAttributes = (classId: string, attributes: Record<string, AttributeDefinition>) => {
    setClasses(classes.map(c => c.id === classId ? { ...c, attributes } : c));
  };

  const copyClass = (cls: ClassDefinition) => {
    let copyNum = 1;
    let newId = `${cls.id}_copy`;
    while (classes.some(c => c.id === newId)) {
      copyNum++;
      newId = `${cls.id}_copy${copyNum}`;
    }
    setClasses([...classes, { ...cls, id: newId, name: `${cls.name} (Copy)` }]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Taxonomy name is required');
      return;
    }
    if (classes.length === 0) {
      setError('At least one class is required');
      return;
    }

    // Merge common attributes into each class before submitting
    const classesWithCommonAttrs = classes.map(cls => ({
      ...cls,
      attributes: { ...commonAttributes, ...cls.attributes }
    }));

    // Get annotation rules from template if selected, otherwise use defaults
    const template = selectedTemplate !== 'none' ? getTaxonomyTemplate(selectedTemplate) : null;
    const annotationRules = template?.annotation_rules ?? {
      min_points_polyline: 2,
      min_points_polygon: 3,
      allow_overlapping_boxes: false,
      require_track_id: true,
    };

    // Get shared attributes from template if selected
    const sharedAttributes = template?.shared_attributes ?? [];

    if (!organizationId) {
      setError('No organization found. Please ensure you belong to an organization.');
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      version,
      annotation_mode: annotationMode,
      classes: classesWithCommonAttrs,
      skeletons: {},
      annotation_rules: annotationRules,
      shared_attributes: sharedAttributes,
      organization_id: organizationId,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto py-8">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-3xl mx-4 shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-4">Create New Taxonomy</h2>

        <form onSubmit={handleSubmit}>
          {/* Template Selector */}
          <div className="mb-6 p-4 bg-gradient-to-r from-primary/10 to-blue-500/10 rounded-lg border border-primary/30">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <h3 className="text-sm font-medium text-white">Start from Template</h3>
              <span className="text-xs text-gray-400">(Optional)</span>
            </div>
            <select
              value={selectedTemplate}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full px-4 py-2.5 bg-dark border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="none">Start from scratch...</option>
              <optgroup label="3D / Fusion Templates">
                {TAXONOMY_TEMPLATES.filter(t => t.annotation_mode === 'fusion_3d').map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.classes.length} classes)
                  </option>
                ))}
              </optgroup>
              <optgroup label="3D Segmentation Templates">
                {TAXONOMY_TEMPLATES.filter(t => t.annotation_mode === 'segmentation_3d').map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.classes.length} classes)
                  </option>
                ))}
              </optgroup>
              <optgroup label="2D Only Templates">
                {TAXONOMY_TEMPLATES.filter(t => t.annotation_mode === '2d_only').map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.classes.length} classes)
                  </option>
                ))}
              </optgroup>
            </select>
            {selectedTemplate !== 'none' && (
              <p className="mt-2 text-xs text-gray-400">
                ✓ Template applied. You can customize classes and attributes below.
              </p>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Taxonomy Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                placeholder="e.g., Autonomous Driving v2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Version
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                placeholder="1.0.0"
              />
            </div>
          </div>

          {/* Annotation Mode Selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Annotation Mode *
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setAnnotationMode('fusion_3d')}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  annotationMode === 'fusion_3d'
                    ? 'border-primary bg-primary/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                  <span className={`text-sm font-medium ${annotationMode === 'fusion_3d' ? 'text-white' : 'text-gray-300'}`}>
                    3D / Fusion
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">
                  3D cuboids, 4D tracking, fusion annotations
                </p>
              </button>

              <button
                type="button"
                onClick={() => setAnnotationMode('segmentation_3d')}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  annotationMode === 'segmentation_3d'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  <span className={`text-sm font-medium ${annotationMode === 'segmentation_3d' ? 'text-white' : 'text-gray-300'}`}>
                    Segmentation
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">
                  Per-point LiDAR semantic labeling
                </p>
              </button>

              <button
                type="button"
                onClick={() => setAnnotationMode('2d_only')}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  annotationMode === '2d_only'
                    ? 'border-orange-500 bg-orange-500/10'
                    : 'border-gray-600 bg-dark hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className={`text-sm font-medium ${annotationMode === '2d_only' ? 'text-white' : 'text-gray-300'}`}>
                    2D Only
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">
                  Lanes, signs, 2D-only annotations
                </p>
              </button>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary resize-none"
              placeholder="Describe the labeling requirements..."
            />
          </div>

          {/* Common Attributes Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-medium text-white">Common Attributes</h3>
                <p className="text-xs text-gray-500 mt-1">These attributes will be applied to all classes</p>
              </div>
              {classes.length > 0 && Object.keys(commonAttributes).length > 0 && (
                <button
                  type="button"
                  onClick={applyCommonAttributesToClasses}
                  className="px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-xs font-medium"
                >
                  Apply to Existing Classes
                </button>
              )}
            </div>
            <div className="p-4 bg-dark rounded-lg border border-gray-600">
              <AttributeEditor
                attributes={commonAttributes}
                onChange={setCommonAttributes}
              />
            </div>
          </div>

          {/* Classes Section */}
          <div className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-lg font-medium text-white">Classes</h3>
              {classes.length > 0 && (
                <span className="text-xs text-gray-500">{classes.length} defined</span>
              )}
            </div>

            {/* Add New Class Form — kept above the list so it stays reachable
                even when a template pre-fills 10+ classes. */}
            <div className="p-4 bg-dark rounded-lg border border-gray-600 mb-4">
              <div className="text-xs font-medium text-gray-300 mb-3">
                {classes.length > 0 ? 'Add another class' : 'Add your first class'}
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Class Name</label>
                  <input
                    type="text"
                    value={newClassName}
                    onChange={(e) => {
                      setNewClassName(e.target.value);
                      setNewClassId(e.target.value.toLowerCase().replace(/\s+/g, '_'));
                    }}
                    className="w-full px-3 py-2 bg-dark-panel border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-primary"
                    placeholder="e.g., Car"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Class ID</label>
                  <input
                    type="text"
                    value={newClassId}
                    onChange={(e) => setNewClassId(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-panel border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-primary"
                    placeholder="e.g., car"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newClassColor}
                      onChange={(e) => setNewClassColor(e.target.value)}
                      className="w-10 h-9 rounded cursor-pointer border-0"
                    />
                    <input
                      type="text"
                      value={newClassColor}
                      onChange={(e) => setNewClassColor(e.target.value)}
                      className="flex-1 px-3 py-2 bg-dark-panel border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-2">Annotation Types</label>
                <div className="flex flex-wrap gap-2">
                  {ANNOTATION_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleAnnotationType(type)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${
                        newClassTypes.includes(type)
                          ? 'bg-primary text-white'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={addClass}
                className="w-full py-2 bg-primary/80 text-white rounded hover:bg-primary transition-colors font-medium"
              >
                + Add Class
              </button>
            </div>

            {/* Existing Classes */}
            {classes.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Current classes
                </div>
                {classes.map((cls) => (
                  <div key={cls.id} className="p-3 bg-dark rounded-lg border border-gray-600">
                    {/* Class Header */}
                    <div className="flex items-center gap-3">
                      <div
                        className="w-6 h-6 rounded flex-shrink-0"
                        style={{ backgroundColor: cls.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-medium">{cls.name}</span>
                        <span className="text-gray-500 ml-2 text-sm">({cls.id})</span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {cls.type.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                            {t}
                          </span>
                        ))}
                      </div>
                      {/* Copy Class Button */}
                      <button
                        type="button"
                        onClick={() => copyClass(cls)}
                        className="p-1 text-gray-400 hover:text-blue-400"
                        title="Copy class"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeClass(cls.id)}
                        className="p-1 text-red-400 hover:text-red-300"
                        title="Delete class"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Attribute Editor for this class */}
                    <AttributeEditor
                      attributes={cls.attributes}
                      onChange={(attrs) => updateClassAttributes(cls.id, attrs)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-gray-700">
            {/* Repeat the error near the submit button — the one at the top of the
                modal scrolls off-screen on long template forms, so without this
                the user sees the button click do "nothing". */}
            {error && (
              <div className="mb-3 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { resetForm(); onClose(); }}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Taxonomy'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// TAXONOMY CARD
// =============================================================================

const TaxonomyCard: React.FC<{ taxonomy: Taxonomy }> = ({ taxonomy }) => {
  const getModeInfo = (mode: string) => {
    switch (mode) {
      case 'fusion_3d':
        return { label: '3D/Fusion', color: 'purple' };
      case 'segmentation_3d':
        return { label: 'Segmentation', color: 'cyan' };
      case '2d_only':
        return { label: '2D Only', color: 'orange' };
      default:
        return { label: mode, color: 'gray' };
    }
  };

  const { label: modeLabel, color: modeColor } = getModeInfo(taxonomy.annotation_mode);

  const colorClasses = {
    purple: { gradient: 'from-purple-500/20 to-pink-500/20', text: 'text-purple-400', hoverBorder: 'hover:border-purple-500/50', hoverShadow: 'hover:shadow-purple-500/10' },
    cyan: { gradient: 'from-cyan-500/20 to-blue-500/20', text: 'text-cyan-400', hoverBorder: 'hover:border-cyan-500/50', hoverShadow: 'hover:shadow-cyan-500/10' },
    orange: { gradient: 'from-orange-500/20 to-yellow-500/20', text: 'text-orange-400', hoverBorder: 'hover:border-orange-500/50', hoverShadow: 'hover:shadow-orange-500/10' },
    gray: { gradient: 'from-gray-500/20 to-gray-600/20', text: 'text-gray-400', hoverBorder: 'hover:border-gray-500/50', hoverShadow: 'hover:shadow-gray-500/10' },
  };

  const colors = colorClasses[modeColor as keyof typeof colorClasses] || colorClasses.gray;

  return (
    <Link
      to={`/taxonomies/${taxonomy.id}`}
      data-tour="taxonomy-card"
      className={`group relative block bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50 ${colors.hoverBorder} transition-all duration-300 overflow-hidden hover:shadow-lg ${colors.hoverShadow} hover:-translate-y-1`}
    >
      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Taxonomy icon */}
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors.gradient} flex items-center justify-center`}>
              <svg className={`w-5 h-5 ${colors.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white group-hover:text-purple-100 transition-colors">{taxonomy.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 font-mono">v{taxonomy.version}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                  taxonomy.annotation_mode === 'fusion_3d'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : taxonomy.annotation_mode === 'segmentation_3d'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                }`}>
                  {modeLabel}
                </span>
              </div>
            </div>
          </div>
          <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-xs font-medium border border-purple-500/30">
            {taxonomy.classes.length} classes
          </span>
        </div>

        {taxonomy.description && (
          <p className="text-gray-400 text-sm mb-4 line-clamp-2 min-h-[2.5rem]">{taxonomy.description}</p>
        )}

        {/* Class preview */}
        <div className="flex flex-wrap gap-2 mb-4">
          {taxonomy.classes.slice(0, 5).map(cls => (
            <div
              key={cls.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border"
              style={{
                backgroundColor: `${cls.color}15`,
                borderColor: `${cls.color}30`
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: cls.color }}
              />
              <span style={{ color: cls.color }}>{cls.name}</span>
            </div>
          ))}
          {taxonomy.classes.length > 5 && (
            <span className="px-2.5 py-1 text-gray-500 text-xs bg-gray-800/50 rounded-md">
              +{taxonomy.classes.length - 5} more
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-gray-700/50 text-sm">
          <span className="text-gray-500 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {new Date(taxonomy.created_at).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1 text-purple-400 group-hover:translate-x-1 transition-transform">
            <span className="text-xs">View</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
};

// =============================================================================
// TAXONOMIES PAGE
// =============================================================================

export const TaxonomiesPage: React.FC = () => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const currentOrgId = useCurrentOrganizationId();

  const { data: taxonomies, isLoading } = useQuery({
    queryKey: ['taxonomies', currentOrgId, searchQuery],
    queryFn: () => taxonomyApi.list(1, 50, searchQuery || undefined, undefined, currentOrgId || undefined),
  });

  // Header content with create button
  const headerContent = (
    <div className="flex items-center justify-between w-full">
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-white font-medium">Taxonomies</span>
      </nav>
      <button
        data-tour="create-taxonomy"
        onClick={() => setIsCreateModalOpen(true)}
        className="group px-5 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-400 hover:to-pink-400 transition-all duration-300 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 font-medium flex items-center gap-2 text-sm"
      >
        <svg className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Taxonomy
      </button>
    </div>
  );

  return (
    <AppLayout headerContent={headerContent}>

      {/* Search */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search taxonomies..."
            className="w-full pl-12 pr-4 py-3.5 bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all duration-300"
          />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 pb-8">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Loading taxonomies...</div>
        ) : taxonomies?.items && taxonomies.items.length > 0 ? (
          <div data-tour="taxonomy-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {taxonomies.items.map(taxonomy => (
              <TaxonomyCard key={taxonomy.id} taxonomy={taxonomy} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No taxonomies yet</h3>
            <p className="text-gray-400 mb-4 max-w-md mx-auto">Create your first taxonomy to define labeling classes and attributes for your annotation projects.</p>

            {/* Template hint */}
            <div className="flex items-center justify-center gap-2 mb-8 text-sm">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-gray-300">Quick start with <span className="text-primary font-medium">5 pre-built templates</span> for 3D, 2D detection, and segmentation</span>
            </div>

            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-400 hover:to-pink-400 transition-all duration-300 shadow-lg shadow-purple-500/25 font-medium"
            >
              Create Your First Taxonomy
            </button>
          </div>
        )}
      </main>

      {/* Create Modal */}
      <CreateTaxonomyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </AppLayout>
  );
};

export default TaxonomiesPage;
