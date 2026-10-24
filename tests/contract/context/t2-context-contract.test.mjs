import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..', '..');

test('P2-C01/T2 contract publishes context item schema and artifact migration', () => {
  const schemaPath = path.join(
    root,
    'packages',
    'context-compiler',
    'schemas',
    'context-item.json',
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  for (const field of [
    'schema_version',
    'id',
    'layer',
    'content',
    'source_refs',
    'tenant_id',
    'workspace_id',
    'project_id',
    'trace_id',
  ]) {
    assert.ok(schema.required.includes(field), `missing required field ${field}`);
  }
  assert.deepEqual(schema.properties.layer.enum, ['L0', 'L1', 'L2', 'L3', 'L4']);

  const migration = fs.readFileSync(
    path.join(root, 'deploy', 'migrations', '003_artifacts.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS wcp_artifacts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS wcp_artifact_versions/);
  assert.match(migration, /003_artifacts/);
});

test('P2-C01/T2 contract keeps memory adapter source under the public domain boundary', () => {
  assert.ok(fs.existsSync(path.join(root, 'packages', 'domain', 'src', 'memory', 'index.ts')));
  const adapter = fs.readFileSync(
    path.join(root, 'apps', 'context-service', 'src', 'memory-adapter', 'adapter.ts'),
    'utf8',
  );
  assert.match(adapter, /@planemem\/domain/);
  assert.doesNotMatch(adapter, /export interface MemoryRef/);
});
