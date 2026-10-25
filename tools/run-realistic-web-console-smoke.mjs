import { createHmac } from 'node:crypto';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const run_id = stableRunId(args, 'realistic-ui');
const output = outputDirectory(args);
const baseUrl = String(args.url ?? process.env.WEB_CONSOLE_URL ?? 'http://127.0.0.1:43124').replace(
  /\/$/,
  '',
);
const secret = String(args.session_secret ?? process.env.AUTH_SESSION_SECRET ?? '');
const scope = {
  tenant_id: String(
    args.tenant_id ?? process.env.WORKBENCH_TENANT_ID ?? '01HF7YAT000000000000000001',
  ),
  workspace_id: String(
    args.workspace_id ?? process.env.WORKBENCH_WORKSPACE_ID ?? '01HF7YAT000000000000000002',
  ),
  project_id: String(
    args.project_id ?? process.env.WORKBENCH_PROJECT_ID ?? '01HF7YAT000000000000000003',
  ),
};

if (!secret) {
  throw new Error('AUTH_SESSION_SECRET is required for the signed UI smoke session');
}

function encodeSession() {
  const payload = Buffer.from(
    JSON.stringify({
      access_token: 'smoke-probe',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      sub: 'ui-acceptance',
      preferred_username: 'ui-acceptance',
      roles: ['admin'],
      ...scope,
    }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const cookie = `planemem_session=${encodeSession()}`;
const routes = [
  { path: '/overview', marker: 'Project Overview' },
  { path: '/work-items', marker: 'Resolve checkpoint hash mismatch' },
  { path: '/context', marker: 'North-star outcome' },
  { path: '/sessions', marker: 'github-actions' },
  { path: '/handoffs', marker: 'Restore the redaction review' },
  { path: '/conflicts', marker: 'real-w-134' },
  { path: '/audit', marker: 'work_item.update' },
  { path: '/admin', marker: 'PostgreSQL projection' },
];

const results = [];
for (const route of routes) {
  const response = await fetch(`${baseUrl}${route.path}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const body = await response.text();
  results.push({
    path: route.path,
    status_code: response.status,
    marker: route.marker,
    marker_found: body.includes(route.marker),
    bytes: Buffer.byteLength(body),
  });
}

const failed = results.filter((result) => result.status_code !== 200 || !result.marker_found);
const report = {
  schema_version: 1,
  status: failed.length === 0 ? 'passed' : 'failed',
  run_id,
  base_url: baseUrl,
  scope,
  routes: results,
  source_refs: [
    { type: 'fixture', id: 'seed-realistic-workbench.sql' },
    { type: 'live-api', id: 'workbench.query' },
    { type: 'live-ui', id: baseUrl },
  ],
};
const reportPath = writeJson(output, `${run_id}.json`, report);
printResult({ ...report, report_path: reportPath });
if (failed.length > 0) process.exitCode = 1;
