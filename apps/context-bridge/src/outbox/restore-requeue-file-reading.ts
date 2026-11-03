import type { DatabaseSync } from 'node:sqlite';
import { ContractError } from '@planemem/contracts';
import { outboxReadTransaction } from './reading.js';
import { assertOutboxRestoreTrace, outboxRestoreBudget } from './restore.js';
import { parseOutboxRestoreRequeueSelection } from './restore-requeue-query.js';
import {
  outboxStoredRequeueRecord,
  type OutboxRestoreRequeueReceipt,
} from './restore-requeue-receipt.js';
import { createOutboxRestoreRequeueFile } from './restore-requeue-file.js';

/** The original batch and its complete parent are captured in one read snapshot, never replayed. */
export function readOutboxRestoreRequeueFile(db: DatabaseSync, input: unknown, trace: string) {
  const selection = parseOutboxRestoreRequeueSelection(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let historical_receipt: OutboxRestoreRequeueReceipt | null = null;
  try {
    const file = outboxReadTransaction(
      db,
      () => {
        const { recorded, history } = outboxStoredRequeueRecord(db, selection, trace, check);
        historical_receipt = recorded;
        if (!recorded || !history)
          throw new ContractError(
            'OUTBOX_REQUEUE_RECORD_NOT_FOUND',
            'No complete original requeue history was observed; no receipt file is available',
            { trace_id: trace, retryable: false },
          );
        const file = createOutboxRestoreRequeueFile(
          {
            schema_version: 1,
            kind: 'workctx.sync-outbox-restore-requeue-receipt',
            scope: selection.scope,
            observed_at: new Date().toISOString(),
            export_trace_id: trace,
            receipt: recorded,
            parent: history,
          },
          trace,
          check,
        );
        check();
        return file;
      },
      trace,
    );
    check();
    return file;
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete original requeue file could not be prepared',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          selection,
          historical_receipt,
          complete: false,
          local_commit: 'not-attempted',
        },
      },
    );
  }
}
