import {
  ContractError,
  parseConflictRegistryQuery,
  parseConflictRegistryEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareConflictRegistry(input: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  try {
    const query = parseConflictRegistryQuery(input);
    return { method: 'GET', path: '/v1/conflicts', headers: {}, body: { ...query }, context };
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply valid conflict filters and an unchanged cursor',
      { trace_id: context.trace_id },
    );
  }
}

export function conflictRegistryToolResult(value: unknown, request: HttpRequest) {
  try {
    if (request.method !== 'GET' || request.path !== '/v1/conflicts') throw new TypeError();
    const query = parseConflictRegistryQuery(request.body);
    return parseConflictRegistryEnvelope(value, query, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the complete requested conflict page',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
