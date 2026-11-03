import {
  ContractError,
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';

export function prepareArtifactReceipt(
  input: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): ArtifactReceiptQuery {
  try {
    if (key !== undefined)
      throw new TypeError('Artifact receipts use the original command.request_key without --key');
    const query = parseArtifactReceiptQuery(input);
    if (
      query.identity.tenant_id !== scope.tenant_id ||
      query.identity.workspace_id !== scope.workspace_id ||
      query.identity.project_id !== scope.project_id
    )
      throw new TypeError('The original artifact request belongs to another project');
    return query;
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original artifact request',
      {
        trace_id: trace,
      },
    );
  }
}

export function artifactReceiptResult(value: unknown, query: ArtifactReceiptQuery, trace: string) {
  try {
    return parseArtifactReceiptEnvelope(value, query, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The original artifact receipt could not be confirmed. Keep the original identity, parameters and key.',
      {
        trace_id: trace,
      },
    );
  }
}
