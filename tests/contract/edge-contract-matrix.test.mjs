import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const matrixPath = path.join(root, 'docs/design/03-integration/05-module-contract-test-matrix.md');
const interfacePath = path.join(
  root,
  'docs/design/03-integration/04-module-interface-contracts.md',
);
const requirementsPath = path.join(root, 'docs/traceability/requirements-matrix.yaml');

test('contract matrix maps every interface edge to provider and consumer test boundaries', () => {
  const matrix = readFileSync(matrixPath, 'utf8');
  const interfaceContract = readFileSync(interfacePath, 'utf8');
  const requirements = readFileSync(requirementsPath, 'utf8');
  const rows = [...matrix.matchAll(/^\| (IF-P\d-P\d) \| ([^|]+) \| ([^|]+) \|/gm)];

  assert.equal(rows.length, 28);
  assert.equal(new Set(rows.map((row) => row[1])).size, rows.length);
  for (const [, edge, providerTests, consumerTests] of rows) {
    const [, provider, consumer] = edge.match(/^IF-(P\d)-(P\d)$/);
    assert.match(providerTests.trim(), new RegExp(provider));
    assert.match(consumerTests.trim(), new RegExp(consumer));
    assert.equal(interfaceContract.includes(`| ${edge} |`), true, edge);
    assert.equal(existsSync(path.join(root, 'tests', provider.toLowerCase())), true, provider);
    assert.equal(existsSync(path.join(root, 'tests', consumer.toLowerCase())), true, consumer);
    assert.equal(
      existsSync(
        path.join(
          root,
          'docs/design/04-testing/modules',
          `${provider}-independent-verification.md`,
        ),
      ),
      true,
      provider,
    );
    assert.equal(
      existsSync(
        path.join(
          root,
          'docs/design/04-testing/modules',
          `${consumer}-independent-verification.md`,
        ),
      ),
      true,
      consumer,
    );
  }
  assert.match(requirements, /edge_prefix:\s*["']?IF-Px-Py/);
  assert.match(requirements, /edge:\s*["']?pnpm run test:contract -- --edge IF-Px-Py/);
});
