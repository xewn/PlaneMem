import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptQuery,
  syncJsonSnapshot,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';

function failure(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { upload_dispatch_state: 'not-sent', server_outcome: 'not-checked' },
  });
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
        'max-bytes': { type: 'string' },
      },
    });
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'artifacts inspect-request'
    )
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const request = parsed.values['json-file'];
    const content = parsed.values.file;
    const limit = parsed.values['max-bytes'];
    if (!request || (limit !== undefined && content === undefined)) throw new TypeError();
    for (const path of [request, ...(content === undefined ? [] : [content])]) {
      if (!path.trim() || path === '-' || /[\u0000-\u001f]/.test(path)) throw new TypeError();
    }
    let maximum = ARTIFACT_UPLOAD_DEFAULT_BYTES;
    if (limit !== undefined) {
      if (!/^(0|[1-9][0-9]{0,9})$/.test(limit)) throw new TypeError();
      maximum = Number(limit);
      if (!Number.isSafeInteger(maximum) || maximum > ARTIFACT_UPLOAD_MAX_BYTES)
        throw new TypeError();
    }
    return {
      request: resolve(request),
      content: content === undefined ? undefined : resolve(content),
      maximum,
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use artifacts inspect-request --json-file ORIGINAL.json; optional --file CONTENT and --max-bytes (0..1073741824, only with --file). No stdin, JSON text, repeated flags or other options',
      trace,
    );
  }
}

/** A local file is input to inspect, never authentication or evidence of a server outcome. */
export async function inspectArtifactRequestArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  try {
    const bytes = await readBoundedArtifactFile(args.request, ARTIFACT_UPLOAD_REQUEST_BYTES, trace);
    let original: ArtifactReceiptQuery;
    let canonical: string;
    try {
      original = parseArtifactReceiptQuery(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      canonical = syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
    } catch {
      throw failure(
        'ARTIFACT_REQUEST_INVALID',
        'The file must contain one complete UTF-8 identity/command original request within 1 MiB; keep the file for inspection',
        trace,
      );
    }
    if (args.content !== undefined) {
      const content = await readBoundedArtifactFile(
        args.content,
        args.maximum,
        trace,
        original.command.size,
      );
      if (createHash('sha256').update(content).digest('hex') !== original.command.sha256)
        throw failure(
          'ARTIFACT_HASH_MISMATCH',
          'Content SHA-256 differs from the original request; retain that request and locate its exact content',
          trace,
        );
    }
    return {
      schema_version: 1 as const,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'locally-valid' as const,
        original_file: args.request,
        request_bytes: bytes.byteLength,
        request_sha256: createHash('sha256').update(bytes).digest('hex'),
        canonical_request_sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
        original,
        identity_state: 'not-authenticated' as const,
        server_outcome: 'not-checked' as const,
        content_state:
          args.content === undefined ? ('not-checked' as const) : ('matches-original' as const),
        ...(args.content === undefined ? {} : { content_file: args.content }),
        upload_dispatch_state: 'not-sent' as const,
      },
    };
  } catch (error) {
    if (error instanceof ContractError)
      throw failure(error.envelope.code, error.envelope.message, trace);
    throw failure(
      'ARTIFACT_REQUEST_INSPECTION_FAILED',
      'Could not inspect the local original request; retain the files. No upload was sent',
      trace,
    );
  }
}
