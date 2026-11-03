const reasons = {
  EVENT_INVALID: 'The context item event does not match its versioned lifecycle contract',
  PROJECTION_INVALID: 'The saved context item lifecycle projection is inconsistent',
  BASELINE_REQUIRED: 'The item requires its original creation event at version one',
  VERSION_GAP: 'The item event must be exactly the next version of its saved lifecycle',
  TRANSITION_INVALID: 'The item event contradicts its previous lifecycle state',
  LIMIT_REACHED: 'The context item lifecycle projection reached its item limit',
} as const;
const proposalReasons: Record<keyof typeof reasons, string> = {
  EVENT_INVALID: 'The proposal event does not match its versioned lifecycle contract',
  PROJECTION_INVALID: 'The saved proposal lifecycle projection is inconsistent',
  BASELINE_REQUIRED: 'The proposal requires its original approval request at revision one',
  VERSION_GAP: 'The proposal event must be exactly the next revision of its saved lifecycle',
  TRANSITION_INVALID: 'The proposal event contradicts its previous lifecycle state',
  LIMIT_REACHED: 'The proposal lifecycle projection reached its proposal limit',
};
/** Internal, fixed diagnostics from built-in reducers; no payload or arbitrary exception text. */
export class InboxApplicationRejection extends Error {
  readonly code: string;
  constructor(reason: keyof typeof reasons, domain: 'context-item' | 'proposal' = 'context-item') {
    super(domain === 'proposal' ? proposalReasons[reason] : reasons[reason]);
    this.code = `${domain === 'proposal' ? 'INBOX_PROPOSAL' : 'INBOX_CONTEXT_ITEM'}_${reason}`;
  }
}
