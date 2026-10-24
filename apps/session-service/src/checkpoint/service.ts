import { ContractError, createUlid, type SourceRef, type Ulid } from '@planemem/contracts';
import type { ContextPack } from '@planemem/context-compiler';
import type { MemoryRef } from '@planemem/domain';
import { SessionService, type Session, type SessionScope } from '../session/service.js';

export interface Checkpoint extends SessionScope {
  schema_version: 1;
  checkpoint_id: Ulid;
  session_id: Ulid;
  revision: number;
  completed: string[];
  in_progress: string[];
  next_actions: string[];
  decisions: string[];
  risks: string[];
  open_questions: string[];
  state_hash: string;
  context_pack_hash?: string;
  memory_ref?: MemoryRef;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface Handoff extends SessionScope {
  schema_version: 1;
  handoff_id: Ulid;
  checkpoint_id: Ulid;
  from_client: string;
  target_client?: string;
  status: 'open' | 'claimed' | 'expired';
  claimed_by?: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface CreateCheckpointInput extends SessionScope {
  session_id: Ulid;
  completed: string[];
  in_progress: string[];
  next_actions: string[];
  decisions: string[];
  risks: string[];
  open_questions: string[];
  context_pack?: ContextPack;
  memory_ref?: MemoryRef;
  trace_id: string;
  expected_session_version: number;
}

export interface CreateHandoffInput extends SessionScope {
  checkpoint_id: Ulid;
  from_client: string;
  target_client?: string;
  trace_id: string;
  idempotency_key: string;
}

export class ContinuationService {
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly handoffs = new Map<string, Handoff>();
  private readonly handoffIdempotency = new Map<string, Handoff>();

  constructor(private readonly sessions: SessionService) {}

  health(): {
    service: 'continuation-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { checkpoints: number; handoffs: number };
  } {
    return {
      service: 'continuation-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: { checkpoints: this.checkpoints.size, handoffs: this.handoffs.size },
    };
  }

  createCheckpoint(input: CreateCheckpointInput): Checkpoint {
    const session = this.sessions.getSession(input.session_id, input);
    if (session.status !== 'running' && session.status !== 'paused')
      throw new ContractError('SESSION_STATE_CONFLICT', 'Checkpoint requires a live session', {
        session_id: input.session_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    if (session.version !== input.expected_session_version)
      throw new ContractError('SESSION_VERSION_CONFLICT', 'Session version does not match', {
        expected_version: input.expected_session_version,
        current_version: session.version,
        trace_id: input.trace_id,
        retryable: false,
      });
    if (
      input.context_pack !== undefined &&
      (input.context_pack.scope.project_id !== input.project_id ||
        input.context_pack.scope.workspace_id !== input.workspace_id ||
        input.context_pack.scope.tenant_id !== input.tenant_id)
    )
      throw new ContractError(
        'CONTEXT_SCOPE_MISMATCH',
        'ContextPack scope does not match checkpoint scope',
        { trace_id: input.trace_id, retryable: false },
      );
    const previous = [...this.checkpoints.values()]
      .filter((checkpoint) => checkpoint.session_id === input.session_id)
      .sort((left, right) => right.revision - left.revision)[0];
    const checkpoint: Checkpoint = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      checkpoint_id: createUlid(),
      session_id: input.session_id,
      revision: (previous?.revision ?? 0) + 1,
      completed: [...input.completed],
      in_progress: [...input.in_progress],
      next_actions: [...input.next_actions],
      decisions: [...input.decisions],
      risks: [...input.risks],
      open_questions: [...input.open_questions],
      state_hash: stableHash(
        JSON.stringify({
          completed: input.completed,
          in_progress: input.in_progress,
          next_actions: input.next_actions,
          decisions: input.decisions,
          risks: input.risks,
          open_questions: input.open_questions,
          context_pack_hash: input.context_pack?.pack_hash,
          memory_page_ref: input.memory_ref?.page_ref,
        }),
      ),
      ...(input.context_pack === undefined
        ? {}
        : { context_pack_hash: input.context_pack.pack_hash }),
      ...(input.memory_ref === undefined ? {} : { memory_ref: input.memory_ref }),
      trace_id: input.trace_id,
      source_refs: [
        { type: 'session', id: String(input.session_id) },
        ...(input.memory_ref?.source_refs ?? []),
        ...(input.context_pack?.source_refs ?? []),
      ].filter(
        (ref, index, refs) =>
          refs.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) ===
          index,
      ),
    };
    this.checkpoints.set(String(checkpoint.checkpoint_id), checkpoint);
    return cloneCheckpoint(checkpoint);
  }

  createHandoff(input: CreateHandoffInput): Handoff {
    const previous = this.handoffIdempotency.get(input.idempotency_key);
    if (previous !== undefined) return cloneHandoff(previous);
    const checkpoint = this.getCheckpoint(input.checkpoint_id, input);
    const handoff: Handoff = {
      schema_version: 1,
      tenant_id: checkpoint.tenant_id,
      workspace_id: checkpoint.workspace_id,
      project_id: checkpoint.project_id,
      handoff_id: createUlid(),
      checkpoint_id: checkpoint.checkpoint_id,
      from_client: input.from_client,
      ...(input.target_client === undefined ? {} : { target_client: input.target_client }),
      status: 'open',
      version: 1,
      trace_id: input.trace_id,
      source_refs: [{ type: 'checkpoint', id: String(checkpoint.checkpoint_id) }],
    };
    this.handoffs.set(String(handoff.handoff_id), handoff);
    this.handoffIdempotency.set(input.idempotency_key, handoff);
    return cloneHandoff(handoff);
  }

  claimHandoff(
    input: SessionScope & { handoff_id: Ulid; client_id: string; trace_id: string },
  ): Handoff {
    const handoff = this.handoffs.get(String(input.handoff_id));
    if (!handoff)
      throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist', {
        handoff_id: input.handoff_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    this.assertScope(handoff, input, input.trace_id);
    if (handoff.status === 'claimed') return cloneHandoff(handoff);
    if (handoff.status === 'expired')
      throw new ContractError('HANDOFF_EXPIRED', 'Handoff has expired', {
        handoff_id: input.handoff_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    if (handoff.target_client !== undefined && handoff.target_client !== input.client_id)
      throw new ContractError('HANDOFF_ACCESS_DENIED', 'Handoff is addressed to another client', {
        handoff_id: input.handoff_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    handoff.status = 'claimed';
    handoff.claimed_by = input.client_id;
    handoff.version += 1;
    handoff.trace_id = input.trace_id;
    return cloneHandoff(handoff);
  }

  getHandoff(handoff_id: Ulid, scope: SessionScope & { trace_id?: string }): Handoff {
    const handoff = this.handoffs.get(String(handoff_id));
    if (!handoff)
      throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist', {
        handoff_id,
        trace_id: scope.trace_id ?? 'trace_handoff_unknown',
        retryable: false,
      });
    this.assertScope(handoff, scope, scope.trace_id ?? 'trace_handoff_read');
    return cloneHandoff(handoff);
  }

  getCheckpoint(checkpoint_id: Ulid, scope: SessionScope & { trace_id?: string }): Checkpoint {
    const checkpoint = this.checkpoints.get(String(checkpoint_id));
    if (!checkpoint)
      throw new ContractError('CHECKPOINT_NOT_FOUND', 'Checkpoint does not exist', {
        checkpoint_id,
        trace_id: scope.trace_id ?? 'trace_checkpoint_unknown',
        retryable: false,
      });
    this.assertScope(checkpoint, scope, scope.trace_id ?? 'trace_checkpoint_read');
    return cloneCheckpoint(checkpoint);
  }

  resumeSession(
    input: SessionScope & {
      handoff_id: Ulid;
      client_id: string;
      actor_id: string;
      trace_id: string;
      idempotency_key: string;
    },
  ): { session: Session; checkpoint: Checkpoint; handoff: Handoff } {
    const handoff = this.claimHandoff(input);
    const checkpoint = this.getCheckpoint(handoff.checkpoint_id, input);
    const session = this.sessions.startSession({
      ...input,
      parent_session_id: checkpoint.session_id,
    });
    return { session, checkpoint, handoff };
  }

  private assertScope(value: SessionScope, scope: SessionScope, trace_id: string): void {
    if (
      value.tenant_id !== scope.tenant_id ||
      value.workspace_id !== scope.workspace_id ||
      value.project_id !== scope.project_id
    )
      throw new ContractError('HANDOFF_ACCESS_DENIED', 'Resource scope is not authorized', {
        trace_id,
        retryable: false,
      });
  }
}

function cloneCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    ...checkpoint,
    completed: [...checkpoint.completed],
    in_progress: [...checkpoint.in_progress],
    next_actions: [...checkpoint.next_actions],
    decisions: [...checkpoint.decisions],
    risks: [...checkpoint.risks],
    open_questions: [...checkpoint.open_questions],
    source_refs: [...checkpoint.source_refs],
  };
}

function cloneHandoff(handoff: Handoff): Handoff {
  return { ...handoff, source_refs: [...handoff.source_refs] };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `sha256:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
