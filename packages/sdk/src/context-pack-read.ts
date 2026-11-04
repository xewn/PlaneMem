import {
  ContractError,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  contextPackReadHashJson,
  parseContextPackReadEnvelope,
  parseContextPackReadQuery,
  type ContextPackReadEnvelope,
  type ContextPackReadQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead, contextReadFields } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackReadOptions {
  /** Defaults to 30 seconds, including complete response validation and SHA-256. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a valid saved context pack selection, project context and read options',
  DENIED: 'The current account or client cannot read this saved context pack',
  UNAUTHENTICATED: 'Renew the intended session before reading a saved context pack',
  CONTEXT_PACK_NOT_FOUND: 'The saved context pack is unavailable in this project and selection',
  CONTEXT_PACK_STALE:
    'The saved pack sources changed; review current knowledge and prepare a fresh pack',
  CONTEXT_PACK_EXPIRED: 'The saved context pack expired; prepare a fresh pack',
  CONTEXT_PACK_INVALID: 'The saved context pack could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Context pack storage is unavailable',
  CONTEXT_SOURCE_LIMIT: 'The saved context pack source checks exceeded their limit',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context pack read audit could not be persisted',
  RATE_LIMITED: 'Context pack reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the saved context pack',
  GATEWAY_REQUEST_TIMEOUT: 'The complete context pack read exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete context pack response did not match this read or exceeded its size limit',
  GATEWAY_UNAVAILABLE: 'The saved context pack could not be read',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE:
    'Context pack integrity checking is unavailable; no unchecked pack was returned',
  CONTEXT_PACK_HASH_MISMATCH: 'The complete context pack differs from its saved hash',
};

function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}

/** Capture the original read before dispatch and deliver only a complete digest-checked pack. */
export async function readSavedContextPack(
  transport: WcpTransport,
  original: RequestContext,
  input: ContextPackReadQuery,
  options: WcpContextPackReadOptions,
): Promise<ContextPackReadEnvelope> {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let prepared;
    try {
      const settings = captureContextRead(original, options);
      // Preserve the SDK's flat optional undefined fields without invoking accessors.
      const row = contextReadFields(input, ['pack_id', 'format']);
      const query = parseContextPackReadQuery({
        ...(row.pack_id === undefined ? {} : { pack_id: row.pack_id }),
        ...(row.format === undefined ? {} : { format: row.format }),
      });
      const params = new URLSearchParams();
      if (query.pack_id !== undefined) params.set('pack_id', query.pack_id);
      if (row.format !== undefined) params.set('format', query.format!);
      prepared = {
        context: settings.context,
        query,
        path: '/v1/context-pack' + (params.size ? '?' + params.toString() : ''),
      };
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const { context, query, path } = prepared;
    budget.check();
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw failure('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
    const signal = budget.signal;
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_PACK_READ_RESPONSE_BYTES,
        signal,
      }),
    );
    budget.check();
    let result: ContextPackReadEnvelope;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      // This also bounds and detaches ordinary JSON returned by custom transports.
      result = parseContextPackReadEnvelope(raw, query, context, trace);
      bytes = new TextEncoder().encode(contextPackReadHashJson(result.data.pack));
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    budget.check();
    let digest: ArrayBuffer;
    try {
      digest = await budget.wait(() => globalThis.crypto.subtle.digest('SHA-256', bytes.buffer));
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    } catch {
      budget.check();
      throw failure('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
    }
    const hash =
      'sha256:' +
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== result.data.pack.pack_hash) throw failure('CONTEXT_PACK_HASH_MISMATCH', trace);
    budget.check();
    return result;
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
