'use client';

import { SYNC_RECEIPTS_BACKUP_MAX_ENTRIES, type SyncEventReceiptFile } from '@planemem/contracts';
import { BackupReviewForm } from '../backup-review';
import {
  prepareBrowserReceiptsBackup,
  loadReceiptsBackup,
  restoreReceiptsBackup,
} from '../receipt-backup';

export function ReceiptBackupForm() {
  return (
    <BackupReviewForm<SyncEventReceiptFile>
      title="Saved historical receipt backups"
      scope="This backup includes every saved historical receipt across accounts and projects in this browser profile. Results retain their original query trace and historical meaning. Restoring receipts does not save original queries separately, check current delivery, or change local queues."
      kindLabel="historical receipts"
      filename="sync-receipts-backup.json"
      entryLimit={SYNC_RECEIPTS_BACKUP_MAX_ENTRIES}
      prepare={prepareBrowserReceiptsBackup}
      load={loadReceiptsBackup}
      restore={restoreReceiptsBackup}
      describe={(file) => {
        const receipt = file.document.receipt;
        return [
          { label: 'Event', value: receipt.data.event.event_id },
          { label: 'Event type', value: receipt.data.event.event_type },
          { label: 'Original query trace', value: receipt.trace_id },
          {
            label: 'Historical outcome',
            value:
              receipt.data.status === 'not-observed'
                ? 'not-observed'
                : receipt.data.receipt.accepted
                  ? 'accepted'
                  : 'conflict',
          },
          { label: 'Receipt digest', value: file.document_sha256 },
          ...Object.entries(receipt.data.identity).map(([key, value]) => ({
            label: key.replace(/_/g, ' '),
            value,
          })),
        ];
      }}
    />
  );
}
