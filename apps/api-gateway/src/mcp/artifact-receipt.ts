import {
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareArtifactReceiptTool(input: unknown, context: RequestContext): HttpRequest {
  if (context.authenticated_client !== true || !context.capability.includes('artifact.write'))
    throw new ContractError('DENIED', 'A verified artifact writer is required', {
      trace_id: context.trace_id,
    });
  let query;
  try {
    query = parseArtifactReceiptQuery(input);
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply only the saved artifact identity and complete original command',
      {
        trace_id: context.trace_id,
      },
    );
  }
  try {
    assertArtifactReceiptIdentity(query.identity, context);
  } catch {
    throw new ContractError(
      'DENIED',
      'The original artifact identity differs from the verified session',
      {
        trace_id: context.trace_id,
      },
    );
  }
  const clean = { ...context, capability: [...context.capability] };
  delete clean.idempotency_key;
  delete clean.expected_version;
  return {
    method: 'POST',
    path: '/v1/artifacts/receipt',
    body: { ...query },
    headers: { 'content-type': 'application/json' },
    context: clean,
  };
}

export function artifactReceiptToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/artifacts/receipt' ||
      request.context.authenticated_client !== true ||
      !request.context.capability.includes('artifact.write') ||
      request.context.idempotency_key !== undefined ||
      request.context.expected_version !== undefined ||
      ['idempotency-key', 'if-match', 'if-match-version'].some(
        (name) => request.headers[name] !== undefined,
      )
    )
      throw new TypeError();
    const query = parseArtifactReceiptQuery(request.body);
    assertArtifactReceiptIdentity(query.identity, request.context);
    return parseArtifactReceiptEnvelope(value, query, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The original artifact receipt could not be confirmed. Keep the original identity, parameters and key.',
      {
        trace_id: request.context.trace_id,
      },
    );
  }
}
