import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_PACK_COMPILE_REQUEST_BYTES,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  CONTEXT_PACK_READ_ERROR_BYTES,
  contextPackReadHashJson,
  isSyncIdentifier,
  parseContextPackCompileEnvelope,
  parseContextPackCompileParameters,
  syncJsonSnapshot,
  validateErrorEnvelope,
  validateIdempotencyKey,
} from '@planemem/contracts';
import type { ApiGateway } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadContextTool } from './context-history.js';

const activeSaves = new WeakMap<ApiGateway, { active: number }>();
const messages = {
  INVALID_INPUT:
    'Supply only valid budget_tokens, ttl_seconds and a stable matching idempotency_key',
  DENIED:
    'Use the original verified unexpired client with actual context.read and content visibility',
  NOT_FOUND: 'The saved pack route is unavailable; retain the original request',
  COMMAND_NOT_FOUND: 'The saved pack handler is unavailable; retain the original request',
  CONTEXT_PACK_NOT_FOUND: 'The original saved pack or project is unavailable',
  CONTEXT_PACK_STALE: 'The original saved pack sources changed; retain the original request',
  CONTEXT_PACK_EXPIRED: 'The original saved pack expired; retain the original request',
  CONTEXT_PACK_INVALID: 'The saved context pack could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE:
    'Context pack storage is unavailable; retain the original request',
  CONTEXT_SOURCE_LIMIT: 'The project or source graph exceeds the context pack limits',
  IDEMPOTENCY_KEY_REUSED:
    'The request key belongs to different parameters; recover the exact original',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable; retain the original request',
  AUDIT_PERSISTENCE_UNAVAILABLE:
    'The save audit could not be confirmed; retain the original request',
  RATE_LIMITED: 'Gateway request capacity is occupied; retain the original request',
  MCP_CONTEXT_PACK_COMPILE_BUSY: 'MCP context pack save capacity is occupied',
  MCP_CONTEXT_PACK_COMPILE_TIMEOUT:
    'Stopped waiting for the save; the underlying operation may still complete',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE: 'Context pack integrity checking is unavailable',
  CONTEXT_PACK_HASH_MISMATCH: 'The complete returned context pack differs from its saved hash',
  GATEWAY_RESPONSE_INVALID:
    'The complete save response could not be verified; retain the original request',
  GATEWAY_UNAVAILABLE: 'The context pack save could not be confirmed; retain the original request',
} as const;
type ErrorCode = keyof typeof messages;

// Status mapping of the internal ApiGateway, not the outer authenticated HTTP listener.
const errorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  DENIED: 403,
  NOT_FOUND: 404,
  COMMAND_NOT_FOUND: 404,
  CONTEXT_PACK_NOT_FOUND: 404,
  CONTEXT_PACK_STALE: 409,
  CONTEXT_PACK_EXPIRED: 410,
  CONTEXT_PACK_INVALID: 500,
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
  CONTEXT_SOURCE_LIMIT: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  WORKBENCH_AUTH_UNAVAILABLE: 400,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** One original save only. A deadline never proves that an internal write was rolled back. */
export async function executeContextPackCompileTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const deadline = performance.now() + 30_000;
  const trace = isSyncIdentifier(original.trace_id) ? original.trace_id : 'trace_unknown';
  let started = false;
  let stage: 'input' | 'integrity' | 'transport' | 'response' | 'output' = 'input';
  const fail = (code: ErrorCode) =>
    new ContractError(code, messages[code], {
      trace_id: trace,
      retryable: false,
      details: {
        compile_stage: stage,
        compile_dispatch_state: started ? 'started' : 'not-sent',
        server_outcome: started ? 'unknown' : 'not-checked',
        recovery:
          'Keep the original project, account/client, budget, lifetime and request key. Retry explicitly only with that same original request; this failure does not disprove an earlier save.',
      },
    });
  let context: RequestContext;
  try {
    context = structuredClone(original);
  } catch {
    throw fail('DENIED');
  }
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_CONTEXT_PACK_COMPILE_TIMEOUT');
    if (!canReadContextTool(context)) throw fail('DENIED');
  };
  active();
  let parameters: ReturnType<typeof parseContextPackCompileParameters>;
  let key: string;
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(raw, CONTEXT_PACK_COMPILE_REQUEST_BYTES));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { idempotency_key, ...input } = value as Record<string, unknown>;
    parameters = parseContextPackCompileParameters(input);
    key = validateIdempotencyKey(
      idempotency_key === undefined ? context.idempotency_key : idempotency_key,
    );
    if (
      !isSyncIdentifier(key) ||
      /\u007f/.test(key) ||
      (context.idempotency_key !== undefined && context.idempotency_key !== key)
    )
      throw new TypeError();
  } catch {
    active();
    throw fail('INVALID_INPUT');
  }
  context.idempotency_key = key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  active();
  stage = 'integrity';
  let digest: ReturnType<typeof createHash>;
  try {
    digest = createHash('sha256');
  } catch {
    active();
    throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
  }
  active();
  stage = 'transport';
  let gate = activeSaves.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeSaves.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_CONTEXT_PACK_COMPILE_BUSY');
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      stage = 'transport';
      const request = {
        method: 'POST' as const,
        path: '/v1/context-pack/compile',
        body: { ...parameters },
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-expected-actor-id': context.actor_id,
          'x-expected-client-id': context.client_id,
        },
        context: structuredClone(context),
      };
      active();
      started = true;
      // Internal dispatch cannot be canceled, including while policy/audit is waiting.
      const response = await api.handle(request);
      stage = 'response';
      active();
      if (
        (response.status !== 200 &&
          (!Number.isInteger(response.status) || response.status < 400 || response.status > 599)) ||
        response.headers['x-trace-id'] !== trace ||
        (response.status !== 200 && response.headers.etag !== undefined) ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID');
      const value: unknown = JSON.parse(
        syncJsonSnapshot(
          response.body,
          response.status === 200
            ? CONTEXT_PACK_READ_RESPONSE_BYTES
            : CONTEXT_PACK_READ_ERROR_BYTES,
        ),
      );
      active();
      if (response.status !== 200) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).some(
            (field) => !['code', 'message', 'details', 'trace_id', 'retryable'].includes(field),
          )
        )
          throw fail('GATEWAY_RESPONSE_INVALID');
        const error = validateErrorEnvelope(value);
        if (
          error.trace_id !== trace ||
          !Object.hasOwn(errorStatuses, error.code) ||
          errorStatuses[error.code] !== response.status
        )
          throw fail('GATEWAY_RESPONSE_INVALID');
        throw fail(
          Object.hasOwn(messages, error.code) ? (error.code as ErrorCode) : 'GATEWAY_UNAVAILABLE',
        );
      }
      const envelope = parseContextPackCompileEnvelope(value, parameters, context, trace);
      if (response.headers.etag !== envelope.etag) throw fail('GATEWAY_RESPONSE_INVALID');
      if (
        !context.capability.includes('data.restricted.read') &&
        envelope.data.pack.items.some((item) => item.sensitivity === 'restricted')
      )
        throw fail('DENIED');
      active();
      const snapshot = contextPackReadHashJson(envelope.data.pack);
      active();
      stage = 'integrity';
      let hash: string;
      try {
        hash = 'sha256:' + digest.update(snapshot, 'utf8').digest('hex');
      } catch {
        active();
        throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
      }
      if (hash !== envelope.data.pack.pack_hash) throw fail('CONTEXT_PACK_HASH_MISMATCH');
      active();
      stage = 'output';
      const text = syncJsonSnapshot(envelope, CONTEXT_PACK_READ_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * CONTEXT_PACK_READ_RESPONSE_BYTES + 4096);
      active();
      return result;
    } catch (error) {
      let finalError = error;
      try {
        active();
      } catch (stopped) {
        finalError = stopped;
      }
      const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
      // Never adopt upstream messages, original keys, partial packs or outcome claims.
      throw fail(
        envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
          ? (envelope.code as ErrorCode)
          : stage === 'transport'
            ? 'GATEWAY_UNAVAILABLE'
            : 'GATEWAY_RESPONSE_INVALID',
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
          () => reject(fail('MCP_CONTEXT_PACK_COMPILE_TIMEOUT')),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
