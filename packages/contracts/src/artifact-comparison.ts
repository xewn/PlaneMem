import { parseArtifactMetadataView, parseArtifactReadQuery } from './artifact-read.js';
import type { SourceRef } from './metadata.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export interface ArtifactComparisonQuery {
  artifact_id: string;
  from_version: number;
  to_version: number;
}

/** Explicit saved versions, preserving the caller's comparison direction. */
export function parseArtifactComparisonQuery(input: unknown): ArtifactComparisonQuery {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, 4096));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Choose a file and two saved versions.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['artifact_id', 'from_version', 'to_version'].includes(key)))
    throw new TypeError('Use only the file ID and the two selected versions.');
  const from = parseArtifactReadQuery({ artifact_id: row.artifact_id, version: row.from_version });
  const to = parseArtifactReadQuery({ artifact_id: row.artifact_id, version: row.to_version });
  if (from.version === undefined || to.version === undefined || from.version === to.version)
    throw new TypeError('Choose two different saved versions.');
  return { artifact_id: from.artifact_id, from_version: from.version, to_version: to.version };
}

function sourceKey(source: SourceRef | undefined) {
  return source === undefined
    ? undefined
    : JSON.stringify([source.type, source.id, source.revision ?? null, source.uri ?? null]);
}

/** Local comparison only; metadata does not authenticate a file or verify its stored bytes. */
export function compareArtifactMetadata(before: unknown, after: unknown) {
  const from = parseArtifactMetadataView(JSON.parse(syncJsonSnapshot(before, 2 * 1024 * 1024)));
  const to = parseArtifactMetadataView(JSON.parse(syncJsonSnapshot(after, 2 * 1024 * 1024)));
  if (
    (['tenant_id', 'workspace_id', 'project_id', 'artifact_id'] as const).some(
      (key) => from[key] !== to[key],
    ) ||
    from.version === to.version
  )
    throw new TypeError('Compare two different versions of the same file in the same project.');
  const fields = [
    ['name', 'Name'],
    ['mime', 'File type'],
    ['classification', 'Classification'],
    ['size', 'Size in bytes'],
    ['sha256', 'Saved SHA-256'],
    ['created_at', 'File first recorded'],
    ['updated_at', 'Version saved'],
    ['trace_id', 'Saved record trace'],
  ] as const;
  const rows = fields.map(([key, label]) => ({
    key,
    label,
    before: String(from[key]),
    after: String(to[key]),
    changed: from[key] !== to[key],
  }));
  const sources = Array.from(
    { length: Math.max(from.source_refs.length, to.source_refs.length) },
    (_, index) => {
      const before = from.source_refs[index];
      const after = to.source_refs[index];
      return {
        position: index + 1,
        before,
        after,
        status:
          before === undefined
            ? ('added' as const)
            : after === undefined
              ? ('removed' as const)
              : sourceKey(before) === sourceKey(after)
                ? ('same' as const)
                : ('changed' as const),
      };
    },
  );
  return {
    rows,
    sources,
    content_descriptor_matches: from.sha256 === to.sha256 && from.size === to.size,
    changed_fields: rows.filter((row) => row.changed).length,
    changed_source_positions: sources.filter((row) => row.status !== 'same').length,
  };
}

export type ArtifactMetadataComparison = ReturnType<typeof compareArtifactMetadata>;
