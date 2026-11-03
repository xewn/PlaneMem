import {
  buildEtag,
  isUlid,
  isSyncIdentifier,
  parseArtifactWrite,
  validateSourceRef,
  type ArtifactWriteCommand,
  type Classification,
  type SourceRef,
} from '@planemem/contracts';
import { createHash } from 'node:crypto';

export interface ArtifactIdentity {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}
/** Supplied by an authenticated caller, never copied from a public request body. */
export interface ArtifactAccess extends ArtifactIdentity {
  trace_id: string;
  capabilities: readonly string[];
}
export interface PersistentArtifactMetadata {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  artifact_id: string;
  name: string;
  mime: string;
  classification: Classification;
  source_refs: SourceRef[];
  storage_key: string;
  sha256: string;
  size: number;
  version: number;
  etag: string;
  trace_id: string;
  created_at: string;
  updated_at: string;
}
export type ArtifactWriteResult = {
  status: 'recorded';
  artifact: PersistentArtifactMetadata;
  replayed: boolean;
  trace_id: string;
};
export type ArtifactReceiptResult =
  | ArtifactWriteResult
  | { status: 'not-observed'; trace_id: string };

export interface ArtifactSqlTransaction {
  query<T>(sql: string, parameters: unknown[]): Promise<T[]>;
}
export interface ArtifactDatabase extends ArtifactSqlTransaction {
  /** One transaction/connection; resolve only after COMMIT, reject on rollback or unknown commit. No implicit replay. */
  transaction<T>(work: (transaction: ArtifactSqlTransaction) => Promise<T>): Promise<T>;
}
export interface ImmutableArtifactObjects {
  /** Create only when absent; an existing key must never be overwritten. */
  putIfAbsent(key: string, content: Uint8Array): Promise<void>;
  /** Enforce maxBytes while reading; undefined means absent, not an empty object. */
  read(key: string, maxBytes: number): Promise<Uint8Array | undefined>;
}

const classifications: Classification[] = ['public', 'internal', 'confidential', 'restricted'];
export function parseArtifactAccess(value: ArtifactAccess): ArtifactAccess {
  const row = object(value);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const) identifier(row[field]);
  for (const field of ['actor_id', 'client_id', 'trace_id'] as const) text(row[field], 1024);
  if (
    !Array.isArray(row.capabilities) ||
    row.capabilities.some((entry) => typeof entry !== 'string')
  )
    throw new TypeError('Invalid artifact capabilities');
  return {
    tenant_id: value.tenant_id,
    workspace_id: value.workspace_id,
    project_id: value.project_id,
    actor_id: value.actor_id,
    client_id: value.client_id,
    trace_id: value.trace_id,
    capabilities: [...value.capabilities],
  };
}

export function parsePersistentArtifact(value: unknown): PersistentArtifactMetadata {
  const row = object(value);
  if (row.schema_version !== 1 || !isUlid(row.artifact_id))
    throw new TypeError('Invalid artifact record');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const) identifier(row[field]);
  text(row.name, 255);
  mime(row.mime);
  classification(row.classification);
  text(row.trace_id, 1024);
  hash(row.sha256);
  integer(row.size, 0);
  integer(row.version, 1);
  const created = timestamp(row.created_at);
  const updated = timestamp(row.updated_at);
  if (Date.parse(updated) < Date.parse(created) || row.etag !== buildEtag(row.version as number))
    throw new TypeError('Invalid artifact version metadata');
  const scope = {
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
  };
  if (
    row.storage_key !==
    artifactObjectKey({ ...scope, artifact_id: row.artifact_id }, row.sha256 as string)
  )
    throw new TypeError('Artifact object key differs');
  return {
    schema_version: 1,
    ...scope,
    artifact_id: row.artifact_id,
    name: row.name as string,
    mime: row.mime as string,
    classification: row.classification as Classification,
    source_refs: refs(row.source_refs),
    storage_key: row.storage_key as string,
    sha256: row.sha256 as string,
    size: row.size as number,
    version: row.version as number,
    etag: row.etag as string,
    trace_id: row.trace_id as string,
    created_at: created,
    updated_at: updated,
  };
}

export function artifactObjectKey(
  scope: Pick<
    PersistentArtifactMetadata,
    'tenant_id' | 'workspace_id' | 'project_id' | 'artifact_id'
  >,
  sha256: string,
) {
  return `artifacts/${encodeURIComponent(scope.tenant_id)}/${encodeURIComponent(scope.workspace_id)}/${encodeURIComponent(scope.project_id)}/${scope.artifact_id}/sha256/${sha256}`;
}
export function artifactDigest(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function artifactReceiptId(access: ArtifactIdentity, key: string) {
  return artifactDigest(
    JSON.stringify([
      access.tenant_id,
      access.workspace_id,
      access.project_id,
      access.actor_id,
      access.client_id,
      key,
    ]),
  );
}
export function artifactCommandHash(command: ArtifactWriteCommand) {
  return artifactDigest(JSON.stringify(parseArtifactWrite(command)));
}
export function timestamp(value: unknown): string {
  const raw = value instanceof Date ? value.toISOString() : value;
  if (typeof raw !== 'string' || !/Z$/.test(raw) || !Number.isFinite(Date.parse(raw)))
    throw new TypeError('Invalid artifact timestamp');
  return new Date(raw).toISOString();
}
function refs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 200 || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid artifact sources');
  return Array.from(value, (entry: unknown) => {
    const ref = validateSourceRef(entry);
    const row = object(entry);
    only(row, ['type', 'id', 'revision', 'uri']);
    text(ref.type, 128);
    text(ref.id, 1024);
    if (ref.uri !== undefined) text(ref.uri, 4096);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected artifact object');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new TypeError('Unexpected artifact fields');
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError('Invalid artifact text');
}
function identifier(value: unknown) {
  if (!isSyncIdentifier(value) || value === '.' || value === '..')
    throw new TypeError('Invalid artifact scope');
}
function hash(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new TypeError('Invalid artifact SHA-256');
}
function integer(value: unknown, min: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new TypeError('Invalid artifact integer');
}
function classification(value: unknown) {
  if (!classifications.includes(value as Classification))
    throw new TypeError('Invalid artifact classification');
}
function mime(value: unknown) {
  text(value, 255);
  if (typeof value !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(value))
    throw new TypeError('Supply a media type without parameters');
}

export {
  parseArtifactWrite,
  type ArtifactWriteCommand,
  type ArtifactCreateCommand,
  type ArtifactPutCommand,
} from '@planemem/contracts';
