import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractError, createUlid } from '@planemem/contracts';

export const GENERATION_JOURNAL_RESTORE_MARKER = '.generation-journal-restored.json';
export const GENERATION_JOURNAL_RESTORE_SOURCE = 'generation-journal-source-backup.json';
export type GenerationJournalDispatchPolicy =
  | 'ordinary-journal'
  | 'blocked-restored'
  | 'blocked-unreadable';

/** Presence is sufficient: corrupt markers, directories and symlinks must also block dispatch. */
export async function readGenerationJournalDispatchPolicy(
  root: string,
): Promise<GenerationJournalDispatchPolicy> {
  for (const name of [GENERATION_JOURNAL_RESTORE_MARKER, GENERATION_JOURNAL_RESTORE_SOURCE]) {
    try {
      await lstat(join(root, name));
      return 'blocked-restored';
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        return 'blocked-unreadable';
    }
  }
  // This observation is not proof that a historical provider invocation never happened.
  return 'ordinary-journal';
}

export async function assertGenerationJournalDispatchAllowed(root: string) {
  const policy = await readGenerationJournalDispatchPolicy(root);
  if (policy !== 'ordinary-journal')
    throw new ContractError(
      'PROPOSAL_GENERATION_JOURNAL_QUARANTINED',
      'Restored journals retain historical observations only; keep their marker and source backup, and do not start new generation requests or model calls',
      {
        trace_id: 'trace_generation_' + createUlid(),
        journal_dispatch: policy,
        provider_dispatch: 'not-sent',
        provider_dispatch_scope: 'this-invocation',
      },
    );
}
