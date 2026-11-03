import { readBoundedArtifactFile } from './artifact-files.js';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptQuery,
  parseArtifactUploadEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';

export interface ArtifactUploadArguments {
  operation: ArtifactReceiptQuery['command']['operation'];
  request_file: string;
  content_file: string;
  max_bytes: number;
  timeout_ms: number;
}

export function isArtifactUploadCommand(command: string): boolean {
  return command === 'artifacts create' || command === 'artifacts put-version';
}

/** Both CLI entrypoints require a saved request; stdin and inline JSON are not uploads. */
export function parseArtifactUploadArguments(
  argv: string[],
  trace: string,
  embedded = false,
): ArtifactUploadArguments {
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      tokens: true,
      options: {
        'json-file': { type: 'string' },
        file: { type: 'string' },
        'max-bytes': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const command = parsed.positionals.join(' ');
    if (parsed.positionals.length !== 2 || !isArtifactUploadCommand(command)) throw new TypeError();
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const request = parsed.values['json-file'];
    const content = parsed.values.file;
    if (embedded && parsed.values['timeout-ms'] !== undefined) throw new TypeError();
    if (!request?.trim() || !content?.trim() || request === '-' || content === '-')
      throw new TypeError();
    return {
      operation: command === 'artifacts create' ? 'artifact.create' : 'artifact.put-version',
      request_file: request,
      content_file: content,
      max_bytes: integerOption(
        parsed.values['max-bytes'],
        ARTIFACT_UPLOAD_DEFAULT_BYTES,
        0,
        ARTIFACT_UPLOAD_MAX_BYTES,
      ),
      timeout_ms: integerOption(parsed.values['timeout-ms'], 180_000, 1, 2_147_483_647),
    };
  } catch {
    throw usage(
      'Use artifacts create/put-version --json-file ORIGINAL.json --file CONTENT; optional --max-bytes (0–1073741824) and HTTP-only --timeout-ms (1–2147483647). Do not repeat flags or supply --json/--key.',
      trace,
    );
  }
}

export async function readArtifactUploadQuery(
  args: ArtifactUploadArguments,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
): Promise<ArtifactReceiptQuery> {
  const bytes = await readBoundedArtifactFile(
    args.request_file,
    ARTIFACT_UPLOAD_REQUEST_BYTES,
    trace,
  );
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const query = parseArtifactReceiptQuery(JSON.parse(text));
    if (
      query.command.operation !== args.operation ||
      query.identity.tenant_id !== scope.tenant_id ||
      query.identity.workspace_id !== scope.workspace_id ||
      query.identity.project_id !== scope.project_id ||
      query.command.size > args.max_bytes ||
      Buffer.byteLength(JSON.stringify(query), 'utf8') > ARTIFACT_UPLOAD_REQUEST_BYTES
    )
      throw new TypeError();
    return query;
  } catch {
    throw usage(
      'Original request must be valid UTF-8 identity/command JSON matching this operation, project and file size limit',
      trace,
    );
  }
}

export async function readArtifactUploadContent(
  args: ArtifactUploadArguments,
  original: ArtifactReceiptQuery,
  trace: string,
): Promise<Uint8Array> {
  const query = parseArtifactReceiptQuery(original);
  const bytes = await readBoundedArtifactFile(
    args.content_file,
    args.max_bytes,
    trace,
    query.command.size,
  );
  if (createHash('sha256').update(bytes).digest('hex') !== query.command.sha256)
    throw usage(
      'File SHA-256 differs from the saved request; retain the original request and locate its exact content',
      trace,
    );
  return bytes;
}

export function artifactUploadForm(original: ArtifactReceiptQuery, bytes: Uint8Array): FormData {
  const query = parseArtifactReceiptQuery(original);
  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify(query)], { type: 'application/json' }),
    'request.json',
  );
  const copy = new Uint8Array(bytes);
  form.append(
    'content',
    new Blob([copy.buffer], { type: 'application/octet-stream' }),
    'content.bin',
  );
  return form;
}

export function artifactUploadResult(value: unknown, query: ArtifactReceiptQuery, trace: string) {
  try {
    return parseArtifactUploadEnvelope(value, query, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Artifact upload result does not match the original request',
      { trace_id: trace },
    );
  }
}

/** Failure of this attempt never disproves an earlier success with the same request. */
export function artifactUploadUnconfirmed(error: unknown, trace: string): ContractError {
  const original = error instanceof ContractError ? error.envelope : undefined;
  return new ContractError(
    original?.code ?? 'ARTIFACT_UPLOAD_UNCONFIRMED',
    original?.message ?? 'Artifact upload could not be confirmed',
    {
      trace_id: trace,
      retryable: original?.retryable ?? false,
      details: {
        ...original?.details,
        artifact_outcome: 'unconfirmed',
        recovery:
          'Keep the original request JSON and content. Query artifacts receipt with that JSON; do not change its identity, key or expected version.',
      },
    },
  );
}

function integerOption(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new TypeError();
  return number;
}

function usage(message: string, trace: string): ContractError {
  return new ContractError('USAGE_ERROR', message, { trace_id: trace, dispatch_state: 'not-sent' });
}
