import {
  ContractError,
  compareArtifactMetadata,
  parseArtifactCommandIdentity,
  parseArtifactComparisonQuery,
  type ArtifactCommandIdentity,
  type ArtifactComparisonQuery,
  type ArtifactMetadataComparison,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import {
  captureArtifactReadOptions,
  readArtifactMetadata,
  type WcpArtifactReadOptions,
} from './artifact-reads.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactComparisonResult {
  schema_version: 1;
  kind: 'artifact-version-comparison';
  comparison_origin: 'local';
  read_consistency: 'separate-reads';
  content_state: 'not-checked';
  query: ArtifactComparisonQuery;
  identity_constraints: ArtifactCommandIdentity;
  from: Awaited<ReturnType<typeof readArtifactMetadata>>;
  to: Awaited<ReturnType<typeof readArtifactMetadata>>;
  comparison: ArtifactMetadataComparison;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply two different saved versions, a complete project/account/client context and valid read options',
  DENIED: 'The current verified session cannot read both selected versions',
  UNAUTHENTICATED: 'Renew the matching session before comparing saved versions',
  ARTIFACT_ACCESS_DENIED: 'The configured account or client cannot read both selected versions',
  ARTIFACT_NOT_FOUND: 'The selected file is unavailable in this project',
  ARTIFACT_VERSION_NOT_FOUND: 'A selected saved version is unavailable',
  ARTIFACT_LEGACY_UNVERIFIED: 'A selected version lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Stored version metadata could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Version metadata storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The version read audit could not be persisted',
  RATE_LIMITED: 'Version reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the version comparison',
  GATEWAY_REQUEST_TIMEOUT: 'The complete version comparison exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID: 'The complete saved records did not match the selected comparison',
  GATEWAY_UNAVAILABLE: 'The selected versions could not be compared',
};
function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: {
      read_kind: 'comparison',
      comparison_state: 'not-completed',
      content_state: 'not-checked',
      upload_dispatch_state: 'not-sent',
    },
  });
}

/** Compose two fixed historical reads; never substitutes current metadata or emits a partial pair. */
export async function compareArtifactVersions(
  transport: WcpTransport,
  originalContext: RequestContext,
  input: ArtifactComparisonQuery,
  options: WcpArtifactReadOptions,
): Promise<WcpArtifactComparisonResult> {
  const context = { ...originalContext };
  const trace = context.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let query: ArtifactComparisonQuery;
    let identity: ArtifactCommandIdentity;
    let settings: ReturnType<typeof captureArtifactReadOptions>;
    try {
      if (
        typeof trace !== 'string' ||
        !trace.trim() ||
        trace.length > 1024 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace)
      )
        throw new TypeError();
      settings = captureArtifactReadOptions(options);
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
      budget.check();
      query = parseArtifactComparisonQuery(input);
      identity = parseArtifactCommandIdentity({
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      });
      // Both reads carry equality constraints even if a transport refreshes its credentials.
      delete context.idempotency_key;
      delete context.expected_version;
      delete context.if_match;
    } catch {
      budget?.check();
      throw failure('INVALID_INPUT', trace);
    }
    const activeBudget = budget;
    const read = (version: number) =>
      activeBudget.wait(() =>
        readArtifactMetadata(
          transport,
          context,
          { artifact_id: query.artifact_id, version },
          { timeout_ms: settings.timeout, signal: activeBudget.signal },
        ),
      );
    const from = await read(query.from_version);
    activeBudget.check();
    const to = await read(query.to_version);
    activeBudget.check();
    let comparison: ArtifactMetadataComparison;
    try {
      comparison = compareArtifactMetadata(from.data.artifact, to.data.artifact);
    } catch {
      activeBudget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    activeBudget.check();
    return {
      schema_version: 1,
      kind: 'artifact-version-comparison',
      comparison_origin: 'local',
      read_consistency: 'separate-reads',
      content_state: 'not-checked',
      query,
      identity_constraints: identity,
      from,
      to,
      comparison,
    };
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}
