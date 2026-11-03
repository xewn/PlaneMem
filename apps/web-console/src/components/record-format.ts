export function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function textValue(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function toneFor(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('block') || normalized.includes('denied') || normalized.includes('error'))
    return 'red';
  if (
    normalized.includes('review') ||
    normalized.includes('proposed') ||
    normalized.includes('pending')
  )
    return 'yellow';
  if (
    normalized.includes('done') ||
    normalized.includes('confirmed') ||
    normalized.includes('verified') ||
    normalized.includes('allowed') ||
    normalized.includes('running')
  )
    return 'green';
  if (
    normalized.includes('active') ||
    normalized.includes('progress') ||
    normalized.includes('latest')
  )
    return 'cyan';
  return 'neutral';
}
