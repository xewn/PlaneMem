import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncChangesRequest,
  parseSyncCursorQuery,
  parseSyncAcknowledgement,
  parseSyncCommandIdentity,
  parseSyncCursorEnvelope,
  assertSyncCommandIdentity,
  assertSyncIdentityScope,
  syncJsonSnapshot,
  SYNC_CURSOR_REQUEST_BYTES,
  SYNC_CURSOR_RESPONSE_BYTES,
  SYNC_CHANGES_RESPONSE_BYTES,
  type SyncChangesRequest,
  type SyncCursorQuery,
  type SyncAcknowledgement,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpTransport, type WcpRequest } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { readSyncPageFile, prepareSyncPageOutput, saveSyncPage } from './sync-page-file.js';

type ConsumerCommand = 'sync changes' | 'sync cursor' | 'sync ack';
type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Prepared =
  | { command: 'sync changes'; input: SyncChangesRequest }
  | { command: 'sync cursor'; input: SyncCursorQuery }
  | { command: 'sync ack'; input: SyncAcknowledgement };
interface NetworkOptions {
  base: string;
  token: string;
  trace: string;
  scope: Scope;
  key?: string | undefined;
  timeout_ms?: number;
}

export function isSyncConsumerCommand(command: string): command is ConsumerCommand {
  return command === 'sync changes' || command === 'sync cursor' || command === 'sync ack';
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use sync changes/cursor/ack with one of --json, --json-file or --page-file and optional --timeout-ms (1..2147483647). Changes may use --output with explicit expected_identity/cursor. Ack requires saved expected_identity/cursor. No stdin, key, version or repeated options',
    { trace_id: trace, retryable: false, dispatch_state: 'not-sent' },
  );
}
function prepare(command: ConsumerCommand, input: unknown, scope: Scope, trace: string): Prepared {
  try {
    if (!isSyncConsumerCommand(command)) throw new TypeError();
    const result: Prepared =
      command === 'sync ack'
        ? { command, input: parseSyncAcknowledgement(input) }
        : command === 'sync cursor'
          ? { command, input: parseSyncCursorQuery(input) }
          : { command, input: parseSyncChangesRequest(input) };
    if (result.input.expected_identity)
      assertSyncIdentityScope(result.input.expected_identity, scope);
    return result;
  } catch {
    throw invalid(trace);
  }
}
async function readArguments(argv: string[], scope: Scope, trace: string) {
  let args;
  let command: ConsumerCommand;
  let timeout_ms: number;
  try {
    args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        'page-file': { type: 'string' },
        output: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const name = args.positionals.join(' ');
    if (args.positionals.length !== 2 || !isSyncConsumerCommand(name)) throw new TypeError();
    command = name;
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    timeout_ms = Number(rawTimeout);
    if (
      [args.values.json, args.values['json-file'], args.values['page-file']].filter(
        (value) => value !== undefined,
      ).length > 1 ||
      (command === 'sync ack' &&
        args.values.json === undefined &&
        args.values['json-file'] === undefined &&
        args.values['page-file'] === undefined) ||
      args.values.json === '-' ||
      args.values['json-file'] === '-' ||
      args.values['page-file'] === '-' ||
      (args.values['page-file'] !== undefined && !args.values['page-file'].trim()) ||
      (args.values.output !== undefined &&
        (command !== 'sync changes' || !args.values.output.trim() || args.values.output === '-')) ||
      (args.values['json-file'] !== undefined && !args.values['json-file'].trim()) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      timeout_ms > 2147483647
    )
      throw new TypeError();
  } catch {
    throw invalid(trace);
  }
  let input: unknown;
  let previous_page_sha256: string | null = null;
  if (args.values['page-file'] !== undefined) {
    const saved = await readSyncPageFile(args.values['page-file'], trace, scope);
    const expected_identity = saved.document.expected_identity;
    const cursor = saved.document.page.data.next_cursor;
    input =
      command === 'sync cursor'
        ? { expected_identity }
        : command === 'sync ack'
          ? { expected_identity, cursor }
          : { expected_identity, cursor, limit: saved.document.query.limit };
    previous_page_sha256 = saved.document_sha256;
  } else {
    let raw = args.values.json ?? '{}';
    const file = args.values['json-file'];
    if (file !== undefined) {
      let bytes;
      try {
        bytes = await readBoundedArtifactFile(file, SYNC_CURSOR_REQUEST_BYTES, trace);
      } catch {
        throw new ContractError(
          'SYNC_CONSUMER_FILE_UNAVAILABLE',
          'Read a stable regular sync JSON file within 16 KiB',
          { trace_id: trace, retryable: false, dispatch_state: 'not-sent' },
        );
      }
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      } catch {
        throw invalid(trace);
      }
    }
    try {
      if (Buffer.byteLength(raw, 'utf8') > SYNC_CURSOR_REQUEST_BYTES) throw new TypeError();
      input = JSON.parse(raw);
    } catch {
      throw invalid(trace);
    }
  }
  const prepared = prepare(command, input, scope, trace);
  if (
    args.values.output !== undefined &&
    (prepared.command !== 'sync changes' ||
      !prepared.input.expected_identity ||
      prepared.input.cursor === undefined)
  )
    throw invalid(trace);
  const output =
    args.values.output === undefined
      ? undefined
      : await prepareSyncPageOutput(args.values.output, trace);
  return { prepared, timeout_ms, output, previous_page_sha256 };
}
function execute(client: WcpClient, prepared: Prepared, timeout_ms: number) {
  if (prepared.command === 'sync ack')
    return client.acknowledgeSync(prepared.input.cursor, {
      expected_identity: prepared.input.expected_identity,
      timeout_ms,
    });
  if (prepared.command === 'sync cursor')
    return client.getSyncCursor({ ...prepared.input, timeout_ms });
  const { expected_identity, ...query } = prepared.input;
  const options = { timeout_ms, ...(expected_identity ? { expected_identity } : {}) };
  return client.getSyncChanges(query, options);
}
export async function callSyncConsumerArguments(argv: string[], options: NetworkOptions) {
  const snapshot = structuredClone(options);
  const args = await readArguments(argv, snapshot.scope, snapshot.trace);
  const { prepared, timeout_ms } = args;
  const result = await callSyncConsumer(prepared.command, prepared.input, {
    ...snapshot,
    timeout_ms,
  });
  return finish(result, args, snapshot.trace);
}
function finish(
  result: Awaited<ReturnType<typeof execute>>,
  args: Awaited<ReturnType<typeof readArguments>>,
  trace: string,
) {
  if (args.output === undefined) return result;
  const { prepared } = args;
  if (
    prepared.command !== 'sync changes' ||
    !prepared.input.expected_identity ||
    prepared.input.cursor === undefined
  )
    throw invalid(trace);
  const { expected_identity, ...query } = prepared.input;
  return saveSyncPage(
    result,
    expected_identity,
    query,
    args.previous_page_sha256,
    args.output,
    trace,
  );
}
/** Public remote entry also uses the bounded SDK path; never falls back to generic fetch. */
export async function callSyncConsumer(
  command: ConsumerCommand,
  input: unknown,
  options: NetworkOptions,
) {
  const snapshot = structuredClone(options);
  const prepared = prepare(command, input, snapshot.scope, snapshot.trace);
  const timeout_ms = snapshot.timeout_ms ?? 30_000;
  let client: WcpClient;
  try {
    if (
      snapshot.key !== undefined ||
      !Number.isSafeInteger(timeout_ms) ||
      timeout_ms < 1 ||
      timeout_ms > 2147483647
    )
      throw new TypeError();
    const base = new URL(snapshot.base);
    const token = snapshot.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms,
      }),
      { ...snapshot.scope, trace_id: snapshot.trace },
    );
  } catch {
    throw invalid(snapshot.trace);
  }
  return execute(client, prepared, timeout_ms);
}

export async function runSyncConsumer(
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
  let dispatched = false;
  let ack = argv[0] === 'sync' && argv[1] === 'ack';
  try {
    const authority = () => {
      const expiry = Date.parse(context.token_expires_at ?? '');
      if (
        context.authenticated_client !== true ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        (context.roles?.includes('admin') !== true && !context.capability.includes('sync.read'))
      )
        throw new ContractError('DENIED', 'A verified unexpired sync reader is required', {
          trace_id: trace,
        });
      return new Date(expiry).toISOString();
    };
    const expires_at = authority();
    const args = await readArguments(argv, scope, trace);
    const { prepared, timeout_ms } = args;
    ack = prepared.command === 'sync ack';
    if (ack && (context.idempotency_key !== undefined || context.expected_version !== undefined))
      throw invalid(trace);
    delete context.idempotency_key;
    delete context.expected_version;
    let identity: SyncCommandIdentity;
    try {
      identity = parseSyncCommandIdentity({
        ...scope,
        actor_id: context.actor_id,
        client_id: context.client_id,
      });
      if (prepared.input.expected_identity)
        assertSyncCommandIdentity(prepared.input.expected_identity, identity);
    } catch {
      throw new ContractError('DENIED', 'Use the saved consumer account, client and project', {
        trace_id: trace,
      });
    }
    // A separate target survives mutations by a router or custom transport.
    const target = prepare(prepared.command, prepared.input, scope, trace);
    const expected = target.input.expected_identity;
    const headers: Record<string, string> = {
      'x-trace-id': trace,
      'x-tenant-id': scope.tenant_id,
      'x-workspace-id': scope.workspace_id,
      'x-project-id': scope.project_id,
      ...(expected
        ? { 'x-expected-actor-id': expected.actor_id, 'x-expected-client-id': expected.client_id }
        : {}),
    };
    let path = target.command === 'sync ack' ? '/v1/sync/ack' : '/v1/sync/cursor';
    let routerInput: Record<string, unknown> = {};
    if (target.command === 'sync changes') {
      const { expected_identity: _identity, ...query } = target.input;
      routerInput = query;
      const parameters = new URLSearchParams();
      if (query.cursor !== undefined) parameters.set('cursor', String(query.cursor));
      if (query.limit !== undefined) parameters.set('limit', String(query.limit));
      path = '/v1/sync/changes' + (parameters.size ? '?' + parameters : '');
    } else if (target.command === 'sync ack') routerInput = { ...target.input };
    const transport: WcpTransport = {
      async request<T = unknown>(request: WcpRequest): Promise<T> {
        authority();
        if (
          request.method !== (ack ? 'POST' : 'GET') ||
          request.path !== path ||
          request.response_type !== 'bounded-json' ||
          request.max_response_bytes !==
            (target.command === 'sync changes'
              ? SYNC_CHANGES_RESPONSE_BYTES
              : SYNC_CURSOR_RESPONSE_BYTES) ||
          Object.keys(request.headers).length !== Object.keys(headers).length ||
          Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
          (ack
            ? syncJsonSnapshot(request.body, SYNC_CURSOR_REQUEST_BYTES) !==
              syncJsonSnapshot(target.input, SYNC_CURSOR_REQUEST_BYTES)
            : request.body !== undefined)
        )
          throw invalid(trace);
        if (request.signal?.aborted)
          throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for sync state', {
            trace_id: trace,
          });
        dispatched = true;
        const raw = await router.execute({
          operation:
            target.command === 'sync changes' ? 'sync.changes' : ack ? 'sync.ack' : 'sync.cursor',
          input: structuredClone(routerInput),
          context: structuredClone(context),
        });
        authority();
        if (target.command === 'sync cursor') {
          try {
            const result = parseSyncCursorEnvelope(raw, scope, trace, identity);
            if (result.data.expires_at !== expires_at) throw new TypeError();
            return result as unknown as T;
          } catch {
            throw new ContractError(
              'GATEWAY_RESPONSE_INVALID',
              'Sync cursor did not match verified authority',
              { trace_id: trace },
            );
          }
        }
        return raw as unknown as T;
      },
    };
    const result = await execute(
      new WcpClient(transport, { ...scope, trace_id: trace }),
      prepared,
      timeout_ms,
    );
    return await finish(result, args, trace);
  } catch (error) {
    if (!ack) throw error;
    // Local dispatch knowledge takes precedence over remote or SDK error details.
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'GATEWAY_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The acknowledgement could not be confirmed; preserve the original target',
      { trace_id: trace, retryable: false, dispatch_state: dispatched ? 'unknown' : 'not-sent' },
    );
  }
}
