export interface RollbackPlan {
  allowed: boolean;
  from: string;
  to: string;
  trace_id: string;
  reasons: string[];
  steps: string[];
}

export function planRollback(input: {
  from: string;
  to: string;
  approved: boolean;
  trace_id: string;
}): RollbackPlan {
  const reasons = input.approved ? [] : ['release_approval_required'];
  return {
    allowed: reasons.length === 0,
    from: input.from,
    to: input.to,
    trace_id: input.trace_id,
    reasons,
    steps:
      reasons.length > 0
        ? []
        : [
            'freeze_writes',
            'restore_backup',
            'apply_previous_manifest',
            'replay_outbox',
            'run_smoke',
            'unfreeze_writes',
          ],
  };
}
