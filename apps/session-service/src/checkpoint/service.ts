import {
  ContractError,
  createUlid,
  checkpointStateHash,
  isUlid,
  validateSourceRef,
  parseHandoffClaimReceiptLookup,
  parseHandoffCreateCommand,
  parseHandoffCreateReceiptLookup,
  assertHandoffCreationCurrent,
  validateIdempotencyKey,
  type HandoffCreateRecorded,
  type HandoffClaimRecorded,
  type SourceRef,
  type Ulid,
} from '@planemem/contracts';
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
  context_pack_id?: string;
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
  claimed_by_actor?: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface CreateCheckpointInput extends SessionScope {
  /** Trusted adapter capability used by durable project visibility checks. */
  read_restricted?: boolean;
  session_id: Ulid;
  completed: string[];
  in_progress: string[];
  next_actions: string[];
  decisions: string[];
  risks: string[];
  open_questions: string[];
  context_pack?: ContextPack;
  /** Trusted adapter resolves this saved ID to context_pack before calling the service. */
  context_pack_id?: string;
  memory_ref?: MemoryRef;
  trace_id: string;
  expected_session_version: number;
  receipt?: { key: string; fingerprint: string };
}

export interface CreateHandoffInput extends SessionScope {
  session_id?: Ulid;
  checkpoint_id: Ulid;
  from_client: string;
  target_client?: string;
  trace_id: string;
  idempotency_key: string;
}

export interface ClaimHandoffInput extends SessionScope {
  read_restricted?: boolean;
  handoff_id: Ulid;
  client_id: string;
  actor_id?: string;
  expected_version?: number;
  require_claimed?: boolean;
  trace_id: string;
}

export interface CreateHandoffReceiptInput extends CreateHandoffInput {
  session_id: Ulid;
  actor_id: string;
  receipt: { key: string; fingerprint: string };
  read_restricted?: boolean;
}
export interface HandoffCreateCommit {
  handoff: Handoff;
  receipt: HandoffCreateRecorded;
}

export interface ClaimHandoffReceiptInput extends ClaimHandoffInput {
  actor_id: string;
  expected_version: number;
  receipt: { key: string; fingerprint: string };
  read_restricted?: boolean;
}
export interface HandoffClaimCommit {
  handoff: Handoff;
  receipt: HandoffClaimRecorded;
}

export interface ContinuationStoreSnapshot {
  checkpoints: Checkpoint[];
  handoffs: Array<{ handoff: Handoff; idempotency_key?: string }>;
}

/** Durable boundary for checkpoints and handoffs. */
export interface ContinuationStore {
  loadContinuations(): Promise<ContinuationStoreSnapshot>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  appendCheckpoint?(
    input: CreateCheckpointInput,
    prepare: (session: Pick<Session, 'status' | 'version'>, revision: number) => Checkpoint,
  ): Promise<Checkpoint>;
  saveHandoff(handoff: Handoff, idempotency_key?: string): Promise<Handoff | void>;
  createHandoffWithReceipt?(
    input: CreateHandoffReceiptInput,
    candidate: Handoff,
  ): Promise<HandoffCreateCommit>;
  findCheckpoint?(id: Ulid, scope: SessionScope): Promise<Checkpoint | undefined>;
  findHandoff?(id: Ulid, scope: SessionScope): Promise<Handoff | undefined>;
  updateHandoff?(
    input: ClaimHandoffInput,
    transition: (current: Handoff) => Handoff,
  ): Promise<Handoff>;
  claimHandoffWithReceipt?(
    input: ClaimHandoffReceiptInput,
    transition: (current: Handoff) => Handoff,
  ): Promise<HandoffClaimCommit>;
}

export class ContinuationService {
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly checkpointReceipts = new Map<string, { id: Ulid; fingerprint: string }>();
  private readonly handoffs = new Map<string, Handoff>();
  private readonly handoffIdempotency = new Map<string, Ulid>();
  // Serialize writes for single-instance store adapters without an atomic update operation.
  private readonly pendingWrites = new Map<string, Promise<unknown>>();

  constructor(
    private readonly sessions: SessionService,
    private readonly store?: ContinuationStore,
  ) {}

  async hydrate(): Promise<void> {
    if (!this.store) return;
    const snapshot = await this.store.loadContinuations();
    this.checkpoints.clear();
    this.checkpointReceipts.clear();
    this.handoffs.clear();
    this.handoffIdempotency.clear();
    for (const checkpoint of snapshot.checkpoints)
      this.checkpoints.set(String(checkpoint.checkpoint_id), cloneCheckpoint(checkpoint));
    for (const row of snapshot.handoffs) {
      const handoff = cloneHandoff(row.handoff);
      this.handoffs.set(String(handoff.handoff_id), handoff);
      if (row.idempotency_key !== undefined)
        this.handoffIdempotency.set(handoffKey(handoff, row.idempotency_key), handoff.handoff_id);
    }
  }

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
    const previous = this.replayedCheckpoint(input);
    if (previous) return previous;
    return this.rememberCheckpoint(input, this.prepareCheckpoint(input));
  }

  private replayedCheckpoint(input: CreateCheckpointInput): Checkpoint | undefined {
    if (!input.receipt) return;
    const previous = this.checkpointReceipts.get(checkpointReceiptKey(input, input.receipt.key));
    if (!previous) return;
    if (previous.fingerprint !== input.receipt.fingerprint)
      throw new ContractError(
        'IDEMPOTENCY_KEY_REUSED',
        'Key belongs to another checkpoint request',
        { trace_id: input.trace_id },
      );
    return this.getCheckpoint(previous.id, input);
  }

  private rememberCheckpoint(input: CreateCheckpointInput, checkpoint: Checkpoint): Checkpoint {
    this.checkpoints.set(checkpoint.checkpoint_id, cloneCheckpoint(checkpoint));
    if (input.receipt)
      this.checkpointReceipts.set(checkpointReceiptKey(input, input.receipt.key), {
        id: checkpoint.checkpoint_id,
        fingerprint: input.receipt.fingerprint,
      });
    return cloneCheckpoint(checkpoint);
  }

  private prepareCheckpoint(
    input: CreateCheckpointInput,
    session: Pick<Session, 'status' | 'version'> = this.sessions.getSession(
      input.session_id,
      input,
    ),
    revision?: number,
  ): Checkpoint {
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
      input.context_pack_id !== undefined &&
      (!isUlid(input.context_pack_id) || input.context_pack === undefined)
    )
      throw new ContractError(
        'INVALID_INPUT',
        'A saved pack binding requires its resolved document',
        {
          trace_id: input.trace_id,
        },
      );
    if (input.context_pack !== undefined) {
      if (
        !input.context_pack?.scope ||
        typeof input.context_pack.pack_hash !== 'string' ||
        !input.context_pack.pack_hash
      )
        throw new ContractError('INVALID_INPUT', 'ContextPack requires scope and pack_hash', {
          trace_id: input.trace_id,
        });
      this.checkReferenceScope(input, input.context_pack.scope);
    }
    if (input.memory_ref !== undefined) {
      const ref = input.memory_ref;
      if (
        typeof ref?.page_ref !== 'string' ||
        !ref.page_ref ||
        typeof ref.hash !== 'string' ||
        !ref.hash ||
        !Number.isSafeInteger(ref.revision) ||
        ref.revision < 1
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Memory reference requires a page, revision and hash',
          { trace_id: input.trace_id },
        );
      this.checkReferenceScope(input, ref);
    }
    for (const source of [input.memory_ref, input.context_pack]) {
      if (!source) continue;
      try {
        if (!Array.isArray(source.source_refs)) throw new TypeError();
        source.source_refs.forEach(validateSourceRef);
      } catch {
        throw new ContractError('INVALID_INPUT', 'Invalid checkpoint source references', {
          trace_id: input.trace_id,
        });
      }
    }
    const checkpoint: Checkpoint = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      checkpoint_id: createUlid(),
      session_id: input.session_id,
      revision: revision ?? this.nextRevision(input.session_id),
      completed: [...input.completed],
      in_progress: [...input.in_progress],
      next_actions: [...input.next_actions],
      decisions: [...input.decisions],
      risks: [...input.risks],
      open_questions: [...input.open_questions],
      state_hash: checkpointStateHash({
        completed: input.completed,
        in_progress: input.in_progress,
        next_actions: input.next_actions,
        decisions: input.decisions,
        risks: input.risks,
        open_questions: input.open_questions,
        ...(input.context_pack === undefined
          ? {}
          : { context_pack_hash: input.context_pack.pack_hash }),
        ...(input.context_pack_id === undefined ? {} : { context_pack_id: input.context_pack_id }),
        ...(input.memory_ref === undefined ? {} : { memory_page_ref: input.memory_ref.page_ref }),
      }),
      ...(input.context_pack === undefined
        ? {}
        : { context_pack_hash: input.context_pack.pack_hash }),
      ...(input.context_pack_id === undefined ? {} : { context_pack_id: input.context_pack_id }),
      ...(input.memory_ref === undefined ? {} : { memory_ref: input.memory_ref }),
      trace_id: input.trace_id,
      source_refs: [
        { type: 'session', id: String(input.session_id) },
        ...(input.context_pack_id === undefined
          ? []
          : [{ type: 'context-pack', id: input.context_pack_id }]),
        ...(input.memory_ref?.source_refs ?? []),
        ...(input.context_pack?.source_refs ?? []),
      ].filter(
        (ref, index, refs) =>
          refs.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) ===
          index,
      ),
    };
    return checkpoint;
  }

  private nextRevision(sessionId: Ulid): number {
    let revision = 0;
    for (const checkpoint of this.checkpoints.values())
      if (checkpoint.session_id === sessionId) revision = Math.max(revision, checkpoint.revision);
    return revision + 1;
  }

  private checkReferenceScope(input: CreateCheckpointInput, scope: SessionScope): void {
    if (
      scope.tenant_id !== input.tenant_id ||
      scope.workspace_id !== input.workspace_id ||
      scope.project_id !== input.project_id
    )
      throw new ContractError(
        'CONTEXT_SCOPE_MISMATCH',
        'Reference scope does not match checkpoint scope',
        { trace_id: input.trace_id },
      );
  }

  async createCheckpointAsync(input: CreateCheckpointInput): Promise<Checkpoint> {
    if (!this.store) return this.createCheckpoint(input);
    const store = this.store;
    return this.serializeWrite(input.session_id, async () => {
      if (store.appendCheckpoint) {
        const checkpoint = await store.appendCheckpoint(input, (session, revision) =>
          this.prepareCheckpoint(input, session, revision),
        );
        return this.rememberCheckpoint(input, checkpoint);
      }
      const previous = this.replayedCheckpoint(input);
      if (previous) return previous;
      const checkpoint = this.prepareCheckpoint(input);
      await store.saveCheckpoint(checkpoint);
      return this.rememberCheckpoint(input, checkpoint);
    });
  }

  createHandoff(input: CreateHandoffInput): Handoff {
    const checkpoint = this.getCheckpoint(input.checkpoint_id, input);
    const handoff = this.prepareHandoff(input, checkpoint);
    return this.rememberHandoff(input, handoff);
  }

  private prepareHandoff(input: CreateHandoffInput, checkpoint: Checkpoint): Handoff {
    if (input.session_id !== undefined && input.session_id !== checkpoint.session_id)
      throw new ContractError('SESSION_SCOPE_MISMATCH', 'Checkpoint belongs to another session', {
        trace_id: input.trace_id,
      });
    const previous = this.handoffIdempotency.get(handoffKey(input, input.idempotency_key));
    if (previous !== undefined) return this.getHandoff(previous, input);
    return {
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
  }

  private rememberHandoff(input: CreateHandoffInput, handoff: Handoff): Handoff {
    this.assertScope(handoff, input, input.trace_id);
    if (
      handoff.checkpoint_id !== input.checkpoint_id ||
      handoff.from_client !== input.from_client ||
      handoff.target_client !== input.target_client
    )
      throw new ContractError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key belongs to another handoff request',
        {
          trace_id: input.trace_id,
        },
      );
    const cached = this.handoffs.get(handoff.handoff_id);
    if (!cached || cached.version < handoff.version) this.handoffs.set(handoff.handoff_id, handoff);
    this.handoffIdempotency.set(handoffKey(input, input.idempotency_key), handoff.handoff_id);
    return this.getHandoff(handoff.handoff_id, input);
  }

  async createHandoffAsync(input: CreateHandoffInput): Promise<Handoff> {
    if (!this.store) return this.createHandoff(input);
    const store = this.store;
    const key = handoffKey(input, input.idempotency_key);
    return this.serializeWrite(key, async () => {
      const handoff = this.prepareHandoff(
        input,
        await this.getCheckpointAsync(input.checkpoint_id, input),
      );
      if (this.handoffIdempotency.has(key)) return this.rememberHandoff(input, handoff);
      const stored = await store.saveHandoff(handoff, input.idempotency_key);
      return this.rememberHandoff(input, stored ?? handoff);
    });
  }

  claimHandoff(input: ClaimHandoffInput): Handoff {
    const handoff = this.claimedHandoff(this.getHandoff(input.handoff_id, input), input);
    this.handoffs.set(handoff.handoff_id, handoff);
    return cloneHandoff(handoff);
  }

  /** Always consult durable history; the legacy in-memory key map is not creation evidence. */
  async createHandoffWithReceiptAsync(
    input: CreateHandoffReceiptInput,
  ): Promise<HandoffCreateCommit> {
    const store = this.store;
    if (!store?.createHandoffWithReceipt)
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Durable handoff creation is unavailable',
        {
          trace_id: input.trace_id,
          retryable: true,
        },
      );
    const command = parseHandoffCreateCommand({
      session_id: input.session_id,
      checkpoint_id: input.checkpoint_id,
      from_client: input.from_client,
      ...(input.target_client === undefined ? {} : { target_client: input.target_client }),
    });
    validateIdempotencyKey(input.idempotency_key);
    if (
      !isUlid(input.session_id) ||
      !input.actor_id ||
      !/^[a-f0-9]{64}$/.test(input.receipt.key) ||
      !/^[a-f0-9]{64}$/.test(input.receipt.fingerprint)
    )
      throw new ContractError('INVALID_INPUT', 'Invalid original handoff creation', {
        trace_id: input.trace_id,
      });
    const candidate: Handoff = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      handoff_id: createUlid(),
      checkpoint_id: input.checkpoint_id,
      from_client: input.from_client,
      ...(input.target_client === undefined ? {} : { target_client: input.target_client }),
      status: 'open',
      version: 1,
      trace_id: input.trace_id,
      source_refs: [{ type: 'checkpoint', id: input.checkpoint_id }],
    };
    const committed = await store.createHandoffWithReceipt(input, candidate);
    try {
      const receipt = parseHandoffCreateReceiptLookup(
        committed.receipt,
        input.session_id,
        command,
        {
          actor_id: input.actor_id,
          client_id: input.from_client,
        },
      );
      if (receipt.status !== 'recorded') throw new TypeError();
      assertHandoffCreationCurrent(committed.handoff, receipt, input);
      const cached = this.handoffs.get(committed.handoff.handoff_id);
      if (!cached || cached.version <= committed.handoff.version)
        this.handoffs.set(committed.handoff.handoff_id, cloneHandoff(committed.handoff));
      // Do not add this actor-bound receipt to the legacy client-only idempotency map.
      return { handoff: cloneHandoff(committed.handoff), receipt };
    } catch {
      throw new ContractError(
        'SESSION_RECEIPT_INVALID',
        'Committed handoff creation could not be confirmed',
        {
          trace_id: input.trace_id,
        },
      );
    }
  }

  private claimedHandoff(handoff: Handoff, input: ClaimHandoffInput): Handoff {
    this.assertScope(handoff, input, input.trace_id);
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
    if (handoff.status === 'claimed') {
      if (input.require_claimed && handoff.claimed_by_actor === undefined)
        throw new ContractError(
          'HANDOFF_ACCESS_DENIED',
          'This older claim has no recorded actor for workbench resume',
          { trace_id: input.trace_id },
        );
      if (
        handoff.claimed_by !== input.client_id ||
        (handoff.claimed_by_actor !== undefined && handoff.claimed_by_actor !== input.actor_id)
      )
        throw new ContractError(
          'HANDOFF_CLAIM_CONFLICT',
          'Handoff has already been claimed by another recipient',
          {
            trace_id: input.trace_id,
          },
        );
      return handoff;
    }
    if (input.expected_version !== undefined && input.expected_version !== handoff.version)
      throw new ContractError(
        'HANDOFF_VERSION_CONFLICT',
        'Handoff changed since it was displayed',
        {
          current_version: handoff.version,
          expected_version: input.expected_version,
          trace_id: input.trace_id,
        },
      );
    if (input.require_claimed)
      throw new ContractError(
        'HANDOFF_CLAIM_REQUIRED',
        'Claim ownership before resuming this handoff',
        { trace_id: input.trace_id },
      );
    return {
      ...handoff,
      status: 'claimed',
      claimed_by: input.client_id,
      ...(input.actor_id === undefined ? {} : { claimed_by_actor: input.actor_id }),
      version: handoff.version + 1,
      trace_id: input.trace_id,
    };
  }

  async claimHandoffAsync(input: ClaimHandoffInput): Promise<Handoff> {
    if (!this.store) return this.claimHandoff(input);
    const store = this.store;
    return this.serializeWrite(input.handoff_id, async () => {
      let handoff: Handoff;
      if (store.updateHandoff) {
        handoff = await store.updateHandoff(input, (current) =>
          this.claimedHandoff(current, input),
        );
      } else {
        const current = this.getHandoff(input.handoff_id, input);
        handoff = this.claimedHandoff(current, input);
        if (handoff !== current) await store.saveHandoff(handoff);
      }
      this.handoffs.set(handoff.handoff_id, handoff);
      return cloneHandoff(handoff);
    });
  }

  /** A durable original-command outcome, separate from the handoff's current ownership. */
  async claimHandoffWithReceiptAsync(input: ClaimHandoffReceiptInput): Promise<HandoffClaimCommit> {
    const store = this.store;
    if (!store?.claimHandoffWithReceipt)
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Durable handoff claim receipts are unavailable',
        { trace_id: input.trace_id, retryable: true },
      );
    if (
      !isUlid(input.handoff_id) ||
      !input.actor_id ||
      !input.client_id ||
      !Number.isSafeInteger(input.expected_version) ||
      input.expected_version < 1 ||
      input.expected_version >= Number.MAX_SAFE_INTEGER ||
      !/^[a-f0-9]{64}$/.test(input.receipt.key) ||
      !/^[a-f0-9]{64}$/.test(input.receipt.fingerprint) ||
      input.require_claimed === true
    )
      throw new ContractError('INVALID_INPUT', 'Invalid original handoff claim', {
        trace_id: input.trace_id,
      });
    return this.serializeWrite(input.handoff_id, async () => {
      const commit = await store.claimHandoffWithReceipt!(input, (current) => {
        this.assertScope(current, input, input.trace_id);
        if (current.version !== input.expected_version)
          throw new ContractError(
            'HANDOFF_VERSION_CONFLICT',
            'Handoff changed since this original request',
            { trace_id: input.trace_id },
          );
        if (current.status === 'claimed' && current.claimed_by_actor === undefined)
          throw new ContractError(
            'HANDOFF_CLAIM_LEGACY_UNVERIFIED',
            'The historical claim has no recorded actor',
            { trace_id: input.trace_id },
          );
        return this.claimedHandoff(current, input);
      });
      const receipt = parseHandoffClaimReceiptLookup(
        commit.receipt,
        input.handoff_id,
        input.expected_version,
        input,
      );
      this.assertScope(commit.handoff, input, input.trace_id);
      if (
        receipt.status !== 'recorded' ||
        commit.handoff.handoff_id !== input.handoff_id ||
        receipt.checkpoint_id !== commit.handoff.checkpoint_id ||
        !Number.isSafeInteger(commit.handoff.version) ||
        commit.handoff.version < receipt.handoff_version
      )
        throw new ContractError(
          'SESSION_RECEIPT_INVALID',
          'Stored handoff claim does not match current history',
          { trace_id: input.trace_id },
        );
      // Publish only the current committed handoff, never a historical snapshot from its receipt.
      this.handoffs.set(commit.handoff.handoff_id, cloneHandoff(commit.handoff));
      return { handoff: cloneHandoff(commit.handoff), receipt };
    });
  }

  private async serializeWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
    const previous = this.pendingWrites.get(key);
    const pending = previous ? previous.then(write, write) : write();
    this.pendingWrites.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingWrites.get(key) === pending) this.pendingWrites.delete(key);
    }
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

  private async getCheckpointAsync(
    id: Ulid,
    scope: SessionScope & { trace_id?: string },
  ): Promise<Checkpoint> {
    if (this.store?.findCheckpoint) {
      const row = await this.store.findCheckpoint(id, scope);
      if (row) this.checkpoints.set(id, row);
      else this.checkpoints.delete(id);
    }
    return this.getCheckpoint(id, scope);
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
      resume_origin: {
        handoff_id: input.handoff_id,
        checkpoint_id: checkpoint.checkpoint_id,
        require_claimed: false,
      },
    });
    return { session, checkpoint, handoff };
  }

  async resumeSessionAsync(
    input: SessionScope & {
      read_restricted?: boolean;
      session_id?: Ulid;
      require_claimed?: boolean;
      handoff_id: Ulid;
      client_id: string;
      actor_id: string;
      trace_id: string;
      idempotency_key: string;
    },
  ): Promise<{ session: Session; checkpoint: Checkpoint; handoff: Handoff }> {
    const checkpoint = await this.checkpointForResumeAsync(input);
    const handoff = await this.claimHandoffAsync(input);
    const session = await this.sessions.startSessionAsync({
      ...input,
      parent_session_id: checkpoint.session_id,
      resume_origin: {
        handoff_id: input.handoff_id,
        checkpoint_id: checkpoint.checkpoint_id,
        require_claimed: input.require_claimed === true,
      },
    });
    return { session, checkpoint, handoff };
  }

  /** Read and authorize the immutable checkpoint without claiming or starting a session. */
  async checkpointForResumeAsync(
    input: ClaimHandoffInput & { session_id?: Ulid },
  ): Promise<Checkpoint> {
    if (this.store?.findHandoff) {
      const row = await this.store.findHandoff(input.handoff_id, input);
      if (row) this.handoffs.set(row.handoff_id, row);
      else this.handoffs.delete(input.handoff_id);
    }
    const ref = this.getHandoff(input.handoff_id, input);
    const checkpoint = await this.getCheckpointAsync(ref.checkpoint_id, input);
    if (input.session_id !== undefined && input.session_id !== checkpoint.session_id)
      throw new ContractError('SESSION_SCOPE_MISMATCH', 'Resume session does not match handoff', {
        trace_id: input.trace_id,
      });
    this.claimedHandoff(ref, input);
    return checkpoint;
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
  return structuredClone(checkpoint);
}

function cloneHandoff(handoff: Handoff): Handoff {
  return { ...handoff, source_refs: [...handoff.source_refs] };
}

function handoffKey(scope: SessionScope & { from_client: string }, key: string): string {
  return JSON.stringify([
    scope.tenant_id,
    scope.workspace_id,
    scope.project_id,
    scope.from_client,
    key,
  ]);
}

function checkpointReceiptKey(input: CreateCheckpointInput, key: string): string {
  return JSON.stringify([
    input.tenant_id,
    input.workspace_id,
    input.project_id,
    input.session_id,
    key,
  ]);
}
