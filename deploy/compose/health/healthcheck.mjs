import fs from 'node:fs';
import path from 'node:path';

const composeRoot = path.resolve(import.meta.dirname, '..');
const offline = process.argv.includes('--offline');
const composeExists = fs.existsSync(path.join(composeRoot, 'docker-compose.yml'));

const result = {
  status: composeExists ? 'ok' : 'failed',
  readiness: composeExists && offline ? 'ready' : composeExists ? 'unknown' : 'not_ready',
  schema_version: 1,
  version: '0.1.0',
  trace_id: `trace_health_${Date.now().toString(36)}`,
  scope: {
    tenant_id: 'tenant-demo',
    workspace_id: 'workspace-demo',
    project_id: 'project-continuity',
  },
  source_refs: [{ type: 'compose', id: 'planemem-p0' }],
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'ok' ? 0 : 1);
