import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';
import { parseEtag } from './versioning.js';

export interface HandoffCreateCommand {
  checkpoint_id: string;
  session_id?: string;
  from_client?: string;
  target_client?: string;
}
export interface HandoffCreateReceiptQuery {
  request_key: string;
  handoff: HandoffCreateCommand;
}
export interface HandoffCreateRecorded {
  status: 'recorded';
  handoff_id: string;
  session_id: string;
  checkpoint_id: string;
  from_client: string;
  created_by_actor: string;
  target_client?: string;
  handoff_version: 1;
}
export type HandoffCreateReceiptLookup =
  | { status: 'not-observed'; session_id: string; checkpoint_id: string }
  | HandoffCreateRecorded;

export interface HandoffCreateBinding {
  session_id: string;
  query: HandoffCreateReceiptQuery;
  identity: SessionCommandIdentity;
}
export interface HandoffCreateResult {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  handoff_id: string;
  checkpoint_id: string;
  from_client: string;
  target_client?: string;
  status: 'open' | 'claimed' | 'expired';
  claimed_by?: string;
  claimed_by_actor?: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
  create_receipt: HandoffCreateRecorded;
}
export interface HandoffCreateEnvelope<T> {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: T;
  etag?: string;
}

/** Expected identity is an original-request precondition, never authentication. */
export function parseHandoffCreateBinding(
  sessionId: unknown,
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): HandoffCreateBinding {
  const query = parseHandoffCreateReceiptQuery(input);
  const identity = parseSessionCommandIdentity(expectedIdentity);
  if (
    !isUlid(sessionId) ||
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id ||
    (query.handoff.session_id !== undefined && query.handoff.session_id !== sessionId) ||
    (query.handoff.from_client !== undefined && query.handoff.from_client !== identity.client_id)
  )
    throw new TypeError('The original creation belongs to another session, sender or project');
  return { session_id: sessionId, query, identity };
}

export function parseHandoffCreateEnvelope(
  value: unknown,
  binding: HandoffCreateBinding,
  traceId: string,
  lookup: true,
): HandoffCreateEnvelope<HandoffCreateReceiptLookup>;
export function parseHandoffCreateEnvelope(
  value: unknown,
  binding: HandoffCreateBinding,
  traceId: string,
  lookup: false,
): HandoffCreateEnvelope<HandoffCreateResult>;
export function parseHandoffCreateEnvelope(
  value: unknown,
  binding: HandoffCreateBinding,
  traceId: string,
  lookup: boolean,
): HandoffCreateEnvelope<HandoffCreateReceiptLookup | HandoffCreateResult>;
export function parseHandoffCreateEnvelope(
  value: unknown,
  binding: HandoffCreateBinding,
  traceId: string,
  lookup: boolean,
): HandoffCreateEnvelope<HandoffCreateReceiptLookup | HandoffCreateResult> {
  const row = object(value);
  if (row.schema_version !== 1 || row.trace_id !== traceId || !identifier(traceId))
    throw new TypeError('Creation response trace mismatch');
  const refs = sourceRefs(row.source_refs);
  if (lookup) {
    if (refs.length || row.etag !== undefined)
      throw new TypeError('Invalid historical creation envelope');
    return {
      schema_version: 1,
      trace_id: traceId,
      source_refs: [],
      data: parseHandoffCreateReceiptLookup(
        row.data,
        binding.session_id,
        binding.query.handoff,
        binding.identity,
      ),
    };
  }
  const data = object(row.data);
  const receipt = parseHandoffCreateReceiptLookup(
    data.create_receipt,
    binding.session_id,
    binding.query.handoff,
    binding.identity,
  );
  if (receipt.status !== 'recorded')
    throw new TypeError('Creation requires its original durable receipt');
  assertHandoffCreationCurrent(data, receipt, binding.identity);
  const sources = sourceRefs(data.source_refs);
  if (
    JSON.stringify(sources) !== JSON.stringify(refs) ||
    (row.etag !== undefined && parseEtag(row.etag) !== data.version)
  )
    throw new TypeError('Creation sources or version do not match');
  return {
    schema_version: 1,
    trace_id: traceId,
    source_refs: refs,
    ...(typeof row.etag === 'string' ? { etag: row.etag } : {}),
    data: {
      schema_version: 1,
      tenant_id: binding.identity.tenant_id,
      workspace_id: binding.identity.workspace_id,
      project_id: binding.identity.project_id,
      handoff_id: receipt.handoff_id,
      checkpoint_id: receipt.checkpoint_id,
      from_client: receipt.from_client,
      ...(receipt.target_client === undefined ? {} : { target_client: receipt.target_client }),
      status: data.status as HandoffCreateResult['status'],
      ...(typeof data.claimed_by === 'string' ? { claimed_by: data.claimed_by } : {}),
      ...(typeof data.claimed_by_actor === 'string'
        ? { claimed_by_actor: data.claimed_by_actor }
        : {}),
      version: data.version as number,
      trace_id: data.trace_id as string,
      source_refs: sources,
      create_receipt: receipt,
    },
  };
}

function sourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid creation sources');
  return value.map((input) => {
    const ref = validateSourceRef(input);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a handoff creation object');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

/** Optional original fields are preserved; they must not be invented during recovery. */
export function parseHandoffCreateCommand(value: unknown): HandoffCreateCommand {
  const row = object(value);
  if (
    Object.keys(row).some(
      (key) => !['checkpoint_id', 'session_id', 'from_client', 'target_client'].includes(key),
    ) ||
    !isUlid(row.checkpoint_id) ||
    (row.session_id !== undefined && !isUlid(row.session_id)) ||
    (row.from_client !== undefined && !identifier(row.from_client)) ||
    (row.target_client !== undefined && !identifier(row.target_client))
  )
    throw new TypeError('Supply the original checkpoint and optional original sender and target');
  return {
    checkpoint_id: row.checkpoint_id,
    ...(typeof row.session_id === 'string' ? { session_id: row.session_id } : {}),
    ...(typeof row.from_client === 'string' ? { from_client: row.from_client } : {}),
    ...(typeof row.target_client === 'string' ? { target_client: row.target_client } : {}),
  };
}
export function parseHandoffCreateReceiptQuery(value: unknown): HandoffCreateReceiptQuery {
  const row = object(value);
  if (Object.keys(row).some((key) => !['request_key', 'handoff'].includes(key)))
    throw new TypeError('Unknown creation receipt field');
  return {
    request_key: validateIdempotencyKey(row.request_key),
    handoff: parseHandoffCreateCommand(row.handoff),
  };
}
export function parseHandoffCreateReceiptLookup(
  value: unknown,
  sessionId: string,
  input: HandoffCreateCommand,
  identity: { actor_id: string; client_id: string },
): HandoffCreateReceiptLookup {
  const command = parseHandoffCreateCommand(input);
  const row = object(value);
  if (
    !isUlid(sessionId) ||
    !identifier(identity.actor_id) ||
    !identifier(identity.client_id) ||
    (command.session_id !== undefined && command.session_id !== sessionId) ||
    (command.from_client !== undefined && command.from_client !== identity.client_id) ||
    row.session_id !== sessionId ||
    row.checkpoint_id !== command.checkpoint_id
  )
    throw new TypeError('Creation receipt does not match the original request');
  if (row.status === 'not-observed') {
    if (Object.keys(row).some((key) => !['status', 'session_id', 'checkpoint_id'].includes(key)))
      throw new TypeError('Invalid absent creation receipt');
    return { status: 'not-observed', session_id: sessionId, checkpoint_id: command.checkpoint_id };
  }
  if (
    row.status !== 'recorded' ||
    !isUlid(row.handoff_id) ||
    row.handoff_version !== 1 ||
    row.from_client !== identity.client_id ||
    row.created_by_actor !== identity.actor_id ||
    row.target_client !== command.target_client ||
    Object.keys(row).some(
      (key) =>
        ![
          'status',
          'handoff_id',
          'session_id',
          'checkpoint_id',
          'from_client',
          'created_by_actor',
          'target_client',
          'handoff_version',
        ].includes(key),
    )
  )
    throw new TypeError('Invalid original handoff creation receipt');
  return {
    status: 'recorded',
    handoff_id: row.handoff_id,
    session_id: sessionId,
    checkpoint_id: command.checkpoint_id,
    from_client: identity.client_id,
    created_by_actor: identity.actor_id,
    handoff_version: 1,
    ...(command.target_client === undefined ? {} : { target_client: command.target_client }),
  };
}

/** Creation is historical evidence, even when another client has since claimed the handoff. */
export function assertHandoffCreationCurrent(
  value: unknown,
  receipt: HandoffCreateRecorded,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): void {
  const row = object(value);
  if (
    row.schema_version !== 1 ||
    row.tenant_id !== scope.tenant_id ||
    row.workspace_id !== scope.workspace_id ||
    row.project_id !== scope.project_id ||
    row.handoff_id !== receipt.handoff_id ||
    row.checkpoint_id !== receipt.checkpoint_id ||
    row.from_client !== receipt.from_client ||
    row.target_client !== receipt.target_client ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    (row.status !== 'open' && row.status !== 'claimed' && row.status !== 'expired') ||
    (row.version === 1 && row.status !== 'open') ||
    (row.status === 'open' &&
      (row.version !== 1 || row.claimed_by !== undefined || row.claimed_by_actor !== undefined)) ||
    (row.status === 'claimed' &&
      (!identifier(row.claimed_by) || !identifier(row.claimed_by_actor))) ||
    (row.claimed_by !== undefined && !identifier(row.claimed_by)) ||
    (row.claimed_by_actor !== undefined &&
      (!identifier(row.claimed_by_actor) || !identifier(row.claimed_by))) ||
    (row.target_client !== undefined &&
      row.claimed_by !== undefined &&
      row.target_client !== row.claimed_by) ||
    !identifier(row.trace_id) ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length > 200 ||
    Object.keys(row.source_refs).length !== row.source_refs.length
  )
    throw new TypeError('Current handoff contradicts its creation receipt');
  const refs = row.source_refs.map(validateSourceRef);
  if (!refs.some((ref) => ref.type === 'checkpoint' && ref.id === receipt.checkpoint_id))
    throw new TypeError('Created handoff lacks its checkpoint source');
}
