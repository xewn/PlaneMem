import type {
  ContextPackReceipt,
  SessionResumeOrigin,
  HandoffClaimRecorded,
  HandoffCreateRecorded,
  SessionStartRecorded,
  SourceRef,
  SyncUploadResult,
  SyncChange,
  SyncChangesPage,
} from '@planemem/contracts';
import type { CanonicalEvent } from '@planemem/events';

/** Wire responses from the gateway; distinct from the baseline entity schemas. */
export interface WcpEnvelope<T> {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: T;
  etag?: string;
  revision?: number;
  server_cursor?: number;
  next_before_revision?: number;
  /** Context/work item list continuation; distinct from the numeric sync cursor inside data. */
  next_cursor?: string;
}

export interface WcpScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface WcpWriteOptions {
  /** Reuse for a retry of the same command; use a new key for a new command. */
  idempotency_key: string;
}

export interface WcpVersionedWriteOptions extends WcpWriteOptions {
  expected_version: number;
}

export interface WcpSession extends WcpScope {
  schema_version: 1;
  session_id: string;
  client_id: string;
  actor_id: string;
  parent_session_id?: string;
  resume_origin?: SessionResumeOrigin;
  /** Present for ordinary starts with a durable original request receipt. */
  start_receipt?: SessionStartRecorded;
  status: 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';
  version: number;
  started_at: string;
  ended_at?: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface WcpAgentRun {
  schema_version: 1;
  run_id: string;
  session_id: string;
  sequence: number;
  model?: string;
  status: 'running' | 'completed' | 'failed';
  version: number;
  /** Session version after the original command. A replay can carry a historical version. */
  session_version?: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface WcpToolCall {
  schema_version: 1;
  tool_call_id: string;
  session_id: string;
  run_id: string;
  tool_name: string;
  status: 'started' | 'succeeded' | 'failed';
  version: number;
  session_version?: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface WcpCheckpointContent {
  completed: string[];
  in_progress: string[];
  next_actions: string[];
  decisions: string[];
  risks: string[];
  open_questions: string[];
}

export interface WcpMemoryRef extends WcpScope {
  schema_version: 1;
  page_ref: string;
  revision: number;
  hash: string;
  source_refs: SourceRef[];
  trace_id: string;
}

export interface WcpCheckpoint extends WcpScope, WcpCheckpointContent {
  schema_version: 1;
  checkpoint_id: string;
  session_id: string;
  revision: number;
  state_hash: string;
  context_pack_hash?: string;
  context_pack_id?: string;
  memory_ref?: WcpMemoryRef;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface WcpHandoff extends WcpScope {
  schema_version: 1;
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
  /** Present on durable claim responses; this is historical command evidence. */
  claim_receipt?: HandoffClaimRecorded;
  /** Present on durable creation responses; does not establish current ownership. */
  create_receipt?: HandoffCreateRecorded;
}

export interface WcpResumeResult {
  session: WcpSession;
  checkpoint: WcpCheckpoint;
  handoff: WcpHandoff;
  /** Absent when talking to a gateway predating saved checkpoint bindings. */
  context_pack_state?: 'checked' | 'legacy-unverified' | 'none';
  context_pack?: ContextPackReceipt;
}

export type WcpSyncChange = SyncChange;
export type WcpSyncPage = SyncChangesPage;

export type WcpUploadReceipt = WcpScope & SyncUploadResult;

export type WcpConflictDecision =
  | { resolution: 'local' | 'server'; merged_value?: never }
  | { resolution: 'merge'; merged_value: unknown };

export interface WcpConflictResolution {
  conflict_id: string;
  version: number;
  resolution: 'local' | 'server' | 'merge';
  event: CanonicalEvent;
}

/** @deprecated Legacy full-list shape. listConflicts returns ConflictRegistryRecord metadata; use getConflict for values. */
export interface WcpConflict {
  conflict_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  /** Projection BIGINT fields may be serialized as decimal strings. */
  base_version: number | string;
  local_version: number | string;
  server_version: number | string;
  local_value: unknown;
  server_value: unknown;
  status: 'open' | 'resolved';
  resolution: 'local' | 'server' | 'merge' | null;
  actor_id: string | null;
  version: number | string;
  trace_id: string;
  source_refs: SourceRef[];
  resolved_value: unknown;
  resolved_at: string | null;
  resolved_by_client: string | null;
  resolution_event_id: string | null;
}
