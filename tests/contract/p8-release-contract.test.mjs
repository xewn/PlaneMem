import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('P8 contract publishes release, compose and Helm boundaries', () => {
  for (const path of [
    'packages/release/package.json',
    'apps/integration-orchestrator/package.json',
    'deploy/release-manifest.yaml',
    'deploy/compose/docker-compose.yml',
    'deploy/compose/docker-compose.local-test.yml',
    'deploy/helm/planemem/Chart.yaml',
    'deploy/helm/planemem/values.schema.json',
  ])
    assert.equal(existsSync(path), true, path);
  assert.match(readFileSync('deploy/release-manifest.yaml', 'utf8'), /schema_version:\s*1/);
  assert.match(
    readFileSync('deploy/compose/docker-compose.local-test.yml', 'utf8'),
    /planemem-platform:0\.1\.0(?:-transport|-wavemate)?@sha256:[0-9a-f]{64}/,
  );
});
