import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('P5 contract publishes web console package and route boundaries', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'apps', 'web-console', 'package.json'), 'utf8'),
  );
  assert.equal(manifest.version, '0.1.0');
  assert.ok(manifest.exports['.']);
  for (const file of [
    'apps/web-console/src/app/page.ts',
    'apps/web-console/src/app/handoffs/model.ts',
    'apps/web-console/src/app/conflicts/model.ts',
    'apps/web-console/src/app/admin/model.ts',
  ])
    assert.ok(fs.existsSync(path.join(root, file)));
});
