import {
  ContractError,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';

export function isArtifactReadTool(name: string) {
  return name === 'get_artifact' || name === 'get_artifact_version';
}

export function artifactReadToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    const query = parseArtifactReadQuery(request.body);
    if (
      !isArtifactReadTool(name) ||
      (name === 'get_artifact_version') !== (query.version !== undefined) ||
      request.method !== 'GET' ||
      request.path !==
        '/v1/artifacts/' +
          encodeURIComponent(query.artifact_id) +
          (query.version === undefined ? '' : '/versions/' + query.version)
    )
      throw new TypeError();
    return parseArtifactReadEnvelope(value, query, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested artifact metadata snapshot',
      { trace_id: request.context.trace_id },
    );
  }
}
