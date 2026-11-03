import type { ProposalQueueBackupJob } from './proposal-queue-backup.js';

/** Shared new-row restore policy; never apply it as an update to an existing live job. */
export function restoredProposalQueueJob(row: ProposalQueueBackupJob): ProposalQueueBackupJob {
  return row.status === 'submitted'
    ? { ...row }
    : {
        ...row,
        status: 'blocked',
        uncertain: 1,
        error_code: 'PROPOSAL_QUEUE_RESTORED_UNKNOWN',
        lease_token: null,
        lease_until_ms: null,
      };
}
