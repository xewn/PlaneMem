import {
  ContractError,
  CONTEXT_PACK_SAVE_CONTEXT_BYTES,
  parseContextPackSaveContextEnvelope,
  type ContextPackSaveContextEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackSaveContextOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the original project, optional account/client constraints and valid read options',
  DENIED: 'A verified unexpired context reader is required',
  UNAUTHENTICATED: 'Sign in with the intended account and client to read save identity',
  CONTEXT_PACK_SAVE_CONTEXT_INVALID: 'The verified save identity could not be represented',
  RATE_LIMITED: 'Context pack save identity reads are temporarily busy',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The save identity read audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for context pack save identity',
  GATEWAY_REQUEST_TIMEOUT: 'Context pack save identity exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete save identity differs from the original request or expired',
  GATEWAY_UNAVAILABLE: 'Context pack save identity could not be read',
};

/** Read current authority only. Callers must retain an existing request's original binding. */
export async function readContextPackSaveContext(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpContextPackSaveContextOptions,
): Promise<ContextPackSaveContextEnvelope> {
  let trace = 'trace_unknown';
  let budget: RequestBudget | undefined;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
    });
  try {
    let settings: ReturnType<typeof captureContextRead>;
    try {
      settings = captureContextRead(original, options);
      trace = settings.context.trace_id;
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT');
    }
    const activeBudget = budget;
    const { context } = settings;
    activeBudget.check();
    const raw = await activeBudget.wait(() =>
      transport.request({
        method: 'GET',
        path: '/v1/context-pack/save-context',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_PACK_SAVE_CONTEXT_BYTES,
        signal: activeBudget.signal,
      }),
    );
    activeBudget.check();
    let result: ContextPackSaveContextEnvelope;
    try {
      result = parseContextPackSaveContextEnvelope(raw, context, trace);
      if (Date.parse(result.data.expires_at) <= Date.now()) throw new TypeError();
    } catch {
      activeBudget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    activeBudget.check();
    return result;
  } catch (error) {
    let failure = error;
    try {
      budget?.check();
    } catch (stopped) {
      failure = stopped;
    }
    const envelope = failure instanceof ContractError ? failure.envelope : undefined;
    throw fail(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget?.close();
  }
}
