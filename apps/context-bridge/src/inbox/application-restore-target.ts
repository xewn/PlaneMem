import { ContractError, parseSyncApplicationRestoreTarget } from '@planemem/contracts';

export interface SyncInboxApplicationRestoreTarget {
  schema_version: 1;
  application_history_sha256: string;
  received_history_sha256: string;
}

/** Called only on the detached, bounded restore query. Partial or unknown guards are rejected. */
export function parseInboxApplicationRestoreTarget(
  value: unknown,
): SyncInboxApplicationRestoreTarget {
  return parseSyncApplicationRestoreTarget(value);
}

export function inboxApplicationRestoreTarget(
  application: string,
  received: string,
): SyncInboxApplicationRestoreTarget {
  return {
    schema_version: 1,
    application_history_sha256: application,
    received_history_sha256: received,
  };
}

/** Each component is checked in the owner's write transaction, before any source/application insert. */
export function assertInboxApplicationRestoreTargetHistory(
  expected: string | undefined,
  observed: string,
  component: 'application-history' | 'received-history',
  trace: string,
) {
  if (expected === undefined || expected === observed) return;
  throw new ContractError(
    'INBOX_APPLICATION_RESTORE_TARGET_CHANGED',
    'The selected target history changed since the saved expectation; inspect it without replacing the original restore query',
    {
      trace_id: trace,
      retryable: false,
      details: {
        target_component: component,
        expected_history_sha256: expected,
        observed_history_sha256: observed,
        local_commit_state: 'not-committed',
        acknowledgement_dispatch_state: 'not-sent',
      },
    },
  );
}
