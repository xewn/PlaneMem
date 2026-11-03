import {
  ContractError,
  buildEtag,
  parseConflictReceiptQuery,
  parseConflictSubmissionResponse,
  CONFLICT_SUBMISSION_RESPONSE_BYTES,
  type ConflictReceiptQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';
import { assertConflictClientIdentity } from './conflict-identity.js';

export interface WcpConflictSubmissionOptions {
  reviewed: true;
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the complete saved original request and reviewed=true with valid timeout/signal options',
  DENIED:
    'Use the original account, client and project with conflict resolution access; keep the original request',
  UNAUTHENTICATED: 'Renew the original session, then check the original receipt',
  CONFLICT_NOT_FOUND:
    'The conflict is unavailable; keep the original request and check its receipt when access is restored',
  CONFLICT_ALREADY_RESOLVED:
    'A decision already exists; keep this original request and check its receipt',
  CONFLICT_VERSION_MISMATCH:
    'The original version no longer matches; keep it unchanged and check the original receipt',
  IDEMPOTENCY_KEY_REUSED:
    'The original key is bound to different parameters; recover the exact original request',
  CONFLICT_STORAGE_UNAVAILABLE:
    'The decision could not be confirmed; keep the original request and check its receipt',
  AUDIT_PERSISTENCE_UNAVAILABLE:
    'The request audit could not be persisted; the decision outcome remains unknown',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable; keep the original request',
  RATE_LIMITED: 'Gateway capacity is occupied; keep the original request',
  GATEWAY_REQUEST_CANCELED:
    'Stopped waiting; the decision may still complete, so keep the original request and check its receipt',
  GATEWAY_REQUEST_TIMEOUT:
    'The local deadline expired; the decision may still complete, so keep the original request and check its receipt',
  GATEWAY_RESPONSE_INVALID:
    'The complete decision response could not be validated; keep the original request and check its receipt',
  GATEWAY_UNAVAILABLE:
    'The decision outcome remains unknown; keep the original request and check its receipt',
};

export async function submitConflictDecision(
  transport: WcpTransport,
  originalContext: RequestContext,
  input: ConflictReceiptQuery,
  options: WcpConflictSubmissionOptions,
) {
  const context = { ...originalContext };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let request;
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      options.reviewed !== true ||
      Object.keys(options).some((key) => !['reviewed', 'timeout_ms', 'signal'].includes(key))
    )
      throw new TypeError();
    request = parseConflictReceiptQuery(input);
    assertConflictClientIdentity(request.identity, context);
  } catch {
    throw fail('INVALID_INPUT');
  }
  const budget = createRequestBudget(
    trace,
    options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
    options.signal,
  );
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/conflicts/' + encodeURIComponent(request.command.conflict_id) + '/resolve',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': request.identity.tenant_id,
          'x-workspace-id': request.identity.workspace_id,
          'x-project-id': request.identity.project_id,
          'x-expected-actor-id': request.identity.actor_id,
          'x-expected-client-id': request.identity.client_id,
          'idempotency-key': request.request_key,
          'if-match': buildEtag(request.command.expected_version),
        },
        body: parseConflictReceiptQuery(request).command,
        response_type: 'bounded-json',
        max_response_bytes: CONFLICT_SUBMISSION_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseConflictSubmissionResponse(raw, request, trace);
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        Object.hasOwn(messages, error.envelope.code)
        ? error.envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget.close();
  }
}
