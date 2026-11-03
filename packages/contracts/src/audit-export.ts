import { isUlid } from './ids.js';
import {
  parseWorkbenchAuditRecord,
  type WorkbenchAuditRecord,
  type WorkbenchAuditScope,
} from './workbench-audit.js';

export const AUDIT_EXPORT_REQUEST_BYTES = 4096;
export const AUDIT_EXPORT_DOCUMENT_BYTES = 96 * 1024;
export const AUDIT_EXPORT_RESPONSE_BYTES = 128 * 1024;
export interface AuditExportRequest {
  scope: WorkbenchAuditScope;
  audit_id: string;
  sha256: string;
}
export interface AuditExportDocument {
  schema_version: 1;
  content_state: 'bounded-view';
  scope: WorkbenchAuditScope;
  record: WorkbenchAuditRecord;
}
export interface AuditExportEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  data: {
    document: AuditExportDocument;
    document_sha256: string;
    document_bytes: number;
    release_audit_id: string;
    audit_state: 'release-recorded';
    client_delivery_state: 'not-confirmed';
  };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid audit export object');
  return value as Record<string, unknown>;
}
function scope(value: unknown): WorkbenchAuditScope {
  const result = object(value, ['tenant_id', 'workspace_id', 'project_id']);
  for (const key of ['tenant_id', 'workspace_id', 'project_id']) {
    const field = result[key];
    if (
      typeof field !== 'string' ||
      !field.length ||
      field.length > 256 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(field)
    )
      throw new TypeError('Invalid audit export scope');
  }
  return {
    tenant_id: result.tenant_id as string,
    workspace_id: result.workspace_id as string,
    project_id: result.project_id as string,
  };
}
export function parseAuditExportRequest(value: unknown): AuditExportRequest {
  const input = object(value, ['scope', 'audit_id', 'sha256']);
  if (
    !isUlid(input.audit_id) ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    throw new TypeError('Invalid audit export selection');
  return { scope: scope(input.scope), audit_id: input.audit_id, sha256: input.sha256 };
}

export function auditExportDocument(
  project: WorkbenchAuditScope,
  record: WorkbenchAuditRecord,
): AuditExportDocument {
  return {
    schema_version: 1,
    content_state: 'bounded-view',
    scope: scope(project),
    record: parseWorkbenchAuditRecord(record),
  };
}

/** Stable JSON for the reviewed view, with finite structural work and no custom serializers. */
export function auditExportDocumentJson(document: AuditExportDocument): string {
  const input = object(document, ['schema_version', 'content_state', 'scope', 'record']);
  if (input.schema_version !== 1 || input.content_state !== 'bounded-view')
    throw new TypeError('Invalid audit export document');
  const parsed = auditExportDocument(scope(input.scope), parseWorkbenchAuditRecord(input.record));
  let nodes = 0;
  const canonical = (value: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 64) throw new TypeError('Audit view is too complex to export');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    )
      return value;
    if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
    if (
      value &&
      typeof value === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key], depth + 1)]),
      );
    throw new TypeError('Invalid audit export value');
  };
  const json = JSON.stringify(canonical(parsed, 0));
  if (new TextEncoder().encode(json).byteLength > AUDIT_EXPORT_DOCUMENT_BYTES)
    throw new TypeError('Audit export is too large');
  return json;
}

/** Callers must independently hash the canonical document; structural validation alone is insufficient. */
export function parseAuditExportEnvelope(
  value: unknown,
  selection: AuditExportRequest,
  trace: string,
): AuditExportEnvelope {
  const request = parseAuditExportRequest(selection);
  const input = object(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  const data = object(input.data, [
    'document',
    'document_sha256',
    'document_bytes',
    'release_audit_id',
    'audit_state',
    'client_delivery_state',
  ]);
  const rawDocument = object(data.document, ['schema_version', 'content_state', 'scope', 'record']);
  if (rawDocument.schema_version !== 1 || rawDocument.content_state !== 'bounded-view')
    throw new TypeError('Invalid audit export document');
  const document = auditExportDocument(
    scope(rawDocument.scope),
    parseWorkbenchAuditRecord(rawDocument.record),
  );
  const json = auditExportDocumentJson(document);
  if (
    input.schema_version !== 1 ||
    input.trace_id !== trace ||
    document.record.audit_id !== request.audit_id ||
    Object.keys(request.scope).some(
      (key) =>
        document.scope[key as keyof WorkbenchAuditScope] !==
        request.scope[key as keyof WorkbenchAuditScope],
    ) ||
    data.document_sha256 !== request.sha256 ||
    data.document_bytes !== new TextEncoder().encode(json).byteLength ||
    !isUlid(data.release_audit_id) ||
    data.release_audit_id === request.audit_id ||
    data.audit_state !== 'release-recorded' ||
    data.client_delivery_state !== 'not-confirmed' ||
    !Array.isArray(input.source_refs) ||
    input.source_refs.length !== 2
  )
    throw new TypeError('Audit export does not match the reviewed selection');
  const refs = input.source_refs.map((value) => object(value, ['type', 'id']));
  if (
    refs[0]?.type !== 'audit' ||
    refs[0].id !== request.audit_id ||
    refs[1]?.type !== 'audit' ||
    refs[1].id !== data.release_audit_id
  )
    throw new TypeError('Invalid audit export references');
  const result: AuditExportEnvelope = {
    schema_version: 1,
    trace_id: trace,
    source_refs: [
      { type: 'audit', id: request.audit_id },
      { type: 'audit', id: data.release_audit_id },
    ],
    data: {
      document,
      document_sha256: request.sha256,
      document_bytes: data.document_bytes as number,
      release_audit_id: data.release_audit_id,
      audit_state: 'release-recorded',
      client_delivery_state: 'not-confirmed',
    },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > AUDIT_EXPORT_RESPONSE_BYTES)
    throw new TypeError('Audit export envelope is too large');
  return result;
}
