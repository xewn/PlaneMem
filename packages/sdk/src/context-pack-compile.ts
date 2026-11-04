import {
  ContractError,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  contextPackReadHashJson,
  isSyncIdentifier,
  parseContextPackCompileEnvelope,
  parseContextPackCompileParameters,
  validateIdempotencyKey,
  type CompileContextPackRequest,
  type ContextPackCompileParameters,
  type ContextPackReadEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import type { WcpWriteOptions } from './continuity.js';
import { captureContextRead, contextReadFields } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackCompileOptions extends WcpWriteOptions {
  /** Defaults to 30 seconds, including credentials, the complete response and SHA-256. */
  timeout_ms?: number;
  /** Stops local waiting; it does not establish that a remote save was canceled. */
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply valid original pack settings, project context and a stable request key',
  DENIED: 'The current account or client cannot save this context pack',
  UNAUTHENTICATED: 'Renew the intended session before retrying the original save',
  CONTEXT_PACK_NOT_FOUND: 'The original saved pack or project is unavailable',
  CONTEXT_PACK_STALE: 'The original saved pack sources changed; retain the original request',
  CONTEXT_PACK_EXPIRED: 'The original saved pack expired; retain the original request',
  CONTEXT_PACK_INVALID: 'The original saved context pack could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE:
    'Context pack storage is unavailable; retain the original request',
  CONTEXT_SOURCE_LIMIT: 'The project or source graph exceeds the context pack limits',
  IDEMPOTENCY_KEY_REUSED:
    'The request key belongs to different parameters; recover the exact original',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable; retain the original request',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context pack command audit could not be confirmed',
  RATE_LIMITED: 'Gateway capacity is occupied; retain the original request',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the context pack save; its result may be unknown',
  GATEWAY_REQUEST_TIMEOUT:
    'The context pack save exceeded the local deadline; its result may be unknown',
  GATEWAY_RESPONSE_INVALID: 'The complete context pack save response could not be verified',
  GATEWAY_UNAVAILABLE: 'The context pack save could not be confirmed; retain the original request',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE: 'Context pack integrity checking is unavailable',
  CONTEXT_PACK_HASH_MISMATCH: 'The returned complete context pack differs from its saved hash',
};

/** At most one transport call. Failures cannot disprove an earlier same-key save. */
export async function compileSavedContextPack(
  transport: WcpTransport,
  original: RequestContext,
  input: CompileContextPackRequest,
  options: WcpContextPackCompileOptions,
): Promise<ContextPackReadEnvelope> {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  let dispatched = false;
  let stage: 'input' | 'integrity' | 'transport' | 'response' = 'input';
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      details: {
        compile_stage: stage,
        compile_dispatch_state: dispatched ? 'started' : 'not-sent',
        server_outcome: dispatched ? 'unknown' : 'not-checked',
        recovery:
          'Keep the original project, account/client constraints, budget, lifetime and request key. Retry explicitly only with that same original request; this failure does not disprove an earlier save.',
      },
    });
  try {
    let parameters: ContextPackCompileParameters;
    let settings: ReturnType<typeof captureContextRead>;
    let key: string;
    try {
      const optionFields = contextReadFields(options, ['idempotency_key', 'timeout_ms', 'signal']);
      settings = captureContextRead(original, {
        ...(optionFields.timeout_ms === undefined
          ? {}
          : { timeout_ms: optionFields.timeout_ms as number }),
        ...(optionFields.signal === undefined
          ? {}
          : { signal: optionFields.signal as AbortSignal }),
      });
      key = validateIdempotencyKey(optionFields.idempotency_key);
      if (!isSyncIdentifier(key) || /\u007f/.test(key)) throw new TypeError();
      const fields = contextReadFields(input, ['budget_tokens', 'ttl_seconds']);
      parameters = parseContextPackCompileParameters({
        ...(fields.budget_tokens === undefined ? {} : { budget_tokens: fields.budget_tokens }),
        ...(fields.ttl_seconds === undefined ? {} : { ttl_seconds: fields.ttl_seconds }),
      });
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT');
    }
    const activeBudget = budget;
    const { context } = settings;
    activeBudget.check();
    stage = 'integrity';
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-trace-id': trace,
      'x-tenant-id': context.tenant_id,
      'x-workspace-id': context.workspace_id,
      'x-project-id': context.project_id,
      'idempotency-key': key,
      ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
      ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
    };
    stage = 'transport';
    const raw = await activeBudget.wait(() => {
      dispatched = true;
      return transport.request({
        method: 'POST',
        path: '/v1/context-pack/compile',
        headers,
        // Keep an independent original for response matching even with custom transports.
        body: { ...parameters },
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_PACK_READ_RESPONSE_BYTES,
        signal: activeBudget.signal,
      });
    });
    stage = 'response';
    activeBudget.check();
    let result: ContextPackReadEnvelope;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      result = parseContextPackCompileEnvelope(raw, parameters, context, trace);
      bytes = new TextEncoder().encode(contextPackReadHashJson(result.data.pack));
    } catch {
      activeBudget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    activeBudget.check();
    stage = 'integrity';
    let digest: ArrayBuffer;
    try {
      digest = await activeBudget.wait(() =>
        globalThis.crypto.subtle.digest('SHA-256', bytes.buffer),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    } catch {
      activeBudget.check();
      throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
    }
    const hash =
      'sha256:' +
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== result.data.pack.pack_hash) throw fail('CONTEXT_PACK_HASH_MISMATCH');
    activeBudget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw fail(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    try {
      budget?.close();
    } catch {
      /* Preserve the original outcome if signal cleanup fails. */
    }
  }
}
