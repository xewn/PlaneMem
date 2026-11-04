import { isDeepStrictEqual } from 'node:util';
import { ContractError, createUlid, syncJsonSnapshot } from '@planemem/contracts';
import type { ProposalQueueBinding } from './queue-binding.js';
import { paths, readOptional, readState } from './generation-journal-read.js';
import { GENERATION_REQUEST_BYTES } from './generation-request.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';
import {
  captureGenerationJournalBackup,
  inspectGenerationJournalBackup,
  GENERATION_JOURNAL_BACKUP_BYTES,
} from './generation-journal-backup.js';
import {
  assertJournalInventory,
  assertJournalMergeGuard,
  journalContentDigest,
  mergePrefix,
  prepareGenerationJournalMerge,
  verifyJournalMergeGuard,
} from './generation-journal-merge-plan.js';

export interface GenerationJournalMergeOptions {
  preview?: boolean;
  confirm_sha256?: string;
}
function parseOptions(value: unknown) {
  try {
    const row = JSON.parse(syncJsonSnapshot(value, 4096)) as Record<string, unknown>;
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !['preview', 'confirm_sha256'].includes(key)) ||
      (row.preview !== undefined && typeof row.preview !== 'boolean')
    )
      throw new TypeError();
    if (row.preview === true && row.confirm_sha256 === undefined)
      return { preview: true as const, digest: null };
    if (
      row.preview !== true &&
      typeof row.confirm_sha256 === 'string' &&
      row.confirm_sha256.length === 64 &&
      /^[a-f0-9]{64}$/.test(row.confirm_sha256)
    )
      return { preview: false as const, digest: row.confirm_sha256 };
    throw new TypeError();
  } catch {
    throw new ContractError(
      mergePrefix + 'CONFIRMATION_REQUIRED',
      'Preview the complete merge plan or confirm its exact SHA-256',
    );
  }
}

/** Missing files only, in an already quarantined directory. The file group is not a transaction. */
export async function mergeGenerationJournalBackup(
  value: unknown,
  directoryPath: string,
  binding: ProposalQueueBinding,
  options: GenerationJournalMergeOptions = {},
) {
  const selected = parseOptions(options);
  let prepared: Awaited<ReturnType<typeof prepareGenerationJournalMerge>>;
  try {
    prepared = await prepareGenerationJournalMerge(value, directoryPath, binding);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      mergePrefix + 'UNAVAILABLE',
      'The complete existing journal and evidence could not be inspected; no writes were attempted',
    );
  }
  const { root, source, current, expected, guard, identity, additions, report } = prepared;
  if (selected.preview) return { ...report, state: 'preview' as const, mutation: 'none' as const };
  if (selected.digest !== report.plan_sha256)
    throw new ContractError(
      mergePrefix + 'PLAN_CHANGED',
      'The source, target content or restoration evidence differs from the confirmed plan; preview again',
      {
        actual_plan_sha256: report.plan_sha256,
        current_content_sha256: report.current_content_sha256,
        mutation: 'none',
      },
    );
  if (!additions.length)
    return { ...report, state: 'unchanged' as const, mutation: 'none' as const };

  const trace = 'trace_generation_journal_merge_' + createUlid();
  let phase = 'preserve-evidence';
  let activeFile: string | null = null;
  let logWriteAttempted = false;
  const savedLogFiles: string[] = [];
  const savedEvidence: string[] = [];
  const temporaryPaths = new Set<string>();
  const write = async (path: string, content: unknown, maximum: number, journal: boolean) => {
    activeFile = path;
    await assertJournalMergeGuard(root, identity, guard);
    const output = await prepareGenerationOutput(path);
    if (journal) logWriteAttempted = true;
    const saved = await saveGenerationFile(
      output,
      Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8'),
      maximum,
      trace,
      mergePrefix + 'FILE_SAVE_FAILED',
    );
    (journal ? savedLogFiles : savedEvidence).push(path);
    if (saved.cleanup_pending && saved.temporary_path) temporaryPaths.add(saved.temporary_path);
    await assertJournalMergeGuard(root, identity, guard);
  };
  const verifyEvidence = async () => {
    for (const evidence of [prepared.sourceEvidence, prepared.beforeEvidence]) {
      if (
        !isDeepStrictEqual(
          evidence.backup,
          inspectGenerationJournalBackup(
            await readOptional(evidence.path, GENERATION_JOURNAL_BACKUP_BYTES),
          ),
        )
      )
        throw new ContractError(
          mergePrefix + 'EVIDENCE_CONFLICT',
          'A retained evidence file changed; keep the original source backup',
        );
    }
  };
  try {
    for (const evidence of [prepared.sourceEvidence, prepared.beforeEvidence]) {
      activeFile = evidence.path;
      if (!evidence.retained)
        await write(evidence.path, evidence.backup, GENERATION_JOURNAL_BACKUP_BYTES, false);
    }
    await verifyEvidence();
    phase = 'recheck-target';
    activeFile = null;
    const beforeWrites = await captureGenerationJournalBackup(root, source.binding);
    if (journalContentDigest(beforeWrites) !== journalContentDigest(current))
      throw new ContractError(
        mergePrefix + 'CHANGED',
        'Target content changed after evidence preservation; no journal files can be added under this plan',
      );
    await assertJournalInventory(root, beforeWrites);
    await verifyJournalMergeGuard(root, identity, guard, source.binding);

    const originalByKey = new Map(current.requests.map((item) => [item.request.request_key, item]));
    const expectedByKey = new Map(
      expected.requests.map((item) => [item.request.request_key, item]),
    );
    for (const addition of additions) {
      phase = 'check-request';
      const key = addition.request_key;
      const names = paths(root, key);
      const original = originalByKey.get(key);
      await assertJournalMergeGuard(root, identity, guard);
      if (original) {
        if (!isDeepStrictEqual(original, await readState(root, source.binding, key)))
          throw new ContractError(
            mergePrefix + 'CHANGED',
            'An original request changed before its missing files were added',
          );
      } else {
        for (const part of ['request', 'attempt', 'outcome'] as const)
          if (
            (await readOptional(
              names[part],
              part === 'attempt' ? 8192 : GENERATION_REQUEST_BYTES,
            )) !== undefined
          )
            throw new ContractError(
              mergePrefix + 'CHANGED',
              'A planned new request now has existing files',
            );
      }
      const target = expectedByKey.get(key)!;
      phase = 'add-files';
      for (const part of addition.files) {
        const document = target[part];
        if (!document) throw new TypeError();
        await write(
          names[part],
          document,
          part === 'attempt' ? 8192 : GENERATION_REQUEST_BYTES,
          true,
        );
      }
      phase = 'verify-request';
      if (!isDeepStrictEqual(target, await readState(root, source.binding, key)))
        throw new ContractError(
          mergePrefix + 'CHANGED',
          'The complete supplemented request differs from its planned original content',
        );
    }
    phase = 'verify-complete';
    activeFile = null;
    const after = await captureGenerationJournalBackup(root, source.binding);
    if (journalContentDigest(after) !== journalContentDigest(expected))
      throw new ContractError(
        mergePrefix + 'CHANGED',
        'The complete final journal differs from the confirmed union',
      );
    await assertJournalInventory(root, after);
    await verifyEvidence();
    await verifyJournalMergeGuard(root, identity, guard, source.binding);
    return {
      ...report,
      state: 'merged-blocked' as const,
      mutation: 'missing-files-added' as const,
      verification: 'complete-readback' as const,
      final_snapshot_sha256: after.sha256,
      final_started_at: after.started_at,
      final_completed_at: after.completed_at,
      saved_log_files: savedLogFiles,
      saved_evidence: savedEvidence,
      cleanup_pending: temporaryPaths.size > 0,
      temporary_paths: [...temporaryPaths],
    };
  } catch (error) {
    throw new ContractError(
      mergePrefix + 'FAILED',
      'Merge was not confirmed; retain source, before-snapshot and all existing/new files, then inspect and preview again',
      {
        trace_id: trace,
        plan_sha256: report.plan_sha256,
        source_backup_sha256: source.sha256,
        directory: root,
        phase,
        active_file: activeFile,
        journal_mutation: logWriteAttempted ? 'not-confirmed' : 'not-started',
        saved_log_files: savedLogFiles,
        saved_evidence: savedEvidence,
        evidence_paths: [prepared.sourceEvidence.path, prepared.beforeEvidence.path],
        temporary_paths: [...temporaryPaths],
        provider_dispatch: 'not-sent',
        provider_dispatch_scope: 'this-invocation',
        atomicity: 'per-file-only',
        ...(error instanceof ContractError ? { cause_code: error.envelope.code } : {}),
        ...(error instanceof ContractError &&
        error.envelope.code === mergePrefix + 'FILE_SAVE_FAILED'
          ? { output: error.envelope.details }
          : {}),
      },
    );
  }
}
