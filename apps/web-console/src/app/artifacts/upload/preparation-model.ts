import {
  isUlid,
  parseArtifactCommandIdentity,
  parseArtifactReadEnvelope,
  parseArtifactReadQuery,
  parseArtifactReceiptQuery,
  parseArtifactUploadContextEnvelope,
  type ArtifactUploadContextEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { WEB_ARTIFACT_UPLOAD_BYTES } from '../../../lib/artifact-upload';
import { encodeArtifactRequest } from '../receipt/model';
import type { ArtifactPageParams } from '../query';

export interface ArtifactUploadPreparation {
  context: ArtifactUploadContextEnvelope;
  target?: ReturnType<typeof parseArtifactReadEnvelope>;
  expected_version?: number;
}

export function parseArtifactUploadPreparation(
  value: unknown,
  artifactId?: string,
): ArtifactUploadPreparation {
  const row = record(value, ['context', 'target', 'expected_version']);
  const envelope = record(row.context, ['schema_version', 'trace_id', 'source_refs', 'data']);
  const data = record(envelope.data, [
    'identity',
    'expires_at',
    'max_bytes',
    'can_read',
    'can_read_restricted',
  ]);
  const identity = parseArtifactCommandIdentity(data.identity);
  if (typeof envelope.trace_id !== 'string') throw new TypeError('Missing preparation trace');
  const context = parseArtifactUploadContextEnvelope(envelope, identity, envelope.trace_id);
  if (artifactId === undefined) {
    if (row.target !== undefined || row.expected_version !== undefined)
      throw new TypeError('Unexpected append target or selected version');
    return { context };
  }
  if (!isUlid(artifactId) || !context.data.can_read)
    throw new TypeError('Append metadata is required');
  const target = record(row.target, [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
    'revision',
    'etag',
  ]);
  if (typeof target.trace_id !== 'string') throw new TypeError('Missing metadata trace');
  const saved = parseArtifactReadEnvelope(
    target,
    { artifact_id: artifactId },
    identity,
    target.trace_id,
  );
  if (saved.data.artifact.classification === 'restricted' && !context.data.can_read_restricted)
    throw new TypeError('Restricted artifact access is required');
  const selection = parseArtifactReadQuery({
    artifact_id: artifactId,
    ...(row.expected_version === undefined ? {} : { version: row.expected_version }),
  });
  if (selection.version !== undefined && saved.data.artifact.version !== selection.version)
    throw new TypeError('The selected version no longer matches the current file.');
  return {
    context,
    target: saved,
    ...(selection.version === undefined ? {} : { expected_version: selection.version }),
  };
}

export function parseArtifactPreparationPageQuery(params: ArtifactPageParams): {
  artifact_id?: string;
  expected_version?: number;
} {
  if (Object.keys(params).some((key) => !['artifact', 'expected_version'].includes(key)))
    throw new Error('Use a file ID and an optional selected version to prepare a new request.');
  if (params.artifact === undefined && params.expected_version === undefined) return {};
  if (!isUlid(params.artifact))
    throw new Error('Use one complete file ID for the selected version.');
  if (
    params.expected_version !== undefined &&
    (typeof params.expected_version !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(params.expected_version) ||
      !Number.isSafeInteger(Number(params.expected_version)))
  )
    throw new Error('Use one positive selected version without spaces or leading zeros.');
  const query = parseArtifactReadQuery({
    artifact_id: params.artifact,
    ...(params.expected_version === undefined ? {} : { version: Number(params.expected_version) }),
  });
  return {
    artifact_id: query.artifact_id,
    ...(query.version === undefined ? {} : { expected_version: query.version }),
  };
}

export function newArtifactUploadHref(artifactId?: string, expectedVersion?: number): string {
  if (artifactId === undefined) {
    if (expectedVersion !== undefined) throw new TypeError('A selected version requires a file ID');
    return '/artifacts/upload/new';
  }
  const query = parseArtifactReadQuery({
    artifact_id: artifactId,
    ...(expectedVersion === undefined ? {} : { version: expectedVersion }),
  });
  const params = new URLSearchParams({ artifact: query.artifact_id });
  if (query.version !== undefined) params.set('expected_version', String(query.version));
  return '/artifacts/upload/new?' + params.toString();
}

export function buildNewArtifactRequest(
  preparation: ArtifactUploadPreparation,
  details: unknown,
  content: { size: number; sha256: string },
  key: string,
): ArtifactReceiptQuery {
  const fixed = parseArtifactUploadPreparation(
    preparation,
    preparation.target?.data.artifact.artifact_id,
  );
  if (Date.parse(fixed.context.data.expires_at) <= Date.now())
    throw new TypeError(
      'This preparation has expired. Open a new preparation before creating a request.',
    );
  if (content.size > Math.min(WEB_ARTIFACT_UPLOAD_BYTES, fixed.context.data.max_bytes))
    throw new TypeError('The file exceeds the preparation limit.');
  const fields = record(
    details,
    fixed.target ? [] : ['name', 'mime', 'classification', 'source_refs'],
  );
  if (fields.classification === 'restricted' && !fixed.context.data.can_read_restricted)
    throw new TypeError('Restricted file access is required.');
  const supplied = record(content, ['size', 'sha256']);
  const descriptor = { size: supplied.size, sha256: supplied.sha256 };
  const request = parseArtifactReceiptQuery({
    identity: fixed.context.data.identity,
    command: fixed.target
      ? {
          operation: 'artifact.put-version',
          artifact_id: fixed.target.data.artifact.artifact_id,
          expected_version: fixed.target.data.artifact.version,
          request_key: key,
          ...descriptor,
        }
      : { operation: 'artifact.create', ...fields, request_key: key, ...descriptor },
  });
  encodeArtifactRequest(request);
  return request;
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError('Invalid preparation fields');
  return value as Record<string, unknown>;
}
