import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('P4 contract publishes all gateway package boundaries and client matrix', () => {
  for (const packagePath of [
    'apps/api-gateway/package.json',
    'apps/mcp-gateway/package.json',
    'apps/workctx-cli/package.json',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, packagePath), 'utf8'));
    assert.equal(manifest.version, '0.1.0');
    assert.ok(manifest.exports['.']);
  }
  const matrix = fs.readFileSync(path.join(root, 'integrations/support-matrix.yaml'), 'utf8');
  assert.match(matrix, /clients:/);
  assert.match(matrix, /unsupported_mcp: cli/);
});
