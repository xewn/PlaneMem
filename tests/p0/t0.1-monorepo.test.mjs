import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('T0.1 publishes a reproducible workspace contract', () => {
  const manifest = readJson('package.json');
  assert.equal(manifest.private, true);
  assert.equal(manifest.packageManager, 'pnpm@11.25.0');
  assert.match(manifest.engines.node, /^>=24 <25$/);
  for (const script of [
    'lint',
    'typecheck',
    'test',
    'contract-test',
    'test:contract',
    'test:module',
  ]) {
    assert.equal(typeof manifest.scripts?.[script], 'string', `missing ${script} script`);
  }
  assert.equal(fs.existsSync(path.join(root, 'pnpm-workspace.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'turbo.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), true);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/pr.yml')), true);
});

test('T0.1 declares stable package boundaries', () => {
  const expected = ['contracts', 'events', 'sdk', 'test-fixtures'];
  for (const name of expected) {
    const file = path.join(root, 'packages', name, 'package.json');
    assert.equal(fs.existsSync(file), true, `missing packages/${name}/package.json`);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(manifest.name, `@planemem/${name}`);
    assert.equal(manifest.private, true);
  }
});
