import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  isUlid,
  parseCreateProposal,
  validateIdempotencyKey,
} from '@planemem/contracts';
import {
  inspectProposalGenerationRecord,
  readGeneratedProposalDraft,
  serializeProposalGenerationRecord,
  PROPOSAL_GENERATION_RECORD_BYTES,
  type GeneratedProposalRecord,
} from './generation-record.js';
import type { ProposalQueueBinding } from './queue-binding.js';
import { PROPOSAL_QUEUE_GENERATION_SCHEMA } from './proposal-queue-schema.js';

// Internal helpers. The queue owns the surrounding transaction and original binding.
const table = 'proposal_generation_records';
const pageBytes = 32 * 1024 * 1024;
const metadataSql = `SELECT substr(job_id,1,27) AS job_id, substr(record_sha256,1,65) AS record_sha256,
  schema_version, substr(attached_at,1,25) AS attached_at,
  typeof(record_json) AS json_type, length(CAST(record_json AS BLOB)) AS json_bytes
  FROM proposal_generation_records`;
export interface ProposalGenerationHistoryQuery {
  after?: string;
  limit?: number;
}
export interface ProposalGenerationHistoryEntry {
  job_id: string;
  request_key: string;
  attached_at: string;
  record: GeneratedProposalRecord;
}
type Job = { job_id: string; request_key: string; draft: ReturnType<typeof parseCreateProposal> };
type Metadata = {
  job_id: string;
  record_sha256: string;
  schema_version: number;
  attached_at: string;
  json_type: string;
  json_bytes: number;
};
function corrupt(): never {
  throw new ContractError(
    'PROPOSAL_GENERATION_HISTORY_CORRUPT',
    'Stored generation history does not match its job, binding or record',
  );
}
function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function validateGenerationDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new TypeError('Use a full lowercase SHA-256');
}
export function parseGenerationHistoryQuery(value: ProposalGenerationHistoryQuery = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['after', 'limit'].includes(key))
  )
    throw new TypeError();
  if (value.after !== undefined) validateGenerationDigest(value.after);
  const limit = value.limit === undefined ? 10 : value.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new TypeError('Use a record limit between 1 and 20');
  return { limit, ...(value.after === undefined ? {} : { after: value.after }) };
}
function schema(db: DatabaseSync, create: boolean): boolean {
  const found = db.prepare('SELECT type FROM sqlite_schema WHERE name = ?').get(table);
  if (!found && !create) return false;
  if (!found) {
    db.exec(PROPOSAL_QUEUE_GENERATION_SCHEMA);
  } else if (found.type !== 'table') corrupt();
  const columns = db.prepare('PRAGMA table_info(proposal_generation_records)').all();
  const expected = [
    ['job_id', 'TEXT', 1],
    ['record_sha256', 'TEXT', 2],
    ['schema_version', 'INTEGER', 0],
    ['record_json', 'TEXT', 0],
    ['attached_at', 'TEXT', 0],
  ] as const;
  if (
    columns.length !== expected.length ||
    expected.some(([name, type, pk], i) => {
      const column = columns[i];
      return (
        !column ||
        column.name !== name ||
        column.type !== type ||
        column.notnull !== 1 ||
        column.pk !== pk
      );
    })
  )
    corrupt();
  return true;
}
function job(db: DatabaseSync, id: string): Job {
  if (!isUlid(id)) throw new TypeError('job_id must be a ULID');
  // Bound the parent payload before materializing it, even for a damaged local database.
  const size = db
    .prepare(
      `SELECT typeof(payload) AS payload_type,
    length(CAST(payload AS BLOB)) AS payload_bytes FROM proposal_jobs WHERE job_id = ?`,
    )
    .get(id);
  if (!size)
    throw new ContractError('PROPOSAL_JOB_NOT_FOUND', 'Proposal submission job is unavailable');
  if (
    size.payload_type !== 'text' ||
    typeof size.payload_bytes !== 'number' ||
    size.payload_bytes < 1 ||
    size.payload_bytes > 1024 * 1024
  )
    corrupt();
  const row = db
    .prepare(
      'SELECT substr(request_key,1,256) AS request_key, payload, substr(payload_hash,1,65) AS payload_hash FROM proposal_jobs WHERE job_id = ?',
    )
    .get(id);
  try {
    if (
      !row ||
      typeof row.payload !== 'string' ||
      typeof row.request_key !== 'string' ||
      !/^[\x21-\x7e]{1,255}$/.test(row.request_key)
    )
      return corrupt();
    validateIdempotencyKey(row.request_key);
    if (createHash('sha256').update(row.payload, 'utf8').digest('hex') !== row.payload_hash)
      return corrupt();
    const draft = parseCreateProposal(JSON.parse(row.payload));
    if (JSON.stringify(draft) !== row.payload) return corrupt();
    return { job_id: id, request_key: row.request_key, draft };
  } catch {
    return corrupt();
  }
}
function metadata(value: unknown, id: string): Metadata {
  if (!value || typeof value !== 'object') return corrupt();
  const row = value as Metadata;
  if (
    row.job_id !== id ||
    typeof row.record_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.record_sha256) ||
    row.schema_version !== 1 ||
    !utc(row.attached_at) ||
    row.json_type !== 'text' ||
    !Number.isSafeInteger(row.json_bytes) ||
    row.json_bytes < 1 ||
    row.json_bytes > PROPOSAL_GENERATION_RECORD_BYTES
  )
    corrupt();
  return row;
}
function entry(
  db: DatabaseSync,
  info: Metadata,
  parent: Job,
  binding: ProposalQueueBinding,
): ProposalGenerationHistoryEntry {
  const stored = db
    .prepare(
      'SELECT record_json FROM proposal_generation_records WHERE job_id = ? AND record_sha256 = ?',
    )
    .get(parent.job_id, info.record_sha256);
  try {
    if (
      !stored ||
      typeof stored.record_json !== 'string' ||
      Buffer.byteLength(stored.record_json, 'utf8') !== info.json_bytes
    )
      return corrupt();
    const record = inspectProposalGenerationRecord(JSON.parse(stored.record_json));
    if (
      record.kind !== 'proposal-generation' ||
      record.sha256 !== info.record_sha256 ||
      !isDeepStrictEqual(readGeneratedProposalDraft(record, binding), parent.draft)
    )
      return corrupt();
    // Stored bytes are stable across object-key order changes in imported files.
    if (serializeProposalGenerationRecord(record) !== stored.record_json) return corrupt();
    return {
      job_id: parent.job_id,
      request_key: parent.request_key,
      attached_at: info.attached_at,
      record,
    };
  } catch {
    return corrupt();
  }
}
export function attachGenerationRecord(
  db: DatabaseSync,
  id: string,
  record: GeneratedProposalRecord,
  binding: ProposalQueueBinding,
) {
  const parent = job(db, id);
  if (!isDeepStrictEqual(readGeneratedProposalDraft(record, binding), parent.draft)) corrupt();
  const serialized = serializeProposalGenerationRecord(record);
  schema(db, true);
  const existing = db
    .prepare(metadataSql + ' WHERE job_id = ? AND record_sha256 = ?')
    .get(id, record.sha256);
  if (existing) {
    const previous = entry(db, metadata(existing, id), parent, binding);
    if (serializeProposalGenerationRecord(previous.record) !== serialized) corrupt();
    return { attached_at: previous.attached_at, replayed: true };
  }
  const attached = new Date().toISOString();
  db.prepare(
    `INSERT INTO proposal_generation_records
    (job_id,record_sha256,schema_version,record_json,attached_at) VALUES (?,?,1,?,?)`,
  ).run(id, record.sha256, serialized, attached);
  const readback = entry(
    db,
    metadata(
      db.prepare(metadataSql + ' WHERE job_id = ? AND record_sha256 = ?').get(id, record.sha256),
      id,
    ),
    job(db, id),
    binding,
  );
  if (
    readback.attached_at !== attached ||
    serializeProposalGenerationRecord(readback.record) !== serialized
  )
    corrupt();
  return { attached_at: attached, replayed: false };
}
export function getGenerationHistory(
  db: DatabaseSync,
  id: string,
  sha256: string,
  binding: ProposalQueueBinding,
): ProposalGenerationHistoryEntry {
  validateGenerationDigest(sha256);
  const parent = job(db, id);
  const found = schema(db, false)
    ? db.prepare(metadataSql + ' WHERE job_id = ? AND record_sha256 = ?').get(id, sha256)
    : undefined;
  if (!found)
    throw new ContractError(
      'PROPOSAL_GENERATION_RECORD_NOT_FOUND',
      'No generation record is attached to this job with that digest',
    );
  return entry(db, metadata(found, id), parent, binding);
}
export function listGenerationHistory(
  db: DatabaseSync,
  id: string,
  binding: ProposalQueueBinding,
  options: ProposalGenerationHistoryQuery = {},
) {
  const query = parseGenerationHistoryQuery(options);
  const parent = job(db, id);
  const rows = schema(db, false)
    ? db
        .prepare(
          metadataSql +
            ` WHERE job_id = ? AND (? IS NULL OR record_sha256 > ?)
    ORDER BY proposal_generation_records.record_sha256 LIMIT ?`,
        )
        .all(id, query.after ?? null, query.after ?? null, query.limit + 1)
    : [];
  const infos = rows.map((row) => metadata(row, id));
  const selected = infos.slice(0, query.limit);
  if (selected.reduce((total, row) => total + row.json_bytes, 0) > pageBytes)
    throw new ContractError(
      'PROPOSAL_GENERATION_HISTORY_LIMIT',
      'This page exceeds the history byte budget; request fewer records',
    );
  const records = selected.map((row) => {
    const found = entry(db, row, parent, binding);
    return {
      record_sha256: found.record.sha256,
      preparation_sha256: found.record.preparation.sha256,
      attached_at: found.attached_at,
      generated_at: found.record.generation.generated_at,
      trace_id: found.record.generation.trace_id,
      requested_model: found.record.generation.requested_model,
      returned_model: found.record.generation.returned_model,
      prompt_version: found.record.generation.prompt_version,
      classification: found.record.generation.draft.classification,
      source_count: found.record.generation.source_refs.length,
    };
  });
  return {
    job_id: id,
    request_key: parent.request_key,
    records,
    ...(infos.length > query.limit
      ? { next_after: records[records.length - 1]!.record_sha256 }
      : {}),
  };
}
