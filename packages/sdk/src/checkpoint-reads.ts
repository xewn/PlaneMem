import {
  ContractError,
  CHECKPOINT_DETAIL_RESPONSE_BYTES,
  CHECKPOINT_HISTORY_RESPONSE_BYTES,
  parseCheckpointReadQuery,
  parseCheckpointReadEnvelope,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryEnvelope,
  parseCheckpointHistoryWorkbenchEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpCheckpointReadOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply valid checkpoint identifiers, project scope and timeout/signal options',
  DENIED: 'The current session cannot read checkpoints in this project',
  UNAUTHENTICATED: 'The current session must be renewed',
  RATE_LIMITED: 'Gateway capacity is occupied',
  SESSION_NOT_FOUND: 'Session is unavailable in this project',
  CHECKPOINT_NOT_FOUND: 'Checkpoint is unavailable in this session',
  CHECKPOINT_READ_TOO_LARGE:
    'Checkpoint content exceeds the complete read limit; no partial content was returned',
  SESSION_ACTIVITY_INVALID: 'Stored checkpoint content could not be validated',
  SESSION_STORAGE_UNAVAILABLE: 'Checkpoint storage is unavailable',
  WORKBENCH_DATABASE_UNAVAILABLE: 'Checkpoint history storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for checkpoint content',
  GATEWAY_REQUEST_TIMEOUT: 'Checkpoint content exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete checkpoint response did not match this request or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'Checkpoint content could not be read',
};

async function read<T>(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpCheckpointReadOptions,
  prepare: (context: RequestContext) => {
    path: string;
    body?: unknown;
    maximum: number;
    parse: (value: unknown) => T;
  },
): Promise<T> {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let request;
  try {
    if (
      !context.project_id ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
    )
      throw new TypeError();
    request = prepare(context);
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
        method: request.body === undefined ? 'GET' : 'POST',
        path: request.path,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id!,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        ...(request.body === undefined ? {} : { body: request.body }),
        response_type: 'bounded-json',
        max_response_bytes: request.maximum,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = request.parse(raw);
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

export function readCheckpointDetail(
  transport: WcpTransport,
  context: RequestContext,
  input: unknown,
  options: WcpCheckpointReadOptions,
) {
  return read(transport, context, options, (snapshot) => {
    const query = parseCheckpointReadQuery(input);
    return {
      path: '/v1/sessions/' + query.session_id + '/checkpoints/' + query.checkpoint_id,
      maximum: CHECKPOINT_DETAIL_RESPONSE_BYTES,
      parse: (value: unknown) =>
        parseCheckpointReadEnvelope(value, query, snapshot, snapshot.trace_id),
    };
  });
}
export function readCheckpointHistory(
  transport: WcpTransport,
  context: RequestContext,
  input: unknown,
  options: WcpCheckpointReadOptions,
) {
  return read(transport, context, options, (snapshot) => {
    const query = parseCheckpointHistoryQuery(input);
    const search =
      query.before_revision === undefined ? '' : '?before_revision=' + query.before_revision;
    return {
      path: '/v1/sessions/' + query.session_id + '/checkpoints' + search,
      maximum: CHECKPOINT_HISTORY_RESPONSE_BYTES,
      parse: (value: unknown) =>
        parseCheckpointHistoryEnvelope(value, query, snapshot, snapshot.trace_id),
    };
  });
}
export function readWorkbenchCheckpointHistory(
  transport: WcpTransport,
  context: RequestContext,
  input: unknown,
  options: WcpCheckpointReadOptions,
) {
  return read(transport, context, options, (snapshot) => {
    const query = parseCheckpointHistoryQuery(input);
    return {
      path: '/v1/workbench/query',
      body: { ...query, operation: 'checkpoints' },
      maximum: CHECKPOINT_HISTORY_RESPONSE_BYTES,
      parse: (value: unknown) => {
        const result = parseCheckpointHistoryWorkbenchEnvelope(
          value,
          query,
          snapshot,
          snapshot.trace_id,
        );
        if (
          (snapshot.actor_id !== undefined &&
            result.session_identity?.actor_id !== snapshot.actor_id) ||
          (snapshot.client_id !== undefined &&
            result.session_identity?.client_id !== snapshot.client_id)
        )
          throw new TypeError();
        return result;
      },
    };
  });
}
