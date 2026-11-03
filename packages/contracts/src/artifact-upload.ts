import {
  parseArtifactReceiptQuery,
  parseArtifactRecordedSnapshot,
  type ArtifactReceiptQuery,
} from './artifact-receipt.js';
import type { ArtifactMetadataView } from './artifact-read.js';
import type { SourceRef } from './metadata.js';

export const ARTIFACT_UPLOAD_REQUEST_BYTES = 1024 * 1024;
export const ARTIFACT_UPLOAD_DEFAULT_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export interface ArtifactUploadEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: ArtifactReceiptQuery & {
    status: 'recorded';
    artifact: ArtifactMetadataView;
  } & (
      | { replayed: false; content_state: 'verified-at-save' }
      | { replayed: true; content_state: 'not-checked' }
    );
}

export function parseArtifactUploadEnvelope(
  value: unknown,
  input: ArtifactReceiptQuery,
  trace: string,
): ArtifactUploadEnvelope {
  const original = parseArtifactReceiptQuery(input);
  const row = object(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(trace) ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError('Invalid artifact upload envelope');
  const data = object(row.data, [
    'identity',
    'command',
    'status',
    'artifact',
    'replayed',
    'content_state',
  ]);
  const query = parseArtifactReceiptQuery({ identity: data.identity, command: data.command });
  if (JSON.stringify(query) !== JSON.stringify(original) || data.status !== 'recorded')
    throw new TypeError('Artifact upload differs from the original request');
  const state =
    data.replayed === false && data.content_state === 'verified-at-save'
      ? { replayed: false as const, content_state: 'verified-at-save' as const }
      : data.replayed === true && data.content_state === 'not-checked'
        ? { replayed: true as const, content_state: 'not-checked' as const }
        : undefined;
  if (!state) throw new TypeError('Invalid artifact upload content state');
  const artifact = parseArtifactRecordedSnapshot(data.artifact, query, row.source_refs);
  if (!state.replayed && artifact.trace_id !== trace)
    throw new TypeError('Initial artifact save trace differs');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'artifact', id: artifact.artifact_id, revision: artifact.version }],
    data: { ...query, status: 'recorded', artifact, ...state },
  };
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid artifact upload fields');
  return value as Record<string, unknown>;
}
