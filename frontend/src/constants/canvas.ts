
export const HANDLE_SIZE = 8;
export const KEYPOINT_RADIUS = 6;
export const DASH_PATTERN = [5, 5];

export const ANNOTATION_COLORS = {
  default: '#3b82f6',
  selected: '#ffffff',
  hover: '#60a5fa',
  occluded: '#ffaa00',
  notLabeled: '#666666',
};

export const DEFAULT_CLASS_COLORS: Record<string, string> = {
  car: '#ef4444',
  truck: '#f97316',
  bus: '#f59e0b',
  motorcycle: '#84cc16',
  bicycle: '#22c55e',
  pedestrian: '#14b8a6',
  traffic_sign: '#06b6d4',
  traffic_light: '#3b82f6',
  lane: '#8b5cf6',
  road: '#a855f7',
  building: '#ec4899',
  vegetation: '#10b981',
  default: '#6b7280',
};

export function getClassColor(
  classId: string,
  taxonomy?: { classes?: Array<{ name: string; color?: string }> }
): string {
  if (taxonomy?.classes) {
    const classEntry = taxonomy.classes.find(c => c.name === classId);
    if (classEntry?.color) {
      return classEntry.color;
    }
  }

  return DEFAULT_CLASS_COLORS[classId.toLowerCase()] || DEFAULT_CLASS_COLORS.default;
}
