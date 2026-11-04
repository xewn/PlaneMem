import { createHash } from 'node:crypto';
import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  createUlid,
  proposalReceiptJson,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import {
  directory,
  readOptional,
  readState,
  JournalReadBudgetExceeded,
} from './generation-journal-read.js';
import {
  GENERATION_REQUEST_BYTES,
  inspectGenerationRequest,
  inspectGenerationAttempt,
  inspectGenerationOutcome,
  validateGenerationRequestKey,
  type ProposalGenerationRequestState,
} from './generation-request.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';

export const GENERATION_JOURNAL_BACKUP_BYTES = 32 * 1024 * 1024;
export const GENERATION_JOURNAL_BACKUP_MAX_REQUESTS = 100;
const directoryEntries = 10_000;
const prefix = 'PROPOSAL_GENERATION_JOURNAL_BACKUP_';

export interface ProposalGenerationJournalBackup {
  schema_version: 1;
  kind: 'proposal-generation-journal-backup';
  started_at: string;
  completed_at: string;
  coverage: 'binding-canonical-v1';
  consistency: 'two-pass-observation';
  binding: ProposalQueueBinding;
  requests: ProposalGenerationRequestState[];
  sha256: string;
}
function object(value: unknown, fields?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    fields &&
    (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
  )
    throw new TypeError();
  return row;
}
function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function digest(value: unknown) {
  return hash(proposalReceiptJson(value, GENERATION_JOURNAL_BACKUP_BYTES));
}
function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function state(value: unknown, binding: ProposalQueueBinding): ProposalGenerationRequestState {
  const row = object(value, ['request', 'attempt', 'outcome', 'state']);
  const key = object(row.request).request_key;
  validateGenerationRequestKey(key);
  const request = inspectGenerationRequest(row.request, binding, key);
  if (row.attempt !== null && Buffer.byteLength(JSON.stringify(row.attempt), 'utf8') > 8192)
    throw new TypeError();
  const attempt = row.attempt === null ? null : inspectGenerationAttempt(row.attempt, request);
  if (row.outcome !== null && !attempt) throw new TypeError();
  const outcome =
    row.outcome === null ? null : inspectGenerationOutcome(row.outcome, request, attempt!);
  const expected = outcome
    ? outcome.record
      ? 'generated'
      : 'failed'
    : attempt
      ? 'attempted'
      : 'prepared';
  if (row.state !== expected) throw new TypeError();
  return { request, attempt, outcome, state: expected };
}

/** Integrity of retained observations only; missing markers never authorize a new model call. */
export function inspectGenerationJournalBackup(value: unknown): ProposalGenerationJournalBackup {
  try {
    const row = object(JSON.parse(syncJsonSnapshot(value, GENERATION_JOURNAL_BACKUP_BYTES)), [
      'schema_version',
      'kind',
      'started_at',
      'completed_at',
      'coverage',
      'consistency',
      'binding',
      'requests',
      'sha256',
    ]);
    if (
      row.schema_version !== 1 ||
      row.kind !== 'proposal-generation-journal-backup' ||
      !utc(row.started_at) ||
      !utc(row.completed_at) ||
      row.completed_at < row.started_at ||
      row.coverage !== 'binding-canonical-v1' ||
      row.consistency !== 'two-pass-observation' ||
      !Array.isArray(row.requests) ||
      row.requests.length > GENERATION_JOURNAL_BACKUP_MAX_REQUESTS ||
      typeof row.sha256 !== 'string' ||
      row.sha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      Buffer.byteLength(JSON.stringify(row, null, 2) + '\n', 'utf8') >
        GENERATION_JOURNAL_BACKUP_BYTES
    )
      throw new TypeError();
    const binding = normalizeQueueBinding(row.binding as ProposalQueueBinding);
    if (!isDeepStrictEqual(binding, row.binding)) throw new TypeError();
    let previous = '';
    const requestIds = new Set<string>();
    const attemptIds = new Set<string>();
    for (const input of row.requests) {
      const item = state(input, binding);
      const keyHash = hash(item.request.request_key);
      if (
        keyHash <= previous ||
        requestIds.has(item.request.request_id) ||
        (item.attempt && attemptIds.has(item.attempt.attempt_id))
      )
        throw new TypeError();
      previous = keyHash;
      requestIds.add(item.request.request_id);
      if (item.attempt) attemptIds.add(item.attempt.attempt_id);
    }
    const { sha256, ...body } = row;
    if (sha256 !== digest(body)) throw new TypeError();
    return row as unknown as ProposalGenerationJournalBackup;
  } catch {
    throw new ContractError(
      prefix + 'INVALID',
      'Use a complete consistent generation journal backup; partial or mixed records cannot be accepted',
    );
  }
}

async function inventory(root: string) {
  const files: string[] = [];
  const requests = new Set<string>();
  const dependents = new Set<string>();
  let count = 0;
  for await (const entry of await opendir(root)) {
    if (++count > directoryEntries)
      throw new ContractError(
        prefix + 'LIMIT',
        'Journal directory enumeration exceeds 10,000 entries',
      );
    const match = /^generation-([a-f0-9]{64})\.(request|attempt|outcome)\.json$/.exec(entry.name);
    if (!match) continue;
    if (!entry.isFile()) throw new TypeError();
    files.push(entry.name);
    (match[2] === 'request' ? requests : dependents).add(match[1]!);
  }
  // Orphans cannot safely be attributed to any binding. Do not silently omit them.
  if ([...dependents].some((key) => !requests.has(key)))
    throw new ContractError(
      prefix + 'ORPHAN',
      'A canonical attempt or outcome has no original request; retain the directory and resolve its provenance',
    );
  return { files: files.sort(), requests: [...requests].sort() };
}
async function collect(root: string, binding: ProposalQueueBinding, keys: string[]) {
  const budget = { remaining: GENERATION_JOURNAL_BACKUP_BYTES };
  const items: ProposalGenerationRequestState[] = [];
  let retainedBytes = 0;
  for (const keyHash of keys) {
    const input = await readOptional(
      join(root, 'generation-' + keyHash + '.request.json'),
      GENERATION_REQUEST_BYTES,
      budget,
    );
    const row = object(input);
    validateGenerationRequestKey(row.request_key);
    const original = object(object(row.preparation).preparation).binding;
    const request = inspectGenerationRequest(
      input,
      original as ProposalQueueBinding,
      row.request_key,
    );
    if (hash(request.request_key) !== keyHash) throw new TypeError();
    if (!isDeepStrictEqual(request.preparation.preparation.binding, binding)) continue;
    if (items.length >= GENERATION_JOURNAL_BACKUP_MAX_REQUESTS)
      throw new ContractError(
        prefix + 'LIMIT',
        'The complete binding exceeds 100 generation requests',
      );
    const current = await readState(root, binding, request.request_key, budget, request);
    retainedBytes += Buffer.byteLength(JSON.stringify(current, null, 2), 'utf8');
    if (retainedBytes > GENERATION_JOURNAL_BACKUP_BYTES)
      throw new ContractError(
        prefix + 'LIMIT',
        'The complete binding exceeds the backup byte budget',
      );
    items.push(current);
  }
  return items;
}

/** Two matching read passes detect ordinary publication races; this does not lock writers. */
export async function captureGenerationJournalBackup(
  directoryPath: string,
  value: ProposalQueueBinding,
) {
  try {
    const binding = normalizeQueueBinding(value);
    const root = await directory(directoryPath);
    const identity = await stat(root);
    const started_at = new Date().toISOString();
    const before = await inventory(root);
    const first = await collect(root, binding, before.requests);
    const middle = await inventory(root);
    if (!isDeepStrictEqual(before, middle))
      throw new ContractError(
        prefix + 'CHANGED',
        'The journal changed during capture; retain its files and retry backup after writers are paused',
      );
    const second = await collect(root, binding, middle.requests);
    const after = await inventory(root);
    const finalIdentity = await stat(root);
    if (
      !finalIdentity.isDirectory() ||
      finalIdentity.dev !== identity.dev ||
      finalIdentity.ino !== identity.ino ||
      !isDeepStrictEqual(middle, after) ||
      !isDeepStrictEqual(first, second)
    )
      throw new ContractError(
        prefix + 'CHANGED',
        'The journal changed during capture; no partial backup is returned',
      );
    const body = {
      schema_version: 1 as const,
      kind: 'proposal-generation-journal-backup' as const,
      started_at,
      completed_at: new Date().toISOString(),
      coverage: 'binding-canonical-v1' as const,
      consistency: 'two-pass-observation' as const,
      binding,
      requests: second,
    };
    if (
      Buffer.byteLength(
        JSON.stringify({ ...body, sha256: '0'.repeat(64) }, null, 2) + '\n',
        'utf8',
      ) > GENERATION_JOURNAL_BACKUP_BYTES
    )
      throw new ContractError(prefix + 'LIMIT', 'The complete formatted backup exceeds 32 MiB');
    return inspectGenerationJournalBackup({ ...body, sha256: digest(body) });
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code.startsWith(prefix)) throw error;
    if (error instanceof JournalReadBudgetExceeded)
      throw new ContractError(prefix + 'LIMIT', 'A complete journal read pass exceeds 32 MiB');
    throw new ContractError(
      prefix + 'UNAVAILABLE',
      'The original journal could not be fully read and verified; no partial backup is returned',
    );
  }
}

export function generationJournalBackupSummary(value: unknown) {
  const backup = inspectGenerationJournalBackup(value);
  return {
    schema_version: backup.schema_version,
    kind: backup.kind,
    backup_sha256: backup.sha256,
    binding: backup.binding,
    started_at: backup.started_at,
    completed_at: backup.completed_at,
    coverage: backup.coverage,
    consistency: backup.consistency,
    requests: backup.requests.length,
    states: Object.fromEntries(
      ['prepared', 'attempted', 'generated', 'failed'].map((name) => [
        name,
        backup.requests.filter((row) => row.state === name).length,
      ]),
    ),
    verification: 'file-consistency-only',
    current_journal: 'not-checked',
    provider_dispatch: 'not-sent',
    provider_dispatch_scope: 'this-invocation',
    current_provider: 'not-checked',
    restoration: 'not-performed',
  };
}
export async function readGenerationJournalBackup(path: string) {
  let value: unknown;
  try {
    if (typeof path !== 'string' || !path.trim() || path === '-' || /[\u0000-\u001f]/.test(path))
      throw new TypeError();
    value = await readOptional(path, GENERATION_JOURNAL_BACKUP_BYTES);
    if (value === undefined) throw new TypeError();
  } catch {
    throw new ContractError(
      prefix + 'FILE_UNAVAILABLE',
      'Use an existing bounded regular generation journal backup file',
    );
  }
  return inspectGenerationJournalBackup(value);
}
export async function prepareGenerationJournalBackupOutput(path: string) {
  try {
    return await prepareGenerationOutput(path);
  } catch {
    throw new ContractError(
      prefix + 'OUTPUT_UNAVAILABLE',
      'Choose a new journal backup file in an existing directory',
    );
  }
}
export async function saveGenerationJournalBackup(
  output: Awaited<ReturnType<typeof prepareGenerationJournalBackupOutput>>,
  value: unknown,
) {
  const backup = inspectGenerationJournalBackup(value);
  return saveGenerationFile(
    output,
    Buffer.from(JSON.stringify(backup, null, 2) + '\n', 'utf8'),
    GENERATION_JOURNAL_BACKUP_BYTES,
    'trace_generation_journal_backup_' + createUlid(),
    prefix + 'SAVE_FAILED',
  );
}
