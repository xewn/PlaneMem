import { isUlid } from './ids.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import {
  parseSessionClosureState,
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
} from './session-activity.js';
import {
  parseResumeReceiptQuery,
  parseResumeReceiptLookup,
  parseSessionResumeOrigin,
  type ResumeReceiptQuery,
  type SessionResumeOrigin,
} from './session-resume.js';
import { parseCheckpointRecord, type CheckpointSavedRecord } from './checkpoint-clients.js';
import { parseContextPackReceipt } from './context-pack-response.js';
import type { ContextPackReceipt } from './context.js';

export interface ResumeBinding {
  parent_session_id: string;
  identity: SessionCommandIdentity;
  query: Required<ResumeReceiptQuery>;
  expected_checkpoint_id?: string;
}
type Scope = Pick<SessionCommandIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
export interface ResumedSession extends Scope {
  schema_version: 1;
  session_id: string;
  parent_session_id: string;
  actor_id: string;
  client_id: string;
  resume_origin: SessionResumeOrigin;
  status: 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';
  version: number;
  started_at: string;
  ended_at?: string;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface ResumedHandoff extends Scope {
  schema_version: 1;
  handoff_id: string;
  checkpoint_id: string;
  from_client: string;
  target_client?: string;
  status: 'claimed';
  claimed_by: string;
  claimed_by_actor?: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface ResumeResult {
  session: ResumedSession;
  checkpoint: CheckpointSavedRecord;
  handoff: ResumedHandoff;
  context_pack_state: 'checked' | 'legacy-unverified' | 'none';
  context_pack?: ContextPackReceipt;
}
export function parseResumeCommand(value: unknown): {
  handoff_id: string;
  require_claimed: boolean;
} {
  const row = object(value);
  if (
    Object.keys(row).some((key) => !['handoff_id', 'require_claimed'].includes(key)) ||
    !isUlid(row.handoff_id) ||
    (row.require_claimed !== undefined && typeof row.require_claimed !== 'boolean')
  )
    throw new TypeError('Supply only the original handoff_id and optional require_claimed');
  return { handoff_id: row.handoff_id, require_claimed: row.require_claimed === true };
}
/** Original identity is a precondition; the expected checkpoint is never sent as business input. */
export function parseResumeBinding(
  parentId: unknown,
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  expectedCheckpointId?: unknown,
): ResumeBinding {
  const query = parseResumeReceiptQuery(input);
  const identity = parseSessionCommandIdentity(expectedIdentity);
  if (!isUlid(parentId) || (expectedCheckpointId !== undefined && !isUlid(expectedCheckpointId)))
    throw new TypeError('Parent session and expected checkpoint must be ULIDs');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identity[field] !== scope[field]) throw new TypeError('Original resume scope differs');
  return {
    parent_session_id: parentId,
    identity,
    query,
    ...(typeof expectedCheckpointId === 'string'
      ? { expected_checkpoint_id: expectedCheckpointId }
      : {}),
  };
}
export function parseResumeReceiptEnvelope(value: unknown, binding: ResumeBinding, trace: string) {
  const { row, refs } = envelope(value, trace);
  if (refs.length) throw new TypeError('Resume receipt must not contain resource sources');
  const data = parseResumeReceiptLookup(
    row.data,
    binding.parent_session_id,
    binding.query.handoff_id,
  );
  if (
    data.status === 'recorded' &&
    (data.require_claimed !== binding.query.require_claimed ||
      (binding.expected_checkpoint_id !== undefined &&
        data.checkpoint_id !== binding.expected_checkpoint_id))
  )
    throw new TypeError('Resume receipt differs from original binding');
  return { schema_version: 1 as const, trace_id: trace, source_refs: [], data };
}
export function parseResumeEnvelope(value: unknown, binding: ResumeBinding, trace: string) {
  const { row, refs } = envelope(value, trace);
  const result = object(row.data);
  const checkpoint = parseCheckpointRecord(
    result.checkpoint,
    binding.parent_session_id,
    binding.identity,
  );
  if (
    binding.expected_checkpoint_id !== undefined &&
    checkpoint.checkpoint_id !== binding.expected_checkpoint_id
  )
    throw new TypeError('Resume checkpoint differs from original expectation');
  const session = resumedSession(result.session, binding, checkpoint.checkpoint_id);
  const handoff = resumedHandoff(result.handoff, binding, checkpoint.checkpoint_id);
  const expectedSources = [
    ...session.source_refs,
    ...checkpoint.source_refs,
    ...handoff.source_refs,
  ];
  if (!sameSources(refs, expectedSources))
    throw new TypeError('Resume envelope sources differ from its records');
  let contextPack: ContextPackReceipt | undefined;
  let state: ResumeResult['context_pack_state'];
  if (checkpoint.context_pack_id !== undefined) {
    if (result.context_pack_state !== 'checked')
      throw new TypeError('Saved resume pack was not checked');
    state = 'checked';
    contextPack = parseContextPackReceipt(
      result.context_pack,
      binding.identity,
      checkpoint.context_pack_id,
      checkpoint.context_pack_hash,
    );
    const expectedCheckpointSources = [
      { type: 'session', id: binding.parent_session_id },
      { type: 'context-pack', id: checkpoint.context_pack_id },
      ...(checkpoint.memory_ref?.source_refs ?? []),
      ...contextPack.pack.source_refs,
    ].filter(
      (ref, index, all) =>
        all.findIndex((other) => other.type === ref.type && other.id === ref.id) === index,
    );
    if (!sameSources(checkpoint.source_refs, expectedCheckpointSources))
      throw new TypeError('Resume pack sources differ from checkpoint');
  } else {
    state = checkpoint.context_pack_hash === undefined ? 'none' : 'legacy-unverified';
    if (result.context_pack_state !== state || result.context_pack !== undefined)
      throw new TypeError('Unexpected resume context pack');
  }
  const data: ResumeResult = {
    session,
    checkpoint,
    handoff,
    context_pack_state: state,
    ...(contextPack === undefined ? {} : { context_pack: contextPack }),
  };
  return { schema_version: 1 as const, trace_id: trace, source_refs: refs, data };
}
function resumedSession(
  value: unknown,
  binding: ResumeBinding,
  checkpointId: string,
): ResumedSession {
  const row = object(value);
  checkScope(row, binding.identity);
  if (
    row.schema_version !== 1 ||
    !isUlid(row.session_id) ||
    row.session_id === binding.parent_session_id ||
    row.parent_session_id !== binding.parent_session_id ||
    row.actor_id !== binding.identity.actor_id ||
    row.client_id !== binding.identity.client_id ||
    !time(row.started_at) ||
    !name(row.trace_id)
  )
    throw new TypeError('Invalid resumed session');
  const origin = parseSessionResumeOrigin(row.resume_origin);
  if (
    origin.handoff_id !== binding.query.handoff_id ||
    origin.checkpoint_id !== checkpointId ||
    origin.require_claimed !== binding.query.require_claimed
  )
    throw new TypeError('Resume origin differs from original request');
  const state = parseSessionClosureState(
    {
      session_id: row.session_id,
      status: row.status,
      version: row.version,
      ended_at: row.ended_at ?? null,
    },
    row.session_id,
  );
  if (state.ended_at !== null && Date.parse(state.ended_at) < Date.parse(row.started_at))
    throw new TypeError('Invalid resumed session lifetime');
  const sourceRefs = sources(row.source_refs);
  if (!sameSources(sourceRefs, [{ type: 'session', id: binding.identity.client_id }]))
    throw new TypeError('Invalid resumed session source');
  return {
    schema_version: 1,
    ...scopeFields(binding.identity),
    session_id: row.session_id,
    parent_session_id: binding.parent_session_id,
    actor_id: binding.identity.actor_id,
    client_id: binding.identity.client_id,
    resume_origin: origin,
    status: state.status,
    version: state.version,
    started_at: row.started_at,
    trace_id: row.trace_id,
    source_refs: sourceRefs,
    ...(state.ended_at === null ? {} : { ended_at: state.ended_at }),
  };
}
function resumedHandoff(
  value: unknown,
  binding: ResumeBinding,
  checkpointId: string,
): ResumedHandoff {
  const row = object(value);
  checkScope(row, binding.identity);
  if (
    row.schema_version !== 1 ||
    row.handoff_id !== binding.query.handoff_id ||
    row.checkpoint_id !== checkpointId ||
    row.status !== 'claimed' ||
    row.claimed_by !== binding.identity.client_id ||
    !name(row.from_client) ||
    !positive(row.version) ||
    !name(row.trace_id) ||
    (row.target_client !== undefined && row.target_client !== binding.identity.client_id) ||
    (row.claimed_by_actor !== undefined && row.claimed_by_actor !== binding.identity.actor_id) ||
    (binding.query.require_claimed && row.claimed_by_actor !== binding.identity.actor_id)
  )
    throw new TypeError('Invalid resumed handoff ownership');
  const sourceRefs = sources(row.source_refs);
  if (!sameSources(sourceRefs, [{ type: 'checkpoint', id: checkpointId }]))
    throw new TypeError('Invalid resumed handoff source');
  return {
    schema_version: 1,
    ...scopeFields(binding.identity),
    handoff_id: binding.query.handoff_id,
    checkpoint_id: checkpointId,
    from_client: row.from_client,
    status: 'claimed',
    claimed_by: binding.identity.client_id,
    version: row.version,
    trace_id: row.trace_id,
    source_refs: sourceRefs,
    ...(typeof row.target_client === 'string' ? { target_client: row.target_client } : {}),
    ...(typeof row.claimed_by_actor === 'string' ? { claimed_by_actor: row.claimed_by_actor } : {}),
  };
}
function envelope(value: unknown, trace: string) {
  const row = object(value);
  if (row.schema_version !== 1 || !name(trace) || row.trace_id !== trace || row.etag !== undefined)
    throw new TypeError('Invalid resume envelope');
  return { row, refs: sources(row.source_refs) };
}
function checkScope(row: Record<string, unknown>, scope: Scope) {
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (row[field] !== scope[field]) throw new TypeError('Resume record scope differs');
}
function scopeFields(scope: Scope): Scope {
  return {
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
  };
}
function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid resume sources');
  return Array.from(value, (source) => ({ ...validateSourceRef(source) }));
}
function sameSources(left: SourceRef[], right: SourceRef[]): boolean {
  return (
    left.length === right.length &&
    left.every((ref, index) => {
      const expected = right[index]!;
      return (
        ref.type === expected.type &&
        ref.id === expected.id &&
        ref.revision === expected.revision &&
        ref.uri === expected.uri
      );
    })
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected resume data');
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function name(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 4096;
}
function time(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && Number.isFinite(Date.parse(value));
}
