import {
  isUlid,
  parseArtifactCommandIdentity,
  parseArtifactReadEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactUploadContextEnvelope,
  type ArtifactUploadContextEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { WEB_ARTIFACT_UPLOAD_BYTES } from '../../../lib/artifact-upload';
import { encodeArtifactRequest } from '../receipt/model';

export interface ArtifactUploadPreparation {
  context: ArtifactUploadContextEnvelope;
  target?: ReturnType<typeof parseArtifactReadEnvelope>;
}

export function parseArtifactUploadPreparation(
  value: unknown,
  artifactId?: string,
): ArtifactUploadPreparation {
  const row = record(value, ['context', 'target']);
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
    if (row.target !== undefined) throw new TypeError('Unexpected append target');
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
  return { context, target: saved };
}

export function newArtifactUploadHref(artifactId?: string): string {
  if (artifactId === undefined) return '/artifacts/upload/new';
  if (!isUlid(artifactId)) throw new TypeError('Supply an artifact ID');
  return '/artifacts/upload/new?artifact=' + encodeURIComponent(artifactId);
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
