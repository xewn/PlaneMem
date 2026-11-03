import {
  ContractError,
  WORKBENCH_AUDIT_RESPONSE_BYTES,
  AUDIT_EXPORT_RESPONSE_BYTES,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditEnvelope,
  auditExportDocumentJson,
  parseAuditExportRequest,
  parseAuditExportEnvelope,
  isUlid,
  type RequestContext,
  type WorkbenchAuditQuery,
  type WorkbenchAuditScope,
  type AuditExportDocument,
  type AuditExportEnvelope,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpAuditOptions {
  /** Total local wait, including hashing and custom transports; no automatic retry. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply valid audit input, project scope and request options',
  UNAUTHENTICATED: 'The current session must be renewed',
  DENIED: 'The current session cannot perform this audit operation',
  NOT_FOUND: 'The selected audit record is not available in this scope',
  RATE_LIMITED: 'The gateway request limit is occupied',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The audit store is unavailable',
  WORKBENCH_AUDIT_INVALID: 'The stored audit view could not be validated',
  AUDIT_EXPORT_BUSY: 'Audit export preparation capacity is occupied',
  AUDIT_EXPORT_TIMEOUT: 'Stopped waiting for audit export preparation',
  AUDIT_EXPORT_CONFLICT: 'The record view changed; read and review it again before exporting',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Durable audit persistence was not confirmed',
  AUDIT_INTEGRITY_UNAVAILABLE: 'SHA-256 verification is unavailable',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting; the remote operation may still have completed',
  GATEWAY_REQUEST_TIMEOUT:
    'The local deadline elapsed; the remote operation may still have completed',
  GATEWAY_UNAVAILABLE: 'The audit request could not be completed',
  GATEWAY_RESPONSE_INVALID: 'The audit response did not match the request',
};

function failure(error: unknown, trace: string, target?: string, knownRelease?: string) {
  const envelope =
    error instanceof ContractError && error.envelope.trace_id === trace
      ? error.envelope
      : undefined;
  const code =
    envelope && Object.hasOwn(messages, envelope.code) ? envelope.code : 'GATEWAY_UNAVAILABLE';
  const candidate =
    envelope?.details.audit_state === 'release-recorded'
      ? envelope.details.release_audit_id
      : undefined;
  const release =
    knownRelease ?? (isUlid(candidate) && candidate !== target ? candidate : undefined);
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details:
      target === undefined
        ? {}
        : {
            audit_state: release ? 'release-recorded' : 'unconfirmed',
            ...(release ? { release_audit_id: release } : {}),
            client_delivery_state: 'not-confirmed',
          },
  });
}

function optionsBudget(options: WcpAuditOptions, trace: string, fallback: number) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'timeout_ms' && key !== 'signal')
  )
    throw new ContractError('INVALID_INPUT', messages.INVALID_INPUT!, { trace_id: trace });
  return createRequestBudget(
    trace,
    options.timeout_ms === undefined ? fallback : options.timeout_ms,
    options.signal,
  );
}

function project(context: RequestContext): WorkbenchAuditScope {
  if (!context.project_id)
    throw new ContractError('INVALID_INPUT', messages.INVALID_INPUT!, {
      trace_id: context.trace_id,
    });
  return {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
}

function headers(context: RequestContext, scope: WorkbenchAuditScope) {
  return {
    'x-trace-id': context.trace_id,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
    ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
  };
}

export async function readAuditRecords(
  transport: WcpTransport,
  source: RequestContext,
  input: WorkbenchAuditQuery,
  options: WcpAuditOptions,
) {
  const context = { ...source };
  const budget = optionsBudget(options, context.trace_id, 30_000);
  try {
    const scope = project(context);
    let query;
    try {
      query = parseWorkbenchAuditQuery(input);
    } catch {
      throw new ContractError('INVALID_INPUT', messages.INVALID_INPUT!, {
        trace_id: context.trace_id,
      });
    }
    const result = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        headers: headers(context, scope),
        body: { operation: 'audit', ...query },
        response_type: 'bounded-json',
        max_response_bytes: WORKBENCH_AUDIT_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let page;
    try {
      page = structuredClone(parseWorkbenchAuditEnvelope(result, query, scope, context.trace_id));
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', messages.GATEWAY_RESPONSE_INVALID!, {
        trace_id: context.trace_id,
      });
    }
    budget.check();
    return page;
  } catch (error) {
    throw failure(error, context.trace_id);
  } finally {
    budget.close();
  }
}

/** Export exactly the supplied reviewed view. This method neither reads a replacement nor saves a file. */
export async function exportReviewedAuditView(
  transport: WcpTransport,
  source: RequestContext,
  reviewed: AuditExportDocument,
  options: WcpAuditOptions,
): Promise<AuditExportEnvelope> {
  const context = { ...source };
  const budget = optionsBudget(options, context.trace_id, 90_000);
  let target: string | undefined;
  let release: string | undefined;
  try {
    const scope = project(context);
    let document: AuditExportDocument;
    let json: string;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        context.if_match !== undefined
      )
        throw new TypeError();
      // Canonicalize synchronously before any credential/hash wait; caller mutations cannot change it.
      json = auditExportDocumentJson(reviewed);
      document = JSON.parse(json) as AuditExportDocument;
      if (
        Object.keys(scope).some(
          (key) =>
            scope[key as keyof WorkbenchAuditScope] !==
            document.scope[key as keyof WorkbenchAuditScope],
        )
      )
        throw new TypeError();
      target = document.record.audit_id;
    } catch {
      throw new ContractError('INVALID_INPUT', messages.INVALID_INPUT!, {
        trace_id: context.trace_id,
      });
    }
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw new ContractError(
        'AUDIT_INTEGRITY_UNAVAILABLE',
        messages.AUDIT_INTEGRITY_UNAVAILABLE!,
        { trace_id: context.trace_id },
      );
    const digest = async (value: string) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await budget.wait(() =>
        globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer),
      );
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    };
    const selected = parseAuditExportRequest({
      scope,
      audit_id: target,
      sha256: await digest(json),
    });
    const result = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/audit/export',
        headers: headers(context, scope),
        body: structuredClone(selected),
        response_type: 'bounded-json',
        max_response_bytes: AUDIT_EXPORT_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let envelope;
    let returnedJson;
    try {
      envelope = structuredClone(parseAuditExportEnvelope(result, selected, context.trace_id));
      release = envelope.data.release_audit_id;
      returnedJson = auditExportDocumentJson(envelope.data.document);
      if (returnedJson !== json) throw new TypeError();
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', messages.GATEWAY_RESPONSE_INVALID!, {
        trace_id: context.trace_id,
      });
    }
    if ((await digest(returnedJson)) !== selected.sha256)
      throw new ContractError('GATEWAY_RESPONSE_INVALID', messages.GATEWAY_RESPONSE_INVALID!, {
        trace_id: context.trace_id,
      });
    budget.check();
    return envelope;
  } catch (error) {
    throw failure(error, context.trace_id, target, release);
  } finally {
    budget.close();
  }
}
