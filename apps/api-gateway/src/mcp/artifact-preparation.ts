import { createHash } from 'node:crypto';
import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  createUlid,
  parseArtifactReadEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactUploadDraft,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ArtifactReceiptQuery,
  type ArtifactUploadDraft,
} from '@planemem/contracts';
import {
  artifactUploadContextAuthority,
  artifactUploadContextResult,
} from '../artifact-upload-context.js';
import type { ApiGateway } from '../http.js';
import type { RequestContext } from '../router.js';
import {
  MCP_ARTIFACT_UPLOAD_BASE64_CHARS,
  MCP_ARTIFACT_UPLOAD_BODY_BYTES,
  MCP_ARTIFACT_UPLOAD_MAX_BYTES,
  artifactUploadToolGate,
  type McpArtifactUploadOptions,
} from './artifact-upload.js';

const RESULT_BYTES = 3 * ARTIFACT_UPLOAD_REQUEST_BYTES + 16 * 1024;
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply only a new draft and canonical content_base64 without original identity, keys, hash/size or inherited write conditions',
  DENIED: 'A verified unexpired artifact writer with the required access is needed',
  ARTIFACT_ACCESS_DENIED: 'This preparation requires the matching artifact read capability',
  ARTIFACT_TOO_LARGE:
    'MCP preparation is limited to 4 MiB decoded content and the configured upload limit',
  ARTIFACT_UPLOAD_BUSY: 'Artifact upload and preparation capacity is occupied',
  ARTIFACT_UPLOAD_CONTEXT_INVALID: 'The verified upload identity could not be represented',
  ARTIFACT_INTEGRITY_UNAVAILABLE: 'Secure request-key generation is unavailable',
  ARTIFACT_VERSION_CONFLICT:
    'The explicitly reviewed version differs from current metadata; review before preparing a different request',
  ARTIFACT_NOT_FOUND: 'The selected artifact is unavailable to this caller',
  ARTIFACT_LEGACY_UNVERIFIED: 'Current artifact metadata lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Current artifact metadata could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact metadata storage is unavailable',
  UNAUTHENTICATED: 'Renew the session before preparing a new original request',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The preparation read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_ARTIFACT_PREPARATION_TIMEOUT:
    'Stopped waiting for preparation; underlying reads may still be running, and no upload was sent',
  GATEWAY_RESPONSE_INVALID:
    'The complete preparation response did not match verified authority or exceeded its limit',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: { local_state: 'not-saved', upload_dispatch_state: 'not-sent' },
  });
function normalized(error: unknown, trace: string) {
  return fail(
    error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      Object.hasOwn(messages, error.envelope.code)
      ? error.envelope.code
      : 'GATEWAY_RESPONSE_INVALID',
    trace,
  );
}
function inputFor(raw: unknown, context: RequestContext, maximum: number) {
  artifactUploadContextAuthority(context);
  let row: Record<string, unknown>;
  let draft: ArtifactUploadDraft;
  let encoded: string;
  try {
    if (context.idempotency_key !== undefined || context.expected_version !== undefined)
      throw new TypeError();
    const value: unknown = JSON.parse(syncJsonSnapshot(raw, MCP_ARTIFACT_UPLOAD_BODY_BYTES));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['draft', 'content_base64'].includes(key))
    )
      throw new TypeError();
    row = value as Record<string, unknown>;
    draft = parseArtifactUploadDraft(
      JSON.parse(syncJsonSnapshot(row.draft, ARTIFACT_UPLOAD_REQUEST_BYTES)),
    );
    if (
      typeof row.content_base64 !== 'string' ||
      row.content_base64.length > MCP_ARTIFACT_UPLOAD_BASE64_CHARS
    )
      throw new TypeError();
    encoded = row.content_base64;
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
  const content = Buffer.from(encoded, 'base64');
  if (content.byteLength > Math.min(maximum, MCP_ARTIFACT_UPLOAD_MAX_BYTES))
    throw fail('ARTIFACT_TOO_LARGE', context.trace_id);
  if (content.toString('base64') !== encoded) throw fail('INVALID_INPUT', context.trace_id);
  return {
    draft,
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
function resultFor(original: ArtifactReceiptQuery, expires: string, trace: string) {
  const json = syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
  const envelope = {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      original,
      request_json: json,
      request_bytes: Buffer.byteLength(json, 'utf8'),
      request_sha256: createHash('sha256').update(json, 'utf8').digest('hex'),
      identity_observed_expires_at: expires,
      local_state: 'prepared-not-saved',
      upload_dispatch_state: 'not-sent',
      next_action: 'save-and-review-original',
    },
  };
  const text = syncJsonSnapshot(envelope, RESULT_BYTES);
  const result = { content: [{ type: 'text' as const, text }] };
  syncJsonSnapshot(result, 2 * RESULT_BYTES + 4096);
  return result;
}

/** A timed-out read retains its shared capacity until it actually settles. No write route is called. */
export async function executeArtifactPreparationTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
  options: McpArtifactUploadOptions = {},
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_ARTIFACT_PREPARATION_TIMEOUT', trace);
    artifactUploadContextAuthority(context);
  };
  const gate = artifactUploadToolGate(api, options);
  const maximum = gate.maxBytes;
  let release: () => void;
  try {
    active();
    release = options.takeReservation?.() ?? gate.acquire(trace);
  } catch (error) {
    throw normalized(error, trace);
  }
  const work = (async () => {
    try {
      const input = inputFor(raw, context, maximum);
      if (typeof globalThis.crypto?.getRandomValues !== 'function')
        throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      active();
      const read = async (path: string, limit: number) => {
        active();
        const response = await api.handle({
          method: 'GET',
          path,
          headers: {},
          context: structuredClone(context),
        });
        active();
        if (
          response.headers['x-trace-id'] !== trace ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            response.headers['content-type'] ?? '',
          )
        )
          throw fail('GATEWAY_RESPONSE_INVALID', trace);
        const value: unknown = JSON.parse(
          syncJsonSnapshot(response.body, response.status >= 400 ? 16 * 1024 : limit),
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
        return value;
      };
      const caller = artifactUploadContextResult(
        await read('/v1/artifacts/upload-context', 16 * 1024),
        context,
      );
      if (input.size > caller.data.max_bytes) throw fail('ARTIFACT_TOO_LARGE', trace);
      const draft = input.draft;
      if (
        (draft.operation === 'artifact.put-version' && !caller.data.can_read) ||
        (draft.operation === 'artifact.create' &&
          draft.classification === 'restricted' &&
          !caller.data.can_read_restricted)
      )
        throw fail('ARTIFACT_ACCESS_DENIED', trace);
      if (draft.operation === 'artifact.put-version') {
        const value = await read(
          '/v1/artifacts/' + encodeURIComponent(draft.artifact_id),
          2 * 1024 * 1024,
        );
        const artifact = parseArtifactReadEnvelope(
          value,
          { artifact_id: draft.artifact_id },
          caller.data.identity,
          trace,
        ).data.artifact;
        if (artifact.classification === 'restricted' && !caller.data.can_read_restricted)
          throw fail('ARTIFACT_ACCESS_DENIED', trace);
        if (artifact.version !== draft.expected_version)
          throw fail('ARTIFACT_VERSION_CONFLICT', trace);
      }
      let candidate: ArtifactReceiptQuery;
      try {
        candidate = parseArtifactReceiptQuery({
          identity: caller.data.identity,
          command: {
            ...draft,
            size: input.size,
            sha256: input.sha256,
            request_key: 'workctx-artifact-' + '0'.repeat(26),
          },
        });
        // Check request/envelope/escaped result capacity before allocating a new key.
        resultFor(candidate, caller.data.expires_at, trace);
      } catch {
        throw fail('INVALID_INPUT', trace);
      }
      active();
      if (typeof globalThis.crypto?.getRandomValues !== 'function')
        throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      const request = parseArtifactReceiptQuery({
        identity: candidate.identity,
        command: { ...candidate.command, request_key: 'workctx-artifact-' + createUlid() },
      });
      const result = resultFor(request, caller.data.expires_at, trace);
      active();
      return result;
    } catch (error) {
      let finalError = error;
      try {
        active();
      } catch (stopped) {
        finalError = stopped;
      }
      throw normalized(finalError, trace);
    } finally {
      release();
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_ARTIFACT_PREPARATION_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
