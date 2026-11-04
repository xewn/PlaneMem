import {
  ARTIFACT_REGISTRY_RESPONSE_BYTES,
  ContractError,
  parseArtifactCommandIdentity,
  parseArtifactRegistryQuery,
  parseArtifactRegistryEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

const activeReads = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid file filters and page settings; preserve the complete next_query or restart without a cursor',
  DENIED: 'Use a verified unexpired client with actual artifact.read capability',
  UNAUTHENTICATED: 'Renew the matching session before listing project files',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read the selected project files',
  ARTIFACT_NOT_FOUND: 'The project is unavailable to this account',
  ARTIFACT_LEGACY_UNVERIFIED: 'The selected files lack a verified metadata snapshot',
  ARTIFACT_STORED_INVALID: 'Stored file directory records could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Project file directory storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The file directory read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_ARTIFACT_REGISTRY_BUSY: 'MCP project file read capacity is occupied',
  MCP_ARTIFACT_REGISTRY_TIMEOUT:
    'Stopped waiting for project files; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete file page did not match the query or exceeded its size limit',
};
function fail(code: string, trace: string) {
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: {
      read_kind: 'registry',
      content_state: 'not-checked',
      upload_dispatch_state: 'not-sent',
    },
  });
}

export function canReadArtifactRegistryTool(context: RequestContext): boolean {
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

export function prepareArtifactRegistryTool(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  if (!canReadArtifactRegistryTool(context)) throw fail('DENIED', context.trace_id);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  let query;
  try {
    query = parseArtifactRegistryQuery(raw);
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
  if (query.classification === 'restricted' && !context.capability.includes('data.restricted.read'))
    throw fail('ARTIFACT_ACCESS_DENIED', context.trace_id);
  // Internal ApiGateway receives query fields as body; public HTTP uses URL parameters.
  return {
    method: 'GET',
    path: '/v1/artifacts',
    headers: {},
    body: { ...query },
    context,
  };
}

/** Local timeout never releases capacity while the underlying directory read is still running. */
export async function executeArtifactRegistryTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_ARTIFACT_REGISTRY_TIMEOUT', trace);
    if (!canReadArtifactRegistryTool(context)) throw fail('DENIED', trace);
  };
  active();
  const request = prepareArtifactRegistryTool(raw, context);
  const query = parseArtifactRegistryQuery(request.body);
  active();
  let gate = activeReads.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_ARTIFACT_REGISTRY_BUSY', trace);
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
          response.status >= 400 ? 16 * 1024 : ARTIFACT_REGISTRY_RESPONSE_BYTES,
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
      const envelope = parseArtifactRegistryEnvelope(value, query, context, trace);
      if (
        !context.capability.includes('data.restricted.read') &&
        envelope.data.items.some((item) => item.classification === 'restricted')
      )
        throw fail('ARTIFACT_ACCESS_DENIED', trace);
      active();
      const text = syncJsonSnapshot(envelope, ARTIFACT_REGISTRY_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * ARTIFACT_REGISTRY_RESPONSE_BYTES + 4096);
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
          () => reject(fail('MCP_ARTIFACT_REGISTRY_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
