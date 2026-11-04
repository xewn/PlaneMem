import { isSyncIdentifier, isUlid, type RequestContext } from '@planemem/contracts';

interface ContextReadOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}

/** Flat optional undefined values are allowed; accessors and inherited/custom fields are not. */
export function contextReadFields(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !allowed.includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError();
  return Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)!.value]),
  );
}

export function captureContextRead(original: RequestContext, options: ContextReadOptions) {
  const row = contextReadFields(original, [
    'trace_id',
    'tenant_id',
    'workspace_id',
    'project_id',
    'actor_id',
    'client_id',
    'idempotency_key',
    'expected_version',
    'if_match',
  ]);
  if (
    !isSyncIdentifier(row.trace_id) ||
    !isUlid(row.tenant_id) ||
    !isUlid(row.workspace_id) ||
    !isUlid(row.project_id) ||
    (row.actor_id !== undefined && !isUlid(row.actor_id)) ||
    (row.client_id !== undefined && !isSyncIdentifier(row.client_id))
  )
    throw new TypeError();
  const settings = contextReadFields(options, ['timeout_ms', 'signal']);
  const timeout = settings.timeout_ms === undefined ? 30_000 : settings.timeout_ms;
  const signal = settings.signal as AbortSignal | undefined;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 2_147_483_647 ||
    (signal !== undefined &&
      (!signal ||
        typeof signal !== 'object' ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function'))
  )
    throw new TypeError();
  return {
    context: {
      trace_id: row.trace_id,
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      ...(row.actor_id === undefined ? {} : { actor_id: row.actor_id }),
      ...(row.client_id === undefined ? {} : { client_id: row.client_id }),
    },
    timeout,
    signal,
  };
}
