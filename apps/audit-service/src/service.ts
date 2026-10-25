import { createUlid, type SourceRef, type Ulid } from '@planemem/contracts';
import { redact, type Classification } from '@planemem/auth';

export interface AuditScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface AuditRecord extends AuditScope {
  schema_version: 1;
  audit_id: Ulid;
  actor_id: string;
  client_id: string;
  session_id?: string;
  action: string;
  resource: string;
  result: 'allowed' | 'denied' | 'error';
  classification: Classification;
  details: unknown;
  trace_id: string;
  source_refs: SourceRef[];
  occurred_at: string;
}

export interface AuditInput extends AuditScope {
  actor_id: string;
  client_id: string;
  session_id?: string;
  action: string;
  resource: string;
  result: AuditRecord['result'];
  classification: Classification;
  details?: unknown;
  trace_id: string;
  source_refs?: SourceRef[];
  idempotency_key: string;
}

export class AuditService {
  private readonly records: AuditRecord[] = [];
  private readonly idempotency = new Map<string, AuditRecord>();

  health(): {
    service: 'audit-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { records: number };
  } {
    return {
      service: 'audit-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: { records: this.records.length },
    };
  }

  recordAudit(input: AuditInput): AuditRecord {
    const previous = this.idempotency.get(input.idempotency_key);
    if (previous !== undefined) return clone(previous);
    const record: AuditRecord = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      audit_id: createUlid(),
      actor_id: input.actor_id,
      client_id: input.client_id,
      ...(input.session_id === undefined ? {} : { session_id: input.session_id }),
      action: input.action,
      resource: input.resource,
      result: input.result,
      classification: input.classification,
      details: redact(input.details ?? {}, input.classification),
      trace_id: input.trace_id,
      source_refs: input.source_refs === undefined ? [] : [...input.source_refs],
      occurred_at: new Date().toISOString(),
    };
    this.records.push(record);
    this.idempotency.set(input.idempotency_key, record);
    return clone(record);
  }

  queryAudit(
    scope: AuditScope,
    filter: { trace_id?: string; action?: string; limit?: number } = {},
  ): AuditRecord[] {
    const limit = filter.limit ?? 100;
    return this.records
      .filter(
        (record) =>
          record.tenant_id === scope.tenant_id &&
          record.workspace_id === scope.workspace_id &&
          record.project_id === scope.project_id &&
          (filter.trace_id === undefined || record.trace_id === filter.trace_id) &&
          (filter.action === undefined || record.action === filter.action),
      )
      .slice(-limit)
      .map(clone);
  }

  snapshot(): AuditRecord[] {
    return this.records.map(clone);
  }

  createExportRecord(
    input: AuditInput & { export_format: 'json' | 'csv'; row_count: number },
  ): AuditRecord {
    return this.recordAudit({
      ...input,
      action: `export.${input.export_format}`,
      details: { row_count: input.row_count },
    });
  }

  redact(value: unknown, classification: Classification): unknown {
    return redact(value, classification);
  }
}

function clone(record: AuditRecord): AuditRecord {
  return { ...record, source_refs: [...record.source_refs] };
}
