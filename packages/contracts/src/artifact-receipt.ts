import { parseArtifactWrite, type ArtifactWriteCommand } from './artifact-command.js';
import { parseArtifactMetadataView, type ArtifactMetadataView } from './artifact-read.js';
import { isSyncIdentifier } from './sync.js';
import type { SourceRef } from './metadata.js';

export interface ArtifactCommandIdentity {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}
export interface ArtifactReceiptQuery {
  identity: ArtifactCommandIdentity;
  command: ArtifactWriteCommand;
}
export type ArtifactReceiptView = ArtifactReceiptQuery &
  (
    | { status: 'not-observed' }
    | {
        status: 'recorded';
        artifact: ArtifactMetadataView;
        replayed: true;
        content_state: 'not-checked';
      }
  );
export interface ArtifactReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: ArtifactReceiptView;
}

export function parseArtifactCommandIdentity(value: unknown): ArtifactCommandIdentity {
  const row = object(value);
  only(row, ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id']);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isSyncIdentifier(row[key]) || row[key] === '.' || row[key] === '..')
      throw new TypeError('Invalid original artifact scope');
  text(row.actor_id);
  text(row.client_id);
  return {
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
    actor_id: row.actor_id as string,
    client_id: row.client_id as string,
  };
}

/** The identity is an equality precondition, never an authorization credential. */
export function parseArtifactReceiptQuery(value: unknown): ArtifactReceiptQuery {
  const row = object(value);
  only(row, ['identity', 'command']);
  return {
    identity: parseArtifactCommandIdentity(row.identity),
    command: parseArtifactWrite(row.command),
  };
}

export function assertArtifactReceiptIdentity(
  original: ArtifactCommandIdentity,
  actual: {
    tenant_id: string;
    workspace_id: string;
    project_id?: string;
    actor_id?: string;
    client_id?: string;
  },
): void {
  const identity = parseArtifactCommandIdentity(original);
  for (const key of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (identity[key] !== actual[key])
      throw new TypeError('The original artifact request belongs to another identity or project');
}

export function parseArtifactReceiptEnvelope(
  value: unknown,
  input: ArtifactReceiptQuery,
  trace: string,
): ArtifactReceiptEnvelope {
  const query = parseArtifactReceiptQuery(input);
  const row = object(value);
  only(row, ['schema_version', 'trace_id', 'source_refs', 'data']);
  text(trace);
  if (row.schema_version !== 1 || row.trace_id !== trace || !Array.isArray(row.source_refs))
    throw new TypeError('Invalid artifact receipt envelope');
  const data = object(row.data);
  const identity = parseArtifactCommandIdentity(data.identity);
  const command = parseArtifactWrite(data.command);
  if (
    JSON.stringify(identity) !== JSON.stringify(query.identity) ||
    JSON.stringify(command) !== JSON.stringify(query.command)
  )
    throw new TypeError('Artifact receipt differs from the original request');
  const base = { schema_version: 1 as const, trace_id: trace };
  if (data.status === 'not-observed') {
    only(data, ['status', 'identity', 'command']);
    if (row.source_refs.length !== 0 || Object.keys(row.source_refs).length !== 0)
      throw new TypeError('An absent artifact receipt cannot identify a saved result');
    return { ...base, source_refs: [], data: { status: 'not-observed', identity, command } };
  }
  only(data, ['status', 'identity', 'command', 'artifact', 'replayed', 'content_state']);
  if (data.status !== 'recorded' || data.replayed !== true || data.content_state !== 'not-checked')
    throw new TypeError('Invalid recorded artifact receipt');
  const artifact = parseArtifactRecordedSnapshot(data.artifact, query, row.source_refs);
  return {
    ...base,
    source_refs: [{ type: 'artifact', id: artifact.artifact_id, revision: artifact.version }],
    data: {
      status: 'recorded',
      identity,
      command,
      artifact,
      replayed: true,
      content_state: 'not-checked',
    },
  };
}

/** Shared binding for an immutable saved result, never a current-version precondition. */
export function parseArtifactRecordedSnapshot(
  value: unknown,
  input: ArtifactReceiptQuery,
  sources: unknown[],
): ArtifactMetadataView {
  const { identity, command } = parseArtifactReceiptQuery(input);
  const artifact = parseArtifactMetadataView(value);
  if (
    artifact.tenant_id !== identity.tenant_id ||
    artifact.workspace_id !== identity.workspace_id ||
    artifact.project_id !== identity.project_id ||
    artifact.sha256 !== command.sha256 ||
    artifact.size !== command.size
  )
    throw new TypeError('Artifact receipt scope or content descriptor differs');
  if (command.operation === 'artifact.create') {
    if (
      artifact.version !== 1 ||
      artifact.name !== command.name ||
      artifact.mime !== command.mime ||
      artifact.classification !== command.classification ||
      artifact.created_at !== artifact.updated_at ||
      JSON.stringify(artifact.source_refs) !== JSON.stringify(command.source_refs)
    )
      throw new TypeError('Artifact creation receipt differs');
  } else if (
    artifact.artifact_id !== command.artifact_id ||
    artifact.version !== command.expected_version + 1
  )
    throw new TypeError('Artifact version receipt differs');
  if (sources.length !== 1 || Object.keys(sources).length !== 1)
    throw new TypeError('Invalid artifact receipt sources');
  const source = object(sources[0]);
  only(source, ['type', 'id', 'revision']);
  if (
    source.type !== 'artifact' ||
    source.id !== artifact.artifact_id ||
    source.revision !== artifact.version
  )
    throw new TypeError('Artifact receipt source differs');
  return artifact;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an artifact receipt object');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unexpected artifact receipt fields');
}
function text(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError('Invalid artifact identity or trace');
}
