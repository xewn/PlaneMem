import {
  ContractError,
  parseProposalReviewReceiptQuery,
  parseProposalReviewReceiptEnvelope,
  PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES,
  type ProposalReviewReceiptQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpProposalReviewReceiptOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the saved identity, request key and complete normalized review decision, reason and revision',
  DENIED: 'Use the original verified account, client and project with human proposal review access',
  UNAUTHENTICATED: 'Sign in as the original human reviewer',
  PROPOSAL_NOT_FOUND: 'The original proposal or its project is not currently visible',
  IDEMPOTENCY_KEY_REUSED:
    'This original key belongs to different parameters; keep the saved request',
  PROPOSAL_INVALID:
    'The historical review receipt could not be verified; keep the original request',
  PROPOSAL_STORAGE_UNAVAILABLE: 'Proposal receipt storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Receipt query audit could not be persisted',
  RATE_LIMITED: 'Receipt reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the receipt; keep the original request',
  GATEWAY_REQUEST_TIMEOUT: 'The receipt exceeded the local deadline; keep the original request',
  GATEWAY_RESPONSE_INVALID: 'The complete review receipt did not match the original query',
  GATEWAY_UNAVAILABLE: 'The original proposal outcome could not be confirmed',
};
export async function readProposalReviewReceipt(
  transport: WcpTransport,
  original: RequestContext,
  input: ProposalReviewReceiptQuery,
  options: WcpProposalReviewReceiptOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let query;
  try {
    if (typeof trace !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(trace)) throw new TypeError();
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
    )
      throw new TypeError();
    query = parseProposalReviewReceiptQuery(input);
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (query.identity[field] !== context[field]) throw new TypeError();
    for (const field of ['actor_id', 'client_id'] as const)
      if (context[field] !== undefined && query.identity[field] !== context[field])
        throw new TypeError();
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
        path: '/v1/proposals/review-receipt',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': query.identity.tenant_id,
          'x-workspace-id': query.identity.workspace_id,
          'x-project-id': query.identity.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body: parseProposalReviewReceiptQuery(query),
        response_type: 'bounded-json',
        max_response_bytes: PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseProposalReviewReceiptEnvelope(raw, query, trace);
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
