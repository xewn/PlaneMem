export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function canRead(classification: Classification, capabilities: string[]): boolean {
  return classification !== 'restricted' || capabilities.includes('data.restricted.read');
}

export function canExport(classification: Classification, capabilities: string[]): boolean {
  return (
    classification === 'public' ||
    (classification !== 'restricted' && capabilities.includes('data.export')) ||
    capabilities.includes('data.restricted.export')
  );
}

export function redact(value: unknown, classification: Classification): unknown {
  if (classification === 'public') return value;
  if (typeof value === 'string') return `[redacted:${classification}]`;
  if (Array.isArray(value)) return value.map((item) => redact(item, classification));
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, classification)]),
    );
  return value;
}
