import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('P3 contract publishes session, sync and outbox migrations', () => {
  for (const migration of [
    '004_sessions.sql',
    '005_sync.sql',
    '006_outbox.sql',
    '010_session_continuity_persistence.sql',
  ]) {
    const content = fs.readFileSync(path.join(root, 'deploy', 'migrations', migration), 'utf8');
    assert.match(content, /schema_migrations/);
    assert.match(content, /CREATE TABLE IF NOT EXISTS/);
  }
});

test('P3 contract keeps session continuity persistence isolated from project handoffs', () => {
  const migration = fs.readFileSync(
    path.join(root, 'deploy', 'migrations', '010_session_continuity_persistence.sql'),
    'utf8',
  );
  assert.match(migration, /wcp_session_checkpoints/);
  assert.match(migration, /wcp_session_handoffs/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS wcp_handoffs/);
});

test('P3 contract keeps public service boundaries versioned', () => {
  for (const packagePath of [
    'apps/session-service/package.json',
    'apps/sync-service/package.json',
    'apps/context-bridge/package.json',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, packagePath), 'utf8'));
    assert.equal(manifest.version, '0.1.0');
    assert.ok(manifest.exports['.']);
  }
});
