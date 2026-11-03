const reasons = {
  EVENT_INVALID: 'The context item event does not match its versioned lifecycle contract',
  PROJECTION_INVALID: 'The saved context item lifecycle projection is inconsistent',
  BASELINE_REQUIRED: 'The item requires its original creation event at version one',
  VERSION_GAP: 'The item event must be exactly the next version of its saved lifecycle',
  TRANSITION_INVALID: 'The item event contradicts its previous lifecycle state',
  LIMIT_REACHED: 'The context item lifecycle projection reached its item limit',
} as const;
/** Internal, fixed diagnostics from built-in reducers; no payload or arbitrary exception text. */
export class InboxApplicationRejection extends Error {
  readonly code: string;
  constructor(reason: keyof typeof reasons) {
    super(reasons[reason]);
    this.code = `INBOX_CONTEXT_ITEM_${reason}`;
  }
}
