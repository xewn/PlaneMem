import { readSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ContractError,
  CONTEXT_PACK_COMPILE_REQUEST_BYTES,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  isSyncIdentifier,
  isUlid,
  parseContextPackCompileEnvelope,
  parseContextPackCompileParameters,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  validateIdempotencyKey,
  validateRequestContext,
  type ContextPackCompileParameters,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Expected = { actor_id: string; client_id: string };
interface Target {
  parameters: ContextPackCompileParameters;
  key: string;
  expected?: Expected;
}
interface Options {
  base: string;
  token: string;
  trace: string;
  scope: Scope;
  key?: string | undefined;
  timeout_ms?: number;
}
const activeSaves = new WeakMap<CommandRouter, { active: number }>();

function failure(code: string, message: string, trace: string, started = false) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: {
      compile_stage: started ? 'response' : 'input',
      compile_dispatch_state: started ? 'started' : 'not-sent',
      server_outcome: started ? 'unknown' : 'not-checked',
      recovery:
        'Keep the original project, account/client constraints, budget, lifetime and request key. Retry explicitly only with that same original request; this failure does not disprove an earlier save.',
    },
  });
}
function invalid(trace: string) {
  return failure(
    'USAGE_ERROR',
    'Use context compile with at most one --json or --json-file (4 KiB), a stable --key or idempotency_key, and optional --timeout-ms (1..2147483647). JSON accepts budget_tokens, ttl_seconds and paired expected_actor_id/expected_client_id. Key sources must agree. No --output, repeated or unknown options or fields.',
    trace,
  );
}
function timeout(value: unknown, trace: string) {
  const result = value === undefined ? 30_000 : value;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > 2_147_483_647
  )
    throw invalid(trace);
  return result;
}
function requestKey(values: unknown[]) {
  const keys = values.filter((value) => value !== undefined);
  const key = validateIdempotencyKey(keys[0]);
  if (!isSyncIdentifier(key) || /\u007f/.test(key) || keys.some((value) => value !== key))
    throw new TypeError();
  return key;
}
function prepare(input: unknown, scope: Scope, trace: string, keys: unknown[]): Target {
  try {
    if (!isSyncIdentifier(trace) || !isUlid(scope.project_id)) throw new TypeError();
    validateRequestContext({ ...scope, trace_id: trace });
    const raw: unknown = JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_COMPILE_REQUEST_BYTES));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
    const row = raw as Record<string, unknown>;
    let expected: Expected | undefined;
    if (Object.hasOwn(row, 'expected_actor_id') || Object.hasOwn(row, 'expected_client_id')) {
      const identity = parseSyncCommandIdentity({
        ...scope,
        actor_id: row.expected_actor_id,
        client_id: row.expected_client_id,
      });
      validateRequestContext({ ...identity, trace_id: trace });
      if (!isSyncIdentifier(identity.client_id)) throw new TypeError();
      expected = { actor_id: identity.actor_id, client_id: identity.client_id };
    }
    const {
      idempotency_key,
      expected_actor_id: _actor,
      expected_client_id: _client,
      ...parameters
    } = row;
    return {
      parameters: parseContextPackCompileParameters(parameters),
      key: requestKey([...keys, idempotency_key]),
      ...(expected ? { expected } : {}),
    };
  } catch {
    throw invalid(trace);
  }
}

// Input acquisition precedes the SDK deadline. Waiting for stdin EOF is not cancelable.
function readStdin() {
  const bytes = new Uint8Array(CONTEXT_PACK_COMPILE_REQUEST_BYTES + 1);
  let used = 0;
  while (used < bytes.length) {
    const count = readSync(0, bytes, used, bytes.length - used, null);
    if (count === 0) break;
    used += count;
  }
  if (used > CONTEXT_PACK_COMPILE_REQUEST_BYTES) throw new TypeError();
  return bytes.subarray(0, used);
}
async function argumentsFor(
  argv: string[],
  scope: Scope,
  trace: string,
  allowStdin: boolean,
  originalKey?: string,
) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        key: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const raw = args.values.json;
    const file = args.values['json-file'];
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'context compile' ||
      (raw !== undefined && file !== undefined) ||
      (file !== undefined && (!file.trim() || file === '-' || /[\u0000-\u001f]/.test(file))) ||
      (raw === '-' && !allowStdin) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout)
    )
      throw new TypeError();
    const timeout_ms = timeout(Number(rawTimeout), trace);
    const keys = [originalKey, args.values.key];
    if (keys.some((key) => key !== undefined)) requestKey(keys);
    let text: string;
    if (file !== undefined || raw === '-') {
      const bytes =
        file === undefined
          ? readStdin()
          : await readBoundedArtifactFile(file, CONTEXT_PACK_COMPILE_REQUEST_BYTES, trace);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      text = raw ?? '{}';
      if (Buffer.byteLength(text, 'utf8') > CONTEXT_PACK_COMPILE_REQUEST_BYTES)
        throw new TypeError();
    }
    return {
      target: prepare(JSON.parse(text.replace(/^\uFEFF/, '')), scope, trace, keys),
      timeout_ms,
    };
  } catch {
    throw invalid(trace);
  }
}
function networkClient(options: Options, expected?: Expected) {
  try {
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    return new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms: timeout(options.timeout_ms, options.trace),
      }),
      validateRequestContext({ ...options.scope, ...expected, trace_id: options.trace }),
    );
  } catch {
    throw invalid(options.trace);
  }
}
function execute(client: WcpClient, target: Target, timeout_ms: number) {
  return client.compileContextPack(target.parameters, {
    idempotency_key: target.key,
    timeout_ms,
  });
}
export async function callContextCompile(input: unknown, options: Options) {
  const saved = structuredClone(options);
  const target = prepare(input, saved.scope, saved.trace, [saved.key]);
  return execute(
    networkClient(saved, target.expected),
    target,
    timeout(saved.timeout_ms, saved.trace),
  );
}
export async function callContextCompileArguments(argv: string[], options: Options) {
  const saved = structuredClone(options);
  networkClient(saved);
  const { target, timeout_ms } = await argumentsFor(
    argv,
    saved.scope,
    saved.trace,
    true,
    saved.key,
  );
  return execute(networkClient({ ...saved, timeout_ms }, target.expected), target, timeout_ms);
}

export async function runContextCompile(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const authority = (started = false) => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      !Array.isArray(context.capability) ||
      !context.capability.includes('context.read')
    )
      throw failure(
        'DENIED',
        'Use the original verified unexpired context reader; retain the original save request',
        trace,
        started,
      );
  };
  authority();
  let identity: ReturnType<typeof parseSyncCommandIdentity>;
  try {
    identity = parseSyncCommandIdentity({
      ...scope,
      actor_id: context.actor_id,
      client_id: context.client_id,
    });
    validateRequestContext({ ...identity, trace_id: trace });
    if (!isSyncIdentifier(identity.client_id)) throw new TypeError();
  } catch {
    throw invalid(trace);
  }
  const { target, timeout_ms } = await argumentsFor(
    argv,
    scope,
    trace,
    false,
    context.idempotency_key,
  );
  if (
    target.expected &&
    (target.expected.actor_id !== identity.actor_id ||
      target.expected.client_id !== identity.client_id)
  )
    throw failure(
      'DENIED',
      'The selected account or client differs from the verified caller',
      trace,
    );
  context.idempotency_key = target.key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    'x-expected-actor-id': identity.actor_id,
    'x-expected-client-id': identity.client_id,
    'idempotency-key': target.key,
  };
  const body = syncJsonSnapshot(target.parameters, CONTEXT_PACK_COMPILE_REQUEST_BYTES);
  let called = false;
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      const active = () => {
        if (request.signal?.aborted)
          throw failure(
            'GATEWAY_REQUEST_CANCELED',
            'Stopped waiting for the save; retain the original request',
            trace,
            true,
          );
        authority(true);
      };
      active();
      if (
        called ||
        !request.signal ||
        request.method !== 'POST' ||
        request.path !== '/v1/context-pack/compile' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== CONTEXT_PACK_READ_RESPONSE_BYTES ||
        Object.keys(request.headers).length !== Object.keys(headers).length ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        syncJsonSnapshot(request.body, CONTEXT_PACK_COMPILE_REQUEST_BYTES) !== body
      )
        throw invalid(trace);
      called = true;
      let gate = activeSaves.get(router);
      if (!gate) {
        gate = { active: 0 };
        activeSaves.set(router, gate);
      }
      if (gate.active >= 2)
        throw failure(
          'RATE_LIMITED',
          'Embedded context pack save capacity is occupied',
          trace,
          true,
        );
      const lease = gate;
      lease.active++;
      try {
        const raw = await router.execute(
          {
            operation: 'context.pack.compile',
            input: { ...target.parameters },
            context: structuredClone(context),
          },
          async (run) => {
            active();
            return run();
          },
        );
        active();
        let result;
        try {
          result = parseContextPackCompileEnvelope(raw, target.parameters, scope, trace);
        } catch {
          active();
          throw failure(
            'GATEWAY_RESPONSE_INVALID',
            'The complete saved pack could not be validated',
            trace,
            true,
          );
        }
        if (
          !context.capability.includes('data.restricted.read') &&
          result.data.pack.items.some((item) => item.sensitivity === 'restricted')
        )
          throw failure(
            'DENIED',
            'Restricted saved content is unavailable to this caller',
            trace,
            true,
          );
        active();
        return result as unknown as T;
      } finally {
        // A local timeout does not free a slot while the underlying save is still running.
        lease.active--;
      }
    },
  };
  const client = new WcpClient(transport, validateRequestContext({ ...identity, trace_id: trace }));
  const result = await execute(client, target, timeout_ms);
  authority(true);
  return result;
}
