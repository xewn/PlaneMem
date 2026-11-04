import {
  ContractError,
  CONTEXT_PACK_SAVE_CONTEXT_BYTES,
  parseContextPackSaveContextEnvelope,
  syncJsonSnapshot,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';

export function canReadContextPackSaveContext(context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    context.capability.includes('context.read') &&
    Number.isFinite(expiry) &&
    expiry > Date.now()
  );
}

/** Headers constrain trusted context; they never supply authenticated identity. */
export function validateContextPackSaveContextHeaders(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
  context: RequestContext,
): void {
  const invalid = () =>
    new ContractError(
      'INVALID_INPUT',
      'Save identity accepts no body, duplicate headers, write or cache conditions',
      { trace_id: context.trace_id, retryable: false },
    );
  let headers: Map<string, string>;
  try {
    const pairs = entries.filter(([, value]) => value !== undefined);
    syncJsonSnapshot(pairs, CONTEXT_PACK_SAVE_CONTEXT_BYTES);
    headers = new Map();
    for (const [name, value] of pairs) {
      const key = name.toLowerCase();
      if (typeof value !== 'string' || headers.has(key)) throw new TypeError();
      headers.set(key, value);
    }
  } catch {
    throw invalid();
  }
  if (
    [
      'idempotency-key',
      'if-match',
      'if-match-version',
      'x-expected-version',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'range',
      'if-range',
      'content-encoding',
      'transfer-encoding',
    ].some((key) => headers.has(key)) ||
    (headers.has('content-length') && headers.get('content-length') !== '0') ||
    ['traceparent', 'x-trace-id'].some(
      (key) => headers.has(key) && headers.get(key) !== context.trace_id,
    )
  )
    throw invalid();
  for (const [name, actual] of [
    ['x-tenant-id', context.tenant_id],
    ['x-workspace-id', context.workspace_id],
    ['x-project-id', context.project_id],
    ['x-expected-actor-id', context.actor_id],
    ['x-expected-client-id', context.client_id],
  ] as const) {
    if (headers.has(name) && headers.get(name) !== actual)
      throw new ContractError('DENIED', 'The original identity differs from the verified caller', {
        trace_id: context.trace_id,
        retryable: false,
      });
  }
}

export function registerContextPackSaveContext(router: CommandRouter): void {
  router.register('context.pack.save-context', (request) => {
    const context = structuredClone(request.context);
    const active = () => {
      if (!canReadContextPackSaveContext(context))
        throw new ContractError('DENIED', 'A verified unexpired context reader is required', {
          trace_id: context.trace_id,
          retryable: false,
        });
    };
    active();
    if (
      Object.keys(request.input).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Save identity takes no parameters or write conditions',
        { trace_id: context.trace_id, retryable: false },
      );
    let result;
    try {
      result = parseContextPackSaveContextEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: [],
          data: {
            identity: {
              tenant_id: context.tenant_id,
              workspace_id: context.workspace_id,
              project_id: context.project_id,
              actor_id: context.actor_id,
              client_id: context.client_id,
            },
            expires_at: new Date(context.token_expires_at!).toISOString(),
            permissions: {
              compile: true,
              read_restricted: context.capability.includes('data.restricted.read'),
            },
          },
        },
        context,
        context.trace_id,
      );
    } catch {
      throw new ContractError(
        'CONTEXT_PACK_SAVE_CONTEXT_INVALID',
        'Verified context pack save identity could not be represented',
        { trace_id: context.trace_id, retryable: false },
      );
    }
    active();
    return result;
  });
}
