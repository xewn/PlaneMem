import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('contract suite has a reproducible workspace baseline', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.packageManager, 'pnpm@11.25.0');
  assert.equal(packageJson.engines.node, '>=24 <25');
  assert.ok(fs.existsSync(path.join(root, 'pnpm-lock.yaml')));
  assert.ok(fs.existsSync(path.join(root, 'turbo.json')));
});
