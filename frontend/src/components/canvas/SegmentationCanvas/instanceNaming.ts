
export const INSTANCE_ID_PAD = 3;

export function classInstancePrefix(className: string, override?: string): string {
  const configured = override?.trim();
  if (configured) return configured.toUpperCase();
  const derived = className.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return derived || 'OBJ';
}

export function instanceDisplayId(
  className: string,
  ordinal: number,
  override?: string,
): string {
  const prefix = classInstancePrefix(className, override);
  return `${prefix}_${String(ordinal).padStart(INSTANCE_ID_PAD, '0')}`;
}
