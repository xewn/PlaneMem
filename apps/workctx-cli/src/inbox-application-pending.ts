import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import type { SqliteSyncInbox } from '@planemem/context-bridge';

/** Query and adapter selection precede opening an existing inbox. No reducer or file output. */
export async function runInboxApplicationPending(path: string, input: unknown, trace: string) {
  const bridge = await import('@planemem/context-bridge');
  const query = bridge.parseInboxBuiltInApplicationPendingQuery(input, trace);
  let inbox: SqliteSyncInbox | undefined;
  let listing: ReturnType<SqliteSyncInbox['readBuiltInApplicationPendingPages']> | undefined;
  let failed = false;
  let failure: unknown;
  let stage = 'open';
  try {
    inbox = new bridge.SqliteSyncInbox(path, { create: false, readonly: true, trace_id: trace });
    stage = 'listing';
    listing = inbox.readBuiltInApplicationPendingPages(query, trace);
  } catch (error) {
    failed = true;
    failure = error;
  }
  let close_pending = false;
  if (inbox) {
    try {
      inbox.close();
    } catch {
      close_pending = true;
    }
  }
  if (failed || !listing) {
    throw new ContractError(
      failure instanceof ContractError
        ? failure.envelope.code
        : 'INBOX_APPLICATION_PENDING_UNAVAILABLE',
      failure instanceof ContractError
        ? failure.envelope.message
        : 'The pending application pages could not be read',
      {
        trace_id: trace,
        retryable: false,
        details: {
          stage,
          ...(failure instanceof ContractError ? failure.envelope.details : {}),
          pending_query: query,
          listing_completed: false,
          inbox: path,
          ...(inbox ? { close_pending } : {}),
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      },
    );
  }
  const result = {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: query.expected_identity.tenant_id,
      workspace_id: query.expected_identity.workspace_id,
      project_id: query.expected_identity.project_id,
    },
    data: { ...listing, inbox: path },
    close_pending,
  };
  try {
    syncJsonSnapshot(result, 512 * 1024);
  } catch {
    throw new ContractError(
      'INBOX_APPLICATION_PENDING_TOO_LARGE',
      'The complete pending page response exceeds 512 KiB; request a smaller limit',
      {
        trace_id: trace,
        retryable: false,
        details: {
          stage: 'response',
          pending_query: query,
          listing_completed: true,
          response_completed: false,
          inbox: path,
          close_pending,
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      },
    );
  }
  return result;
}
