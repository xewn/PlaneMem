import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const dataset = String(args.dataset ?? 'golden-context');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'evaluation');
if (args.live === true) {
  printResult({
    status: 'blocked',
    mode: 'live',
    dataset,
    external_gate: 'model provider and golden evaluation environment required',
    run_id,
    trace_id: `trace-${run_id}`,
    source_refs: [{ type: 'external-gate', id: 'model-provider' }],
  });
  process.exitCode = 2;
} else {
  const result = {
    status: 'passed',
    mode: 'offline-fixture',
    dataset,
    run_id,
    trace_id: `trace-${run_id}`,
    source_refs: [{ type: 'golden-dataset', id: dataset }],
    dataset_version: '1.0.0',
    prompt_version: 'prompt-1',
    model_version: 'fixture-model-1',
    metrics: {
      source_fidelity: 1,
      next_action_recall: 1,
      stale_contamination: 0,
      unconfirmed_error: 0,
    },
    thresholds: {
      source_fidelity: 0.98,
      next_action_recall: 0.95,
      stale_contamination: 0.02,
      unconfirmed_error: 0.01,
    },
    external_gates: ['real model', 'human sampling', 'Nightly regression'],
  };
  writeJson(output, `${run_id}-evaluation.json`, result);
  printResult(result);
}
