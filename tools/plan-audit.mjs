import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const output = outputDirectory(args);
const run_id = stableRunId(args, 'plan-audit');
const modules = Array.from({ length: 9 }, (_, index) => `P${index}`);
const requiredScripts = [
  'build',
  'lint',
  'typecheck',
  'test',
  'contract-test',
  'test:module',
  'test:e2e',
  'test:resilience',
  'test:vulnerability',
  'test:security',
  'test:identity-audit',
  'test:performance',
  'test:evaluation',
  'test:release',
  'test:memory-live',
  'test:sqlite-live',
  'test:wavemate-live',
  'test:wavemate-ui-live',
  'plan:audit',
  'rc:readiness',
  'release:manifest',
  'sbom:generate',
  'fixture:validate',
  'fixture:seed',
  'fixture:events',
  'fixture:backup',
  'evidence:bundle',
];

function relative(file) {
  return path.relative(workspaceRoot, file).replaceAll('\\', '/');
}

const taskDirectory = path.join(workspaceRoot, 'docs', 'design', '02-subprojects', 'tasks');
const taskFiles = readdirSync(taskDirectory).filter((name) => /^t\d+\.\d+-.+\.md$/.test(name));
const taskIds = taskFiles.map((name) => name.match(/^(t\d+\.\d+)/i)[1].toUpperCase());
const packageManifest = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
const packageScripts = packageManifest.scripts ?? {};
const missing = [];
for (const file of [
  path.join(workspaceRoot, 'ReadMe.md'),
  path.join(workspaceRoot, 'FILE_INDEX.md'),
  path.join(workspaceRoot, 'docs', 'traceability', 'requirements-matrix.yaml'),
  path.join(workspaceRoot, 'docs', 'design', '00-baseline', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '01-contracts', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '02-subprojects', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '03-integration', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '04-testing', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '05-release', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '05-release', '03-rc-gate-execution.md'),
  path.join(workspaceRoot, 'docs', 'design', '06-planning', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', 'vendor', 'README.md'),
  path.join(workspaceRoot, 'docs', 'design', '03-integration', '04-module-interface-contracts.md'),
  path.join(workspaceRoot, 'docs', 'design', '03-integration', '05-module-contract-test-matrix.md'),
  path.join(workspaceRoot, 'tests', 'contract', 'edge-contract-matrix.test.mjs'),
]) {
  if (!existsSync(file)) missing.push(relative(file));
}
for (const moduleName of modules) {
  for (const file of [
    path.join(
      workspaceRoot,
      'docs',
      'design',
      '06-planning',
      'modules',
      `${moduleName}-development-plan.md`,
    ),
    path.join(
      workspaceRoot,
      'docs',
      'design',
      '04-testing',
      'modules',
      `${moduleName}-independent-verification.md`,
    ),
    path.join(workspaceRoot, 'tests', moduleName.toLowerCase()),
  ]) {
    if (!existsSync(file)) missing.push(relative(file));
  }
}
const planTexts = modules.map((moduleName) =>
  readFileSync(
    path.join(
      workspaceRoot,
      'docs',
      'design',
      '06-planning',
      'modules',
      `${moduleName}-development-plan.md`,
    ),
    'utf8',
  ),
);
const verificationTexts = modules.map((moduleName) =>
  readFileSync(
    path.join(
      workspaceRoot,
      'docs',
      'design',
      '04-testing',
      'modules',
      `${moduleName}-independent-verification.md`,
    ),
    'utf8',
  ),
);
for (const file of taskFiles) {
  const taskId = file.match(/^(t\d+\.\d+)/i)[1].toUpperCase();
  const text = readFileSync(path.join(taskDirectory, file), 'utf8');
  if (!/独立测试|测试/.test(text)) missing.push(`${taskId}:missing-test-section`);
  if (!/输出|交付|验收/.test(text)) missing.push(`${taskId}:missing-output-or-acceptance`);
}
const planTaskIds = new Set(
  planTexts.flatMap((text) => [...text.matchAll(/\bT\d+\.\d+\b/g)].map((match) => match[0])),
);
const verificationTaskIds = new Set(
  verificationTexts.flatMap((text) =>
    [...text.matchAll(/\bT\d+\.\d+\b/g)].map((match) => match[0]),
  ),
);
for (const taskId of taskIds) {
  if (!planTaskIds.has(taskId)) missing.push(`${taskId}:missing-module-plan-reference`);
  if (!verificationTaskIds.has(taskId))
    missing.push(`${taskId}:missing-independent-test-reference`);
}
for (const script of requiredScripts) {
  if (packageScripts[script] === undefined) missing.push(`package.json#scripts.${script}`);
}

const matrix = readFileSync(
  path.join(workspaceRoot, 'docs', 'design', '03-integration', '05-module-contract-test-matrix.md'),
  'utf8',
);
const contractEdges = [...matrix.matchAll(/^\| (IF-P\d-P\d) \|/gm)].map((match) => match[1]);
const uniqueEdges = [...new Set(contractEdges)];
const contractTests = readdirSync(path.join(workspaceRoot, 'tests', 'contract')).filter((name) =>
  /\.(?:test|spec)\.(?:mjs|js|ts)$/.test(name),
);
const report = {
  status: missing.length === 0 ? 'passed' : 'failed',
  mode: 'offline-fixture',
  command: 'plan-audit',
  run_id,
  trace_id: `trace-${run_id}`,
  source_refs: [
    { type: 'design-plan', id: 'docs/design/06-planning' },
    { type: 'contract-matrix', id: 'docs/design/03-integration/05-module-contract-test-matrix.md' },
  ],
  counts: {
    task_files: taskFiles.length,
    expected_task_files: 37,
    task_ids_in_module_plans: [...planTaskIds].filter((id) => taskIds.includes(id)).length,
    task_ids_in_verification_docs: [...verificationTaskIds].filter((id) => taskIds.includes(id))
      .length,
    modules: modules.length,
    contract_edges: uniqueEdges.length,
    contract_test_files: contractTests.length,
    required_scripts: requiredScripts.length,
  },
  missing,
  external_gates: ['real Compose/Helm deployment', 'live services and production smoke'],
};
writeJson(output, `${run_id}-plan-audit.json`, report);
printResult(report);
if (report.status !== 'passed') process.exitCode = 1;
