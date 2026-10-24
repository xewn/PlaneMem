import { ContractError, type SourceRef, type Ulid } from '@planemem/contracts';

export interface SyncScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface SyncEvent {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  client_cursor?: number;
  source_refs: SourceRef[];
}

export interface AcceptedEvent extends SyncEvent {
  server_cursor: number;
  accepted: true;
}

export interface RejectedEvent {
  event_id: string;
  accepted: false;
  code: 'DUPLICATE' | 'CURSOR_GAP' | 'VALIDATION_ERROR';
  trace_id: string;
}

export interface AppendBatchResult extends SyncScope {
  schema_version: 1;
  trace_id: string;
  accepted: AcceptedEvent[];
  rejected: RejectedEvent[];
  next_cursor: number;
  source_refs: SourceRef[];
}

export interface ChangePage extends SyncScope {
  schema_version: 1;
  trace_id: string;
  changes: AcceptedEvent[];
  next_cursor: number;
  has_more: boolean;
  source_refs: SourceRef[];
}

export class SyncService {
  private readonly events = new Map<string, AcceptedEvent[]>();
  private readonly cursors = new Map<string, number>();
  private readonly clientCursors = new Map<string, number>();
  private readonly idempotency = new Map<string, AppendBatchResult>();

  health(): {
    service: 'sync-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { scopes: number; events: number };
  } {
    return {
      service: 'sync-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: {
        scopes: this.events.size,
        events: [...this.events.values()].reduce((count, values) => count + values.length, 0),
      },
    };
  }

  appendBatch(
    input: SyncScope & { events: SyncEvent[]; idempotency_key: string; trace_id: string },
  ): AppendBatchResult {
    const previous = this.idempotency.get(input.idempotency_key);
    if (previous !== undefined) return cloneAppendResult(previous);
    const scopeKey = key(input);
    const stored = this.events.get(scopeKey) ?? [];
    let serverCursor = this.cursors.get(scopeKey) ?? 0;
    let clientCursor = this.clientCursors.get(scopeKey) ?? 0;
    const accepted: AcceptedEvent[] = [];
    const rejected: RejectedEvent[] = [];
    for (const event of input.events) {
      if (
        !event.event_id ||
        !event.event_type ||
        typeof event.payload !== 'object' ||
        event.payload === null
      ) {
        rejected.push({
          event_id: event.event_id ?? '',
          accepted: false,
          code: 'VALIDATION_ERROR',
          trace_id: input.trace_id,
        });
        continue;
      }
      if (
        stored.some((candidate) => candidate.event_id === event.event_id) ||
        accepted.some((candidate) => candidate.event_id === event.event_id)
      ) {
        rejected.push({
          event_id: event.event_id,
          accepted: false,
          code: 'DUPLICATE',
          trace_id: input.trace_id,
        });
        continue;
      }
      if (event.client_cursor !== undefined && event.client_cursor !== clientCursor + 1) {
        rejected.push({
          event_id: event.event_id,
          accepted: false,
          code: 'CURSOR_GAP',
          trace_id: input.trace_id,
        });
        continue;
      }
      serverCursor += 1;
      if (event.client_cursor !== undefined) clientCursor = event.client_cursor;
      const acceptedEvent: AcceptedEvent = {
        ...event,
        server_cursor: serverCursor,
        accepted: true,
        source_refs: [...event.source_refs],
      };
      accepted.push(acceptedEvent);
      stored.push(acceptedEvent);
    }
    this.events.set(scopeKey, stored);
    this.cursors.set(scopeKey, serverCursor);
    this.clientCursors.set(scopeKey, clientCursor);
    const result: AppendBatchResult = {
      schema_version: 1,
      ...input,
      accepted,
      rejected,
      next_cursor: serverCursor,
      source_refs: accepted.flatMap((event) => event.source_refs),
    };
    this.idempotency.set(input.idempotency_key, result);
    return cloneAppendResult(result);
  }

  getChanges(
    input: SyncScope & { after_cursor: number; limit: number; trace_id: string },
  ): ChangePage {
    const current = this.cursors.get(key(input)) ?? 0;
    if (input.after_cursor > current)
      throw new ContractError('CURSOR_GAP', 'Requested cursor is ahead of the server cursor', {
        requested_cursor: input.after_cursor,
        current_cursor: current,
        trace_id: input.trace_id,
        retryable: true,
      });
    if (input.limit < 1 || input.limit > 500)
      throw new ContractError(
        'VALIDATION_ERROR',
        'Change page limit is outside the allowed range',
        { limit: input.limit, trace_id: input.trace_id, retryable: false },
      );
    const changes = (this.events.get(key(input)) ?? [])
      .filter((event) => event.server_cursor > input.after_cursor)
      .slice(0, input.limit);
    const next_cursor = changes.at(-1)?.server_cursor ?? input.after_cursor;
    return {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      trace_id: input.trace_id,
      changes: changes.map((event) => ({ ...event, source_refs: [...event.source_refs] })),
      next_cursor,
      has_more: (this.events.get(key(input)) ?? []).some(
        (event) => event.server_cursor > next_cursor,
      ),
      source_refs: changes.flatMap((event) => event.source_refs),
    };
  }

  ackCursor(input: SyncScope & { client_id: string; cursor: number; trace_id: string }): {
    schema_version: 1;
    client_id: string;
    cursor: number;
    trace_id: string;
    source_refs: SourceRef[];
  } {
    const current = this.cursors.get(key(input)) ?? 0;
    if (input.cursor > current)
      throw new ContractError(
        'CURSOR_GAP',
        'Cannot acknowledge a cursor that the server has not issued',
        {
          cursor: input.cursor,
          current_cursor: current,
          trace_id: input.trace_id,
          retryable: true,
        },
      );
    const ackKey = `${key(input)}:${input.client_id}`;
    const previous = this.clientCursors.get(ackKey) ?? 0;
    if (input.cursor < previous)
      throw new ContractError('CURSOR_REGRESSION', 'Cursor acknowledgements must be monotonic', {
        cursor: input.cursor,
        previous_cursor: previous,
        trace_id: input.trace_id,
        retryable: false,
      });
    this.clientCursors.set(ackKey, input.cursor);
    return {
      schema_version: 1,
      client_id: input.client_id,
      cursor: input.cursor,
      trace_id: input.trace_id,
      source_refs: [{ type: 'sync-cursor', id: `${input.client_id}:${input.cursor}` }],
    };
  }

  reconcile(input: SyncScope & { client_cursor: number; trace_id: string }): {
    schema_version: 1;
    gap: boolean;
    server_cursor: number;
    client_cursor: number;
    trace_id: string;
    source_refs: SourceRef[];
  } {
    const server_cursor = this.cursors.get(key(input)) ?? 0;
    return {
      schema_version: 1,
      gap: input.client_cursor > server_cursor || input.client_cursor < 0,
      server_cursor,
      client_cursor: input.client_cursor,
      trace_id: input.trace_id,
      source_refs: [{ type: 'sync-cursor', id: `${input.client_cursor}:${server_cursor}` }],
    };
  }
}

function key(scope: SyncScope): string {
  return `${scope.tenant_id}/${scope.workspace_id}/${scope.project_id}`;
}

function cloneAppendResult(result: AppendBatchResult): AppendBatchResult {
  return {
    ...result,
    accepted: result.accepted.map((event) => ({ ...event, source_refs: [...event.source_refs] })),
    rejected: result.rejected.map((event) => ({ ...event })),
    source_refs: [...result.source_refs],
  };
}
