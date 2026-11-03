import { createHash } from 'node:crypto';
import { canRead, canExport } from '@planemem/auth';
import {
  ContractError,
  isUlid,
  validateErrorEnvelope,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditEnvelope,
  parseAuditExportRequest,
  parseAuditExportEnvelope,
  auditExportDocument,
  auditExportDocumentJson,
  AUDIT_EXPORT_REQUEST_BYTES,
  AUDIT_EXPORT_RESPONSE_BYTES,
  WORKBENCH_AUDIT_RESPONSE_BYTES,
  WORKBENCH_AUDIT_ERROR_BYTES,
  type AuditExportRequest,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply only the original audit query or reviewed export selection',
  DENIED: 'The current session cannot perform this audit operation',
  UNAUTHENTICATED: 'The current session must be renewed',
  NOT_FOUND: 'The selected audit record is not available in this scope',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The audit store is unavailable',
  WORKBENCH_AUDIT_INVALID: 'The stored audit view could not be validated',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Durable audit persistence was not confirmed',
  AUDIT_EXPORT_CONFLICT: 'The record view changed; read and review it again before exporting',
  AUDIT_EXPORT_BUSY: 'Audit export capacity is occupied',
  AUDIT_EXPORT_TIMEOUT: 'Stopped waiting for gateway export preparation',
  MCP_AUDIT_BUSY: 'MCP audit preparation capacity is occupied',
  MCP_AUDIT_TIMEOUT: 'Stopped waiting; a remote audit operation may still complete',
  GATEWAY_RESPONSE_INVALID: 'The audit response did not match the request',
};

export function isAuditTool(name: unknown): boolean {
  return (
    typeof name === 'string' &&
    ['list_audit_records', 'get_audit_record', 'export_audit_record'].includes(name)
  );
}

export function canUseAuditTool(name: unknown, context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  return (
    isAuditTool(name) &&
    context.authenticated_client === true &&
    context.capability.includes('audit.read') &&
    Number.isFinite(expiry) &&
    expiry > Date.now() &&
    (name !== 'export_audit_record' ||
      context.capability.some(
        (value) => value === 'data.export' || value === 'data.restricted.export',
      ))
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}

export function prepareAuditTool(
  name: string,
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const context = structuredClone(original);
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: context.trace_id });
  if (!canUseAuditTool(name, context)) throw fail('DENIED');
  let body: Record<string, unknown>;
  try {
    const input = object(raw);
    if (
      Buffer.byteLength(JSON.stringify(input), 'utf8') >
      (name === 'export_audit_record' ? AUDIT_EXPORT_REQUEST_BYTES : 16 * 1024)
    )
      throw new TypeError();
    if (name === 'export_audit_record') {
      if (
        Object.keys(input).some(
          (key) => !['scope', 'audit_id', 'sha256', 'reviewed'].includes(key),
        ) ||
        input.reviewed !== true
      )
        throw new TypeError();
      const selected = parseAuditExportRequest({
        scope: input.scope,
        audit_id: input.audit_id,
        sha256: input.sha256,
      });
      body = { ...selected };
    } else {
      const query = parseWorkbenchAuditQuery(input);
      if (
        name === 'get_audit_record' &&
        (query.audit_id === undefined || Object.keys(query).some((key) => key !== 'audit_id'))
      )
        throw new TypeError();
      body = { operation: 'audit', ...query };
    }
  } catch {
    throw fail('INVALID_INPUT');
  }
  if (name === 'export_audit_record') {
    const selected = parseAuditExportRequest(body);
    if (
      selected.scope.tenant_id !== context.tenant_id ||
      selected.scope.workspace_id !== context.workspace_id ||
      selected.scope.project_id !== context.project_id
    )
      throw fail('DENIED');
  }
  delete context.idempotency_key;
  delete context.expected_version;
  return {
    method: 'POST',
    path: name === 'export_audit_record' ? '/v1/audit/export' : '/v1/workbench/query',
    headers: {},
    context,
    body,
  };
}

/** Uses the same bounded WCP views and mandatory release audit as the other clients. */
export async function executeAuditTool(api: ApiGateway, name: string, prepared: HttpRequest) {
  const request = structuredClone(prepared);
  const trace = request.context.trace_id;
  const exporting = name === 'export_audit_record';
  let releaseId: string | undefined;
  let selection: AuditExportRequest | undefined;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      details: exporting
        ? {
            audit_state: releaseId ? 'release-recorded' : 'unconfirmed',
            ...(releaseId ? { release_audit_id: releaseId } : {}),
            client_delivery_state: 'not-confirmed',
          }
        : {},
    });
  let dispatch: HttpRequest;
  try {
    if (
      !isAuditTool(name) ||
      request.method !== 'POST' ||
      Object.keys(request.headers).length ||
      request.context.idempotency_key !== undefined ||
      request.context.expected_version !== undefined ||
      request.path !== (exporting ? '/v1/audit/export' : '/v1/workbench/query')
    )
      throw new TypeError();
    if (exporting) {
      selection = parseAuditExportRequest(request.body);
      dispatch = prepareAuditTool(name, { ...selection, reviewed: true }, request.context);
    } else {
      const { operation, ...query } = object(request.body);
      if (operation !== 'audit') throw new TypeError();
      dispatch = prepareAuditTool(name, query, request.context);
    }
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw fail('DENIED');
    throw fail('INVALID_INPUT');
  }
  const deadline = Date.now() + (exporting ? 75_000 : 30_000);
  const active = () => {
    if (Date.now() >= deadline) throw fail('MCP_AUDIT_TIMEOUT');
    if (!canUseAuditTool(name, request.context)) throw fail('DENIED');
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_AUDIT_BUSY');
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const response = await api.handle(structuredClone(dispatch));
      const maximum =
        response.status >= 400
          ? WORKBENCH_AUDIT_ERROR_BYTES
          : exporting
            ? AUDIT_EXPORT_RESPONSE_BYTES
            : WORKBENCH_AUDIT_RESPONSE_BYTES;
      if (Buffer.byteLength(JSON.stringify(response.body), 'utf8') > maximum)
        throw fail('GATEWAY_RESPONSE_INVALID');
      if (response.status >= 400) {
        const error = validateErrorEnvelope(response.body);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID');
        if (
          exporting &&
          error.details.audit_state === 'release-recorded' &&
          isUlid(error.details.release_audit_id) &&
          error.details.release_audit_id !== selection?.audit_id
        )
          releaseId = error.details.release_audit_id;
        active();
        throw fail(Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID');
      }
      if (response.status !== 200 || response.headers['x-trace-id'] !== trace)
        throw fail('GATEWAY_RESPONSE_INVALID');
      let resultValue: unknown;
      if (exporting) {
        const envelope = parseAuditExportEnvelope(response.body, selection!, trace);
        releaseId = envelope.data.release_audit_id;
        active();
        if (
          !canRead(envelope.data.document.record.classification, request.context.capability) ||
          !canExport(envelope.data.document.record.classification, request.context.capability)
        )
          throw fail('DENIED');
        if (
          createHash('sha256')
            .update(auditExportDocumentJson(envelope.data.document), 'utf8')
            .digest('hex') !== selection!.sha256
        )
          throw fail('GATEWAY_RESPONSE_INVALID');
        resultValue = envelope;
      } else {
        const { operation: _operation, ...query } = dispatch.body!;
        const page = parseWorkbenchAuditEnvelope(
          response.body,
          parseWorkbenchAuditQuery(query),
          request.context,
          trace,
        );
        active();
        if (page.data.some((row) => !canRead(row.classification, request.context.capability)))
          throw fail('DENIED');
        if (name === 'list_audit_records') resultValue = page;
        else {
          let preparation: Record<string, unknown> = {
            state: 'unavailable',
            reason: 'no-visible-record',
          };
          const row = page.data[0];
          if (row) {
            try {
              const json = auditExportDocumentJson(auditExportDocument(page.scope, row));
              preparation = {
                state: 'available',
                content_state: 'bounded-view',
                review_required: true,
                selection: parseAuditExportRequest({
                  scope: page.scope,
                  audit_id: row.audit_id,
                  sha256: createHash('sha256').update(json, 'utf8').digest('hex'),
                }),
              };
            } catch {
              preparation = { state: 'unavailable', reason: 'view-not-exportable' };
            }
          }
          resultValue = {
            schema_version: 1,
            trace_id: trace,
            source_refs: page.source_refs,
            data: { page, export_preparation: preparation, content_trust: 'untrusted-reference' },
          };
        }
      }
      const result = { content: [{ type: 'text', text: JSON.stringify(resultValue) }] };
      // The text string is escaped a second time in the MCP result. Bound that representation too.
      const resultLimit =
        name === 'list_audit_records'
          ? 2 * WORKBENCH_AUDIT_RESPONSE_BYTES + 64 * 1024
          : 2 * AUDIT_EXPORT_RESPONSE_BYTES + 16 * 1024;
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > resultLimit)
        throw fail('GATEWAY_RESPONSE_INVALID');
      active();
      return result;
    } catch (error) {
      const code =
        error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        Object.hasOwn(messages, error.envelope.code)
          ? error.envelope.code
          : 'GATEWAY_RESPONSE_INVALID';
      throw fail(code);
    } finally {
      lease.active--;
    }
  })();
  // A local timeout cannot stop an in-flight database/policy/audit call. Keep its slot until settled.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_AUDIT_TIMEOUT')),
          Math.max(1, deadline - Date.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
