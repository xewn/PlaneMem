import { readSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ARTIFACT_VERSIONS_RESPONSE_BYTES,
  ARTIFACT_REGISTRY_RESPONSE_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactVersionsQuery,
  parseArtifactRegistryQuery,
  syncJsonSnapshot,
  type ArtifactReadQuery,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { prepareArtifactRead, isArtifactReadCommand } from './artifact-read.js';
import { prepareArtifactReceipt } from './artifact-receipt.js';
import { readBoundedArtifactFile } from './artifact-files.js';
import { captureArtifactReceipt, prepareArtifactReceiptOutput } from './artifact-receipt-file.js';
import type { ArtifactOutput } from './artifact-output.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Query =
  | { kind: 'metadata'; query: ArtifactReadQuery }
  | { kind: 'versions'; query: ReturnType<typeof parseArtifactVersionsQuery> }
  | { kind: 'registry'; query: ReturnType<typeof parseArtifactRegistryQuery> }
  | { kind: 'receipt'; query: ArtifactReceiptQuery };
interface Options {
  base: string;
  token: string;
  trace: string;
  scope: Scope;
  key?: string | undefined;
  timeout_ms?: number;
}

export function isArtifactQueryCommand(command: string) {
  return (
    isArtifactReadCommand(command) ||
    command === 'artifacts receipt' ||
    command === 'artifacts list' ||
    command === 'artifacts versions'
  );
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use artifacts get/version/versions/list/receipt with one --json or --json-file and optional --timeout-ms (1..2147483647). Only receipt accepts --output NEW_FILE; no --key or repeated options. Metadata/version query JSON is limited to 4 KiB, file directory query JSON to 8 KiB and original receipt JSON to 1 MiB. Preserve the complete next_query for another directory page and keep saved originals unchanged.',
    { trace_id: trace, retryable: false },
  );
}
function queryBytes(command: string) {
  return command === 'artifacts receipt'
    ? ARTIFACT_UPLOAD_REQUEST_BYTES
    : command === 'artifacts list'
      ? 8192
      : 4096;
}
function prepare(
  command: string,
  input: unknown,
  scope: Scope,
  trace: string,
  key?: string,
): Query {
  try {
    if (!isArtifactQueryCommand(command) || key !== undefined) throw new TypeError();
    const maximum = queryBytes(command);
    const snapshot: unknown = JSON.parse(syncJsonSnapshot(input, maximum));
    if (command === 'artifacts receipt')
      return { kind: 'receipt', query: prepareArtifactReceipt(snapshot, scope, trace) };
    if (command === 'artifacts versions')
      return { kind: 'versions', query: parseArtifactVersionsQuery(snapshot) };
    if (command === 'artifacts list')
      return { kind: 'registry', query: parseArtifactRegistryQuery(snapshot) };
    const query = prepareArtifactRead(command, snapshot, trace);
    if (!query) throw new TypeError();
    return { kind: 'metadata', query };
  } catch {
    throw invalid(trace);
  }
}

// Preserve network --json - without buffering an unbounded stdin stream. Like file reads,
// waiting for stdin/EOF happens before the SDK deadline and is not advertised as cancelable.
function readStdin(maximum: number) {
  const bytes = new Uint8Array(maximum + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(0, bytes, offset, Math.min(64 * 1024, bytes.length - offset), null);
    if (count === 0) break;
    offset += count;
  }
  if (offset > maximum) throw new TypeError();
  return bytes.subarray(0, offset);
}
async function readArguments(argv: string[], scope: Scope, trace: string, allowStdin: boolean) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        'timeout-ms': { type: 'string' },
        output: { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const command = args.positionals.join(' ');
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout_ms = Number(rawTimeout);
    const file = args.values['json-file'];
    const raw = args.values.json;
    const output = args.values.output;
    if (
      args.positionals.length !== 2 ||
      !isArtifactQueryCommand(command) ||
      (raw === undefined) === (file === undefined) ||
      (file !== undefined && (!file.trim() || file === '-')) ||
      (raw === '-' && !allowStdin) ||
      (output !== undefined &&
        (command !== 'artifacts receipt' ||
          !output.trim() ||
          output === '-' ||
          /[\u0000-\u001f]/.test(output))) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      timeout_ms > 2147483647
    )
      throw new TypeError();
    const maximum = queryBytes(command);
    let text: string;
    if (file !== undefined || raw === '-') {
      const bytes =
        file === undefined
          ? readStdin(maximum)
          : await readBoundedArtifactFile(file, maximum, trace);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      if (raw === undefined || Buffer.byteLength(raw, 'utf8') > maximum) throw new TypeError();
      text = raw;
    }
    return { target: prepare(command, JSON.parse(text), scope, trace), timeout_ms, output };
  } catch {
    throw invalid(trace);
  }
}
function execute(client: WcpClient, target: Query, timeout_ms: number) {
  if (target.kind === 'receipt') return client.getArtifactReceipt(target.query, { timeout_ms });
  if (target.kind === 'versions') return client.listArtifactVersions(target.query, { timeout_ms });
  if (target.kind === 'registry') return client.listArtifacts(target.query, { timeout_ms });
  return target.query.version === undefined
    ? client.getArtifact(target.query.artifact_id, { timeout_ms })
    : client.getArtifactVersion(target.query.artifact_id, target.query.version, { timeout_ms });
}
async function executeWithOutput(
  client: WcpClient,
  target: Query,
  timeout_ms: number,
  trace: string,
  output: ArtifactOutput | undefined,
) {
  if (target.kind !== 'receipt' || output === undefined) return execute(client, target, timeout_ms);
  const receipt = await client.getArtifactReceipt(target.query, { timeout_ms });
  const local = await captureArtifactReceipt(receipt, target.query, output, trace);
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: receipt.source_refs,
    data: { receipt, local, upload_dispatch_state: 'not-sent' as const },
  };
}
export function artifactQueryExitCode(
  result: Awaited<ReturnType<typeof executeWithOutput>>,
): 0 | 1 {
  return 'local' in result.data && result.data.local.state !== 'saved-and-read-back' ? 1 : 0;
}
function networkClient(options: Options) {
  try {
    if (options.key !== undefined) throw new TypeError();
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    return new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms: options.timeout_ms ?? 30_000,
      }),
      { ...options.scope, trace_id: options.trace },
    );
  } catch {
    throw invalid(options.trace);
  }
}
export function callArtifactQuery(command: string, input: unknown, options: Options) {
  const snapshot = structuredClone(options);
  const target = prepare(command, input, snapshot.scope, snapshot.trace, snapshot.key);
  return execute(networkClient(snapshot), target, snapshot.timeout_ms ?? 30_000);
}
export async function callArtifactQueryArguments(argv: string[], options: Options) {
  const snapshot = structuredClone(options);
  // Reject invalid credentials/configuration before consuming a file or stdin.
  networkClient(snapshot);
  const { target, timeout_ms, output } = await readArguments(
    argv,
    snapshot.scope,
    snapshot.trace,
    true,
  );
  const destination =
    output === undefined ? undefined : await prepareArtifactReceiptOutput(output, snapshot.trace);
  return executeWithOutput(
    networkClient({ ...snapshot, timeout_ms }),
    target,
    timeout_ms,
    snapshot.trace,
    destination,
  );
}

export async function runArtifactQuery(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const trace = context.trace_id;
  const scope: Scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const { target, timeout_ms, output } = await readArguments(argv, scope, trace, false);
  const authority = () => {
    try {
      const expiry = Date.parse(context.token_expires_at ?? '');
      if (
        context.authenticated_client !== true ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        !context.capability.includes(target.kind === 'receipt' ? 'artifact.write' : 'artifact.read')
      )
        throw new TypeError();
      if (target.kind === 'receipt') assertArtifactReceiptIdentity(target.query.identity, context);
    } catch {
      throw new ContractError(
        'ARTIFACT_ACCESS_DENIED',
        'Use the matching verified, unexpired artifact reader or original writer',
        {
          trace_id: trace,
          retryable: false,
        },
      );
    }
  };
  authority();
  const destination =
    output === undefined ? undefined : await prepareArtifactReceiptOutput(output, trace);
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    ...(target.kind === 'receipt'
      ? {
          'x-expected-actor-id': target.query.identity.actor_id,
          'x-expected-client-id': target.query.identity.client_id,
        }
      : {}),
  };
  const path =
    target.kind === 'receipt'
      ? '/v1/artifacts/receipt'
      : target.kind === 'versions'
        ? versionsPath(target.query)
        : target.kind === 'registry'
          ? registryPath(target.query)
          : '/v1/artifacts/' +
            encodeURIComponent(target.query.artifact_id) +
            (target.query.version === undefined ? '' : '/versions/' + target.query.version);
  const body =
    target.kind === 'receipt'
      ? syncJsonSnapshot(target.query, ARTIFACT_UPLOAD_REQUEST_BYTES)
      : undefined;
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authority();
      if (
        request.method !== (target.kind === 'receipt' ? 'POST' : 'GET') ||
        request.path !== path ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !==
          (target.kind === 'versions'
            ? ARTIFACT_VERSIONS_RESPONSE_BYTES
            : target.kind === 'registry'
              ? ARTIFACT_REGISTRY_RESPONSE_BYTES
              : (target.kind === 'receipt' ? 4 : 2) * 1024 * 1024) ||
        Object.keys(request.headers).length !== Object.keys(headers).length ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        (body === undefined
          ? request.body !== undefined
          : syncJsonSnapshot(request.body, ARTIFACT_UPLOAD_REQUEST_BYTES) !== body)
      )
        throw invalid(trace);
      if (request.signal?.aborted)
        throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for artifact data', {
          trace_id: trace,
        });
      const result = await router.execute({
        operation:
          target.kind === 'receipt'
            ? 'artifact.receipt'
            : target.kind === 'versions'
              ? 'artifact.versions.list'
              : target.kind === 'registry'
                ? 'artifact.registry.list'
                : target.query.version === undefined
                  ? 'artifact.read'
                  : 'artifact.version.read',
        input:
          target.kind === 'versions' || target.kind === 'registry'
            ? { ...target.query }
            : target.kind === 'metadata'
              ? {
                  ...target.query,
                  ...(target.query.version === undefined
                    ? {}
                    : { version: String(target.query.version) }),
                }
              : (JSON.parse(body!) as Record<string, unknown>),
        context: structuredClone(context),
      });
      authority();
      return result as unknown as T;
    },
  };
  return executeWithOutput(
    new WcpClient(transport, { ...scope, trace_id: trace }),
    target,
    timeout_ms,
    trace,
    destination,
  );
}

function versionsPath(query: ReturnType<typeof parseArtifactVersionsQuery>) {
  const parameters = new URLSearchParams({ limit: String(query.limit) });
  if (query.at_version !== undefined) parameters.set('at_version', String(query.at_version));
  if (query.before_version !== undefined)
    parameters.set('before_version', String(query.before_version));
  return (
    '/v1/artifacts/' + encodeURIComponent(query.artifact_id) + '/versions?' + parameters.toString()
  );
}

function registryPath(query: ReturnType<typeof parseArtifactRegistryQuery>) {
  const parameters = new URLSearchParams({ limit: String(query.limit) });
  if (query.query !== undefined) parameters.set('query', query.query);
  if (query.classification !== undefined) parameters.set('classification', query.classification);
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor);
  return '/v1/artifacts?' + parameters.toString();
}
