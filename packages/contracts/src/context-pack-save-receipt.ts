import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { validateIdempotencyKey } from './metadata.js';
import { parseSyncCommandIdentity } from './sync-command-context.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { parsePackSaveOriginal } from './context-pack-save-original.js';
import {
  parseContextPackCompileParameters,
  type ContextPackCompileParameters,
} from './context-pack-compile.js';
import {
  parseContextPackDirectoryRecord,
  type ContextPackDirectoryRecord,
} from './context-pack-directory.js';
import type { ContextPackSaveIdentity } from './context-pack-save-context.js';

export const CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES = 4096;
export const CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES = 16384;
export interface ContextPackSaveReceiptQuery {
  identity: ContextPackSaveIdentity;
  read_restricted: boolean;
  request_key: string;
  parameters: ContextPackCompileParameters;
}
export interface ContextPackRecordedSave extends ContextPackDirectoryRecord {
  pack_hash: string;
  server_cursor: number;
  content_state: 'not-checked';
  source_state: 'not-checked';
}
export interface ContextPackSaveReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: 'context-pack'; id: string; revision: number }>;
  data: { original: ContextPackSaveReceiptQuery } & (
    | { status: 'not-observed' }
    | { status: 'recorded'; receipt: ContextPackRecordedSave }
  );
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
export function parseContextPackSaveReceiptQuery(input: unknown): ContextPackSaveReceiptQuery {
  const row = object(JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES)), [
    'identity',
    'read_restricted',
    'request_key',
    'parameters',
  ]);
  const identity = parseSyncCommandIdentity(row.identity);
  const request_key = validateIdempotencyKey(row.request_key);
  if (
    ![identity.tenant_id, identity.workspace_id, identity.project_id, identity.actor_id].every(
      isUlid,
    ) ||
    !isSyncIdentifier(identity.client_id) ||
    /\u007f/.test(identity.client_id) ||
    !isSyncIdentifier(request_key) ||
    /\u007f/.test(request_key) ||
    typeof row.read_restricted !== 'boolean'
  )
    throw new TypeError();
  const parameters = parseContextPackCompileParameters(
    object(row.parameters, ['budget_tokens', 'ttl_seconds']),
  );
  return { identity, read_restricted: row.read_restricted, request_key, parameters };
}
/** Gateway location is checked by the caller, never asserted by the server receipt. */
export function contextPackSaveReceiptQuery(original: unknown): ContextPackSaveReceiptQuery {
  const request = parsePackSaveOriginal(original);
  return parseContextPackSaveReceiptQuery({
    identity: request.binding.identity,
    read_restricted: request.binding.read_restricted,
    request_key: request.request_key,
    parameters: request.parameters,
  });
}
export function parseContextPackSaveReceiptEnvelope(
  input: unknown,
  expected: ContextPackSaveReceiptQuery,
  trace: string,
): ContextPackSaveReceiptEnvelope {
  const query = parseContextPackSaveReceiptQuery(expected);
  const row = object(
    JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES)),
    ['schema_version', 'trace_id', 'source_refs', 'data'],
  );
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !isSyncIdentifier(trace) ||
    /\u007f/.test(trace) ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError();
  const data = object(
    row.data,
    row.data &&
      typeof row.data === 'object' &&
      'status' in row.data &&
      row.data.status === 'recorded'
      ? ['original', 'status', 'receipt']
      : ['original', 'status'],
  );
  const original = parseContextPackSaveReceiptQuery(data.original);
  if (JSON.stringify(original) !== JSON.stringify(query)) throw new TypeError();
  if (data.status === 'not-observed') {
    if (row.source_refs.length) throw new TypeError();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: { original, status: 'not-observed' },
    };
  }
  if (data.status !== 'recorded') throw new TypeError();
  const saved = object(data.receipt, [
    'pack_id',
    'version',
    'created_at',
    'expires_at',
    'budget_tokens',
    'used_tokens',
    'pack_hash',
    'server_cursor',
    'content_state',
    'source_state',
  ]);
  const metadata = parseContextPackDirectoryRecord({
    pack_id: saved.pack_id,
    version: saved.version,
    created_at: saved.created_at,
    expires_at: saved.expires_at,
    budget_tokens: saved.budget_tokens,
    used_tokens: saved.used_tokens,
  });
  if (
    metadata.created_at.startsWith('0000') ||
    metadata.expires_at.startsWith('0000') ||
    metadata.budget_tokens !== query.parameters.budget_tokens ||
    Date.parse(metadata.expires_at) - Date.parse(metadata.created_at) >
      query.parameters.ttl_seconds * 1000 ||
    typeof saved.pack_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(saved.pack_hash) ||
    typeof saved.server_cursor !== 'number' ||
    !Number.isSafeInteger(saved.server_cursor) ||
    saved.server_cursor < 1 ||
    saved.content_state !== 'not-checked' ||
    saved.source_state !== 'not-checked' ||
    row.source_refs.length !== 1
  )
    throw new TypeError();
  const source = object(row.source_refs[0], ['type', 'id', 'revision']);
  if (
    source.type !== 'context-pack' ||
    source.id !== metadata.pack_id ||
    source.revision !== metadata.version
  )
    throw new TypeError();
  const receipt: ContextPackRecordedSave = {
    ...metadata,
    pack_hash: saved.pack_hash,
    server_cursor: saved.server_cursor,
    content_state: 'not-checked',
    source_state: 'not-checked',
  };
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'context-pack', id: receipt.pack_id, revision: receipt.version }],
    data: { original, status: 'recorded', receipt },
  };
}
