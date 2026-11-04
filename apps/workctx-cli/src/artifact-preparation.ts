import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  createUlid,
  parseArtifactReadEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactWrite,
  syncJsonSnapshot,
  type ArtifactCommandIdentity,
  type ArtifactCreateCommand,
  type ArtifactPutCommand,
  type ArtifactUploadContextEnvelope,
} from '@planemem/contracts';
import { FetchWcpTransport } from '@planemem/sdk';
import {
  artifactUploadContextAuthority,
  type CommandRouter,
  type RequestContext,
} from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';
import { callArtifactUploadContext, runArtifactUploadContext } from './artifact-upload-context.js';

type Draft =
  | Omit<ArtifactCreateCommand, 'request_key' | 'sha256' | 'size'>
  | Omit<ArtifactPutCommand, 'request_key' | 'sha256' | 'size'>;
type NetworkOptions = {
  base: string;
  token: string;
  trace: string;
  scope: { tenant_id: string; workspace_id: string; project_id: string };
};
const usageMessage =
  'Use artifacts prepare --json-file DRAFT.json --file CONTENT --output NEW_ORIGINAL.json; optional --max-bytes and --timeout-ms. Supply new create metadata or an artifact ID with an explicit expected_version; no original identity, command wrapper, key, hash, size, stdin or repeated flags';
function failure(
  code: string,
  message: string,
  trace: string,
  details: Record<string, unknown> = {},
) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...details, upload_dispatch_state: 'not-sent' },
  });
}
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(value)) throw new TypeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new TypeError();
  return parsed;
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'json-file': { type: 'string' },
        file: { type: 'string' },
        output: { type: 'string' },
        'max-bytes': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (parsed.positionals.length !== 2 || parsed.positionals.join(' ') !== 'artifacts prepare')
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const file = parsed.values.file;
    const draft = parsed.values['json-file'];
    const output = parsed.values.output;
    if (
      !file?.trim() ||
      !draft?.trim() ||
      !output?.trim() ||
      [file, draft, output].some((path) => path === '-' || /[\u0000-\u001f]/.test(path))
    )
      throw new TypeError();
    return {
      file,
      draft,
      output,
      max_bytes: integer(
        parsed.values['max-bytes'],
        ARTIFACT_UPLOAD_DEFAULT_BYTES,
        0,
        ARTIFACT_UPLOAD_MAX_BYTES,
      ),
      timeout_ms: integer(parsed.values['timeout-ms'], 180_000, 1, 2_147_483_647),
    };
  } catch {
    throw failure('USAGE_ERROR', usageMessage, trace);
  }
}
async function readDraft(path: string, trace: string): Promise<Draft> {
  const bytes = await readBoundedArtifactFile(path, ARTIFACT_UPLOAD_REQUEST_BYTES, trace);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const row = JSON.parse(syncJsonSnapshot(value, ARTIFACT_UPLOAD_REQUEST_BYTES)) as Record<
      string,
      unknown
    >;
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      ['identity', 'command', 'request_key', 'idempotency_key', 'sha256', 'size'].some((key) =>
        Object.hasOwn(row, key),
      )
    )
      throw new TypeError();
    // Validate only new draft fields with the existing write parser, without allocating a request key.
    const normalized = parseArtifactWrite({
      ...row,
      request_key: 'preparation-validation',
      sha256: '0'.repeat(64),
      size: 0,
    });
    const { request_key: _key, sha256: _hash, size: _size, ...draft } = normalized;
    return draft;
  } catch {
    throw failure('USAGE_ERROR', usageMessage, trace);
  }
}
async function descriptor(path: string, maximum: number, trace: string) {
  const bytes = await readBoundedArtifactFile(path, maximum, trace);
  return { size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
/** Only race read-only remote work. Local file publication is always awaited to settlement. */
async function waitRead<T>(read: () => Promise<T>, timeout: number, trace: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              failure(
                'GATEWAY_REQUEST_TIMEOUT',
                'Artifact preparation reads exceeded the local deadline',
                trace,
              ),
            ),
          timeout,
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function prepare(
  argv: string[],
  trace: string,
  readIdentity: (timeout: number) => Promise<ArtifactUploadContextEnvelope>,
  readCurrent: (id: string, identity: ArtifactCommandIdentity, timeout: number) => Promise<unknown>,
) {
  const args = argumentsFor(argv, trace);
  const deadline = performance.now() + args.timeout_ms;
  const remaining = () => {
    const milliseconds = Math.ceil(deadline - performance.now());
    if (milliseconds < 1)
      throw failure(
        'GATEWAY_REQUEST_TIMEOUT',
        'Artifact preparation reads exceeded the local deadline',
        trace,
      );
    return milliseconds;
  };
  try {
    // Reject an occupied destination and invalid new draft before making any gateway call.
    const output = await prepareArtifactOutput(args.output, trace);
    remaining();
    const draft = await readDraft(args.draft, trace);
    const timeout = remaining();
    const caller = await waitRead(() => readIdentity(timeout), timeout, trace);
    const currentIdentity = () => {
      remaining();
      if (Date.parse(caller.data.expires_at) <= Date.now())
        throw failure('DENIED', 'Upload identity expired before local request preparation', trace);
    };
    currentIdentity();
    if (
      (draft.operation === 'artifact.put-version' && !caller.data.can_read) ||
      (draft.operation === 'artifact.create' &&
        draft.classification === 'restricted' &&
        !caller.data.can_read_restricted)
    )
      throw failure(
        'ARTIFACT_ACCESS_DENIED',
        'This preparation requires the matching read capability',
        trace,
      );
    const content = await descriptor(
      args.file,
      Math.min(args.max_bytes, caller.data.max_bytes),
      trace,
    );
    currentIdentity();
    if (draft.operation === 'artifact.put-version') {
      const readTimeout = remaining();
      const raw = await waitRead(
        () => readCurrent(draft.artifact_id, { ...caller.data.identity }, readTimeout),
        readTimeout,
        trace,
      );
      currentIdentity();
      let artifact;
      try {
        artifact = parseArtifactReadEnvelope(
          JSON.parse(syncJsonSnapshot(raw, 2 * 1024 * 1024)),
          { artifact_id: draft.artifact_id },
          caller.data.identity,
          trace,
        ).data.artifact;
      } catch {
        throw failure(
          'GATEWAY_RESPONSE_INVALID',
          'Current artifact metadata could not be confirmed',
          trace,
        );
      }
      if (artifact.classification === 'restricted' && !caller.data.can_read_restricted)
        throw failure('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', trace);
      if (artifact.version !== draft.expected_version)
        throw failure(
          'ARTIFACT_VERSION_CONFLICT',
          'The reviewed version changed; review current metadata before preparing a different request',
          trace,
        );
    }
    // Check the exact final size before allocating the one new key; the placeholder has equal length.
    const candidate = parseArtifactReceiptQuery({
      identity: caller.data.identity,
      command: { ...draft, ...content, request_key: 'workctx-artifact-' + '0'.repeat(26) },
    });
    syncJsonSnapshot(candidate, ARTIFACT_UPLOAD_REQUEST_BYTES);
    currentIdentity();
    const original = parseArtifactReceiptQuery({
      identity: candidate.identity,
      command: { ...candidate.command, request_key: 'workctx-artifact-' + createUlid() },
    });
    const raw = syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
    const bytes = new TextEncoder().encode(raw);
    const requestHash = createHash('sha256').update(bytes).digest('hex');
    currentIdentity();
    let saved;
    try {
      // From here on, do not race the local save against timeout or expiry.
      saved = await saveArtifactOutput(output, bytes, requestHash, trace);
    } catch (error) {
      throw failure(
        'ARTIFACT_PREPARATION_SAVE_FAILED',
        'The original request could not be saved completely; inspect reported local paths before preparing again. No upload was sent',
        trace,
        error instanceof ContractError ? error.envelope.details : { output_path: output.path },
      );
    }
    try {
      const stored = await readBoundedArtifactFile(
        saved.path,
        ARTIFACT_UPLOAD_REQUEST_BYTES,
        trace,
        bytes.byteLength,
      );
      if (createHash('sha256').update(stored).digest('hex') !== requestHash) throw new TypeError();
      const verified = parseArtifactReceiptQuery(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored)),
      );
      if (syncJsonSnapshot(verified, ARTIFACT_UPLOAD_REQUEST_BYTES) !== raw) throw new TypeError();
    } catch {
      throw failure(
        'ARTIFACT_PREPARATION_READBACK_FAILED',
        'The output was created but final contents could not be confirmed; keep it for inspection. No upload was sent and the file was not replaced or removed',
        trace,
        {
          local_state: 'published-unconfirmed',
          output_path: saved.path,
          cleanup_pending: saved.cleanup_pending,
          ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
        },
      );
    }
    return {
      schema_version: 1 as const,
      trace_id: trace,
      source_refs:
        draft.operation === 'artifact.put-version'
          ? [{ type: 'artifact', id: draft.artifact_id, revision: draft.expected_version }]
          : [],
      data: {
        status: 'prepared' as const,
        original_file: saved.path,
        request_sha256: requestHash,
        identity: original.identity,
        identity_observed_expires_at: caller.data.expires_at,
        request_key: original.command.request_key,
        operation: original.command.operation,
        ...(original.command.operation === 'artifact.put-version'
          ? {
              artifact_id: original.command.artifact_id,
              expected_version: original.command.expected_version,
            }
          : {}),
        ...content,
        local_state: 'saved-and-read-back' as const,
        upload_dispatch_state: 'not-sent' as const,
        next_action: 'review-original-file' as const,
        cleanup_pending: saved.cleanup_pending,
        ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
      },
    };
  } catch (error) {
    if (error instanceof ContractError) {
      const envelope = error.envelope;
      throw failure(
        envelope.code,
        ['ARTIFACT_FILE_UNAVAILABLE', 'USAGE_ERROR'].includes(envelope.code)
          ? envelope.message.replace(/no request was sent/gi, 'no upload was sent') +
              '; preparation did not send an upload'
          : envelope.message,
        trace,
        envelope.details,
      );
    }
    throw failure(
      'ARTIFACT_PREPARATION_FAILED',
      'Could not prepare the original request; no upload was sent',
      trace,
    );
  }
}

export function callArtifactPreparation(argv: string[], options: NetworkOptions) {
  const captured = structuredClone(options);
  return prepare(
    argv,
    captured.trace,
    (timeout) =>
      callArtifactUploadContext(
        ['artifacts', 'identity', '--timeout-ms', String(timeout)],
        captured,
      ),
    async (id, identity, timeout) => {
      let transport: FetchWcpTransport;
      try {
        const base = new URL(captured.base);
        const token = captured.token.trim();
        if (base.search || base.hash || !token) throw new TypeError();
        new Headers({ authorization: 'Bearer ' + token });
        transport = new FetchWcpTransport({
          base_url: base.href,
          access_token: () => token,
          timeout_ms: timeout,
        });
      } catch {
        throw failure('USAGE_ERROR', 'Configure a valid gateway and bearer token', captured.trace);
      }
      return transport.request({
        method: 'GET',
        path: '/v1/artifacts/' + encodeURIComponent(id),
        headers: {
          'x-trace-id': captured.trace,
          'x-tenant-id': identity.tenant_id,
          'x-workspace-id': identity.workspace_id,
          'x-project-id': identity.project_id,
          'x-expected-actor-id': identity.actor_id,
          'x-expected-client-id': identity.client_id,
        },
        response_type: 'bounded-json',
        max_response_bytes: 2 * 1024 * 1024,
      });
    },
  );
}
export function runArtifactPreparation(
  argv: string[],
  router: CommandRouter,
  input: RequestContext,
) {
  const context = structuredClone(input);
  if (context.idempotency_key !== undefined || context.expected_version !== undefined)
    throw failure(
      'USAGE_ERROR',
      'New artifact preparation cannot inherit write conditions',
      context.trace_id,
    );
  return prepare(
    argv,
    context.trace_id,
    (timeout) =>
      runArtifactUploadContext(
        ['artifacts', 'identity', '--timeout-ms', String(timeout)],
        router,
        context,
      ),
    async (id, identity) => {
      const check = () => {
        artifactUploadContextAuthority(context);
        assertArtifactReceiptIdentity(identity, context);
        if (!context.capability.includes('artifact.read'))
          throw failure(
            'ARTIFACT_ACCESS_DENIED',
            'Append preparation requires artifact read access',
            context.trace_id,
          );
      };
      check();
      const raw = await router.execute({
        operation: 'artifact.read',
        input: { artifact_id: id },
        context: structuredClone(context),
      });
      check();
      return raw;
    },
  );
}
