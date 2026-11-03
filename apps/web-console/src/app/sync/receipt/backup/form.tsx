'use client';

import { SYNC_ORIGINALS_BACKUP_MAX_ENTRIES, type SyncEventReceiptQuery } from '@planemem/contracts';
import { BackupReviewForm } from '../backup-review';
import {
  prepareBrowserOriginalsBackup,
  loadOriginalsBackup,
  restoreOriginalsBackup,
} from '../original-backup';

export function OriginalBackupForm() {
  return (
    <BackupReviewForm<SyncEventReceiptQuery>
      title="Saved original query backups"
      scope="This backup includes saved original queries across accounts and projects in this browser profile. Historical receipt copies, unsaved drafts and local queues are not included."
      kindLabel="original queries"
      filename="sync-originals-backup.json"
      entryLimit={SYNC_ORIGINALS_BACKUP_MAX_ENTRIES}
      prepare={prepareBrowserOriginalsBackup}
      load={loadOriginalsBackup}
      restore={restoreOriginalsBackup}
      describe={(entry) => [
        { label: 'Event', value: entry.event.event_id },
        { label: 'Event type', value: entry.event.event_type },
        ...Object.entries(entry.identity).map(([key, value]) => ({
          label: key.replace(/_/g, ' '),
          value,
        })),
      ]}
    />
  );
}
