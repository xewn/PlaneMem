import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_DOWNLOAD_DEFAULT_BYTES,
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  ContractError,
  isSyncIdentifier,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
  parseArtifactDownloadQuery,
  parseArtifactDownloadHeaders,
  parseArtifactDownloadEnvelope,
  type ArtifactDownloadEnvelope,
  type ArtifactDownloadQuery,
  type ArtifactMetadataView,
} from '@planemem/contracts';
import { FetchWcpTransport, type WcpBinaryResponse } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';

interface DownloadArguments {
  json?: string;
  json_file?: string;
  output: string;
  max_bytes: number;
  timeout_ms: number;
}
type Scope = { tenant_id: string; workspace_id: string; project_id: string };

function usage(trace: string): ContractError {
  return new ContractError(
    'USAGE_ERROR',
    'Use artifacts download --json OBJECT or --json-file QUERY.json, with --output NEW_FILE; JSON requires artifact_id and version. Optional --max-bytes (0–1073741824), HTTP-only --timeout-ms (1–2147483647); no stdin, repeated flags or --key.',
    { trace_id: trace, dispatch_state: 'not-sent' },
  );
}

export function parseArtifactDownloadArguments(
  argv: string[],
  trace: string,
  embedded = false,
): DownloadArguments {
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        output: { type: 'string' },
        'max-bytes': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (parsed.positionals.join(' ') !== 'artifacts download' || parsed.positionals.length !== 2)
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const values = parsed.values;
    if (
      (values.json === undefined) === (values['json-file'] === undefined) ||
      !values.output?.trim() ||
      values.output === '-' ||
      values.json === '-' ||
      values['json-file'] === '-' ||
      (values['json-file'] !== undefined && !values['json-file'].trim()) ||
      (embedded && values['timeout-ms'] !== undefined)
    )
      throw new TypeError();
    return {
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values['json-file'] === undefined ? {} : { json_file: values['json-file'] }),
      output: values.output,
      max_bytes: integer(
        values['max-bytes'],
        ARTIFACT_DOWNLOAD_DEFAULT_BYTES,
        0,
        ARTIFACT_DOWNLOAD_MAX_BYTES,
      ),
      timeout_ms: integer(values['timeout-ms'], 180_000, 1, 2_147_483_647),
    };
  } catch {
    throw usage(trace);
  }
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError();
  return result;
}

function selectedQuery(text: string, trace: string) {
  try {
    if (Buffer.byteLength(text, 'utf8') > 16 * 1024) throw new TypeError();
    const query = parseArtifactReadQuery(JSON.parse(text));
    if (query.version === undefined) throw new TypeError();
    return { artifact_id: query.artifact_id, version: query.version };
  } catch {
    throw usage(trace);
  }
}

function invalid(trace: string): ContractError {
  return new ContractError(
    'GATEWAY_RESPONSE_INVALID',
    'Artifact response does not match the selected version or verified content',
    { trace_id: trace },
  );
}

async function downloadAndSave(
  rawArgs: DownloadArguments,
  rawScope: Scope,
  trace: string,
  metadata: (query: { artifact_id: string; version: number }) => Promise<unknown>,
  download: (query: ArtifactDownloadQuery, artifact: ArtifactMetadataView) => Promise<unknown>,
) {
  const args = { ...rawArgs };
  const scope = {
    tenant_id: rawScope.tenant_id,
    workspace_id: rawScope.workspace_id,
    project_id: rawScope.project_id,
  };
  if (
    Object.values(scope).some(
      (value) => !isSyncIdentifier(value) || value === '.' || value === '..',
    ) ||
    !Number.isSafeInteger(args.max_bytes) ||
    args.max_bytes < 0 ||
    args.max_bytes > ARTIFACT_DOWNLOAD_MAX_BYTES
  )
    throw usage(trace);
  // Inline JSON is parsed before the first asynchronous dependency; file input is bounded.
  let query: { artifact_id: string; version: number };
  if (args.json !== undefined) query = selectedQuery(args.json, trace);
  else {
    const bytes = await readBoundedArtifactFile(args.json_file!, 16 * 1024, trace);
    try {
      query = selectedQuery(new TextDecoder('utf-8', { fatal: true }).decode(bytes), trace);
    } catch {
      throw usage(trace);
    }
  }
  const output = await prepareArtifactOutput(args.output, trace);
  let delivery: ArtifactDownloadEnvelope | undefined;
  let dispatched = false;
  try {
    const response = await metadata({ ...query });
    let artifact: ArtifactMetadataView;
    try {
      artifact = parseArtifactReadEnvelope(response, query, scope, trace).data.artifact;
    } catch {
      throw invalid(trace);
    }
    if (artifact.size > args.max_bytes)
      throw new ContractError('ARTIFACT_TOO_LARGE', 'Artifact exceeds this download byte limit', {
        trace_id: trace,
      });
    const pinned = parseArtifactDownloadQuery({
      ...query,
      sha256: artifact.sha256,
      size: artifact.size,
    });
    dispatched = true;
    const result = await download({ ...pinned }, artifact);
    try {
      delivery = parseArtifactDownloadEnvelope(result, pinned, scope, trace);
      if (createHash('sha256').update(delivery.data.content).digest('hex') !== pinned.sha256)
        throw new TypeError();
    } catch {
      throw invalid(trace);
    }
    const local = await saveArtifactOutput(output, delivery.data.content, pinned.sha256, trace);
    const { content: _content, ...data } = delivery.data;
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: delivery.source_refs,
      data: { ...data, local },
    };
  } catch (error) {
    const envelope = error instanceof ContractError ? error.envelope : undefined;
    throw new ContractError(
      envelope?.code ?? 'ARTIFACT_DOWNLOAD_FAILED',
      envelope?.message ?? 'Artifact download could not be completed',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...envelope?.details,
          local_state: 'not-saved',
          output_path: output.path,
          audit_state: delivery ? 'release-recorded' : dispatched ? 'unconfirmed' : 'not-requested',
          ...(delivery ? { audit_id: delivery.data.audit_id } : {}),
          recovery:
            'A server release audit does not prove local delivery. Review local output and temporary-file details before making a new explicit request.',
        },
      },
    );
  }
}

export async function callArtifactDownload(
  rawArgs: DownloadArguments,
  options: {
    base: string;
    token: string;
    scope: Scope;
    trace: string;
  },
) {
  const args = { ...rawArgs };
  const scope = { ...options.scope };
  const trace = options.trace;
  const token = options.token.trim();
  let transport: FetchWcpTransport;
  try {
    const base = new URL(options.base);
    if (!token || base.search || base.hash) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    transport = new FetchWcpTransport({
      base_url: base.href,
      access_token: () => token,
      timeout_ms: args.timeout_ms,
    });
  } catch {
    throw usage(trace);
  }
  const headers = {
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    'x-trace-id': trace,
  };
  const path = (query: { artifact_id: string; version: number }) =>
    '/v1/artifacts/' + encodeURIComponent(query.artifact_id) + '/versions/' + query.version;
  return downloadAndSave(
    args,
    scope,
    trace,
    (query) =>
      transport.request({
        method: 'GET',
        path: path(query),
        headers,
        response_type: 'bounded-json',
        max_response_bytes: 2 * 1024 * 1024,
      }),
    async (query, artifact) => {
      const response = await transport.request<WcpBinaryResponse>({
        method: 'GET',
        path: path(query) + '/content',
        headers: {
          ...headers,
          'x-expected-artifact-sha256': query.sha256,
          'x-expected-artifact-size': String(query.size),
        },
        response_type: 'bytes',
        max_response_bytes: query.size,
      });
      try {
        if (response.status !== 200) throw new TypeError();
        const { audit_id } = parseArtifactDownloadHeaders(response.headers, artifact, trace);
        return {
          schema_version: 1,
          trace_id: trace,
          source_refs: [{ type: 'artifact', id: query.artifact_id, revision: query.version }],
          data: {
            artifact,
            content: response.content,
            audit_id,
            audit_state: 'release-recorded',
            content_state: 'verified',
          },
        };
      } catch {
        throw invalid(trace);
      }
    },
  );
}

export async function runArtifactDownload(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = {
    ...original,
    capability: [...original.capability],
    roles: [...(original.roles ?? [])],
  };
  const trace = context.trace_id;
  const args = parseArtifactDownloadArguments(argv, trace, true);
  const expires = Date.parse(context.token_expires_at ?? '');
  if (
    context.authenticated_client !== true ||
    !context.capability.includes('artifact.read') ||
    !Number.isFinite(expires) ||
    expires <= Date.now()
  )
    throw new ContractError(
      'DENIED',
      'Artifact downloads require a verified reader with a valid session',
      { trace_id: trace, dispatch_state: 'not-sent' },
    );
  delete context.idempotency_key;
  delete context.expected_version;
  const execute = (operation: string, input: Record<string, unknown>) =>
    router.execute({
      operation,
      input,
      context: { ...context, capability: [...context.capability], roles: [...context.roles] },
    });
  return downloadAndSave(
    args,
    context,
    trace,
    (query) => execute('artifact.version.read', { ...query, version: String(query.version) }),
    (query) =>
      execute('artifact.download', {
        ...query,
        version: String(query.version),
        size: String(query.size),
      }),
  );
}
