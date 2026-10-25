import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('web console publishes a Next app with all eight workbench routes', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'apps', 'web-console', 'package.json'), 'utf8'),
  );
  assert.equal(manifest.scripts.dev, 'next dev');
  assert.equal(manifest.scripts.build, 'next build');
  assert.equal(manifest.dependencies.next, '15.5.6');
  assert.equal(manifest.dependencies.react, '19.1.1');
  assert.equal(manifest.dependencies['react-dom'], '19.1.1');
  for (const route of [
    'overview',
    'work-items',
    'context',
    'sessions',
    'handoffs',
    'conflicts',
    'audit',
    'admin',
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, 'apps', 'web-console', 'src', 'app', route, 'page.tsx')),
    );
  }
});

test('web console keeps auth and workbench configuration server-side', () => {
  const envExample = fs.readFileSync(
    path.join(root, 'apps', 'web-console', '.env.example'),
    'utf8',
  );
  assert.match(envExample, /AUTH_SERVER_ISSUER=http:\/\/localhost:44335/);
  assert.match(envExample, /WORKBENCH_API_URL=http:\/\/localhost:3000/);
  assert.match(envExample, /DATABASE_URL=/);
});
