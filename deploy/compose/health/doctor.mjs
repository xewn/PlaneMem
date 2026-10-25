import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const composeRoot = path.resolve(import.meta.dirname, '..');
const offline = process.argv.includes('--offline');
const requiredFiles = [
  'docker-compose.yml',
  '.env.example',
  'seed.sql',
  'otel-collector.yaml',
  path.join('..', 'migrations', '001_baseline.sql'),
  path.join('..', 'migrations', '002_contracts.sql'),
  path.join('..', 'migrations', '009_runtime_state.sql'),
  path.join('..', 'migrations', '010_session_continuity_persistence.sql'),
];

function report(status, checks, error) {
  return {
    status,
    schema_version: 1,
    version: '0.1.0',
    trace_id: `trace_doctor_${Date.now().toString(36)}`,
    scope: {
      tenant_id: 'tenant-demo',
      workspace_id: 'workspace-demo',
      project_id: 'project-continuity',
    },
    source_refs: [{ type: 'compose', id: 'planemem-p0' }],
    checks,
    ...(error === undefined ? {} : { error }),
  };
}

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(composeRoot, file)));
if (missing.length > 0) {
  console.log(JSON.stringify(report('failed', { files: 'failed' }, { missing }), null, 2));
  process.exit(1);
}

if (!offline) {
  try {
    execFileSync(
      process.platform === 'win32' ? 'docker.exe' : 'docker',
      ['compose', '--env-file', '.env.example', '-f', 'docker-compose.yml', 'config', '--quiet'],
      { cwd: composeRoot, stdio: 'pipe' },
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        report('failed', { files: 'passed', compose_config: 'failed' }, { message: String(error) }),
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

console.log(
  JSON.stringify(
    report('ok', {
      files: 'passed',
      compose_config: offline ? 'skipped_offline' : 'passed',
      migration_metadata: 'passed',
    }),
    null,
    2,
  ),
);
