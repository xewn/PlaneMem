import {
  ARTIFACT_VERSIONS_RESPONSE_BYTES,
  ContractError,
  parseArtifactCommandIdentity,
  parseArtifactVersionsQuery,
  parseArtifactVersionsEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

const activeReads = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply an artifact ID and valid version pagination; preserve the complete next_query',
  DENIED: 'Use a verified unexpired client with actual artifact.read capability',
  UNAUTHENTICATED: 'Renew the matching session before listing artifact versions',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read the selected artifact history',
  ARTIFACT_NOT_FOUND: 'The artifact is unavailable in this project',
  ARTIFACT_LEGACY_UNVERIFIED: 'The selected history lacks a verified metadata snapshot',
  ARTIFACT_STORED_INVALID: 'Stored artifact history could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact version directory storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The artifact directory read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_ARTIFACT_VERSIONS_BUSY: 'MCP artifact version read capacity is occupied',
  MCP_ARTIFACT_VERSIONS_TIMEOUT:
    'Stopped waiting for artifact versions; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete version page did not match the query or exceeded its size limit',
};
function fail(code: string, trace: string) {
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: {
      read_kind: 'versions',
      content_state: 'not-checked',
      upload_dispatch_state: 'not-sent',
    },
  });
}

export function canReadArtifactVersionsTool(context: RequestContext): boolean {
  try {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.schema_version !== 1 ||
      context.authenticated_client !== true ||
      !context.capability.includes('artifact.read') ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    )
      return false;
    parseArtifactCommandIdentity({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
    });
    return (
      typeof context.trace_id === 'string' &&
      !!context.trace_id.trim() &&
      context.trace_id.length <= 1024 &&
      !/[\u0000-\u001f\u007f\p{Cs}]/u.test(context.trace_id)
    );
  } catch {
    return false;
  }
}

export function prepareArtifactVersionsTool(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  if (!canReadArtifactVersionsTool(context)) throw fail('DENIED', context.trace_id);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  try {
    const query = parseArtifactVersionsQuery(raw);
    // Internal ApiGateway receives query fields as body; public HTTP uses URL parameters.
    return {
      method: 'GET',
      path: '/v1/artifacts/' + encodeURIComponent(query.artifact_id) + '/versions',
      headers: {},
      body: { ...query },
      context,
    };
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
}

/** Bound local waiting and retain occupied capacity until the underlying read actually settles. */
export async function executeArtifactVersionsTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_ARTIFACT_VERSIONS_TIMEOUT', trace);
    if (!canReadArtifactVersionsTool(context)) throw fail('DENIED', trace);
  };
  active();
  const request = prepareArtifactVersionsTool(raw, context);
  const query = parseArtifactVersionsQuery(request.body);
  active();
  let gate = activeReads.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_ARTIFACT_VERSIONS_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const response = await api.handle(structuredClone(request));
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
        syncJsonSnapshot(
          response.body,
          response.status >= 400 ? 16 * 1024 : ARTIFACT_VERSIONS_RESPONSE_BYTES,
        ),
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
      const envelope = parseArtifactVersionsEnvelope(value, query, context, trace);
      if (
        !context.capability.includes('data.restricted.read') &&
        envelope.data.items.some((item) => item.classification === 'restricted')
      )
        throw fail('ARTIFACT_ACCESS_DENIED', trace);
      active();
      const text = syncJsonSnapshot(envelope, ARTIFACT_VERSIONS_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * ARTIFACT_VERSIONS_RESPONSE_BYTES + 4096);
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
          () => reject(fail('MCP_ARTIFACT_VERSIONS_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
