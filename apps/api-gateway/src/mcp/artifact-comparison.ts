import {
  ContractError,
  compareArtifactMetadata,
  parseArtifactCommandIdentity,
  parseArtifactComparisonQuery,
  parseArtifactReadEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { ApiGateway } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadArtifactVersionsTool } from './artifact-versions.js';

export const canCompareArtifactVersionsTool = canReadArtifactVersionsTool;
const activeComparisons = new WeakMap<ApiGateway, { active: number }>();
const metadataBytes = 2 * 1024 * 1024;
const resultBytes = 8 * 1024 * 1024;
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply one artifact ID and two different positive safe saved versions',
  DENIED: 'Use a verified unexpired client with actual artifact.read capability',
  UNAUTHENTICATED: 'Renew the matching session before comparing saved versions',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read both selected versions',
  ARTIFACT_NOT_FOUND: 'The selected file is unavailable in this project',
  ARTIFACT_VERSION_NOT_FOUND: 'A selected saved version is unavailable',
  ARTIFACT_LEGACY_UNVERIFIED: 'A selected version lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Stored version metadata could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Version metadata storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The version read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_ARTIFACT_COMPARISON_BUSY: 'MCP artifact comparison capacity is occupied',
  MCP_ARTIFACT_COMPARISON_TIMEOUT:
    'Stopped waiting for the comparison; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete saved records or comparison did not match the query or exceeded their size limits',
};
function fail(code: string, trace: string) {
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

/** Two fixed reads, one local deadline; timed-out reads retain capacity until settlement. */
export async function executeArtifactComparisonTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_ARTIFACT_COMPARISON_TIMEOUT', trace);
    if (!canCompareArtifactVersionsTool(context)) throw fail('DENIED', trace);
  };
  active();
  let query: ReturnType<typeof parseArtifactComparisonQuery>;
  try {
    query = parseArtifactComparisonQuery(raw);
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  const identity = parseArtifactCommandIdentity({
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
    actor_id: context.actor_id,
    client_id: context.client_id,
  });
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  active();
  let gate = activeComparisons.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeComparisons.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_ARTIFACT_COMPARISON_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      const read = async (version: number) => {
        active();
        const selected = { artifact_id: query.artifact_id, version };
        const response = await api.handle({
          method: 'GET',
          path: '/v1/artifacts/' + encodeURIComponent(query.artifact_id) + '/versions/' + version,
          headers: {},
          body: { ...selected },
          context: structuredClone(context),
        });
        active();
        if (
          response.headers['x-trace-id'] !== trace ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            response.headers['content-type'] ?? '',
          ) ||
          response.headers.etag !== undefined
        )
          throw fail('GATEWAY_RESPONSE_INVALID', trace);
        const value: unknown = JSON.parse(
          syncJsonSnapshot(response.body, response.status >= 400 ? 16 * 1024 : metadataBytes),
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
        const envelope = parseArtifactReadEnvelope(value, selected, context, trace);
        if (
          envelope.data.artifact.classification === 'restricted' &&
          !context.capability.includes('data.restricted.read')
        )
          throw fail('ARTIFACT_ACCESS_DENIED', trace);
        active();
        return envelope;
      };
      const from = await read(query.from_version);
      const to = await read(query.to_version);
      active();
      const comparison = compareArtifactMetadata(from.data.artifact, to.data.artifact);
      active();
      const text = syncJsonSnapshot(
        {
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
        },
        resultBytes,
      );
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * resultBytes + 4096);
      active();
      return result;
    } catch (error) {
      let failure = error;
      try {
        active();
      } catch (stopped) {
        failure = stopped;
      }
      throw fail(
        failure instanceof ContractError &&
          failure.envelope.trace_id === trace &&
          Object.hasOwn(messages, failure.envelope.code)
          ? failure.envelope.code
          : 'GATEWAY_RESPONSE_INVALID',
        trace,
      );
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
          () => reject(fail('MCP_ARTIFACT_COMPARISON_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
