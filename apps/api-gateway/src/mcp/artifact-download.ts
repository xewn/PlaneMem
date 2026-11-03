import { createHash } from 'node:crypto';
import {
  ContractError,
  parseArtifactDownloadQuery,
  parseArtifactDownloadEnvelope,
  validateErrorEnvelope,
  type ArtifactDownloadQuery,
} from '@planemem/contracts';
import { ArtifactDownloadGate } from '../artifact-downloads.js';
import type { ArtifactDownloadObserver } from '../artifact-download-audit.js';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

// JSON/base64 expands the payload; larger artifacts use the existing binary HTTP endpoint.
export const MCP_ARTIFACT_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024;
const embeddedGates = new WeakMap<ApiGateway, ArtifactDownloadGate>();

export interface McpArtifactDownloadOptions {
  gate?: ArtifactDownloadGate;
  /** A trusted HTTP adapter holds the lease until its serialized reply finishes or closes. */
  retain?: (
    release: () => void,
    receipt: { query: ArtifactDownloadQuery; release_audit_id: string },
  ) => void;
  observe?: ArtifactDownloadObserver;
}

export function canDownloadArtifactTool(context: RequestContext): boolean {
  const expires = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    context.capability.includes('artifact.read') &&
    Number.isFinite(expires) &&
    expires > Date.now()
  );
}

function path(query: ArtifactDownloadQuery): string {
  return (
    '/v1/artifacts/' +
    encodeURIComponent(query.artifact_id) +
    '/versions/' +
    query.version +
    '/content'
  );
}

export function prepareArtifactDownloadTool(input: unknown, original: RequestContext): HttpRequest {
  const context = {
    ...original,
    capability: [...original.capability],
    roles: [...(original.roles ?? [])],
  };
  if (!canDownloadArtifactTool(context))
    throw new ContractError(
      'DENIED',
      'Artifact downloads require a verified reader with a valid session',
      {
        trace_id: context.trace_id,
      },
    );
  let query;
  try {
    query = parseArtifactDownloadQuery(input);
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply only artifact_id, version, sha256 and size from the selected historical metadata',
      {
        trace_id: context.trace_id,
      },
    );
  }
  if (query.size > MCP_ARTIFACT_DOWNLOAD_MAX_BYTES)
    throw new ContractError(
      'ARTIFACT_TOO_LARGE',
      'MCP embedded downloads are limited to 4 MiB; use the HTTP or CLI download for larger content',
      {
        trace_id: context.trace_id,
      },
    );
  delete context.idempotency_key;
  delete context.expected_version;
  return {
    method: 'GET',
    path: path(query),
    headers: {},
    context,
    body: { ...query, version: String(query.version), size: String(query.size) },
  };
}

function queryFromRequest(request: HttpRequest): ArtifactDownloadQuery {
  const body = request.body;
  if (
    !body ||
    typeof body.version !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(body.version) ||
    typeof body.size !== 'string' ||
    !/^(0|[1-9][0-9]{0,15})$/.test(body.size) ||
    request.method !== 'GET' ||
    Object.keys(request.headers).length !== 0 ||
    request.context.idempotency_key !== undefined ||
    request.context.expected_version !== undefined
  )
    throw new TypeError();
  const query = parseArtifactDownloadQuery({
    ...body,
    version: Number(body.version),
    size: Number(body.size),
  });
  if (request.path !== path(query)) throw new TypeError();
  return query;
}

/** Binary results never enter the generic JSON.stringify(CommandResult) path. */
export async function executeArtifactDownloadTool(
  api: ApiGateway,
  prepared: HttpRequest,
  options: McpArtifactDownloadOptions = {},
) {
  const request = structuredClone(prepared);
  const trace = request.context.trace_id;
  let query;
  try {
    query = queryFromRequest(request);
  } catch {
    throw new ContractError('INVALID_INPUT', 'Invalid pinned artifact download request', {
      trace_id: trace,
    });
  }
  // Prepare again from the immutable snapshot, so direct adapter calls enforce the same boundaries.
  const dispatch = prepareArtifactDownloadTool(query, request.context);
  let gate = options.gate ?? embeddedGates.get(api);
  if (!gate) {
    gate = new ArtifactDownloadGate(MCP_ARTIFACT_DOWNLOAD_MAX_BYTES);
    embeddedGates.set(api, gate);
  }
  if (query.size > gate.maxBytes)
    throw new ContractError(
      'ARTIFACT_TOO_LARGE',
      'Artifact exceeds the configured download byte limit',
      { trace_id: trace },
    );
  const retain = options.retain;
  const release = gate.acquire(trace);
  let retained = false;
  let auditId: string | undefined;
  try {
    const response = await api.handle(dispatch);
    if (response.status >= 400) {
      const error = validateErrorEnvelope(response.body);
      throw new ContractError(error.code, error.message, error);
    }
    if (response.status !== 200) throw new TypeError();
    const delivery = parseArtifactDownloadEnvelope(response.body, query, request.context, trace);
    auditId = delivery.data.audit_id;
    if (createHash('sha256').update(delivery.data.content).digest('hex') !== query.sha256)
      throw new TypeError();
    const { content, ...data } = delivery.data;
    const uri = 'urn:sha256:' + query.sha256;
    const summary = {
      schema_version: 1,
      trace_id: trace,
      source_refs: delivery.source_refs,
      data: {
        ...data,
        resource_uri: uri,
        client_delivery_state: 'not-confirmed',
        content_trust: 'untrusted-reference',
      },
    };
    const result = {
      content: [
        { type: 'text', text: JSON.stringify(summary) },
        {
          type: 'resource',
          resource: {
            uri,
            mimeType: 'application/octet-stream',
            blob: Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString(
              'base64',
            ),
          },
        },
      ],
    };
    if (retain) {
      retain(release, { query: { ...query }, release_audit_id: auditId });
      retained = true;
    }
    return result;
  } catch (error) {
    if (auditId && !retained) {
      try {
        await options.observe?.(request.context, query, {
          kind: 'failure',
          stage: 'adapter-validation',
          release_audit_id: auditId,
        });
      } catch {
        // Supplemental audit failure never replaces the adapter's original failure.
      }
    }
    const envelope = error instanceof ContractError ? error.envelope : undefined;
    throw new ContractError(
      envelope?.code ?? 'GATEWAY_RESPONSE_INVALID',
      envelope?.message ??
        'Artifact download response failed validation; no embedded bytes were returned',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...envelope?.details,
          audit_state: auditId ? 'release-recorded' : 'unconfirmed',
          ...(auditId ? { audit_id: auditId } : {}),
          client_delivery_state: 'not-confirmed',
        },
      },
    );
  } finally {
    if (!retained) release();
  }
}
