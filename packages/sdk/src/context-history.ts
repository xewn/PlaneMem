import {
  ContractError,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  compareContextSnapshots,
  contextRevisionSnapshotJson,
  parseContextComparisonQuery,
  parseContextHistoryReadEnvelope,
  parseContextHistoryReadQuery,
  type ContextComparisonQuery,
  type ContextHistoryReadQuery,
  type ContextItemHistoryPage,
  type ContextItemHistoryQuery,
  type ContextItemRevision,
  type ContextSnapshotComparison,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import type { WcpEnvelope } from './continuity.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';
import {
  captureContextRead as capture,
  contextReadFields as fields,
} from './context-read-input.js';

export interface WcpContextHistoryReadOptions {
  /** Defaults to 30 seconds, including complete response validation and snapshot hashing. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpContextHistoryPagesOptions extends WcpContextHistoryReadOptions {
  /** Defaults to 100, at most 1000. Further continuation raises CONTEXT_HISTORY_PAGE_LIMIT. */
  max_pages?: number;
}

export interface WcpContextComparisonResult {
  schema_version: 1;
  kind: 'context-version-comparison';
  comparison_origin: 'local';
  read_consistency: 'separate-reads';
  content_state: 'snapshot-hashes-checked';
  source_state: 'not-checked';
  query: ContextComparisonQuery;
  identity_constraints: {
    tenant_id: string;
    workspace_id: string;
    project_id: string;
    actor_id: string;
    client_id: string;
  };
  from: WcpEnvelope<ContextItemRevision>;
  to: WcpEnvelope<ContextItemRevision>;
  comparison: ContextSnapshotComparison;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a valid context item, history positions, project context and read options; comparison and page iteration also require account and client constraints',
  DENIED: 'The current account or client cannot read the selected context history',
  UNAUTHENTICATED: 'Renew the intended session before reading context history',
  CONTEXT_ITEM_NOT_FOUND:
    'The selected context item or recorded version is unavailable in this project',
  CONTEXT_ITEM_INVALID: 'The stored context history could not be validated',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context history storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context history read audit could not be persisted',
  RATE_LIMITED: 'Context history reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for context history',
  GATEWAY_REQUEST_TIMEOUT:
    'The complete context history read or comparison exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete context history response did not match this read or exceeded its size limit',
  GATEWAY_UNAVAILABLE: 'Context history could not be read',
  CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE:
    'Snapshot integrity checking is unavailable; no unchecked version was returned',
  CONTEXT_HISTORY_HASH_MISMATCH: 'The complete context snapshot differs from its saved hash',
  CONTEXT_HISTORY_PAGE_LIMIT:
    'The requested history page limit was reached; preserve the last complete page and its continuation',
};
function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}

type CapturedContext = ReturnType<typeof capture>['context'];

/** Capture inputs before dispatch; one budget also covers all asynchronous digest work. */
async function withBudget<T>(
  original: RequestContext,
  options: WcpContextHistoryReadOptions,
  prepare: (context: CapturedContext) => (budget: RequestBudget) => Promise<T>,
): Promise<T> {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let start: (budget: RequestBudget) => Promise<T>;
    try {
      const settings = capture(original, options);
      start = prepare(settings.context);
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    budget.check();
    const result = await start(budget);
    budget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}

async function read(
  transport: WcpTransport,
  context: CapturedContext,
  query: ContextHistoryReadQuery,
  budget: RequestBudget,
) {
  const trace = context.trace_id;
  budget.check();
  if (query.kind === 'version' && typeof globalThis.crypto?.subtle?.digest !== 'function')
    throw failure('CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE', trace);
  const params =
    query.kind === 'history' ? new URLSearchParams({ limit: String(query.limit) }) : undefined;
  if (query.kind === 'history' && query.before_version !== undefined)
    params!.set('before_version', String(query.before_version));
  const path =
    '/v1/context-items/' +
    encodeURIComponent(query.item_id) +
    (query.kind === 'history' ? '/history?' + params!.toString() : '/versions/' + query.version);
  const raw = await budget.wait(() =>
    transport.request({
      method: 'GET',
      path,
      headers: {
        'x-trace-id': trace,
        'x-tenant-id': context.tenant_id,
        'x-workspace-id': context.workspace_id,
        'x-project-id': context.project_id,
        ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
        ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
      },
      response_type: 'bounded-json',
      max_response_bytes:
        query.kind === 'history' ? CONTEXT_HISTORY_RESPONSE_BYTES : CONTEXT_REVISION_RESPONSE_BYTES,
      signal: budget.signal,
    }),
  );
  let result;
  try {
    // The shared parser also detaches and bounds ordinary JSON from a custom transport.
    result = parseContextHistoryReadEnvelope(raw, query, context, trace);
  } catch {
    budget.check();
    throw failure('GATEWAY_RESPONSE_INVALID', trace);
  }
  budget.check();
  if (query.kind === 'version') {
    const revision = result.data as ContextItemRevision;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new TextEncoder().encode(contextRevisionSnapshotJson(revision));
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    let digest: ArrayBuffer;
    try {
      digest = await budget.wait(() => globalThis.crypto.subtle.digest('SHA-256', bytes.buffer));
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    } catch {
      budget.check();
      throw failure('CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE', trace);
    }
    if (
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') !==
      revision.snapshot_hash
    )
      throw failure('CONTEXT_HISTORY_HASH_MISMATCH', trace);
  }
  budget.check();
  return result;
}

export function readContextItemHistory(
  transport: WcpTransport,
  context: RequestContext,
  itemId: string,
  input: ContextItemHistoryQuery,
  options: WcpContextHistoryReadOptions,
): Promise<WcpEnvelope<ContextItemHistoryPage>> {
  return withBudget(context, options, (snapshot) => {
    const row = fields(input, ['before_version', 'limit']);
    const query = parseContextHistoryReadQuery({
      kind: 'history',
      item_id: itemId,
      ...(row.before_version === undefined ? {} : { before_version: row.before_version }),
      ...(row.limit === undefined ? {} : { limit: row.limit }),
    });
    return async (budget) =>
      (await read(transport, snapshot, query, budget)) as WcpEnvelope<ContextItemHistoryPage>;
  });
}

export function readContextItemVersion(
  transport: WcpTransport,
  context: RequestContext,
  itemId: string,
  version: number,
  options: WcpContextHistoryReadOptions,
): Promise<WcpEnvelope<ContextItemRevision>> {
  return withBudget(context, options, (snapshot) => {
    const query = parseContextHistoryReadQuery({ kind: 'version', item_id: itemId, version });
    return async (budget) =>
      (await read(transport, snapshot, query, budget)) as WcpEnvelope<ContextItemRevision>;
  });
}

/** Capture now; each next() alone starts one bounded read. No idle timer or prefetch. */
export function iterateContextItemHistory(
  transport: WcpTransport,
  original: RequestContext,
  itemId: string,
  input: ContextItemHistoryQuery,
  options: WcpContextHistoryPagesOptions,
): AsyncGenerator<WcpEnvelope<ContextItemHistoryPage>, void, unknown> {
  const trace = original.trace_id;
  const prepared = (() => {
    try {
      const row = fields(options, ['timeout_ms', 'signal', 'max_pages']);
      const maximum = row.max_pages === undefined ? 100 : row.max_pages;
      if (
        typeof maximum !== 'number' ||
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        maximum > 1000
      )
        throw new TypeError();
      const settings = capture(original, {
        ...(row.timeout_ms === undefined ? {} : { timeout_ms: row.timeout_ms as number }),
        ...(row.signal === undefined ? {} : { signal: row.signal as AbortSignal }),
      });
      if (settings.context.actor_id === undefined || settings.context.client_id === undefined)
        throw new TypeError();
      const fieldsInput = fields(input, ['before_version', 'limit']);
      const query = parseContextHistoryReadQuery({
        kind: 'history',
        item_id: itemId,
        ...(fieldsInput.before_version === undefined
          ? {}
          : { before_version: fieldsInput.before_version }),
        ...(fieldsInput.limit === undefined ? {} : { limit: fieldsInput.limit }),
      });
      if (query.kind !== 'history') throw new TypeError();
      return { settings, query, maximum };
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
  })();
  const { settings, query, maximum } = prepared;
  return (async function* () {
    let before = query.before_version;
    for (let count = 0; ; count++) {
      if (settings.signal?.aborted) throw failure('GATEWAY_REQUEST_CANCELED', trace);
      if (count >= maximum) throw failure('CONTEXT_HISTORY_PAGE_LIMIT', trace);
      const page = await readContextItemHistory(
        transport,
        settings.context,
        query.item_id,
        { limit: query.limit, ...(before === undefined ? {} : { before_version: before }) },
        {
          timeout_ms: settings.timeout,
          ...(settings.signal === undefined ? {} : { signal: settings.signal }),
        },
      );
      // Retain the validated continuation before exposing the mutable page to the consumer.
      const next = page.data.next_before_version;
      if (next !== undefined && before !== undefined && next >= before)
        throw failure('GATEWAY_RESPONSE_INVALID', trace);
      yield page;
      if (next === undefined) return;
      before = next;
    }
  })();
}

export function compareContextItemVersions(
  transport: WcpTransport,
  context: RequestContext,
  input: ContextComparisonQuery,
  options: WcpContextHistoryReadOptions,
): Promise<WcpContextComparisonResult> {
  return withBudget<WcpContextComparisonResult>(context, options, (snapshot) => {
    const query = parseContextComparisonQuery(input);
    if (snapshot.actor_id === undefined || snapshot.client_id === undefined) throw new TypeError();
    const identity_constraints = {
      tenant_id: snapshot.tenant_id,
      workspace_id: snapshot.workspace_id,
      project_id: snapshot.project_id,
      actor_id: snapshot.actor_id,
      client_id: snapshot.client_id,
    };
    return async (budget) => {
      const from = (await read(
        transport,
        snapshot,
        { kind: 'version', item_id: query.item_id, version: query.from_version },
        budget,
      )) as WcpEnvelope<ContextItemRevision>;
      budget.check();
      const to = (await read(
        transport,
        snapshot,
        { kind: 'version', item_id: query.item_id, version: query.to_version },
        budget,
      )) as WcpEnvelope<ContextItemRevision>;
      let comparison: ContextSnapshotComparison;
      try {
        comparison = compareContextSnapshots(from.data, to.data);
      } catch {
        budget.check();
        throw failure('GATEWAY_RESPONSE_INVALID', snapshot.trace_id);
      }
      budget.check();
      return {
        schema_version: 1,
        kind: 'context-version-comparison',
        comparison_origin: 'local',
        read_consistency: 'separate-reads',
        content_state: 'snapshot-hashes-checked',
        source_state: 'not-checked',
        query,
        identity_constraints,
        from,
        to,
        comparison,
      };
    };
  });
}
