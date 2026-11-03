import {
  ContractError,
  parseConflictReceiptQuery,
  parseConflictReceiptEnvelope,
  CONFLICT_RECEIPT_RESPONSE_BYTES,
  type ConflictReceiptQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';
import { assertConflictClientIdentity } from './conflict-identity.js';

export interface WcpConflictReceiptOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the saved identity, key, full original decision and valid timeout/signal options',
  DENIED: 'Use the original account, client and project with conflict resolution access',
  UNAUTHENTICATED: 'Sign in as the original account before checking the receipt',
  CONFLICT_NOT_FOUND: 'The conflict is unavailable in the current readable scope',
  IDEMPOTENCY_KEY_REUSED:
    'The original key is bound to different parameters; keep the saved request',
  CONFLICT_RECEIPT_LEGACY_UNVERIFIED: 'The legacy decision cannot confirm this original request',
  CONFLICT_RECEIPT_INVALID:
    'The saved receipt could not be validated; the original outcome remains unconfirmed',
  CONFLICT_STORAGE_UNAVAILABLE: 'Receipt storage is unavailable; keep the saved request',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Receipt lookup audit could not be persisted',
  RATE_LIMITED: 'Receipt reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the receipt; keep the original request',
  GATEWAY_REQUEST_TIMEOUT: 'The receipt exceeded the local deadline; keep the original request',
  GATEWAY_RESPONSE_INVALID:
    'The complete receipt did not match the original request or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'The original conflict outcome could not be confirmed',
};
export async function readConflictReceipt(
  transport: WcpTransport,
  original: RequestContext,
  input: ConflictReceiptQuery,
  options: WcpConflictReceiptOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let query;
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
    )
      throw new TypeError();
    query = parseConflictReceiptQuery(input);
    assertConflictClientIdentity(query.identity, context);
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
        path: '/v1/conflicts/receipt',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': query.identity.tenant_id,
          'x-workspace-id': query.identity.workspace_id,
          'x-project-id': query.identity.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body: parseConflictReceiptQuery(query),
        response_type: 'bounded-json',
        max_response_bytes: CONFLICT_RECEIPT_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseConflictReceiptEnvelope(raw, query, trace);
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
