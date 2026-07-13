import type { ClassDefinition, Taxonomy, TaxonomyConfig } from '@/types';

export const DEFAULT_CUBOID_DIMENSIONS: [number, number, number] = [4.0, 2.0, 1.5];

const CLASS_DIMENSION_PRESETS: Array<{ keys: string[]; dimensions: [number, number, number] }> = [
  { keys: ['constructionvehicle', 'construction'], dimensions: [6.0, 2.5, 2.5] },
  { keys: ['trafficcone', 'cone'], dimensions: [0.3, 0.3, 0.5] },
  { keys: ['motorcycle', 'motorbike', 'scooter'], dimensions: [2.2, 0.8, 1.5] },
  { keys: ['bicycle', 'bike', 'cyclist'], dimensions: [1.8, 0.6, 1.2] },
  { keys: ['pedestrian', 'person', 'human', 'adult', 'child'], dimensions: [0.6, 0.6, 1.7] },
  { keys: ['trailer'], dimensions: [6.0, 2.5, 2.5] },
  { keys: ['truck'], dimensions: [8.0, 2.5, 3.0] },
  { keys: ['bus'], dimensions: [12.0, 2.5, 3.5] },
  { keys: ['barrier'], dimensions: [2.0, 0.4, 1.0] },
  { keys: ['animal'], dimensions: [1.0, 0.5, 0.8] },
  { keys: ['car', 'vehicle'], dimensions: [4.5, 1.8, 1.5] },
];

function normalizeClassKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isValidDimensions(value?: [number, number, number] | null): value is [number, number, number] {
  if (!value || value.length !== 3) return false;
  return value.every((dim) => Number.isFinite(dim) && dim > 0);
}

function findClassDefinition(
  classId: string,
  taxonomy?: TaxonomyConfig | Taxonomy | null
): ClassDefinition | undefined {
  const classes = taxonomy?.classes;
  if (!classes?.length) return undefined;

  const exact = classes.find((cls) => cls.id === classId);
  if (exact) return exact;

  const normalizedClassId = normalizeClassKey(classId);
  return classes.find((cls) => normalizeClassKey(cls.id) === normalizedClassId);
}

export function getDefaultCuboidDimensions(
  classId?: string | null,
  taxonomy?: TaxonomyConfig | Taxonomy | null,
  classDef?: ClassDefinition | null
): [number, number, number] {
  if (!classId) return DEFAULT_CUBOID_DIMENSIONS;

  const resolvedClassDef = classDef ?? findClassDefinition(classId, taxonomy);
  const classDimensions = resolvedClassDef?.default_dimensions;
  if (isValidDimensions(classDimensions)) {
    return classDimensions;
  }

  const normalizedId = normalizeClassKey(classId);
  const normalizedName = normalizeClassKey(resolvedClassDef?.name ?? '');
  const combined = `${normalizedId}${normalizedName}`;

  for (const preset of CLASS_DIMENSION_PRESETS) {
    if (preset.keys.some((key) => combined.includes(normalizeClassKey(key)))) {
      return preset.dimensions;
    }
  }

  return DEFAULT_CUBOID_DIMENSIONS;
}
