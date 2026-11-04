import { ContractError, syncJsonSnapshot, validateErrorEnvelope } from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import {
  artifactUploadContextAuthority,
  artifactUploadContextResult,
  canReadArtifactUploadContext,
} from '../artifact-upload-context.js';

const MAXIMUM = 16 * 1024;
const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT: 'Artifact upload identity accepts no arguments or write conditions',
  DENIED: 'A verified unexpired client with actual artifact.write access is required',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read this upload identity',
  ARTIFACT_UPLOAD_CONTEXT_INVALID: 'The verified upload identity could not be represented',
  UNAUTHENTICATED: 'Renew the current session before reading upload identity',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The upload identity read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_ARTIFACT_CONTEXT_BUSY: 'MCP upload identity read capacity is occupied',
  MCP_ARTIFACT_CONTEXT_TIMEOUT:
    'Stopped waiting for upload identity; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete upload identity did not match verified authority or exceeded its limit',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });

export function prepareArtifactUploadContextTool(
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const context = structuredClone(original);
  artifactUploadContextAuthority(context);
  try {
    const input: unknown = JSON.parse(syncJsonSnapshot(raw, MAXIMUM));
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
      throw new TypeError();
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
  delete context.idempotency_key;
  delete context.expected_version;
  return { method: 'GET', path: '/v1/artifacts/upload-context', headers: {}, context };
}

/** Keep a slot until the underlying read settles, even when local waiting has timed out. */
export async function executeArtifactUploadContextTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_ARTIFACT_CONTEXT_TIMEOUT', trace);
    if (!canReadArtifactUploadContext(context)) throw fail('DENIED', trace);
  };
  active();
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_ARTIFACT_CONTEXT_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const request = prepareArtifactUploadContextTool(raw, context);
      active();
      const response = await api.handle(structuredClone(request));
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const value: unknown = JSON.parse(syncJsonSnapshot(response.body, MAXIMUM));
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace);
        throw fail(
          Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID',
          trace,
        );
      }
      if (response.status !== 200) throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const envelope = artifactUploadContextResult(value, request.context);
      active();
      const text = syncJsonSnapshot(envelope, MAXIMUM);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * MAXIMUM + 4096);
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
          () => reject(fail('MCP_ARTIFACT_CONTEXT_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
