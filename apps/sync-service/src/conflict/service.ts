import { ContractError, createUlid, type SourceRef, type Ulid } from '@planemem/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { SyncScope } from '../cursor/service.js';

export interface ConflictRecord<Id extends string = Ulid> extends SyncScope {
  schema_version: 1;
  conflict_id: Id;
  entity_type: string;
  entity_id: string;
  field: string;
  base_version: number;
  local_version: number;
  server_version: number;
  local_value: unknown;
  server_value: unknown;
  status: 'open' | 'resolved';
  resolution?: 'local' | 'server' | 'merge';
  resolved_value?: unknown;
  actor_id?: string;
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface ResolveConflictInput<Id extends string = Ulid> extends SyncScope {
  conflict_id: Id;
  resolution: 'local' | 'server' | 'merge';
  merged_value?: unknown;
  actor_id: string;
  expected_version: number;
  trace_id: string;
}

export class ConflictService {
  private readonly conflicts = new Map<string, ConflictRecord>();

  health(): {
    service: 'conflict-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { open: number; total: number };
  } {
    return {
      service: 'conflict-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: {
        open: [...this.conflicts.values()].filter((conflict) => conflict.status === 'open').length,
        total: this.conflicts.size,
      },
    };
  }

  detectConflict(
    input: SyncScope & {
      entity_type: string;
      entity_id: string;
      field: string;
      base_version: number;
      local_version: number;
      server_version: number;
      local_value: unknown;
      server_value: unknown;
      trace_id: string;
      source_refs?: SourceRef[];
    },
  ): ConflictRecord | undefined {
    // Two clients may both advance to the same revision from the same base.
    if (
      input.local_version === input.server_version &&
      (input.local_version <= input.base_version ||
        isDeepStrictEqual(input.local_value, input.server_value))
    )
      return undefined;
    const conflict: ConflictRecord = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      conflict_id: createUlid(),
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      field: input.field,
      base_version: input.base_version,
      local_version: input.local_version,
      server_version: input.server_version,
      local_value: input.local_value,
      server_value: input.server_value,
      status: 'open',
      version: 1,
      trace_id: input.trace_id,
      source_refs:
        input.source_refs === undefined
          ? [{ type: input.entity_type, id: input.entity_id }]
          : [...input.source_refs],
    };
    this.conflicts.set(String(conflict.conflict_id), clone(conflict));
    return clone(conflict);
  }

  listConflicts(scope: SyncScope): ConflictRecord[] {
    return [...this.conflicts.values()]
      .filter(
        (conflict) =>
          conflict.tenant_id === scope.tenant_id &&
          conflict.workspace_id === scope.workspace_id &&
          conflict.project_id === scope.project_id,
      )
      .map(clone);
  }

  resolveConflict(input: ResolveConflictInput): ConflictRecord {
    const conflict = this.conflicts.get(String(input.conflict_id));
    if (!conflict)
      throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict does not exist', {
        conflict_id: input.conflict_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    const resolved = resolveConflictRecord(conflict, input);
    this.conflicts.set(resolved.conflict_id, resolved);
    return clone(resolved);
  }

  emitResolution(conflict: ConflictRecord): {
    schema_version: 1;
    event_id: string;
    event_type: 'ConflictResolved';
    aggregate_id: string;
    aggregate_version: number;
    trace_id: string;
    payload: ConflictRecord;
    source_refs: SourceRef[];
  } {
    if (conflict.status !== 'resolved')
      throw new ContractError(
        'CONFLICT_NOT_RESOLVED',
        'Only resolved conflicts can emit a resolution event',
        { conflict_id: conflict.conflict_id, trace_id: conflict.trace_id, retryable: false },
      );
    return {
      schema_version: 1,
      event_id: `conflict-resolution-${conflict.conflict_id}-${conflict.version}`,
      event_type: 'ConflictResolved',
      aggregate_id: String(conflict.conflict_id),
      aggregate_version: conflict.version,
      trace_id: conflict.trace_id,
      payload: clone(conflict),
      source_refs: [...conflict.source_refs],
    };
  }
}

function clone<Id extends string>(conflict: ConflictRecord<Id>): ConflictRecord<Id> {
  return structuredClone(conflict);
}

export function resolveConflictRecord<Id extends string>(
  conflict: ConflictRecord<Id>,
  input: ResolveConflictInput<Id>,
): ConflictRecord<Id> {
  if (
    conflict.conflict_id !== input.conflict_id ||
    conflict.tenant_id !== input.tenant_id ||
    conflict.workspace_id !== input.workspace_id ||
    conflict.project_id !== input.project_id
  )
    throw new ContractError('CONFLICT_ACCESS_DENIED', 'Conflict scope is not authorized', {
      trace_id: input.trace_id,
    });
  if (conflict.status === 'resolved') {
    if (
      conflict.actor_id !== input.actor_id ||
      conflict.resolution !== input.resolution ||
      (input.resolution === 'merge' &&
        !isDeepStrictEqual(conflict.resolved_value, input.merged_value))
    )
      throw new ContractError(
        'CONFLICT_ALREADY_RESOLVED',
        'A different decision has already been recorded',
        { trace_id: input.trace_id },
      );
    return clone(conflict);
  }
  if (conflict.version !== input.expected_version)
    throw new ContractError('CONFLICT_VERSION_MISMATCH', 'Conflict version does not match', {
      current_version: conflict.version,
      expected_version: input.expected_version,
      trace_id: input.trace_id,
    });
  const selected =
    input.resolution === 'local'
      ? conflict.local_value
      : input.resolution === 'server'
        ? conflict.server_value
        : input.merged_value;
  return clone({
    ...conflict,
    status: 'resolved',
    resolution: input.resolution,
    actor_id: input.actor_id,
    ...(selected === undefined ? {} : { resolved_value: selected }),
    trace_id: input.trace_id,
    version: conflict.version + 1,
  });
}
