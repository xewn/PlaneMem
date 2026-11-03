import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  createUlid,
  isUlid,
  parseCreateProposal,
  parseProposalCreateReceiptQuery,
  proposalReceiptJson,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import { parseSubmissionReceipt } from './receipt.js';
import {
  inspectProposalGenerationRecord,
  readGeneratedProposalDraft,
  serializeProposalGenerationRecord,
  PROPOSAL_GENERATION_RECORD_BYTES,
} from './generation-record.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';
import { readOptional } from './generation-journal-read.js';

export const PROPOSAL_QUEUE_BACKUP_BYTES = 32 * 1024 * 1024;
export const PROPOSAL_QUEUE_BACKUP_MAX_JOBS = 100;
export const PROPOSAL_QUEUE_BACKUP_MAX_GENERATIONS = 100;
const jobColumns = [
  'job_id',
  'request_key',
  'payload',
  'payload_hash',
  'status',
  'attempts',
  'next_attempt_ms',
  'uncertain',
  'error_code',
  'trace_id',
  'receipt',
  'created_at',
  'lease_token',
  'lease_until_ms',
] as const;
const generationColumns = [
  'job_id',
  'record_sha256',
  'schema_version',
  'record_json',
  'attached_at',
] as const;
export interface ProposalQueueBackupJob {
  job_id: string;
  request_key: string;
  payload: string;
  payload_hash: string;
  status: 'queued' | 'sending' | 'retry' | 'blocked' | 'submitted';
  attempts: number;
  next_attempt_ms: number;
  uncertain: 0 | 1;
  error_code: string | null;
  trace_id: string | null;
  receipt: string | null;
  created_at: string;
  lease_token: string | null;
  lease_until_ms: number | null;
}
export interface ProposalQueueBackupGeneration {
  job_id: string;
  record_sha256: string;
  schema_version: 1;
  record_json: string;
  attached_at: string;
}
export interface ProposalQueueBackup {
  schema_version: 1;
  kind: 'proposal-queue-backup';
  captured_at: string;
  binding: ProposalQueueBinding;
  jobs: ProposalQueueBackupJob[];
  generation_history_present: boolean;
  generation_records: ProposalQueueBackupGeneration[];
  sha256: string;
}
function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  return row;
}
function canonical(value: unknown) {
  return proposalReceiptJson(value, PROPOSAL_QUEUE_BACKUP_BYTES);
}
function digest(raw: string) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function milliseconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}
function job(value: unknown, binding: ProposalQueueBinding): ProposalQueueBackupJob {
  const row = object(value, jobColumns);
  if (
    !isUlid(row.job_id) ||
    typeof row.payload !== 'string' ||
    !row.payload ||
    Buffer.byteLength(row.payload, 'utf8') > 1048576 ||
    typeof row.payload_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.payload_hash) ||
    digest(row.payload) !== row.payload_hash ||
    !['queued', 'sending', 'retry', 'blocked', 'submitted'].includes(row.status as string) ||
    typeof row.attempts !== 'number' ||
    !Number.isSafeInteger(row.attempts) ||
    row.attempts < 0 ||
    !milliseconds(row.next_attempt_ms) ||
    ![0, 1].includes(row.uncertain as number) ||
    !utc(row.created_at) ||
    (row.error_code !== null &&
      (typeof row.error_code !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(row.error_code))) ||
    (row.trace_id !== null &&
      (typeof row.trace_id !== 'string' || !row.trace_id.trim() || row.trace_id.length > 1024)) ||
    (row.status === 'sending'
      ? typeof row.lease_token !== 'string' ||
        !/^[!-~]{1,255}$/.test(row.lease_token) ||
        !milliseconds(row.lease_until_ms)
      : row.lease_token !== null || row.lease_until_ms !== null)
  )
    throw new TypeError();
  const metadata = jobColumns
    .filter((field) => field !== 'payload')
    .reduce(
      (total, field) =>
        total + (row[field] === null ? 0 : Buffer.byteLength(String(row[field]), 'utf8')),
      0,
    );
  if (metadata > 16384) throw new TypeError();
  const draft = parseCreateProposal(JSON.parse(row.payload));
  if (JSON.stringify(draft) !== row.payload) throw new TypeError();
  const { gateway_url: _gateway, ...identity } = binding;
  parseProposalCreateReceiptQuery({ identity, request_key: row.request_key, draft });
  if (row.status === 'submitted') {
    if (typeof row.receipt !== 'string' || row.uncertain !== 0 || row.error_code !== null)
      throw new TypeError();
    const raw: unknown = JSON.parse(row.receipt);
    if (canonical(raw) !== canonical(parseSubmissionReceipt(raw))) throw new TypeError();
  } else if (row.receipt !== null) throw new TypeError();
  return row as unknown as ProposalQueueBackupJob;
}
function generation(
  value: unknown,
  jobs: Map<string, ProposalQueueBackupJob>,
  binding: ProposalQueueBinding,
) {
  const row = object(value, generationColumns);
  if (
    !isUlid(row.job_id) ||
    typeof row.record_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.record_sha256) ||
    row.schema_version !== 1 ||
    !utc(row.attached_at) ||
    typeof row.record_json !== 'string' ||
    Buffer.byteLength(row.record_json, 'utf8') > PROPOSAL_GENERATION_RECORD_BYTES
  )
    throw new TypeError();
  const parent = jobs.get(row.job_id);
  if (!parent) throw new TypeError();
  const record = inspectProposalGenerationRecord(JSON.parse(row.record_json));
  if (
    record.kind !== 'proposal-generation' ||
    record.sha256 !== row.record_sha256 ||
    serializeProposalGenerationRecord(record) !== row.record_json ||
    !isDeepStrictEqual(readGeneratedProposalDraft(record, binding), JSON.parse(parent.payload))
  )
    throw new TypeError();
  return row as unknown as ProposalQueueBackupGeneration;
}

/** Validates consistency only, never authenticity, current state or permission to resend. */
export function inspectProposalQueueBackup(value: unknown): ProposalQueueBackup {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_QUEUE_BACKUP_BYTES)), [
      'schema_version',
      'kind',
      'captured_at',
      'binding',
      'jobs',
      'generation_history_present',
      'generation_records',
      'sha256',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'proposal-queue-backup' ||
      !utc(row.captured_at) ||
      typeof row.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !Array.isArray(row.jobs) ||
      row.jobs.length > PROPOSAL_QUEUE_BACKUP_MAX_JOBS ||
      !Array.isArray(row.generation_records) ||
      row.generation_records.length > PROPOSAL_QUEUE_BACKUP_MAX_GENERATIONS ||
      typeof row.generation_history_present !== 'boolean' ||
      (!row.generation_history_present && row.generation_records.length !== 0)
    )
      throw new TypeError();
    const binding = normalizeQueueBinding(row.binding as ProposalQueueBinding);
    if (
      canonical(binding) !== canonical(row.binding) ||
      Buffer.byteLength(JSON.stringify(binding), 'utf8') > 16384
    )
      throw new TypeError();
    const jobs = new Map<string, ProposalQueueBackupJob>();
    const keys = new Set<string>();
    let previous = '';
    for (const value of row.jobs) {
      const entry = job(value, binding);
      if (entry.job_id <= previous || keys.has(entry.request_key)) throw new TypeError();
      previous = entry.job_id;
      keys.add(entry.request_key);
      jobs.set(entry.job_id, entry);
    }
    previous = '';
    for (const value of row.generation_records) {
      const entry = generation(value, jobs, binding);
      const key = entry.job_id + ':' + entry.record_sha256;
      if (key <= previous) throw new TypeError();
      previous = key;
    }
    const { sha256, ...body } = row;
    if (
      sha256 !== digest(canonical(body)) ||
      Buffer.byteLength(JSON.stringify(row, null, 2) + '\n', 'utf8') > PROPOSAL_QUEUE_BACKUP_BYTES
    )
      throw new TypeError();
    return row as unknown as ProposalQueueBackup;
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_INVALID',
      'Use a complete consistent v1 queue backup; retain the original file',
    );
  }
}

function schema(db: DatabaseSync) {
  const tables = db
    .prepare(
      "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view','trigger') AND name NOT GLOB 'sqlite_*' LIMIT 4",
    )
    .all();
  const names = tables.map((row) => row.name);
  if (
    tables.some((row) => row.type !== 'table') ||
    tables.length < 2 ||
    tables.length > 3 ||
    !names.includes('proposal_queue_binding') ||
    !names.includes('proposal_jobs') ||
    names.some(
      (name) =>
        !['proposal_queue_binding', 'proposal_jobs', 'proposal_generation_records'].includes(
          name as string,
        ),
    )
  )
    throw new TypeError('Only the known v1 logical queue schema can be backed up');
  const expected: Record<string, ReadonlyArray<readonly [string, string, number, number]>> = {
    proposal_queue_binding: [
      ['singleton', 'INTEGER', 0, 1],
      ['schema_version', 'INTEGER', 1, 0],
      ['binding', 'TEXT', 1, 0],
    ],
    proposal_jobs: jobColumns.map(
      (name) =>
        [
          name,
          ['attempts', 'next_attempt_ms', 'uncertain', 'lease_until_ms'].includes(name)
            ? 'INTEGER'
            : 'TEXT',
          ['job_id', 'error_code', 'trace_id', 'receipt', 'lease_token', 'lease_until_ms'].includes(
            name,
          )
            ? 0
            : 1,
          name === 'job_id' ? 1 : 0,
        ] as const,
    ),
    proposal_generation_records: [
      ['job_id', 'TEXT', 1, 1],
      ['record_sha256', 'TEXT', 1, 2],
      ['schema_version', 'INTEGER', 1, 0],
      ['record_json', 'TEXT', 1, 0],
      ['attached_at', 'TEXT', 1, 0],
    ],
  };
  for (const name of names) {
    const table = String(name);
    const fields = expected[table]!;
    const actual = db.prepare('PRAGMA table_xinfo(' + table + ')').all();
    if (
      actual.length !== fields.length ||
      fields.some(([column, type, notnull, pk], index) => {
        const row = actual[index];
        return (
          !row ||
          row.name !== column ||
          row.type !== type ||
          row.notnull !== notnull ||
          row.pk !== pk ||
          row.hidden !== 0
        );
      })
    )
      throw new TypeError('Queue schema differs from the known v1 fields');
  }
  return names.includes('proposal_generation_records');
}

/** Caller owns a native-readonly transaction. Count and bound every value before materializing bodies. */
export function captureProposalQueueBackup(
  db: DatabaseSync,
  input: ProposalQueueBinding,
): ProposalQueueBackup {
  const binding = normalizeQueueBinding(input);
  const generation_history_present = schema(db);
  const bindings = db
    .prepare(
      'SELECT singleton, schema_version, typeof(binding) AS kind, length(CAST(binding AS BLOB)) AS bytes FROM proposal_queue_binding LIMIT 2',
    )
    .all();
  const storedBinding = bindings[0];
  if (
    bindings.length !== 1 ||
    storedBinding?.singleton !== 1 ||
    storedBinding.schema_version !== 1 ||
    storedBinding.kind !== 'text' ||
    typeof storedBinding.bytes !== 'number' ||
    storedBinding.bytes < 1 ||
    storedBinding.bytes > 16384 ||
    db.prepare('SELECT binding FROM proposal_queue_binding WHERE singleton = 1').get()?.binding !==
      JSON.stringify(binding)
  )
    throw new ContractError('PROPOSAL_QUEUE_BINDING_MISMATCH', 'Keep the original queue binding');
  let bytes = 0;
  function read(
    table: 'proposal_jobs' | 'proposal_generation_records',
    columns: readonly string[],
    maximum: number,
    body: string,
    bodyBytes: number,
    order: string,
  ) {
    const count = db.prepare('SELECT COUNT(*) AS count FROM ' + table).get()?.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > maximum)
      throw new ContractError(
        'PROPOSAL_QUEUE_BACKUP_LIMIT',
        'The complete queue exceeds the backup count limit; no partial backup was produced',
      );
    const sizes = db
      .prepare(
        'SELECT ' +
          columns.map((column) => `length(CAST(${column} AS BLOB)) AS ${column}`).join(',') +
          ' FROM ' +
          table,
      )
      .all();
    if (sizes.length !== count) throw new TypeError();
    for (const row of sizes) {
      let metadata = 0;
      for (const column of columns) {
        const size = row[column];
        if (size !== null && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0))
          throw new TypeError();
        if (column === body) {
          if (typeof size !== 'number' || size < 1 || size > bodyBytes) throw new TypeError();
        } else metadata += Number(size ?? 0);
        bytes += Number(size ?? 0);
      }
      if (metadata > 16384 || bytes > PROPOSAL_QUEUE_BACKUP_BYTES)
        throw new ContractError(
          'PROPOSAL_QUEUE_BACKUP_LIMIT',
          'The complete queue exceeds the backup byte budget',
        );
    }
    const rows = db
      .prepare('SELECT ' + columns.join(',') + ' FROM ' + table + ' ORDER BY ' + order)
      .all();
    if (rows.length !== count) throw new TypeError();
    return rows;
  }
  const jobs = read(
    'proposal_jobs',
    jobColumns,
    PROPOSAL_QUEUE_BACKUP_MAX_JOBS,
    'payload',
    1048576,
    'job_id COLLATE BINARY',
  );
  const generation_records = generation_history_present
    ? read(
        'proposal_generation_records',
        generationColumns,
        PROPOSAL_QUEUE_BACKUP_MAX_GENERATIONS,
        'record_json',
        PROPOSAL_GENERATION_RECORD_BYTES,
        'job_id COLLATE BINARY, record_sha256 COLLATE BINARY',
      )
    : [];
  const body = {
    schema_version: 1,
    kind: 'proposal-queue-backup',
    captured_at: new Date().toISOString(),
    binding,
    jobs,
    generation_history_present,
    generation_records,
  };
  return inspectProposalQueueBackup({ ...body, sha256: digest(canonical(body)) });
}

export function proposalQueueBackupSummary(value: unknown) {
  const backup = inspectProposalQueueBackup(value);
  return {
    schema_version: backup.schema_version,
    kind: backup.kind,
    captured_at: backup.captured_at,
    backup_sha256: backup.sha256,
    binding: backup.binding,
    jobs: backup.jobs.length,
    statuses: Object.fromEntries(
      ['queued', 'sending', 'retry', 'blocked', 'submitted'].map((status) => [
        status,
        backup.jobs.filter((row) => row.status === status).length,
      ]),
    ),
    uncertain: backup.jobs.filter((row) => row.uncertain === 1).length,
    generation_history_present: backup.generation_history_present,
    generation_records: backup.generation_records.length,
    verification: 'file-consistency-only',
    current_queue: 'not-checked',
    current_remote: 'not-checked',
  };
}
export async function readProposalQueueBackup(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, PROPOSAL_QUEUE_BACKUP_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_UNAVAILABLE',
      'Use an existing bounded regular queue backup file',
    );
  }
  return inspectProposalQueueBackup(value);
}
export async function prepareProposalQueueBackupOutput(path: string) {
  try {
    return await prepareGenerationOutput(path);
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_OUTPUT_UNAVAILABLE',
      'Choose a new backup file in an existing directory',
    );
  }
}
export async function saveProposalQueueBackup(
  output: Awaited<ReturnType<typeof prepareProposalQueueBackupOutput>>,
  value: unknown,
) {
  const backup = inspectProposalQueueBackup(value);
  return saveGenerationFile(
    output,
    Buffer.from(JSON.stringify(backup, null, 2) + '\n', 'utf8'),
    PROPOSAL_QUEUE_BACKUP_BYTES,
    'trace_worker_queue_backup_' + createUlid(),
    'PROPOSAL_QUEUE_BACKUP_SAVE_FAILED',
  );
}
