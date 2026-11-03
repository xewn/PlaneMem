import { isUlid } from './ids.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';

type Scope = { tenant_id: string; workspace_id: string; project_id?: string };
export interface HandoffReadDetail {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  handoff_id: string;
  session_id: string;
  checkpoint_id: string;
  from_client: string;
  target_client?: string;
  status: 'open' | 'claimed' | 'expired';
  claimed_by?: string;
  claimed_by_actor?: string;
  version: number;
  created_at: string;
  updated_at: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export function parseHandoffReadQuery(value: unknown): { handoff_id: string } {
  const row = object(value);
  if (!isUlid(row.handoff_id) || Object.keys(row).some((key) => key !== 'handoff_id'))
    throw new TypeError('Supply only handoff_id as a ULID');
  return { handoff_id: row.handoff_id };
}

/** Current ownership is not evidence for an original creation, claim or resume request. */
export function parseHandoffReadEnvelope(
  value: unknown,
  handoffId: string,
  scope: Scope,
  trace: string,
  expectedIdentity?: SessionCommandIdentity,
) {
  parseHandoffReadQuery({ handoff_id: handoffId });
  const row = object(value);
  if (row.schema_version !== 1 || !name(trace) || row.trace_id !== trace || row.etag !== undefined)
    throw new TypeError('Invalid handoff detail envelope');
  const outer = refs(row.source_refs);
  if (outer.length !== 1) throw new TypeError('Invalid handoff detail source');
  const source = object((row.source_refs as unknown[])[0]);
  if (
    Object.keys(source).some((key) => !['type', 'id'].includes(key)) ||
    source.type !== 'handoff' ||
    source.id !== handoffId
  )
    throw new TypeError('Invalid handoff detail source');
  const data = object(row.data);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!name(scope[field]) || data[field] !== scope[field])
      throw new TypeError('Handoff scope differs');
  if (
    data.schema_version !== 1 ||
    data.handoff_id !== handoffId ||
    !isUlid(data.session_id) ||
    !isUlid(data.checkpoint_id) ||
    !name(data.from_client) ||
    !name(data.trace_id) ||
    typeof data.version !== 'number' ||
    !Number.isSafeInteger(data.version) ||
    data.version < 1 ||
    (data.status !== 'open' && data.status !== 'claimed' && data.status !== 'expired') ||
    (data.target_client !== undefined && !name(data.target_client)) ||
    (data.claimed_by !== undefined && !name(data.claimed_by)) ||
    (data.claimed_by_actor !== undefined &&
      (!name(data.claimed_by_actor) || !name(data.claimed_by))) ||
    (data.status === 'open' &&
      (data.version !== 1 ||
        data.claimed_by !== undefined ||
        data.claimed_by_actor !== undefined)) ||
    (data.status !== 'open' && data.version < 2) ||
    (data.status === 'claimed' && !name(data.claimed_by)) ||
    (data.target_client !== undefined &&
      data.claimed_by !== undefined &&
      data.target_client !== data.claimed_by)
  )
    throw new TypeError('Invalid current handoff record');
  const createdAt = timestamp(data.created_at);
  const updatedAt = timestamp(data.updated_at);
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new TypeError('Handoff timestamps differ');
  const sources = refs(data.source_refs);
  if (!sources.some((ref) => ref.type === 'checkpoint' && ref.id === data.checkpoint_id))
    throw new TypeError('Handoff checkpoint source is missing');
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (identity)
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (identity[field] !== scope[field]) throw new TypeError('Handoff identity scope differs');
  if (expectedIdentity) {
    const expected = parseSessionCommandIdentity(expectedIdentity);
    for (const field of [
      'tenant_id',
      'workspace_id',
      'project_id',
      'actor_id',
      'client_id',
    ] as const)
      if (identity?.[field] !== expected[field])
        throw new TypeError('Handoff reader identity changed');
  }
  const permissions = object(row.handoff_permissions);
  if (
    Object.keys(permissions).some((key) => !['claim', 'write_sessions'].includes(key)) ||
    typeof permissions.claim !== 'boolean' ||
    typeof permissions.write_sessions !== 'boolean' ||
    ((permissions.claim || permissions.write_sessions) && !identity) ||
    (permissions.write_sessions && !permissions.claim)
  )
    throw new TypeError('Invalid handoff permissions');
  const detail: HandoffReadDetail = {
    schema_version: 1,
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id!,
    handoff_id: handoffId,
    session_id: data.session_id,
    checkpoint_id: data.checkpoint_id,
    from_client: data.from_client,
    status: data.status as HandoffReadDetail['status'],
    version: data.version,
    created_at: createdAt,
    updated_at: updatedAt,
    trace_id: data.trace_id,
    source_refs: sources,
    ...(typeof data.target_client === 'string' ? { target_client: data.target_client } : {}),
    ...(typeof data.claimed_by === 'string' ? { claimed_by: data.claimed_by } : {}),
    ...(typeof data.claimed_by_actor === 'string'
      ? { claimed_by_actor: data.claimed_by_actor }
      : {}),
  };
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: outer,
    data: detail,
    ...(identity ? { session_identity: identity } : {}),
    handoff_permissions: { claim: permissions.claim, write_sessions: permissions.write_sessions },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected handoff detail data');
  return value as Record<string, unknown>;
}
function name(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !Number.isFinite(Date.parse(value)))
    throw new TypeError('Invalid handoff timestamp');
  return new Date(value).toISOString();
}
function refs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid handoff sources');
  const result = Array.from(value, (entry) => {
    const ref = validateSourceRef(entry);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
  if (
    result.some(
      (ref, index) =>
        result.findIndex((other) => other.type === ref.type && other.id === ref.id) !== index,
    )
  )
    throw new TypeError('Duplicate handoff source');
  return result;
}
