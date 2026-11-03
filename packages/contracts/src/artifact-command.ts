import { isUlid } from './ids.js';

import {
  validateIdempotencyKey,
  validateSourceRef,
  type Classification,
  type SourceRef,
} from './metadata.js';
interface ArtifactWriteBase {
  request_key: string;
  sha256: string;
  size: number;
}
export interface ArtifactCreateCommand extends ArtifactWriteBase {
  operation: 'artifact.create';
  name: string;
  mime: string;
  classification: Classification;
  source_refs: SourceRef[];
}
export interface ArtifactPutCommand extends ArtifactWriteBase {
  operation: 'artifact.put-version';
  artifact_id: string;
  expected_version: number;
}
export type ArtifactWriteCommand = ArtifactCreateCommand | ArtifactPutCommand;

const classifications: Classification[] = ['public', 'internal', 'confidential', 'restricted'];
export function parseArtifactWrite(value: unknown): ArtifactWriteCommand {
  const row = object(value);
  validateIdempotencyKey(row.request_key);
  hash(row.sha256);
  integer(row.size, 0);
  const common = {
    request_key: row.request_key as string,
    sha256: row.sha256 as string,
    size: row.size as number,
  };
  if (row.operation === 'artifact.create') {
    only(row, [
      'operation',
      'request_key',
      'sha256',
      'size',
      'name',
      'mime',
      'classification',
      'source_refs',
    ]);
    text(row.name, 255);
    mime(row.mime);
    classification(row.classification);
    return {
      operation: 'artifact.create',
      ...common,
      name: row.name as string,
      mime: row.mime as string,
      classification: row.classification as Classification,
      source_refs: refs(row.source_refs),
    };
  }
  if (row.operation === 'artifact.put-version') {
    only(row, ['operation', 'request_key', 'sha256', 'size', 'artifact_id', 'expected_version']);
    if (!isUlid(row.artifact_id)) throw new TypeError('Invalid artifact ID');
    integer(row.expected_version, 1);
    if (row.expected_version === Number.MAX_SAFE_INTEGER)
      throw new TypeError('Artifact version is exhausted');
    return {
      operation: 'artifact.put-version',
      ...common,
      artifact_id: row.artifact_id,
      expected_version: row.expected_version as number,
    };
  }
  throw new TypeError('Invalid artifact operation');
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
