import { createHash } from 'node:crypto';

export interface EvaluationScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface EvaluationInput {
  dataset_id: string;
  dataset_version: string;
  prompt_version: string;
  model_version: string;
  scope: EvaluationScope;
  trace_id: string;
  expected: { source_refs: string[]; next_actions: string[] };
  actual: {
    source_refs: string[];
    next_actions: string[];
    stale_count: number;
    unconfirmed_count: number;
  };
}

export interface EvaluationReport {
  schema_version: 1;
  report_id: string;
  dataset_id: string;
  dataset_version: string;
  prompt_version: string;
  model_version: string;
  scope: EvaluationScope;
  trace_id: string;
  source_refs: string[];
  metrics: {
    source_fidelity: number;
    next_action_recall: number;
    stale_contamination: number;
    unconfirmed_error: number;
  };
  thresholds: {
    source_fidelity: number;
    next_action_recall: number;
    stale_contamination: number;
    unconfirmed_error: number;
  };
  passed: boolean;
}

export function evaluatePack(input: EvaluationInput): EvaluationReport {
  const sourceRefs = new Set(input.actual.source_refs);
  const expectedRefs = new Set(input.expected.source_refs);
  const expectedActions = new Set(input.expected.next_actions);
  const actualActions = new Set(input.actual.next_actions);
  const sourceMatches = [...expectedRefs].filter((ref) => sourceRefs.has(ref)).length;
  const actionMatches = [...expectedActions].filter((action) => actualActions.has(action)).length;
  const metrics = {
    source_fidelity: expectedRefs.size === 0 ? 1 : sourceMatches / expectedRefs.size,
    next_action_recall: expectedActions.size === 0 ? 1 : actionMatches / expectedActions.size,
    stale_contamination:
      input.actual.stale_count / Math.max(1, actualActions.size + sourceRefs.size),
    unconfirmed_error: input.actual.unconfirmed_count / Math.max(1, actualActions.size),
  };
  const thresholds = {
    source_fidelity: 0.98,
    next_action_recall: 0.95,
    stale_contamination: 0.02,
    unconfirmed_error: 0.01,
  };
  const stable = JSON.stringify({
    ...input,
    actual: {
      ...input.actual,
      source_refs: [...input.actual.source_refs].sort(),
      next_actions: [...input.actual.next_actions].sort(),
    },
  });
  const report_id = `eval_${createHash('sha256').update(stable).digest('hex').slice(0, 20)}`;
  return {
    schema_version: 1,
    report_id,
    dataset_id: input.dataset_id,
    dataset_version: input.dataset_version,
    prompt_version: input.prompt_version,
    model_version: input.model_version,
    scope: { ...input.scope },
    trace_id: input.trace_id,
    source_refs: [...input.expected.source_refs],
    metrics,
    thresholds,
    passed:
      metrics.source_fidelity >= thresholds.source_fidelity &&
      metrics.next_action_recall >= thresholds.next_action_recall &&
      metrics.stale_contamination <= thresholds.stale_contamination &&
      metrics.unconfirmed_error <= thresholds.unconfirmed_error,
  };
}
