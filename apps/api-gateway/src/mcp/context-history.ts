import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_HISTORY_ERROR_BYTES,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  CONTEXT_ITEM_READ_ERROR_BYTES,
  CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
  CONTEXT_ITEM_DIRECTORY_ERROR_BYTES,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  CONTEXT_PACK_READ_ERROR_BYTES,
  CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES,
  CONTEXT_PACK_SAVE_CONTEXT_BYTES,
  CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
  parseContextPackSaveReceiptQuery,
  parseContextPackSaveReceiptEnvelope,
  parseContextPackSaveContextEnvelope,
  parseContextPackDirectoryEnvelope,
  parseContextPackDirectoryQuery,
  contextPackReadHashJson,
  parseContextPackReadEnvelope,
  parseContextPackReadQuery,
  parseContextPackComparisonQuery,
  compareSavedContextPacks,
  compareContextSnapshots,
  contextRevisionSnapshotJson,
  isSyncIdentifier,
  isUlid,
  parseContextComparisonQuery,
  parseContextHistoryReadEnvelope,
  parseContextHistoryReadQuery,
  parseContextItemReadEnvelope,
  parseContextItemReadQuery,
  parseContextItemDirectoryEnvelope,
  parseContextItemDirectoryQuery,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ContextComparisonQuery,
  type ContextHistoryReadQuery,
  type ContextItemRevision,
  type ContextItemReadQuery,
  type ContextItemDirectoryQuery,
  type ContextPackReadQuery,
  type ContextPackComparisonQuery,
  type ContextPackReceipt,
  type ContextPackDirectoryQuery,
  type ContextPackSaveReceiptQuery,
} from '@planemem/contracts';
import type { ApiGateway } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadContextPackSaveReceipt } from '../context-pack-save-receipt.js';

type ToolName =
  | 'get_context_pack_save_receipt'
  | 'get_context_pack_save_context'
  | 'get_context_pack'
  | 'list_context_packs'
  | 'compare_context_packs'
  | 'list_context_items'
  | 'get_context_item'
  | 'get_archived_context_item'
  | 'list_context_item_history'
  | 'get_context_item_version'
  | 'compare_context_item_versions';
type ReadQuery =
  | { kind: 'save-receipt'; query: ContextPackSaveReceiptQuery }
  | { kind: 'save-identity' }
  | ContextHistoryReadQuery
  | ContextItemReadQuery
  | { kind: 'pack'; query: ContextPackReadQuery }
  | { kind: 'pack-list'; query: ContextPackDirectoryQuery }
  | { kind: 'list'; query: ContextItemDirectoryQuery };
type Query =
  | ReadQuery
  | { kind: 'compare'; query: ContextComparisonQuery }
  | { kind: 'compare-packs'; query: ContextPackComparisonQuery };
function isDetailQuery(query: Query): query is ContextItemReadQuery {
  return query.kind === 'current' || query.kind === 'archived';
}
function readPath(query: ReadQuery) {
  if (query.kind === 'save-receipt') return '/v1/context-pack/save-receipt';
  if (query.kind === 'save-identity') return '/v1/context-pack/save-context';
  if (query.kind === 'pack-list') return '/v1/context-packs';
  if (query.kind === 'pack') return '/v1/context-pack';
  if (query.kind === 'list') return '/v1/workbench/query';
  const root = '/v1/context-items/' + encodeURIComponent(query.item_id);
  if (isDetailQuery(query)) return root + (query.kind === 'archived' ? '/archived' : '');
  return root + (query.kind === 'history' ? '/history' : '/versions/' + query.version);
}
function responseLimit(query: ReadQuery) {
  if (query.kind === 'save-receipt') return CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES;
  if (query.kind === 'save-identity') return CONTEXT_PACK_SAVE_CONTEXT_BYTES;
  if (query.kind === 'pack-list') return CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES;
  if (query.kind === 'pack') return CONTEXT_PACK_READ_RESPONSE_BYTES;
  if (query.kind === 'list') return CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES;
  if (isDetailQuery(query)) return CONTEXT_ITEM_READ_RESPONSE_BYTES;
  return query.kind === 'history'
    ? CONTEXT_HISTORY_RESPONSE_BYTES
    : CONTEXT_REVISION_RESPONSE_BYTES;
}
const comparisonBytes = 16 * 1024 * 1024;
const packComparisonBytes = 12 * 1024 * 1024;
// Internal ApiGateway statuses, independent of the outer HTTP authentication listener.
const saveReceiptErrorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  DENIED: 403,
  NOT_FOUND: 404,
  COMMAND_NOT_FOUND: 404,
  CONTEXT_PACK_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  RATE_LIMITED: 429,
  CONTEXT_PACK_RECEIPT_INVALID: 500,
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
  CONTEXT_PACK_RECEIPT_TIMEOUT: 503,
  WORKBENCH_AUTH_UNAVAILABLE: 400,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
};
const saveIdentityErrorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  DENIED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONTEXT_PACK_SAVE_CONTEXT_INVALID: 500,
  WORKBENCH_AUTH_UNAVAILABLE: 503,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
};
const packDirectoryErrorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  DENIED: 403,
  NOT_FOUND: 404,
  CONTEXT_PACK_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONTEXT_PACK_INVALID: 500,
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
  CONTEXT_PACK_DIRECTORY_TIMEOUT: 503,
  WORKBENCH_AUTH_UNAVAILABLE: 503,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
};
const activeReads = new WeakMap<ApiGateway, { active: number }>();
const messages = {
  INVALID_INPUT:
    'Supply complete original identity/read_restricted/request_key/parameters for a save receipt lookup. Other reads accept an empty object for save identity, a saved pack selection, metadata filters, two pack IDs, item filters, an item ID, history positions or two different versions, without identity or write fields. Never supply write conditions to a read.',
  DENIED:
    'Use a verified unexpired client with actual context.read and the required record visibility',
  UNAUTHENTICATED: 'Renew the intended session before reading context',
  NOT_FOUND: 'The context read route is unavailable',
  COMMAND_NOT_FOUND: 'The historical save receipt handler is unavailable',
  IDEMPOTENCY_KEY_REUSED:
    'The original key belongs to different settings or permissions; retain the exact original',
  CONTEXT_PACK_RECEIPT_INVALID: 'The historical save metadata could not be validated',
  CONTEXT_PACK_RECEIPT_TIMEOUT:
    'The gateway stopped waiting for historical save metadata; the read may still be running',
  MCP_CONTEXT_PACK_SAVE_RECEIPT_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_PACK_SAVE_RECEIPT_TIMEOUT:
    'Stopped waiting for the original save receipt; no pack save was sent by this query',
  CONTEXT_ITEM_NOT_FOUND: 'The selected item or recorded version is unavailable in this project',
  CONTEXT_ITEM_INVALID: 'The complete stored context response could not be validated',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context storage is unavailable',
  CONTEXT_PACK_NOT_FOUND: 'The saved context pack is unavailable in this project and selection',
  CONTEXT_PACK_STALE:
    'The saved pack sources changed; review current knowledge and prepare a fresh pack',
  CONTEXT_PACK_EXPIRED: 'The saved context pack expired; prepare a fresh pack',
  CONTEXT_PACK_INVALID: 'The saved context pack could not be validated',
  CONTEXT_PACK_SAVE_CONTEXT_INVALID:
    'The verified context pack save identity could not be represented',
  MCP_CONTEXT_PACK_SAVE_CONTEXT_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_PACK_SAVE_CONTEXT_TIMEOUT:
    'Stopped waiting for save identity; the underlying read may still be running',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Context pack storage is unavailable',
  CONTEXT_PACK_DIRECTORY_TIMEOUT:
    'The gateway stopped waiting for saved pack metadata; the underlying read may still be running',
  CONTEXT_SOURCE_LIMIT: 'The saved context pack source checks exceeded their limit',
  WORKBENCH_DATABASE_UNAVAILABLE: 'Context directory storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_CONTEXT_HISTORY_BUSY: 'MCP context history read capacity is occupied',
  MCP_CONTEXT_HISTORY_TIMEOUT:
    'Stopped waiting for context history; the underlying read may still be running',
  MCP_CONTEXT_ITEM_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_ITEM_TIMEOUT:
    'Stopped waiting for context details; the underlying read may still be running',
  MCP_CONTEXT_DIRECTORY_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_DIRECTORY_TIMEOUT:
    'Stopped waiting for the context directory; the underlying read may still be running',
  MCP_CONTEXT_PACK_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_PACK_TIMEOUT:
    'Stopped waiting for the saved context pack read or comparison; the underlying read may still be running',
  MCP_CONTEXT_PACK_DIRECTORY_BUSY: 'MCP context read capacity is occupied',
  MCP_CONTEXT_PACK_DIRECTORY_TIMEOUT:
    'Stopped waiting for saved pack metadata; the underlying read may still be running',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE:
    'Context pack integrity checking is unavailable; no unchecked pack was returned',
  CONTEXT_PACK_HASH_MISMATCH: 'The complete context pack differs from its saved hash',
  GATEWAY_RESPONSE_INVALID:
    'The complete context response or comparison did not match this read or exceeded its size limit',
  CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE:
    'Snapshot integrity checking is unavailable; no unchecked version was returned',
  CONTEXT_HISTORY_HASH_MISMATCH: 'The complete context snapshot differs from its saved hash',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
export function isContextReadTool(name: unknown): name is ToolName {
  return (
    name === 'get_context_pack_save_receipt' ||
    name === 'get_context_pack_save_context' ||
    name === 'get_context_pack' ||
    name === 'list_context_packs' ||
    name === 'compare_context_packs' ||
    name === 'list_context_items' ||
    name === 'get_context_item' ||
    name === 'get_archived_context_item' ||
    name === 'list_context_item_history' ||
    name === 'get_context_item_version' ||
    name === 'compare_context_item_versions'
  );
}
export function canReadContextTool(context: RequestContext): boolean {
  try {
    const expiry = Date.parse(context.token_expires_at ?? '');
    return (
      context.schema_version === 1 &&
      context.authenticated_client === true &&
      Array.isArray(context.capability) &&
      context.capability.includes('context.read') &&
      Number.isFinite(expiry) &&
      expiry > Date.now() &&
      isSyncIdentifier(context.trace_id) &&
      isUlid(context.tenant_id) &&
      isUlid(context.workspace_id) &&
      isUlid(context.project_id) &&
      isUlid(context.actor_id) &&
      isSyncIdentifier(context.client_id)
    );
  } catch {
    return false;
  }
}
function captureQuery(name: string, raw: unknown, trace: string): Query {
  try {
    if (!isContextReadTool(name)) throw new TypeError();
    const value: unknown = JSON.parse(
      syncJsonSnapshot(raw, name === 'list_context_items' ? 8192 : 4096),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'kind'))
      throw new TypeError();
    if (name === 'get_context_pack_save_receipt')
      return { kind: 'save-receipt', query: parseContextPackSaveReceiptQuery(value) };
    if (name === 'get_context_pack_save_context') {
      if (Object.keys(value).length) throw new TypeError();
      return { kind: 'save-identity' };
    }
    if (name === 'get_context_pack')
      return { kind: 'pack', query: parseContextPackReadQuery(value) };
    if (name === 'list_context_packs')
      return { kind: 'pack-list', query: parseContextPackDirectoryQuery(value) };
    if (name === 'compare_context_packs')
      return { kind: 'compare-packs', query: parseContextPackComparisonQuery(value) };
    if (name === 'list_context_items') {
      // Optional enum values must be omitted rather than bypassing the tool schema with ''.
      const fields = value as Record<string, unknown>;
      if (['layer', 'classification', 'status'].some((field) => fields[field] === ''))
        throw new TypeError();
      return { kind: 'list', query: parseContextItemDirectoryQuery(value) };
    }
    if (name === 'compare_context_item_versions')
      return { kind: 'compare', query: parseContextComparisonQuery(value) };
    if (name === 'get_context_item' || name === 'get_archived_context_item')
      return parseContextItemReadQuery({
        ...value,
        kind: name === 'get_context_item' ? 'current' : 'archived',
      });
    return parseContextHistoryReadQuery({
      ...value,
      kind: name === 'list_context_item_history' ? 'history' : 'version',
    });
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

/** One captured authority and deadline; capacity survives timeout until all underlying work settles. */
export async function executeContextReadTool(
  api: ApiGateway,
  name: string,
  raw: unknown,
  original: RequestContext,
) {
  const deadline = performance.now() + 30_000;
  const detail = name === 'get_context_item' || name === 'get_archived_context_item';
  const directory = name === 'list_context_items';
  const packDirectory = name === 'list_context_packs';
  const pack = name === 'get_context_pack' || name === 'compare_context_packs';
  const saveIdentity = name === 'get_context_pack_save_context';
  const saveReceipt = name === 'get_context_pack_save_receipt';
  const timeoutCode = saveReceipt
    ? 'MCP_CONTEXT_PACK_SAVE_RECEIPT_TIMEOUT'
    : saveIdentity
      ? 'MCP_CONTEXT_PACK_SAVE_CONTEXT_TIMEOUT'
      : packDirectory
        ? 'MCP_CONTEXT_PACK_DIRECTORY_TIMEOUT'
        : pack
          ? 'MCP_CONTEXT_PACK_TIMEOUT'
          : directory
            ? 'MCP_CONTEXT_DIRECTORY_TIMEOUT'
            : detail
              ? 'MCP_CONTEXT_ITEM_TIMEOUT'
              : 'MCP_CONTEXT_HISTORY_TIMEOUT';
  const trace = isSyncIdentifier(original.trace_id) ? original.trace_id : 'trace_unknown';
  let context: RequestContext;
  try {
    context = structuredClone(original);
  } catch {
    throw fail('DENIED', trace);
  }
  const active = () => {
    if (performance.now() >= deadline) throw fail(timeoutCode, trace);
    if (saveReceipt ? !canReadContextPackSaveReceipt(context) : !canReadContextTool(context))
      throw fail('DENIED', trace);
  };
  active();
  const query = captureQuery(name, raw, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const identity = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
    actor_id: context.actor_id,
    client_id: context.client_id,
  };
  if (
    query.kind === 'save-receipt' &&
    ((Object.keys(identity) as Array<keyof typeof identity>).some(
      (key) => query.query.identity[key] !== identity[key],
    ) ||
      query.query.read_restricted !== context.capability.includes('data.restricted.read'))
  )
    throw fail('DENIED', trace);
  const maximum =
    query.kind === 'compare-packs'
      ? packComparisonBytes
      : query.kind === 'compare'
        ? comparisonBytes
        : responseLimit(query);
  active();
  let gate = activeReads.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(api, gate);
  }
  if (gate.active >= 2)
    throw fail(
      saveReceipt
        ? 'MCP_CONTEXT_PACK_SAVE_RECEIPT_BUSY'
        : saveIdentity
          ? 'MCP_CONTEXT_PACK_SAVE_CONTEXT_BUSY'
          : packDirectory
            ? 'MCP_CONTEXT_PACK_DIRECTORY_BUSY'
            : pack
              ? 'MCP_CONTEXT_PACK_BUSY'
              : directory
                ? 'MCP_CONTEXT_DIRECTORY_BUSY'
                : detail
                  ? 'MCP_CONTEXT_ITEM_BUSY'
                  : 'MCP_CONTEXT_HISTORY_BUSY',
      trace,
    );
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      const read = async (selected: ReadQuery) => {
        active();
        const { kind, ...input } = selected;
        // Internal ApiGateway accepts query fields as body; public GET uses URL parameters.
        const response = await api.handle({
          method: kind === 'list' || kind === 'save-receipt' ? 'POST' : 'GET',
          path: readPath(selected),
          headers:
            selected.kind === 'save-identity' || selected.kind === 'save-receipt'
              ? {
                  ...(selected.kind === 'save-receipt'
                    ? { 'content-type': 'application/json' }
                    : {}),
                  'x-trace-id': trace,
                  'x-tenant-id': identity.tenant_id,
                  'x-workspace-id': identity.workspace_id,
                  'x-project-id': identity.project_id,
                  'x-expected-actor-id': identity.actor_id,
                  'x-expected-client-id': identity.client_id,
                }
              : {},
          body:
            selected.kind === 'save-receipt'
              ? { ...parseContextPackSaveReceiptQuery(selected.query) }
              : selected.kind === 'pack' || selected.kind === 'pack-list'
                ? { ...selected.query }
                : selected.kind === 'list'
                  ? { ...selected.query, operation: 'context' }
                  : { ...input },
          context: structuredClone(context),
        });
        active();
        if (
          (response.status !== 200 &&
            (!Number.isInteger(response.status) ||
              response.status < 400 ||
              response.status > 599)) ||
          response.headers['x-trace-id'] !== trace ||
          (((!isDetailQuery(selected) && selected.kind !== 'pack') || response.status !== 200) &&
            response.headers.etag !== undefined) ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            response.headers['content-type'] ?? '',
          )
        )
          throw fail('GATEWAY_RESPONSE_INVALID', trace);
        const value: unknown = JSON.parse(
          syncJsonSnapshot(
            response.body,
            response.status >= 400
              ? selected.kind === 'save-receipt' ||
                selected.kind === 'save-identity' ||
                selected.kind === 'pack' ||
                selected.kind === 'pack-list'
                ? CONTEXT_PACK_READ_ERROR_BYTES
                : selected.kind === 'list'
                  ? CONTEXT_ITEM_DIRECTORY_ERROR_BYTES
                  : isDetailQuery(selected)
                    ? CONTEXT_ITEM_READ_ERROR_BYTES
                    : CONTEXT_HISTORY_ERROR_BYTES
              : responseLimit(selected),
          ),
        );
        if (response.status >= 400) {
          const error = validateErrorEnvelope(value);
          if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace);
          if (
            selected.kind === 'save-receipt' &&
            (!Object.hasOwn(saveReceiptErrorStatuses, error.code) ||
              response.status !== saveReceiptErrorStatuses[error.code] ||
              Object.keys(value as object).some(
                (key) => !['code', 'message', 'details', 'trace_id', 'retryable'].includes(key),
              ))
          )
            throw fail('GATEWAY_RESPONSE_INVALID', trace);
          if (
            selected.kind === 'save-identity' &&
            (!Object.hasOwn(saveIdentityErrorStatuses, error.code) ||
              response.status !== saveIdentityErrorStatuses[error.code] ||
              Object.keys(value as object).some(
                (key) => !['code', 'message', 'details', 'trace_id', 'retryable'].includes(key),
              ))
          )
            throw fail('GATEWAY_RESPONSE_INVALID', trace);
          if (
            selected.kind === 'pack-list' &&
            (!Object.hasOwn(packDirectoryErrorStatuses, error.code) ||
              response.status !== packDirectoryErrorStatuses[error.code])
          )
            throw fail('GATEWAY_RESPONSE_INVALID', trace);
          if (selected.kind === 'pack') {
            const expected = {
              CONTEXT_PACK_NOT_FOUND: 404,
              CONTEXT_PACK_STALE: 409,
              CONTEXT_PACK_EXPIRED: 410,
            };
            if (
              Object.hasOwn(expected, error.code) &&
              response.status !== expected[error.code as keyof typeof expected]
            )
              throw fail('GATEWAY_RESPONSE_INVALID', trace);
          }
          throw fail(
            Object.hasOwn(messages, error.code)
              ? (error.code as ErrorCode)
              : 'GATEWAY_RESPONSE_INVALID',
            trace,
          );
        }
        if (selected.kind === 'save-receipt') {
          const receipt = parseContextPackSaveReceiptEnvelope(value, selected.query, trace);
          active();
          return receipt;
        }
        if (selected.kind === 'save-identity') {
          const authority = parseContextPackSaveContextEnvelope(value, identity, trace);
          if (
            Date.parse(authority.data.expires_at) !== Date.parse(context.token_expires_at!) ||
            Date.parse(authority.data.expires_at) <= Date.now() ||
            authority.data.permissions.read_restricted !==
              context.capability.includes('data.restricted.read')
          )
            throw fail('GATEWAY_RESPONSE_INVALID', trace);
          active();
          return authority;
        }
        if (selected.kind === 'pack-list') {
          const page = parseContextPackDirectoryEnvelope(value, selected.query, identity, trace);
          // The trusted directory handler filters parent-project and saved read_restricted
          // visibility. These scalar metadata records carry no content/classification proof.
          active();
          return page;
        }
        const envelope =
          selected.kind === 'pack'
            ? parseContextPackReadEnvelope(value, selected.query, identity, trace)
            : selected.kind === 'list'
              ? parseContextItemDirectoryEnvelope(value, selected.query, identity, trace)
              : isDetailQuery(selected)
                ? parseContextItemReadEnvelope(value, selected, identity, trace)
                : parseContextHistoryReadEnvelope(value, selected, identity, trace);
        if (
          (isDetailQuery(selected) || selected.kind === 'pack') &&
          (!('etag' in envelope) || response.headers.etag !== envelope.etag)
        )
          throw fail('GATEWAY_RESPONSE_INVALID', trace);
        const records = Array.isArray(envelope.data)
          ? envelope.data
          : 'pack' in envelope.data
            ? envelope.data.pack.items.map((item) => ({ classification: item.sensitivity }))
            : 'versions' in envelope.data
              ? envelope.data.versions
              : [envelope.data];
        if (
          !context.capability.includes('data.restricted.read') &&
          records.some((record) => record.classification === 'restricted')
        )
          throw fail('DENIED', trace);
        active();
        if (kind === 'pack') {
          const receipt = envelope.data as ContextPackReceipt;
          const snapshot = contextPackReadHashJson(receipt.pack);
          active();
          let hash: string;
          try {
            hash = 'sha256:' + createHash('sha256').update(snapshot, 'utf8').digest('hex');
          } catch {
            throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
          }
          if (hash !== receipt.pack.pack_hash) throw fail('CONTEXT_PACK_HASH_MISMATCH', trace);
        } else if (kind === 'version') {
          const revision = envelope.data as ContextItemRevision;
          const snapshot = contextRevisionSnapshotJson(revision);
          active();
          let hash: string;
          try {
            hash = createHash('sha256').update(snapshot, 'utf8').digest('hex');
          } catch {
            throw fail('CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE', trace);
          }
          if (hash !== revision.snapshot_hash) throw fail('CONTEXT_HISTORY_HASH_MISMATCH', trace);
        }
        active();
        return envelope;
      };
      let value: unknown;
      if (query.kind === 'compare-packs') {
        const selected = query.query;
        const from = await read({
          kind: 'pack',
          query: { pack_id: selected.from_pack_id, format: 'json' },
        });
        const to = await read({
          kind: 'pack',
          query: { pack_id: selected.to_pack_id, format: 'json' },
        });
        active();
        value = {
          schema_version: 1,
          kind: 'saved-context-pack-comparison',
          comparison_origin: 'local',
          read_consistency: 'separate-reads',
          content_state: 'pack-hashes-checked',
          source_state: 'not-checked',
          query: selected,
          identity_constraints: identity,
          from,
          to,
          comparison: compareSavedContextPacks(from, to),
        };
      } else if (query.kind === 'compare') {
        const selected = query.query;
        const from = await read({
          kind: 'version',
          item_id: selected.item_id,
          version: selected.from_version,
        });
        const to = await read({
          kind: 'version',
          item_id: selected.item_id,
          version: selected.to_version,
        });
        active();
        value = {
          schema_version: 1,
          kind: 'context-version-comparison',
          comparison_origin: 'local',
          read_consistency: 'separate-reads',
          content_state: 'snapshot-hashes-checked',
          source_state: 'not-checked',
          query: selected,
          identity_constraints: identity,
          from,
          to,
          comparison: compareContextSnapshots(from.data, to.data),
        };
      } else {
        value = await read(query);
      }
      active();
      const text = syncJsonSnapshot(value, maximum);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * maximum + 4096);
      active();
      return result;
    } catch (error) {
      let stopped = error;
      try {
        active();
      } catch (error) {
        stopped = error;
      }
      const envelope = stopped instanceof ContractError ? stopped.envelope : undefined;
      throw fail(
        envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
          ? (envelope.code as ErrorCode)
          : 'GATEWAY_RESPONSE_INVALID',
        trace,
      );
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
          () => reject(fail(timeoutCode, trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
