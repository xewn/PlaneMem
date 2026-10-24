import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('P6 contract publishes auth, policy, audit and observability boundaries', () => {
  for (const packagePath of [
    'packages/auth/package.json',
    'packages/observability/package.json',
    'apps/policy-service/package.json',
    'apps/audit-service/package.json',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, packagePath), 'utf8'));
    assert.equal(manifest.version, '0.1.0');
    assert.ok(manifest.exports['.']);
  }
  const policy = fs.readFileSync(path.join(root, 'deploy', 'opa', 'policy.rego'), 'utf8');
  assert.match(policy, /default allow := false/);
  const keycloak = JSON.parse(
    fs.readFileSync(path.join(root, 'deploy', 'keycloak', 'realm.json'), 'utf8'),
  );
  assert.equal(keycloak.realm, 'planemem');
});
