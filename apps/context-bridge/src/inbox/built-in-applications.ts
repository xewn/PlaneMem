import type { SyncCommandIdentity } from '@planemem/contracts';
import {
  applicationFailure,
  parseInboxApplicationApplyQuery,
  type SyncInboxApplication,
} from './application-model.js';
import {
  CONTEXT_ITEM_APPLICATION,
  contextItemApplicationAdapter,
} from './context-item-application.js';
import { PROPOSAL_APPLICATION, proposalApplicationAdapter } from './proposal-application.js';

function matches(application: SyncInboxApplication, known: SyncInboxApplication) {
  return application.name === known.name && application.version === known.version;
}
export function requireBuiltInApplication(application: SyncInboxApplication, trace: string) {
  if (
    !matches(application, CONTEXT_ITEM_APPLICATION) &&
    !matches(application, PROPOSAL_APPLICATION)
  )
    throw applicationFailure(
      'INBOX_APPLICATION_ADAPTER_UNSUPPORTED',
      'Select context-item-lifecycle or proposal-lifecycle at version 1',
      trace,
    );
}
/** Apply and replay select the same fixed implementation; no modules or executable input. */
export function builtInApplicationAdapter(
  application: SyncInboxApplication,
  identity: SyncCommandIdentity,
  trace: string,
) {
  requireBuiltInApplication(application, trace);
  return matches(application, PROPOSAL_APPLICATION)
    ? proposalApplicationAdapter(identity)
    : contextItemApplicationAdapter(identity);
}
/** Parse and select before opening storage. */
export function parseInboxBuiltInApplicationApplyQuery(input: unknown, trace: string) {
  const query = parseInboxApplicationApplyQuery(input, trace);
  requireBuiltInApplication(query.application, trace);
  return query;
}
