
import type {
  ClassDefinition,
  AttributeDefinition,
  SharedAttributeDefinition,
  TaxonomyConfig,
  Taxonomy
} from '@/types';

export function getEffectiveAttributesForClass(
  classId: string,
  taxonomy: TaxonomyConfig | Taxonomy | null
): Record<string, AttributeDefinition> {
  if (!taxonomy) return {};

  const classDef = taxonomy.classes.find(c => c.id === classId);
  if (!classDef) return {};

  const result: Record<string, AttributeDefinition> = {};

  const sharedAttrs = taxonomy.shared_attributes || [];
  for (const sharedAttr of sharedAttrs) {
    const appliesTo = sharedAttr.applies_to || [];
    const appliesToAll = appliesTo.length === 0 || appliesTo.includes('__all__');
    const appliesToThisClass = appliesToAll || appliesTo.includes(classId);

    if (appliesToThisClass) {
      result[sharedAttr.name] = {
        type: sharedAttr.type,
        default: sharedAttr.default,
        options: sharedAttr.options,
        required: sharedAttr.required,
        description: sharedAttr.description,
        mutable: sharedAttr.mutable,
      };
    }
  }

  if (classDef.attributes) {
    for (const [key, attr] of Object.entries(classDef.attributes)) {
      result[key] = attr;
    }
  }

  return result;
}

export function getEnhancedClassDefinition(
  classId: string,
  taxonomy: TaxonomyConfig | Taxonomy | null
): ClassDefinition | undefined {
  if (!taxonomy) return undefined;

  const classDef = taxonomy.classes.find(c => c.id === classId);
  if (!classDef) return undefined;

  return {
    ...classDef,
    attributes: getEffectiveAttributesForClass(classId, taxonomy),
  };
}

export function sharedAttributeAppliesToClass(
  sharedAttr: SharedAttributeDefinition,
  classId: string
): boolean {
  const appliesTo = sharedAttr.applies_to || [];
  if (appliesTo.length === 0 || appliesTo.includes('__all__')) {
    return true;
  }
  return appliesTo.includes(classId);
}

export function getClassesForSharedAttribute(
  sharedAttr: SharedAttributeDefinition,
  taxonomy: TaxonomyConfig | Taxonomy | null
): string[] {
  if (!taxonomy) return [];

  const appliesTo = sharedAttr.applies_to || [];
  if (appliesTo.length === 0 || appliesTo.includes('__all__')) {
    return taxonomy.classes.map(c => c.id);
  }
  return appliesTo;
}
