import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const composeRoot = path.join(root, 'deploy', 'compose');
const read = (relative) => fs.readFileSync(path.join(composeRoot, relative), 'utf8');

test('T0.6 defines all pinned local services and reproducible commands', () => {
  const compose = read('docker-compose.yml');
  for (const service of [
    'plane',
    'postgres',
    'redis',
    'nats',
    'keycloak',
    'minio',
    'ai-memory',
    'otel-collector',
  ]) {
    assert.match(compose, new RegExp(`^  ${service}:`, 'm'));
  }
  assert.doesNotMatch(compose, /image:\s*[^:\s]+:latest/);
  assert.ok(fs.existsSync(path.join(composeRoot, '.env.example')));
  assert.ok(fs.existsSync(path.join(composeRoot, 'Makefile')));
  assert.ok(fs.existsSync(path.join(composeRoot, 'Justfile')));
  for (const command of ['up', 'down', 'reset', 'migrate', 'seed', 'doctor']) {
    assert.match(read('Makefile'), new RegExp(`^${command}:`, 'm'));
    assert.match(read('Justfile'), new RegExp(`^${command}:`, 'm'));
  }
});

test('T0.6 provides idempotent migration and synthetic seed inputs', () => {
  const migration = fs
    .readdirSync(path.join(composeRoot, '..', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .map((file) => fs.readFileSync(path.join(root, 'deploy', 'migrations', file), 'utf8'))
    .join('\n');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS schema_migrations/i);
  assert.match(migration, /tenant_id/i);
  assert.match(migration, /source_refs/i);
  assert.match(migration, /classification/i);
  assert.match(read('seed.sql'), /01HF7YAT000000000000000001/);
});

test('T0.6 doctor and health checks run offline with structured evidence', () => {
  const doctor = spawnSync(
    process.execPath,
    [path.join(composeRoot, 'health', 'doctor.mjs'), '--offline'],
    { encoding: 'utf8' },
  );
  assert.equal(doctor.status, 0, doctor.stderr);
  const health = JSON.parse(doctor.stdout);
  assert.equal(health.status, 'ok');
  assert.equal(typeof health.trace_id, 'string');
  assert.equal(health.scope.tenant_id, 'tenant-demo');
  const healthcheck = spawnSync(
    process.execPath,
    [path.join(composeRoot, 'health', 'healthcheck.mjs'), '--offline'],
    { encoding: 'utf8' },
  );
  assert.equal(healthcheck.status, 0, healthcheck.stderr);
  assert.equal(JSON.parse(healthcheck.stdout).readiness, 'ready');
});
