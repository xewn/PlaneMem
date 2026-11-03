import {
  ContractError,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
  type ArtifactReadQuery,
} from '@planemem/contracts';

export function isArtifactReadCommand(command: string) {
  return command === 'artifacts get' || command === 'artifacts version';
}

export function prepareArtifactRead(command: string, input: unknown, trace: string, key?: string) {
  if (!isArtifactReadCommand(command)) return;
  try {
    if (key !== undefined) throw new TypeError('Artifact reads do not accept --key');
    const query = parseArtifactReadQuery(input);
    if ((command === 'artifacts version') !== (query.version !== undefined))
      throw new TypeError('Only artifacts version requires a version field');
    return query;
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid artifact read query',
      { trace_id: trace },
    );
  }
}

export function artifactReadResult(
  value: unknown,
  query: ArtifactReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  try {
    return parseArtifactReadEnvelope(value, query, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested artifact metadata snapshot',
      { trace_id: trace },
    );
  }
}
