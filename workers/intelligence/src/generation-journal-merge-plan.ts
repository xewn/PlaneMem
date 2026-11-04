import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isUlid, proposalReceiptJson } from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import { directory, paths, readOptional } from './generation-journal-read.js';
import {
  captureGenerationJournalBackup,
  inspectGenerationJournalBackup,
  GENERATION_JOURNAL_BACKUP_BYTES,
  GENERATION_JOURNAL_BACKUP_MAX_REQUESTS,
  type ProposalGenerationJournalBackup,
} from './generation-journal-backup.js';
import { compareGenerationJournalBackups } from './generation-journal-comparison.js';
import {
  GENERATION_JOURNAL_RESTORE_MARKER,
  GENERATION_JOURNAL_RESTORE_SOURCE,
} from './generation-journal-guard.js';

export const mergePrefix = 'PROPOSAL_GENERATION_JOURNAL_MERGE_';
export type JournalPart = 'request' | 'attempt' | 'outcome';
const parts: JournalPart[] = ['request', 'attempt', 'outcome'];
function hash(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function journalContentDigest(backup: ProposalGenerationJournalBackup) {
  return hash(
    proposalReceiptJson(
      { binding: backup.binding, requests: backup.requests },
      GENERATION_JOURNAL_BACKUP_BYTES,
    ),
  );
}
async function fingerprint(path: string) {
  const item = await lstat(path, { bigint: true });
  if (!item.isFile()) throw new TypeError('Use a regular restore evidence file');
  return {
    dev: String(item.dev),
    ino: String(item.ino),
    size: String(item.size),
    mtime_ns: String(item.mtimeNs),
    ctime_ns: String(item.ctimeNs),
  };
}
export async function journalDirectoryIdentity(root: string) {
  const item = await lstat(root, { bigint: true });
  if (!item.isDirectory()) throw new TypeError('Use the original journal directory');
  return { dev: String(item.dev), ino: String(item.ino) };
}
async function readGuard(root: string, binding: ProposalQueueBinding) {
  try {
    const markerPath = join(root, GENERATION_JOURNAL_RESTORE_MARKER);
    const sourcePath = join(root, GENERATION_JOURNAL_RESTORE_SOURCE);
    const markerIdentity = await fingerprint(markerPath);
    const sourceIdentity = await fingerprint(sourcePath);
    const marker = await readOptional(markerPath, 64 * 1024);
    const original = inspectGenerationJournalBackup(
      await readOptional(sourcePath, GENERATION_JOURNAL_BACKUP_BYTES),
    );
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw new TypeError();
    const row = marker as Record<string, unknown>;
    const fields = [
      'schema_version',
      'kind',
      'restore_id',
      'created_at',
      'source_backup_sha256',
      'binding',
      'policy',
      'completion',
    ];
    if (
      Object.keys(row).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(row, field)) ||
      row.schema_version !== 1 ||
      row.kind !== 'proposal-generation-journal-restore-marker' ||
      !isUlid(row.restore_id) ||
      row.source_backup_sha256 !== original.sha256 ||
      typeof row.created_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at) ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      new Date(row.created_at).toISOString() !== row.created_at ||
      row.policy !== 'block-new-generation' ||
      row.completion !== 'not-attested' ||
      !isDeepStrictEqual(row.binding, binding) ||
      !isDeepStrictEqual(original.binding, binding) ||
      !isDeepStrictEqual(markerIdentity, await fingerprint(markerPath)) ||
      !isDeepStrictEqual(sourceIdentity, await fingerprint(sourcePath))
    )
      throw new TypeError();
    return {
      marker: row,
      marker_identity: markerIdentity,
      source_identity: sourceIdentity,
      source_sha256: original.sha256,
    };
  } catch {
    throw new ContractError(
      mergePrefix + 'QUARANTINE_REQUIRED',
      'Use an existing restored journal with its complete original marker and matching source backup; ordinary or incomplete provenance cannot be merged',
    );
  }
}
type Guard = Awaited<ReturnType<typeof readGuard>>;
/** Cheap per-write check; full original evidence is re-read at operation boundaries. */
export async function assertJournalMergeGuard(
  root: string,
  identity: Awaited<ReturnType<typeof journalDirectoryIdentity>>,
  guard: Guard,
) {
  if (
    !isDeepStrictEqual(identity, await journalDirectoryIdentity(root)) ||
    !isDeepStrictEqual(
      guard.marker_identity,
      await fingerprint(join(root, GENERATION_JOURNAL_RESTORE_MARKER)),
    ) ||
    !isDeepStrictEqual(
      guard.source_identity,
      await fingerprint(join(root, GENERATION_JOURNAL_RESTORE_SOURCE)),
    ) ||
    !isDeepStrictEqual(
      guard.marker,
      await readOptional(join(root, GENERATION_JOURNAL_RESTORE_MARKER), 64 * 1024),
    )
  )
    throw new ContractError(
      mergePrefix + 'CHANGED',
      'Journal identity or restore evidence changed; keep all files and preview again',
    );
}
export async function verifyJournalMergeGuard(
  root: string,
  identity: Awaited<ReturnType<typeof journalDirectoryIdentity>>,
  guard: Guard,
  binding: ProposalQueueBinding,
) {
  await assertJournalMergeGuard(root, identity, guard);
  if (!isDeepStrictEqual(guard, await readGuard(root, binding)))
    throw new ContractError(mergePrefix + 'CHANGED', 'The complete restore evidence changed');
}
export async function assertJournalInventory(
  root: string,
  backup: ProposalGenerationJournalBackup,
) {
  const expected = new Set<string>();
  for (const item of backup.requests) {
    const names = paths(root, item.request.request_key);
    for (const part of parts) if (item[part]) expected.add(basename(names[part]));
  }
  const seen = new Set<string>();
  let count = 0;
  for await (const entry of await opendir(root)) {
    if (++count > 10_000)
      throw new ContractError(mergePrefix + 'LIMIT', 'Journal enumeration exceeds 10,000 entries');
    if (!/^generation-[a-f0-9]{64}\.(request|attempt|outcome)\.json$/.test(entry.name)) continue;
    if (!entry.isFile() || !expected.has(entry.name) || seen.has(entry.name))
      throw new ContractError(
        mergePrefix + 'TARGET_SCOPE',
        'Canonical journal files changed or include another binding; do not merge this directory',
      );
    seen.add(entry.name);
  }
  if (seen.size !== expected.size)
    throw new ContractError(
      mergePrefix + 'CHANGED',
      'A canonical journal file disappeared during inspection',
    );
  return count;
}
async function evidence(
  root: string,
  name: string,
  backup: ProposalGenerationJournalBackup,
  logical: boolean,
) {
  const path = join(root, name);
  const value = await readOptional(path, GENERATION_JOURNAL_BACKUP_BYTES);
  if (value === undefined) return { path, backup, retained: false };
  const existing = inspectGenerationJournalBackup(value);
  if (
    logical
      ? journalContentDigest(existing) !== journalContentDigest(backup)
      : !isDeepStrictEqual(existing, backup)
  )
    throw new ContractError(
      mergePrefix + 'EVIDENCE_CONFLICT',
      'An existing merge evidence file contains different content; it cannot be replaced',
    );
  return { path, backup: existing, retained: true };
}

/** Internal plan retains complete data for writes; callers expose only report. */
export async function prepareGenerationJournalMerge(
  value: unknown,
  directoryPath: string,
  input: ProposalQueueBinding,
) {
  const source = inspectGenerationJournalBackup(value);
  const binding = normalizeQueueBinding(input);
  if (!isDeepStrictEqual(binding, source.binding))
    throw new ContractError(mergePrefix + 'BINDING_MISMATCH', 'Use the original source binding');
  const root = await directory(directoryPath);
  const identity = await journalDirectoryIdentity(root);
  const guard = await readGuard(root, binding);
  const current = await captureGenerationJournalBackup(root, binding);
  const entries = await assertJournalInventory(root, current);
  await verifyJournalMergeGuard(root, identity, guard, binding);
  const comparison = compareGenerationJournalBackups(source, current);
  if (comparison.has_conflicts)
    throw new ContractError(
      mergePrefix + 'CONFLICT',
      'Original request, attempt or outcome conflicts prohibit all merge writes',
      { comparison },
    );
  const merged = new Map(current.requests.map((item) => [item.request.request_key, item]));
  const additions: Array<{
    request_key: string;
    request_key_sha256: string;
    request_id: string;
    files: JournalPart[];
  }> = [];
  for (let index = 0; index < source.requests.length; index++) {
    const item = source.requests[index]!;
    const state = comparison.requests[index]!.state;
    if (state !== 'missing-in-current' && state !== 'source-extends-current') continue;
    const target = merged.get(item.request.request_key);
    const missing = parts.filter((part) => item[part] !== null && !target?.[part]);
    merged.set(item.request.request_key, item);
    additions.push({
      request_key: item.request.request_key,
      request_key_sha256: hash(item.request.request_key),
      request_id: item.request.request_id,
      files: missing,
    });
  }
  let expected: ProposalGenerationJournalBackup;
  try {
    const requests = [...merged.values()].sort((a, b) => {
      const left = hash(a.request.request_key),
        right = hash(b.request.request_key);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    if (requests.length > GENERATION_JOURNAL_BACKUP_MAX_REQUESTS) throw new TypeError();
    // Validation shape only: these capture times are not a new observation and are never saved.
    const { sha256: _currentHash, ...body } = current;
    const candidate = { ...body, requests };
    expected = inspectGenerationJournalBackup({
      ...candidate,
      sha256: hash(proposalReceiptJson(candidate, GENERATION_JOURNAL_BACKUP_BYTES)),
    });
  } catch {
    throw new ContractError(
      mergePrefix + 'LIMIT',
      'The combined complete journal exceeds its request, byte or structural limits',
    );
  }
  const currentDigest = journalContentDigest(current);
  const expectedDigest = journalContentDigest(expected);
  const sourceEvidence = await evidence(
    root,
    'generation-journal-merge-source-' + source.sha256 + '.json',
    source,
    false,
  );
  const beforeEvidence = await evidence(
    root,
    'generation-journal-merge-before-' + currentDigest + '.json',
    current,
    true,
  );
  const addedFiles = additions.reduce((count, item) => count + item.files.length, 0);
  if (
    additions.length > 0 &&
    entries + addedFiles + Number(!sourceEvidence.retained) + Number(!beforeEvidence.retained) >
      10_000
  )
    throw new ContractError(
      mergePrefix + 'LIMIT',
      'The planned journal would exceed its directory entry limit',
    );
  for (const addition of additions) {
    const names = paths(root, addition.request_key);
    for (const part of addition.files) {
      try {
        await lstat(names[part]);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          continue;
        throw error;
      }
      throw new ContractError(
        mergePrefix + 'CHANGED',
        'A planned missing file already exists; preview again',
      );
    }
  }
  const plan = {
    schema_version: 1,
    kind: 'proposal-generation-journal-merge-plan',
    binding,
    directory: root,
    directory_identity: identity,
    restore_evidence: guard,
    source_backup_sha256: source.sha256,
    current_content_sha256: currentDigest,
    expected_content_sha256: expectedDigest,
    additions,
    evidence_files: [basename(sourceEvidence.path), basename(beforeEvidence.path)],
    policy: 'missing-only-keep-quarantine',
  };
  const planSha = hash(proposalReceiptJson(plan, 512 * 1024));
  const report = {
    ...plan,
    plan_sha256: planSha,
    source_requests: source.requests.length,
    current_requests: current.requests.length,
    expected_requests: expected.requests.length,
    added_files: addedFiles,
    comparison,
    evidence: [sourceEvidence, beforeEvidence].map((item) => ({
      path: item.path,
      action:
        additions.length === 0
          ? ('not-needed' as const)
          : item.retained
            ? ('retain' as const)
            : ('create' as const),
      backup_sha256: item.backup.sha256,
    })),
    journal_dispatch: 'blocked-restored' as const,
    current_provider: 'not-checked' as const,
    provider_dispatch: 'not-sent' as const,
    provider_dispatch_scope: 'this-invocation' as const,
    atomicity: 'per-file-only' as const,
  };
  return {
    root,
    source,
    current,
    expected,
    guard,
    identity,
    additions,
    sourceEvidence,
    beforeEvidence,
    report,
  };
}
