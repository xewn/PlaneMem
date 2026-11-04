import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
  parseContextPackSaveReceiptQuery,
  parseContextPackSaveReceiptEnvelope,
  type ContextPackSaveReceiptQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackSaveReceiptOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply the complete original save identity, permissions, key and parameters',
  DENIED: 'Restore the original account, client, project and restricted permission bucket',
  UNAUTHENTICATED: 'Sign in as the original save requester',
  CONTEXT_PACK_NOT_FOUND: 'The original pack project is not currently visible',
  IDEMPOTENCY_KEY_REUSED:
    'This original key belongs to different settings; retain the exact original',
  CONTEXT_PACK_RECEIPT_INVALID: 'The historical save metadata could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Historical context pack storage is unavailable',
  CONTEXT_PACK_RECEIPT_TIMEOUT: 'The gateway stopped waiting for historical save metadata',
  RATE_LIMITED: 'Historical save query capacity is occupied',
  WORKBENCH_AUTH_UNAVAILABLE: 'Authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The receipt query audit could not be confirmed',
  GATEWAY_REQUEST_TIMEOUT: 'Stopped waiting for the original save receipt',
  GATEWAY_REQUEST_CANCELED: 'Canceled local receipt waiting; keep the original request',
  GATEWAY_RESPONSE_INVALID: 'The complete receipt differs from the original query',
  GATEWAY_UNAVAILABLE: 'The original save receipt could not be read',
};
/** Observation only: not-observed never authorizes resubmission or proves a failed save. */
export async function readContextPackSaveReceipt(
  transport: WcpTransport,
  original: RequestContext,
  input: ContextPackSaveReceiptQuery,
  options: WcpContextPackSaveReceiptOptions,
) {
  let trace = 'trace_unknown';
  let budget: RequestBudget | undefined;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  try {
    let settings: ReturnType<typeof captureContextRead>;
    let query: ContextPackSaveReceiptQuery;
    try {
      settings = captureContextRead(original, options);
      trace = settings.context.trace_id;
      query = parseContextPackSaveReceiptQuery(input);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (query.identity[field] !== settings.context[field]) throw new TypeError();
      for (const field of ['actor_id', 'client_id'] as const)
        if (
          settings.context[field] !== undefined &&
          query.identity[field] !== settings.context[field]
        )
          throw new TypeError();
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT');
    }
    const active = budget;
    active.check();
    const raw = await active.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/context-pack/save-receipt',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': trace,
          'x-tenant-id': query.identity.tenant_id,
          'x-workspace-id': query.identity.workspace_id,
          'x-project-id': query.identity.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body: parseContextPackSaveReceiptQuery(query),
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
        signal: active.signal,
      }),
    );
    active.check();
    try {
      const result = parseContextPackSaveReceiptEnvelope(raw, query, trace);
      active.check();
      return result;
    } catch {
      active.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
  } catch (error) {
    let stopped = error;
    try {
      budget?.check();
    } catch (expired) {
      stopped = expired;
    }
    const envelope = stopped instanceof ContractError ? stopped.envelope : undefined;
    throw fail(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget?.close();
  }
}
