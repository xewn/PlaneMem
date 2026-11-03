import {
  ContractError,
  syncJsonSnapshot,
  parseProposalReviewReceiptQuery,
  parseProposalReviewReceiptEnvelope,
  assertProposalReceiptIdentity,
  validateErrorEnvelope,
  PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadProposalReviewReceipt } from '../proposals.js';

const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the saved identity, request_key and complete normalized review decision, reason and revision',
  DENIED: 'Use the original verified unexpired human proposal reviewer account, client and project',
  UNAUTHENTICATED: 'Renew the original proposal session before querying its receipt',
  PROPOSAL_NOT_FOUND: 'The original proposal or project is not currently visible',
  IDEMPOTENCY_KEY_REUSED: 'The original key belongs to different content; keep the saved request',
  PROPOSAL_INVALID: 'The historical proposal review receipt could not be verified',
  PROPOSAL_STORAGE_UNAVAILABLE: 'Original proposal receipt storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The receipt query audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_PROPOSAL_REVIEW_RECEIPT_BUSY:
    'Proposal receipt preparation capacity is occupied; keep the saved request',
  MCP_PROPOSAL_REVIEW_RECEIPT_TIMEOUT:
    'Stopped waiting for the review receipt; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete review receipt did not match the original query or exceeded its limit',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });

export function prepareProposalReviewReceiptTool(
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadProposalReviewReceipt(context)) throw fail('DENIED', trace);
  let query;
  try {
    query = parseProposalReviewReceiptQuery(raw);
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  try {
    assertProposalReceiptIdentity(query.identity, context);
  } catch {
    throw fail('DENIED', trace);
  }
  delete context.idempotency_key;
  delete context.expected_version;
  return {
    method: 'POST',
    path: '/v1/proposals/review-receipt',
    body: { ...query },
    context,
    headers: {
      'content-type': 'application/json',
      'x-expected-actor-id': query.identity.actor_id,
      'x-expected-client-id': query.identity.client_id,
    },
  };
}

/** Local waiting ends at the deadline; capacity stays reserved until the underlying work settles. */
export async function executeProposalReviewReceiptTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadProposalReviewReceipt(context)) throw fail('DENIED', trace);
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_PROPOSAL_REVIEW_RECEIPT_TIMEOUT', trace);
    if (!canReadProposalReviewReceipt(context)) throw fail('DENIED', trace);
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_PROPOSAL_REVIEW_RECEIPT_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const request = prepareProposalReviewReceiptTool(raw, context);
      const query = parseProposalReviewReceiptQuery(request.body);
      active();
      const response = await api.handle(structuredClone(request));
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const value: unknown = JSON.parse(
        syncJsonSnapshot(
          response.body,
          response.status >= 400 ? 16 * 1024 : PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES,
        ),
      );
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace);
        throw fail(
          Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID',
          trace,
        );
      }
      if (response.status !== 200) throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const envelope = parseProposalReviewReceiptEnvelope(value, query, trace);
      active();
      const text = syncJsonSnapshot(envelope, PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES + 4096);
      active();
      return result;
    } catch (error) {
      let failure = error;
      try {
        active();
      } catch (stopped) {
        failure = stopped;
      }
      const code =
        failure instanceof ContractError &&
        failure.envelope.trace_id === trace &&
        Object.hasOwn(messages, failure.envelope.code)
          ? failure.envelope.code
          : 'GATEWAY_RESPONSE_INVALID';
      throw fail(code, trace);
    } finally {
      lease.active--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_PROPOSAL_REVIEW_RECEIPT_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
