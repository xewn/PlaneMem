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
  syncJsonSnapshot,
  type ArtifactDownloadEnvelope,
  type ArtifactDownloadQuery,
  type ArtifactMetadataView,
} from '@planemem/contracts';
import { FetchWcpTransport, type WcpBinaryResponse } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';
import { artifactDownloadBudget } from './artifact-download-budget.js';
import { artifactDownloadResponse, artifactDownloadFailure } from './artifact-download-response.js';

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
    'Use artifacts download --json OBJECT or --json-file QUERY.json, with --output NEW_FILE; JSON requires artifact_id and version. Optional --max-bytes (0–1073741824), --timeout-ms (1–2147483647) for metadata/content reads and verification, not file I/O; no stdin, repeated flags or --key.',
    { trace_id: trace, dispatch_state: 'not-sent' },
  );
}

export function parseArtifactDownloadArguments(
  argv: string[],
  trace: string,
  _embedded = false,
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
      (values['json-file'] !== undefined && !values['json-file'].trim())
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
  metadata: (
    query: { artifact_id: string; version: number },
    signal: AbortSignal,
  ) => Promise<unknown>,
  download: (
    query: ArtifactDownloadQuery,
    artifact: ArtifactMetadataView,
    signal: AbortSignal,
    recordRelease: (id: string) => void,
  ) => Promise<unknown>,
  authority: () => void = () => {},
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
    args.max_bytes > ARTIFACT_DOWNLOAD_MAX_BYTES ||
    !Number.isSafeInteger(args.timeout_ms) ||
    args.timeout_ms < 1 ||
    args.timeout_ms > 2_147_483_647
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
  const budget = artifactDownloadBudget(args.timeout_ms, trace);
  let delivery: ArtifactDownloadEnvelope | undefined;
  let release: string | undefined;
  let dispatched = false;
  let saving = false;
  try {
    authority();
    const response = await budget.wait(() => metadata({ ...query }, budget.signal));
    authority();
    let artifact: ArtifactMetadataView;
    try {
      artifact = parseArtifactReadEnvelope(
        JSON.parse(syncJsonSnapshot(response, 2 * 1024 * 1024)),
        query,
        scope,
        trace,
      ).data.artifact;
    } catch {
      throw invalid(trace);
    }
    budget.check();
    if (artifact.size > args.max_bytes)
      throw new ContractError('ARTIFACT_TOO_LARGE', 'Artifact exceeds this download byte limit', {
        trace_id: trace,
      });
    const pinned = parseArtifactDownloadQuery({
      ...query,
      sha256: artifact.sha256,
      size: artifact.size,
    });
    const result = await budget.wait(() => {
      dispatched = true;
      return download(
        { ...pinned },
        { ...artifact, source_refs: structuredClone(artifact.source_refs) },
        budget.signal,
        (id) => {
          release = id;
        },
      );
    });
    authority();
    try {
      delivery = artifactDownloadResponse(result, pinned, scope, trace);
      release = delivery.data.audit_id;
    } catch {
      throw invalid(trace);
    }
    budget.check();
    if (createHash('sha256').update(delivery.data.content).digest('hex') !== pinned.sha256)
      throw new ContractError('ARTIFACT_HASH_MISMATCH', 'Content SHA-256 did not match', {
        trace_id: trace,
      });
    budget.check();
    authority();
    budget.check();
    // Stop the read budget before publication. File writes/cleanup must settle before reporting.
    budget.close();
    saving = true;
    const local = await saveArtifactOutput(output, delivery.data.content, pinned.sha256, trace);
    const { content: _content, ...data } = delivery.data;
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: delivery.source_refs,
      data: { ...data, local },
    };
  } catch (error) {
    let cause = error;
    if (!saving) {
      try {
        budget.check();
      } catch (expired) {
        cause = expired;
      }
    }
    const details = {
      local_state: 'not-saved',
      output_path: output.path,
      content_dispatch_state: dispatched ? 'started' : 'not-sent',
      audit_state:
        release !== undefined ? 'release-recorded' : dispatched ? 'unconfirmed' : 'not-requested',
      ...(release === undefined ? {} : { audit_id: release }),
      recovery:
        'A server release audit does not prove local delivery. Review local output and temporary-file details before making a new explicit request.',
    };
    // Only the locally invoked save helper can supply filesystem recovery details.
    if (saving) {
      const local =
        cause instanceof ContractError &&
        cause.envelope.trace_id === trace &&
        cause.envelope.code === 'ARTIFACT_SAVE_FAILED'
          ? cause.envelope
          : undefined;
      throw new ContractError(
        'ARTIFACT_SAVE_FAILED',
        'Could not finish saving verified content; inspect the local recovery details before another explicit download',
        {
          trace_id: trace,
          retryable: false,
          details: { ...local?.details, ...details },
        },
      );
    }
    throw artifactDownloadFailure(cause, trace, details);
  } finally {
    budget.close();
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
    (query, signal) =>
      transport.request({
        method: 'GET',
        path: path(query),
        headers,
        response_type: 'bounded-json',
        max_response_bytes: 2 * 1024 * 1024,
        signal,
      }),
    async (query, artifact, signal, recordRelease) => {
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
        signal,
      });
      try {
        if (response.status !== 200) throw new TypeError();
        const responseHeaders = JSON.parse(syncJsonSnapshot(response.headers, 16 * 1024)) as Record<
          string,
          string
        >;
        if (Object.values(responseHeaders).some((value) => typeof value !== 'string'))
          throw new TypeError();
        const { audit_id } = parseArtifactDownloadHeaders(responseHeaders, artifact, trace);
        recordRelease(audit_id);
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
  const context = structuredClone(original);
  const trace = context.trace_id;
  const args = parseArtifactDownloadArguments(argv, trace, true);
  const authority = () => {
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
        {
          trace_id: trace,
          retryable: false,
        },
      );
  };
  authority();
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const execute = async (operation: string, input: Record<string, unknown>) => {
    authority();
    const result = await router.execute({
      operation,
      input,
      context: structuredClone(context),
    });
    authority();
    return result;
  };
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
    authority,
  );
}
