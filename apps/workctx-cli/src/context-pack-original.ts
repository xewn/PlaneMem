import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  PACK_ORIGINAL_BYTES,
  CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES,
  CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
  assertPackSaveBinding,
  contextPackSaveReceiptQuery,
  decodePackSaveOriginal,
  encodePackSaveOriginal,
  isSyncIdentifier,
  packGateway,
  parseContextPackCompileParameters,
  parseContextPackSaveReceiptEnvelope,
  parseContextPackSaveContextEnvelope,
  parsePackSaveBinding,
  parsePackSaveOriginal,
  validateIdempotencyKey,
  validateRequestContext,
  syncJsonSnapshot,
  type ContextPackSaveReceiptEnvelope,
  type ContextPackSaveContextEnvelope,
  type PackSaveBinding,
  type PackSaveOriginal,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { runContextRead } from './context-history.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import {
  captureContextPackReceipt,
  prepareContextPackReceiptOutput,
} from './context-pack-receipt-file.js';

interface NetworkOptions {
  base: string;
  token: string;
  trace: string;
  scope: { tenant_id: string; workspace_id: string; project_id: string };
}
type Mode = 'prepare-save' | 'inspect-save' | 'submit-save' | 'save-receipt';
const recovery =
  'Keep the complete original file and restore its gateway, project, account, client and permissions. Retry explicitly with the same original; this result does not disprove an earlier save.';
function fail(
  code: string,
  message: string,
  trace: string,
  dispatched = false,
  details: Record<string, unknown> = {},
) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: {
      ...details,
      compile_dispatch_state: dispatched ? 'started' : 'not-sent',
      server_outcome: dispatched ? 'unknown' : 'not-checked',
      recovery,
    },
  });
}
function invalid(trace: string) {
  return fail(
    'USAGE_ERROR',
    'Use context prepare-save --key ORIGINAL_KEY --output NEW_ORIGINAL.json [--json-file DRAFT.json] [--timeout-ms 30000]; context inspect-save --json-file ORIGINAL.json; context save-receipt --json-file ORIGINAL.json [--timeout-ms 30000] [--output NEW_RECEIPT.json] to observe only; or context submit-save --json-file ORIGINAL.json --reviewed [--timeout-ms 30000]. No stdin, inline JSON, repeated or unrelated options. Drafts accept only budget_tokens/ttl_seconds; submit and receipt never accept replacement settings or keys.',
    trace,
  );
}
export function isContextPackOriginalCommand(command: string) {
  return [
    'context prepare-save',
    'context inspect-save',
    'context submit-save',
    'context save-receipt',
  ].includes(command);
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'json-file': { type: 'string' },
        output: { type: 'string' },
        key: { type: 'string' },
        reviewed: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (args.positionals.length !== 2 || !isContextPackOriginalCommand(args.positionals.join(' ')))
      throw new TypeError();
    const mode = args.positionals[1] as Mode;
    const allowed =
      mode === 'prepare-save'
        ? ['json-file', 'output', 'key', 'timeout-ms']
        : mode === 'submit-save'
          ? ['json-file', 'reviewed', 'timeout-ms']
          : mode === 'save-receipt'
            ? ['json-file', 'timeout-ms', 'output']
            : ['json-file'];
    const seen = new Set<string>();
    for (const option of args.tokens) {
      if (option.kind !== 'option') continue;
      if (!allowed.includes(option.name) || seen.has(option.name)) throw new TypeError();
      seen.add(option.name);
    }
    const file = args.values['json-file'];
    const output = args.values.output;
    for (const path of [file, output])
      if (
        path !== undefined &&
        (!path.trim() || path === '-' || /[\u0000-\u001f\u007f]/.test(path))
      )
        throw new TypeError();
    if (
      (mode !== 'prepare-save' && file === undefined) ||
      (mode === 'prepare-save' && output === undefined) ||
      (mode === 'submit-save' && args.values.reviewed !== true)
    )
      throw new TypeError();
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout = Number(rawTimeout);
    if (
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      !Number.isSafeInteger(timeout) ||
      timeout > 2147483647
    )
      throw new TypeError();
    const key = mode === 'prepare-save' ? validateIdempotencyKey(args.values.key) : undefined;
    if (key !== undefined && (!isSyncIdentifier(key) || /\u007f/.test(key))) throw new TypeError();
    return { mode, file: file === undefined ? undefined : resolve(file), output, key, timeout };
  } catch {
    throw invalid(trace);
  }
}
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function originalFile(path: string, trace: string) {
  try {
    const bytes = await readBoundedArtifactFile(path, PACK_ORIGINAL_BYTES, trace);
    const original = decodePackSaveOriginal(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    const raw = encodePackSaveOriginal(original);
    return { bytes, original, raw, request_sha256: hash(raw), file_sha256: hash(bytes) };
  } catch {
    throw fail(
      'CONTEXT_PACK_ORIGINAL_UNAVAILABLE',
      'The complete original file could not be read or validated. No pack save was sent by this attempt.',
      trace,
    );
  }
}
export async function inspectContextPackOriginal(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  if (args.mode !== 'inspect-save') throw invalid(trace);
  const saved = await originalFile(args.file!, trace);
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      status: 'inspected',
      original_file: args.file,
      original: saved.original,
      request_sha256: saved.request_sha256,
      file_sha256: saved.file_sha256,
      content_state: 'structure-checked',
      server_outcome: 'not-checked',
      compile_dispatch_state: 'not-sent',
    },
  };
}
const knownErrors = new Set([
  'INVALID_INPUT',
  'USAGE_ERROR',
  'DENIED',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'CONTEXT_PACK_SAVE_CONTEXT_INVALID',
  'CONTEXT_PACK_RECEIPT_INVALID',
  'CONTEXT_PACK_RECEIPT_TIMEOUT',
  'CONTEXT_PACK_NOT_FOUND',
  'CONTEXT_PACK_STALE',
  'CONTEXT_PACK_EXPIRED',
  'CONTEXT_PACK_INVALID',
  'CONTEXT_PACK_STORAGE_UNAVAILABLE',
  'CONTEXT_SOURCE_LIMIT',
  'IDEMPOTENCY_KEY_REUSED',
  'WORKBENCH_AUTH_UNAVAILABLE',
  'AUDIT_PERSISTENCE_UNAVAILABLE',
  'GATEWAY_REQUEST_CANCELED',
  'GATEWAY_REQUEST_TIMEOUT',
  'GATEWAY_RESPONSE_INVALID',
  'GATEWAY_UNAVAILABLE',
  'CONTEXT_PACK_INTEGRITY_UNAVAILABLE',
  'CONTEXT_PACK_HASH_MISMATCH',
  'CONTEXT_PACK_ORIGINAL_CHANGED',
  'CONTEXT_PACK_ORIGINAL_UNAVAILABLE',
]);

/** Fixed token and base, one identity GET and at most one explicit original POST. */
async function network<T>(
  options: NetworkOptions,
  timeout: number,
  binding: PackSaveBinding | undefined,
  work: (
    client: WcpClient,
    state: {
      signal: AbortSignal;
      remaining: () => number;
      check: () => void;
      acceptAuthority: (expires: string) => void;
      allowSave: () => void;
      savedEtag: () => string | null;
    },
  ) => Promise<T>,
  receiptOnly = false,
) {
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  let dispatched = false;
  let expiry = Infinity;
  let reads = 0;
  let observations = 0;
  let ready = false;
  let etag: string | null = null;
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline)
      throw fail(
        'GATEWAY_REQUEST_TIMEOUT',
        'Stopped waiting for the original request.',
        options.trace,
        dispatched,
      );
    if (expiry <= Date.now())
      throw fail(
        'UNAUTHENTICATED',
        'The original identity session expired.',
        options.trace,
        dispatched,
      );
  };
  const remaining = () => {
    check();
    return Math.max(1, Math.ceil(deadline - performance.now()));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const base = packGateway(options.base);
    const origin = new URL(base).origin;
    if (
      binding &&
      (binding.gateway_url !== base ||
        binding.identity.tenant_id !== options.scope.tenant_id ||
        binding.identity.workspace_id !== options.scope.workspace_id ||
        binding.identity.project_id !== options.scope.project_id)
    )
      throw fail(
        'DENIED',
        'Restore the original gateway and project before submitting.',
        options.trace,
      );
    const transport = new FetchWcpTransport({
      base_url: origin,
      access_token: () => options.token,
      timeout_ms: timeout,
      fetch: async (input, init) => {
        check();
        // FetchWcpTransport supplies a URL; never accept an external Request or new destination.
        if (!(input instanceof URL) || input.origin !== origin || input.search || input.hash)
          throw fail(
            'INVALID_INPUT',
            'Unexpected original request destination.',
            options.trace,
            dispatched,
          );
        const reading =
          input.pathname === '/v1/context-pack/save-context' && init?.method === 'GET';
        const saving = input.pathname === '/v1/context-pack/compile' && init?.method === 'POST';
        const observing =
          input.pathname === '/v1/context-pack/save-receipt' && init?.method === 'POST';
        if (
          receiptOnly
            ? !binding || !observing || observations !== 0
            : (!reading && !saving) ||
              (reading && reads !== 0) ||
              (saving && (!binding || !ready || reads !== 1 || dispatched))
        )
          throw fail(
            'INVALID_INPUT',
            'Unexpected original request sequence.',
            options.trace,
            dispatched,
          );
        if (reading) reads++;
        if (observing) observations++;
        if (saving) dispatched = true;
        const response = await fetch(base + input.pathname, init);
        try {
          check();
          if (
            response.status !== 401 &&
            ((response.status !== 200 && (response.status < 400 || response.status > 599)) ||
              response.headers.get('x-trace-id') !== options.trace ||
              ((reading || observing || !response.ok) && response.headers.has('etag')))
          )
            throw fail(
              'GATEWAY_RESPONSE_INVALID',
              'The complete original response could not be confirmed.',
              options.trace,
              dispatched,
            );
          if (saving && response.ok) etag = response.headers.get('etag');
          return response;
        } catch (error) {
          void response.body?.cancel().catch(() => undefined);
          throw error;
        }
      },
    });
    const client = new WcpClient(
      transport,
      validateRequestContext({
        ...options.scope,
        trace_id: options.trace,
        ...(binding
          ? { actor_id: binding.identity.actor_id, client_id: binding.identity.client_id }
          : {}),
      }),
    );
    const operation = (async () => {
      const result = await work(client, {
        signal: controller.signal,
        remaining,
        check,
        acceptAuthority: (expires) => {
          expiry = Date.parse(expires);
          if (!Number.isFinite(expiry)) throw new TypeError();
          check();
        },
        allowSave: () => {
          check();
          ready = true;
        },
        savedEtag: () => etag,
      });
      check();
      return result;
    })();
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            fail(
              'GATEWAY_REQUEST_TIMEOUT',
              'Stopped waiting for the original request.',
              options.trace,
              dispatched,
            ),
          );
        }, remaining());
        timer.unref();
      }),
    ]);
  } catch (error) {
    const envelope = error instanceof ContractError ? error.envelope : undefined;
    const code =
      envelope?.trace_id === options.trace && knownErrors.has(envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE';
    throw fail(
      code,
      dispatched
        ? 'The original pack save is not confirmed. Keep the file unchanged.'
        : receiptOnly
          ? 'The historical save query could not be confirmed. No pack save was sent; keep the original file.'
          : binding
            ? 'This attempt stopped before sending a pack save. Keep the original file; an earlier save may still exist.'
            : 'Save identity could not be confirmed. No new original file was published and no pack save was sent.',
      options.trace,
      dispatched,
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function finishReceiptObservation(
  original: PackSaveOriginal,
  receipt: ContextPackSaveReceiptEnvelope,
  output: ArtifactOutput | undefined,
  trace: string,
) {
  if (!output) return receipt;
  // Query waiting has settled. Await local publication/readback without a timeout race.
  const capture = await captureContextPackReceipt(original, receipt, output, trace);
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: receipt.source_refs,
    data: {
      status: 'receipt-observed' as const,
      original,
      receipt,
      ...capture,
    },
  };
}

const activeReceiptReads = new WeakMap<CommandRouter, { active: number }>();

/** The host supplies the actual router's gateway; an original file cannot select its destination. */
function embeddedOriginalAuthority(input: RequestContext, gatewayUrl: string | undefined) {
  const context = structuredClone(input);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const trace = context.trace_id;
  const authority = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.schema_version !== 1 ||
      context.authenticated_client !== true ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      !Array.isArray(context.capability) ||
      !context.capability.includes('context.read') ||
      !isSyncIdentifier(trace) ||
      /\u007f/.test(trace)
    )
      throw fail('DENIED', 'Use the original verified unexpired context reader.', trace);
  };
  authority();
  let base: string;
  try {
    if (typeof gatewayUrl !== 'string') throw new TypeError();
    base = packGateway(gatewayUrl);
  } catch {
    throw fail(
      'CONTEXT_PACK_GATEWAY_UNAVAILABLE',
      'Configure the embedded host with its actual gateway URL before using original save requests.',
      trace,
    );
  }
  let binding: PackSaveBinding;
  try {
    binding = parsePackSaveBinding({
      gateway_url: base,
      identity: {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      read_restricted: context.capability.includes('data.restricted.read'),
    });
  } catch {
    throw fail('DENIED', 'The complete verified reader identity could not be confirmed.', trace);
  }
  return { context, trace, binding, authority };
}

export async function runContextPackSaveReceipt(
  argv: string[],
  router: CommandRouter,
  input: RequestContext,
  gatewayUrl: string | undefined,
) {
  const args = argumentsFor(argv, input.trace_id);
  if (args.mode !== 'save-receipt') throw invalid(input.trace_id);
  const { context, trace, binding, authority } = embeddedOriginalAuthority(input, gatewayUrl);
  const saved = await originalFile(args.file!, trace);
  authority();
  try {
    assertPackSaveBinding(binding, saved.original.binding);
  } catch {
    throw fail(
      'DENIED',
      'Restore the original gateway, identity and permissions before querying.',
      trace,
    );
  }
  const output =
    args.output === undefined
      ? undefined
      : await prepareContextPackReceiptOutput(args.output, trace);
  authority();
  const query = contextPackSaveReceiptQuery(saved.original);
  const body = syncJsonSnapshot(query, CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES);
  const deadline = performance.now() + args.timeout;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-trace-id': trace,
    'x-tenant-id': binding.identity.tenant_id,
    'x-workspace-id': binding.identity.workspace_id,
    'x-project-id': binding.identity.project_id,
    'x-expected-actor-id': binding.identity.actor_id,
    'x-expected-client-id': binding.identity.client_id,
  };
  let called = false;
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      const active = () => {
        if (performance.now() >= deadline)
          throw fail(
            'GATEWAY_REQUEST_TIMEOUT',
            'Stopped waiting for the original save receipt.',
            trace,
          );
        if (request.signal?.aborted)
          throw fail(
            'GATEWAY_REQUEST_CANCELED',
            'Stopped waiting for the original save receipt.',
            trace,
          );
        authority();
      };
      active();
      if (
        called ||
        !request.signal ||
        request.method !== 'POST' ||
        request.path !== '/v1/context-pack/save-receipt' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES ||
        Object.keys(request.headers).length !== Object.keys(headers).length ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        syncJsonSnapshot(request.body, CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES) !== body
      )
        throw invalid(trace);
      called = true;
      let gate = activeReceiptReads.get(router);
      if (!gate) {
        gate = { active: 0 };
        activeReceiptReads.set(router, gate);
      }
      if (gate.active >= 2)
        throw fail('RATE_LIMITED', 'Embedded save receipt capacity is occupied.', trace);
      const lease = gate;
      lease.active++;
      try {
        const raw = await router.execute(
          {
            operation: 'context.pack.save-receipt',
            input: { ...contextPackSaveReceiptQuery(saved.original) },
            context: structuredClone(context),
          },
          async (run) => {
            active();
            return run();
          },
        );
        active();
        let receipt;
        try {
          receipt = parseContextPackSaveReceiptEnvelope(raw, query, trace);
        } catch {
          active();
          throw fail(
            'GATEWAY_RESPONSE_INVALID',
            'The complete historical receipt differs from the original query.',
            trace,
          );
        }
        active();
        return receipt as unknown as T;
      } finally {
        // Keep capacity occupied until the underlying authorized read actually settles.
        lease.active--;
      }
    },
  };
  const client = new WcpClient(
    transport,
    validateRequestContext({ ...binding.identity, trace_id: trace }),
  );
  let receipt: ContextPackSaveReceiptEnvelope;
  try {
    receipt = await client.getContextPackSaveReceipt(query, { timeout_ms: args.timeout });
    authority();
  } catch (error) {
    const envelope = error instanceof ContractError ? error.envelope : undefined;
    throw fail(
      envelope?.trace_id === trace && knownErrors.has(envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      'The historical save query could not be confirmed. No pack save was sent; keep the original file.',
      trace,
    );
  }
  return finishReceiptObservation(saved.original, receipt, output, trace);
}

export async function runContextPackPrepareSave(
  argv: string[],
  router: CommandRouter,
  input: RequestContext,
  gatewayUrl: string | undefined,
) {
  const args = argumentsFor(argv, input.trace_id);
  if (args.mode !== 'prepare-save') throw invalid(input.trace_id);
  const { context, trace, binding, authority } = embeddedOriginalAuthority(input, gatewayUrl);
  return prepareOriginalFile(args, binding.gateway_url, trace, async () => {
    authority();
    let response;
    try {
      response = await runContextRead(
        ['context', 'save-identity', '--timeout-ms', String(args.timeout)],
        router,
        context,
      );
      authority();
    } catch (error) {
      const envelope = error instanceof ContractError ? error.envelope : undefined;
      throw fail(
        envelope?.trace_id === trace && knownErrors.has(envelope.code)
          ? envelope.code
          : 'GATEWAY_UNAVAILABLE',
        'Save identity could not be confirmed. No original file was published and no pack save was sent.',
        trace,
      );
    }
    try {
      const result = parseContextPackSaveContextEnvelope(response, binding.identity, trace);
      assertPackSaveBinding(
        {
          gateway_url: binding.gateway_url,
          identity: result.data.identity,
          read_restricted: result.data.permissions.read_restricted,
        },
        binding,
      );
      if (Date.parse(result.data.expires_at) !== Date.parse(context.token_expires_at!))
        throw new TypeError();
      return result;
    } catch {
      throw fail(
        'GATEWAY_RESPONSE_INVALID',
        'The complete save identity differs from the verified embedded reader.',
        trace,
      );
    }
  });
}

export async function callContextPackOriginal(argv: string[], input: NetworkOptions) {
  const options = structuredClone(input);
  const args = argumentsFor(argv, options.trace);
  if (args.mode === 'inspect-save') return inspectContextPackOriginal(argv, options.trace);
  try {
    options.base = packGateway(options.base);
    options.token = options.token.trim();
    if (!options.token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + options.token });
    validateRequestContext({ ...options.scope, trace_id: options.trace });
  } catch {
    throw invalid(options.trace);
  }

  if (args.mode === 'save-receipt') {
    const saved = await originalFile(args.file!, options.trace);
    const output =
      args.output === undefined
        ? undefined
        : await prepareContextPackReceiptOutput(args.output, options.trace);
    const receipt = await network(
      options,
      args.timeout,
      saved.original.binding,
      (client, state) =>
        client.getContextPackSaveReceipt(contextPackSaveReceiptQuery(saved.original), {
          timeout_ms: state.remaining(),
          signal: state.signal,
        }),
      true,
    );
    return finishReceiptObservation(saved.original, receipt, output, options.trace);
  }

  if (args.mode === 'submit-save') {
    const saved = await originalFile(args.file!, options.trace);
    return network(options, args.timeout, saved.original.binding, async (client, state) => {
      const authority = await client.getContextPackSaveContext({
        timeout_ms: state.remaining(),
        signal: state.signal,
      });
      state.acceptAuthority(authority.data.expires_at);
      try {
        assertPackSaveBinding(
          {
            gateway_url: options.base,
            identity: authority.data.identity,
            read_restricted: authority.data.permissions.read_restricted,
          },
          saved.original.binding,
        );
      } catch {
        throw fail(
          'DENIED',
          'The current identity or permissions differ from the original.',
          options.trace,
        );
      }
      const again = await originalFile(args.file!, options.trace);
      state.check();
      if (!Buffer.from(saved.bytes).equals(again.bytes) || saved.raw !== again.raw)
        throw fail(
          'CONTEXT_PACK_ORIGINAL_CHANGED',
          'The original file changed before sending.',
          options.trace,
        );
      state.allowSave();
      const result = await client.compileContextPack(saved.original.parameters, {
        idempotency_key: saved.original.request_key,
        timeout_ms: state.remaining(),
        signal: state.signal,
      });
      state.check();
      if (state.savedEtag() !== result.etag)
        throw fail(
          'GATEWAY_RESPONSE_INVALID',
          'The saved pack ETag differs from the complete receipt.',
          options.trace,
          true,
        );
      if (
        !saved.original.binding.read_restricted &&
        result.data.pack.items.some((item) => item.sensitivity === 'restricted')
      )
        throw fail(
          'DENIED',
          'Restricted content differs from the original permission binding.',
          options.trace,
          true,
        );
      return result;
    });
  }

  return prepareOriginalFile(args, options.base, options.trace, () =>
    network(options, args.timeout, undefined, async (client, state) => {
      const result = await client.getContextPackSaveContext({
        timeout_ms: state.remaining(),
        signal: state.signal,
      });
      state.acceptAuthority(result.data.expires_at);
      return result;
    }),
  );
}

async function prepareOriginalFile(
  args: ReturnType<typeof argumentsFor>,
  base: string,
  trace: string,
  readAuthority: () => Promise<ContextPackSaveContextEnvelope>,
) {
  if (args.mode !== 'prepare-save') throw invalid(trace);
  // Preflight local paths and draft before reading authority; no file is created yet.
  const output = await prepareArtifactOutput(args.output!, trace);
  let parameters;
  try {
    const draft =
      args.file === undefined
        ? '{}'
        : new TextDecoder('utf-8', { fatal: true }).decode(
            await readBoundedArtifactFile(args.file, 4096, trace),
          );
    parameters = parseContextPackCompileParameters(JSON.parse(draft.replace(/^\uFEFF/, '')));
  } catch {
    throw invalid(trace);
  }
  const authority = await readAuthority();
  const original: PackSaveOriginal = parsePackSaveOriginal({
    schema_version: 1,
    kind: 'context-pack-save',
    binding: {
      gateway_url: base,
      identity: authority.data.identity,
      read_restricted: authority.data.permissions.read_restricted,
    },
    request_key: args.key,
    parameters,
  });
  const raw = encodePackSaveOriginal(original);
  const bytes = new TextEncoder().encode(raw);
  const requestHash = hash(bytes);
  if (Date.parse(authority.data.expires_at) <= Date.now())
    throw fail('UNAUTHENTICATED', 'Identity expired before local request preparation.', trace);
  let published;
  try {
    // Once local publication begins, await settlement. A timer must not report failure before a late write.
    published = await saveArtifactOutput(output, bytes, requestHash, trace);
  } catch (error) {
    throw fail(
      'CONTEXT_PACK_ORIGINAL_SAVE_FAILED',
      'The original file could not be published. Keep reported recovery paths; no pack save was sent.',
      trace,
      false,
      error instanceof ContractError ? error.envelope.details : { output_path: output.path },
    );
  }
  try {
    const stored = await originalFile(published.path, trace);
    if (stored.raw !== raw || !Buffer.from(bytes).equals(stored.bytes)) throw new TypeError();
  } catch {
    throw fail(
      'CONTEXT_PACK_ORIGINAL_READBACK_FAILED',
      'The file was created but its final contents could not be confirmed. Keep it for inspection; no pack save was sent.',
      trace,
      false,
      {
        local_state: 'published-unconfirmed',
        output_path: published.path,
        cleanup_pending: published.cleanup_pending,
        ...(published.temporary_path === undefined
          ? {}
          : { temporary_path: published.temporary_path }),
      },
    );
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      status: 'prepared',
      original_file: published.path,
      original,
      request_sha256: requestHash,
      identity_observed_expires_at: authority.data.expires_at,
      local_state: 'saved-and-read-back',
      compile_dispatch_state: 'not-sent',
      server_outcome: 'not-checked',
      next_action: 'review-original-file',
      cleanup_pending: published.cleanup_pending,
      ...(published.temporary_path === undefined
        ? {}
        : { temporary_path: published.temporary_path }),
    },
  };
}
