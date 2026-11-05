import { ContractError, syncJsonSnapshot } from '@planemem/contracts';

export function fail(code: string, trace: string): never {
  throw new ContractError(code, 'Simulated session request could not be completed: ' + code, {
    trace_id: trace,
    retryable: false,
  });
}
export function snapshot<T>(value: T, maximum: number): T {
  return JSON.parse(syncJsonSnapshot(value, maximum)) as T;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
export function fingerprint(value: Record<string, unknown>): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return item;
  };
  // Match the gateway's effective body: the header key is not a business field.
  const { idempotency_key: _key, ...body } = value;
  return JSON.stringify(sort(body));
}
export function envelope(data: unknown, trace: string, source_refs: unknown[] = []) {
  return { schema_version: 1 as const, trace_id: trace, source_refs, data };
}
