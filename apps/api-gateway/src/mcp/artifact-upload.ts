import { createHash } from 'node:crypto';
import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactReceiptQuery,
  parseArtifactUploadEnvelope,
  validateErrorEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { ArtifactUploadGate } from '../artifact-upload.js';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export const MCP_ARTIFACT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const MCP_ARTIFACT_UPLOAD_BASE64_CHARS = 4 * Math.ceil(MCP_ARTIFACT_UPLOAD_MAX_BYTES / 3);
export const MCP_ARTIFACT_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;
const embeddedGates = new WeakMap<ApiGateway, ArtifactUploadGate>();

export interface McpArtifactUploadOptions {
  gate?: ArtifactUploadGate;
  /** Trusted HTTP adapter may transfer its same-gate body-reading reservation exactly once. */
  takeReservation?: () => (() => void) | undefined;
}

/** Embedded and HTTP preparation/upload calls share the same two-operation budget. */
export function artifactUploadToolGate(api: ApiGateway, options: McpArtifactUploadOptions) {
  let gate = options.gate ?? embeddedGates.get(api);
  if (!gate) {
    gate = new ArtifactUploadGate(MCP_ARTIFACT_UPLOAD_MAX_BYTES);
    embeddedGates.set(api, gate);
  }
  return gate;
}

export function isArtifactUploadTool(name: unknown): boolean {
  return name === 'create_artifact' || name === 'put_artifact_version';
}

export function canUploadArtifactTool(context: RequestContext): boolean {
  const expires = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    context.capability.includes('artifact.write') &&
    Number.isFinite(expires) &&
    expires > Date.now()
  );
}

export function prepareArtifactUploadTool(
  name: string,
  input: unknown,
  original: RequestContext,
  maximum = MCP_ARTIFACT_UPLOAD_MAX_BYTES,
): HttpRequest {
  const context = {
    ...original,
    capability: [...original.capability],
    roles: [...(original.roles ?? [])],
  };
  const fail = (code: string, message: string) =>
    new ContractError(code, message, {
      trace_id: context.trace_id,
      dispatch_state: 'not-sent',
    });
  if (!isArtifactUploadTool(name)) throw fail('MCP_TOOL_NOT_FOUND', 'MCP upload tool not found');
  if (!canUploadArtifactTool(context))
    throw fail('DENIED', 'A verified artifact writer with a valid session is required');
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw fail('INVALID_INPUT', 'Invalid MCP upload byte limit');
  let query: ArtifactReceiptQuery;
  let encoded: string;
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['request', 'content_base64'].includes(key))
    )
      throw new TypeError();
    const row = input as Record<string, unknown>;
    query = parseArtifactReceiptQuery(row.request);
    if (
      query.command.operation !==
        (name === 'create_artifact' ? 'artifact.create' : 'artifact.put-version') ||
      Buffer.byteLength(JSON.stringify(query), 'utf8') > ARTIFACT_UPLOAD_REQUEST_BYTES ||
      typeof row.content_base64 !== 'string' ||
      row.content_base64.length > MCP_ARTIFACT_UPLOAD_BASE64_CHARS
    )
      throw new TypeError();
    encoded = row.content_base64;
  } catch {
    throw fail(
      'INVALID_INPUT',
      'Supply only the saved request identity/command and bounded content_base64 matching this operation',
    );
  }
  try {
    assertArtifactReceiptIdentity(query.identity, context);
  } catch {
    throw fail('DENIED', 'The saved artifact identity differs from the verified writer');
  }
  if (query.command.size > Math.min(MCP_ARTIFACT_UPLOAD_MAX_BYTES, maximum))
    throw fail(
      'ARTIFACT_TOO_LARGE',
      'MCP uploads are limited to 4 MiB and the configured upload limit; use multipart HTTP/CLI upload for larger content',
    );
  if (encoded.length !== 4 * Math.ceil(query.command.size / 3))
    throw fail('INVALID_INPUT', 'Base64 length differs from the original content size');
  // Native decoding is permissive; a round trip rejects whitespace, URL alphabet, missing padding and nonzero pad bits.
  const content = Buffer.from(encoded, 'base64');
  if (
    content.byteLength !== query.command.size ||
    content.toString('base64') !== encoded ||
    createHash('sha256').update(content).digest('hex') !== query.command.sha256
  )
    throw fail(
      'INVALID_INPUT',
      'Content must be canonical Base64 with the exact saved length and SHA-256',
    );
  delete context.idempotency_key;
  delete context.expected_version;
  context.idempotency_key = query.command.request_key;
  if (query.command.operation === 'artifact.put-version')
    context.expected_version = query.command.expected_version;
  return {
    method: 'POST',
    path:
      query.command.operation === 'artifact.create'
        ? '/v1/artifacts'
        : '/v1/artifacts/' + encodeURIComponent(query.command.artifact_id) + '/versions',
    body: { request: parseArtifactReceiptQuery(query), content: new Uint8Array(content) },
    headers: { 'idempotency-key': query.command.request_key },
    context,
  };
}

export async function executeArtifactUploadTool(
  api: ApiGateway,
  name: string,
  input: unknown,
  context: RequestContext,
  options: McpArtifactUploadOptions = {},
) {
  const trace = context.trace_id;
  // Capture capability and identity before the first asynchronous dependency.
  const fixed = {
    ...context,
    capability: [...context.capability],
    roles: [...(context.roles ?? [])],
  };
  const gate = artifactUploadToolGate(api, options);
  let release: (() => void) | undefined;
  let dispatched = false;
  try {
    if (!canUploadArtifactTool(fixed))
      throw new ContractError(
        'DENIED',
        'A verified artifact writer with a valid session is required',
        { trace_id: trace },
      );
    release = options.takeReservation?.() ?? gate.acquire(trace);
    const request = prepareArtifactUploadTool(name, input, fixed, gate.maxBytes);
    const query = parseArtifactReceiptQuery(request.body?.request);
    dispatched = true;
    const response = await api.handle(request);
    if (response.status >= 400) {
      const error = validateErrorEnvelope(response.body);
      throw new ContractError(error.code, error.message, error);
    }
    if (response.status !== 200) throw new TypeError();
    const saved = parseArtifactUploadEnvelope(response.body, query, trace);
    return { content: [{ type: 'text', text: JSON.stringify(saved) }] };
  } catch (error) {
    const envelope = error instanceof ContractError ? error.envelope : undefined;
    const details = { ...envelope?.details };
    // The adapter owns these states; upstream errors cannot claim a contradictory outcome.
    delete details.dispatch_state;
    delete details.artifact_outcome;
    throw new ContractError(
      envelope?.code ?? 'GATEWAY_RESPONSE_INVALID',
      envelope?.message ??
        'Artifact upload could not be confirmed; keep the original request and content',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...details,
          ...(dispatched ? { artifact_outcome: 'unconfirmed' } : { dispatch_state: 'not-sent' }),
          recovery:
            'Keep the original request JSON and exact content. Use get_artifact_receipt with its unchanged identity and command; do not replace the request_key or expected_version. A preflight failure only describes this invocation, not earlier attempts.',
        },
      },
    );
  } finally {
    release?.();
  }
}
