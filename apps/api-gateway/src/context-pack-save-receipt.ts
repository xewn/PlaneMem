import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES,
  isSyncIdentifier,
  isUlid,
  parseContextPackSaveReceiptQuery,
  parseContextPackSaveReceiptEnvelope,
  syncJsonSnapshot,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { commandReceipt } from './http.js';
import { fingerprint } from './idempotency.js';

const activeReads = new WeakMap<CommandRouter, { active: number }>();
function failure(code: string, trace: string) {
  const messages: Record<string, string> = {
    INVALID_INPUT:
      'Supply the complete original save identity, permissions, key and parameters without write conditions',
    DENIED: 'Restore the original verified identity and context permissions',
    CONTEXT_PACK_NOT_FOUND: 'The original saved pack project is unavailable',
    IDEMPOTENCY_KEY_REUSED: 'The original key belongs to different save parameters or permissions',
    CONTEXT_PACK_RECEIPT_INVALID: 'The historical save metadata could not be validated',
    CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Historical context pack storage is unavailable',
    CONTEXT_PACK_RECEIPT_TIMEOUT:
      'Stopped waiting for the historical save query; it may still be running',
    RATE_LIMITED: 'Historical save query capacity is occupied',
  };
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}
export function canReadContextPackSaveReceipt(context: RequestContext): boolean {
  try {
    return (
      context.schema_version === 1 &&
      context.authenticated_client === true &&
      [context.tenant_id, context.workspace_id, context.project_id, context.actor_id].every(
        isUlid,
      ) &&
      isSyncIdentifier(context.client_id) &&
      !/\u007f/.test(context.client_id) &&
      isSyncIdentifier(context.trace_id) &&
      !/\u007f/.test(context.trace_id) &&
      Array.isArray(context.capability) &&
      context.capability.includes('context.read') &&
      Date.parse(context.token_expires_at ?? '') > Date.now()
    );
  } catch {
    return false;
  }
}
export function validateContextPackSaveReceiptHeaders(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
  context: RequestContext,
) {
  let headers: Map<string, string>;
  try {
    const pairs = entries.filter(([, value]) => value !== undefined);
    syncJsonSnapshot(pairs, 16384);
    headers = new Map();
    for (const [name, value] of pairs) {
      const key = name.toLowerCase();
      if (typeof value !== 'string' || headers.has(key)) throw new TypeError();
      headers.set(key, value);
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
      ].some((key) => headers.has(key))
    )
      throw new TypeError();
    const length = headers.get('content-length');
    if (
      length !== undefined &&
      (!/^[1-9][0-9]{0,3}$/.test(length) ||
        Number(length) > CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES)
    )
      throw new TypeError();
    const type = headers.get('content-type');
    if (
      type !== undefined &&
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type)
    )
      throw new TypeError();
    if (
      ['traceparent', 'x-trace-id'].some(
        (key) => headers.has(key) && headers.get(key) !== context.trace_id,
      )
    )
      throw new TypeError();
  } catch {
    throw failure('INVALID_INPUT', context.trace_id);
  }
  for (const [name, value] of [
    ['x-tenant-id', context.tenant_id],
    ['x-workspace-id', context.workspace_id],
    ['x-project-id', context.project_id],
    ['x-expected-actor-id', context.actor_id],
    ['x-expected-client-id', context.client_id],
  ] as const)
    if (headers.has(name) && headers.get(name) !== value) throw failure('DENIED', context.trace_id);
}
function positive(value: unknown) {
  if (typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError();
  return value;
}
export function registerContextPackSaveReceipt(
  router: CommandRouter,
  database: RuntimeSql | undefined,
) {
  router.register('context.pack.save-receipt', async (request) => {
    const deadline = performance.now() + 30000;
    const context = structuredClone(request.context);
    const trace = isSyncIdentifier(context.trace_id) ? context.trace_id : 'trace_unknown';
    const active = () => {
      if (performance.now() >= deadline) throw failure('CONTEXT_PACK_RECEIPT_TIMEOUT', trace);
      if (!canReadContextPackSaveReceipt(context)) throw failure('DENIED', trace);
    };
    active();
    let query;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        Reflect.has(context, 'if_match')
      )
        throw new TypeError();
      query = parseContextPackSaveReceiptQuery(request.input);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    if (
      Object.entries(query.identity).some(
        ([key, value]) => context[key as keyof typeof query.identity] !== value,
      ) ||
      query.read_restricted !== context.capability.includes('data.restricted.read')
    )
      throw failure('DENIED', trace);
    const original = query;
    const receipt = commandReceipt(
      { operation: 'context.pack.compile', input: { ...original.parameters }, context },
      original.request_key,
    );
    const expected = fingerprint([receipt.fingerprint, original.read_restricted]);
    if (!database) throw failure('CONTEXT_PACK_STORAGE_UNAVAILABLE', trace);
    let gate = activeReads.get(router);
    if (!gate) {
      gate = { active: 0 };
      activeReads.set(router, gate);
    }
    if (gate.active >= 2) throw failure('RATE_LIMITED', trace);
    const lease = gate;
    lease.active++;
    const work = (async () => {
      try {
        const result = await database.begin(
          'isolation level repeatable read read only',
          async (tx) => {
            active();
            const projects = await tx`SELECT id FROM wcp_projects
            WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND id = ${context.project_id} AND deleted_at IS NULL
              AND (${original.read_restricted} OR classification <> 'restricted') LIMIT 1`;
            active();
            if (!projects.length) throw failure('CONTEXT_PACK_NOT_FOUND', trace);
            // No document/source read or stream lock: an absent row is only a snapshot observation.
            const rows =
              await tx`SELECT pack_id, version, created_at, expires_at, budget_tokens, used_tokens,
            pack_hash, server_cursor, request_fingerprint, read_restricted, pack_document IS NOT NULL AS has_document
            FROM wcp_context_packs WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND project_id = ${context.project_id} AND request_key = ${receipt.key} LIMIT 2`;
            active();
            if (!rows.length)
              return parseContextPackSaveReceiptEnvelope(
                {
                  schema_version: 1,
                  trace_id: trace,
                  source_refs: [],
                  data: { original, status: 'not-observed' },
                },
                original,
                trace,
              );
            if (rows.length !== 1) throw failure('CONTEXT_PACK_RECEIPT_INVALID', trace);
            const row = rows[0]!;
            if (
              typeof row.request_fingerprint !== 'string' ||
              !/^[a-f0-9]{64}$/.test(row.request_fingerprint)
            )
              throw failure('CONTEXT_PACK_RECEIPT_INVALID', trace);
            if (row.request_fingerprint !== expected)
              throw failure('IDEMPOTENCY_KEY_REUSED', trace);
            try {
              if (row.has_document !== true || row.read_restricted !== original.read_restricted)
                throw new TypeError();
              const recorded = {
                pack_id: row.pack_id,
                version: positive(row.version),
                created_at: new Date(row.created_at).toISOString(),
                expires_at: new Date(row.expires_at).toISOString(),
                budget_tokens: row.budget_tokens,
                used_tokens: row.used_tokens,
                pack_hash: row.pack_hash,
                server_cursor: positive(row.server_cursor),
                content_state: 'not-checked',
                source_state: 'not-checked',
              };
              return parseContextPackSaveReceiptEnvelope(
                {
                  schema_version: 1,
                  trace_id: trace,
                  source_refs: [
                    { type: 'context-pack', id: recorded.pack_id, revision: recorded.version },
                  ],
                  data: { original, status: 'recorded', receipt: recorded },
                },
                original,
                trace,
              );
            } catch {
              throw failure('CONTEXT_PACK_RECEIPT_INVALID', trace);
            }
          },
        );
        active();
        return result;
      } catch (error) {
        active();
        if (error instanceof ContractError) throw error;
        throw failure('CONTEXT_PACK_STORAGE_UNAVAILABLE', trace);
      } finally {
        lease.active--;
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(failure('CONTEXT_PACK_RECEIPT_TIMEOUT', trace)),
            Math.max(1, deadline - performance.now()),
          );
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}
