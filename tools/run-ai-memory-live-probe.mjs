import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
const run_id = stableRunId(args, 'ai-memory-live');
const workspace = 'live-probe';
const project = 'runtime-probe';
const pagePath = 'notes/live-probe.md';
const query = 'ai-memory capture search';
const composePrefix = [
  'compose',
  '-p',
  'planemem-local',
  '-f',
  'deploy/compose/docker-compose.yml',
  '-f',
  'deploy/compose/docker-compose.local-test.yml',
];

function runCompose(argumentsList) {
  return spawnSync('docker', [...composePrefix, ...argumentsList], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: { ...process.env, RUST_LOG: 'error' },
  });
}

function runMemory(argumentsList) {
  return runCompose(['exec', '-T', 'ai-memory', 'ai-memory', ...argumentsList]);
}

function parseJsonOutput(result) {
  const text = result.stdout.trim();
  if (!text) throw new Error('ai-memory command returned empty stdout');
  return JSON.parse(text);
}

function assertSuccess(result, operation) {
  if (result.status !== 0)
    throw new Error(`${operation} failed: ${(result.stderr || result.stdout).trim()}`);
}

function countHits(value) {
  if (!Array.isArray(value)) throw new Error('ai-memory search response is not an array');
  return value.length;
}

const steps = [];
let wrotePage = false;
let status = 'passed';
let error;
let matchedBeforeDelete = 0;
let matchedAfterDelete = 0;
let pageId;

try {
  const services = runCompose(['ps', '--format', 'json']);
  assertSuccess(services, 'compose.ps');
  const serviceRows = services.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const aiMemory = serviceRows.find((service) => service.Service === 'ai-memory');
  if (aiMemory?.State !== 'running' || aiMemory?.Health !== 'healthy') {
    status = 'blocked';
    error = 'ai-memory Compose service is not running and healthy';
  } else {
    const write = runMemory([
      'write-page',
      '--workspace',
      workspace,
      '--project',
      project,
      '--path',
      pagePath,
      '--body',
      `# Live platform probe\n\nThis page verifies ai-memory capture and search for ${run_id}.`,
      '--kind',
      'fact',
      '--tier',
      'episodic',
    ]);
    assertSuccess(write, 'write-page');
    wrotePage = true;
    const pageMatch = write.stdout.match(/page_id=([^\s)]+)/);
    pageId = pageMatch?.[1];
    steps.push({ name: 'ai-memory.write-page', status: 'passed' });

    const before = runMemory([
      'search',
      '--workspace',
      workspace,
      '--project',
      project,
      '--json',
      '--limit',
      '10',
      query,
    ]);
    assertSuccess(before, 'search-before-delete');
    matchedBeforeDelete = countHits(parseJsonOutput(before));
    if (matchedBeforeDelete < 1) throw new Error('search-before-delete returned no page');
    steps.push({ name: 'ai-memory.search-before-delete', status: 'passed', matchedBeforeDelete });

    const remove = runMemory([
      'delete-page',
      '--workspace',
      workspace,
      '--project',
      project,
      '--path',
      pagePath,
    ]);
    assertSuccess(remove, 'delete-page');
    steps.push({ name: 'ai-memory.delete-page', status: 'passed' });
    wrotePage = false;

    const after = runMemory([
      'search',
      '--workspace',
      workspace,
      '--project',
      project,
      '--json',
      '--limit',
      '10',
      query,
    ]);
    assertSuccess(after, 'search-after-delete');
    matchedAfterDelete = countHits(parseJsonOutput(after));
    if (matchedAfterDelete !== 0) throw new Error('search-after-delete returned residual pages');
    steps.push({ name: 'ai-memory.search-after-delete', status: 'passed' });
  }
} catch (caught) {
  status = 'failed';
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  if (wrotePage) {
    runMemory(['delete-page', '--workspace', workspace, '--project', project, '--path', pagePath]);
  }
}

const result = {
  status,
  mode: 'live',
  run_id,
  service: 'ai-memory',
  version: '3.1.1',
  transport: 'docker-compose exec ai-memory CLI',
  scope: { workspace, project },
  operations: {
    write_page: {
      status: steps.some((step) => step.name === 'ai-memory.write-page') ? 'passed' : 'not-run',
      path: pagePath,
      page_id: pageId,
    },
    search_before_delete: {
      status: steps.some((step) => step.name === 'ai-memory.search-before-delete')
        ? 'passed'
        : 'not-run',
      matched_pages: matchedBeforeDelete,
    },
    delete_page: {
      status: steps.some((step) => step.name === 'ai-memory.delete-page') ? 'passed' : 'not-run',
      path: pagePath,
    },
    search_after_delete: {
      status: steps.some((step) => step.name === 'ai-memory.search-after-delete')
        ? 'passed'
        : 'not-run',
      matched_pages: matchedAfterDelete,
    },
  },
  steps,
  residual_data: matchedAfterDelete === 0 ? 'none' : 'detected',
  measured: status === 'passed',
  source_refs: [{ type: 'live-service', id: 'planemem-local/ai-memory' }],
  external_gates: status === 'blocked' ? ['Docker/Compose ai-memory service'] : [],
  ...(error ? { error } : {}),
};

writeJson(output, `${run_id}-ai-memory.json`, result);
writeFileSync(
  path.join(output, `${run_id}-verification.txt`),
  [
    `status=${status}`,
    'service=ai-memory',
    'version=3.1.1',
    'transport=docker-compose exec ai-memory CLI',
    `scope=${workspace}/${project}`,
    `write_page=${result.operations.write_page.status} path=${pagePath}`,
    `search_before_delete=${result.operations.search_before_delete.status} matched_pages=${matchedBeforeDelete}`,
    `delete_page=${result.operations.delete_page.status} path=${pagePath}`,
    `search_after_delete=${result.operations.search_after_delete.status} matched_pages=${matchedAfterDelete}`,
    `residual_data=${result.residual_data}`,
    ...(error ? [`error=${error}`] : []),
    '',
  ].join('\n'),
  'utf8',
);
printResult(result);
if (status !== 'passed') process.exitCode = status === 'blocked' ? 2 : 1;
