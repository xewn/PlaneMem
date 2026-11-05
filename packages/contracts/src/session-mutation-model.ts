import type { Ulid } from './ids.js';
import type { SourceRef } from './metadata.js';
import type { SessionResumeOrigin } from './session-resume.js';

export interface SessionMutationScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export type SessionMutationStatus = 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';

export interface SessionMutationSession extends SessionMutationScope {
  schema_version: 1;
  session_id: Ulid;
  client_id: string;
  actor_id: string;
  parent_session_id?: Ulid;
  resume_origin?: SessionResumeOrigin;
  status: SessionMutationStatus;
  version: number;
  started_at: string;
  ended_at?: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface SessionMutationRun {
  schema_version: 1;
  run_id: Ulid;
  session_id: Ulid;
  sequence: number;
  model?: string;
  status: 'running' | 'completed' | 'failed';
  version: number;
  /** Version of the session after the original command; not the current live version. */
  session_version?: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface SessionMutationToolCall {
  schema_version: 1;
  tool_call_id: Ulid;
  session_id: Ulid;
  run_id: Ulid;
  tool_name: string;
  status: 'started' | 'succeeded' | 'failed';
  version: number;
  session_version?: number;
  trace_id: string;
  source_refs: SourceRef[];
}
