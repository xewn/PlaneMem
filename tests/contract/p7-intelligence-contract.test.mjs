import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('P7 contract publishes evaluation, intelligence and search package boundaries', () => {
  for (const path of [
    'workers/evaluation/package.json',
    'workers/intelligence/package.json',
    'apps/search-service/package.json',
    'workers/evaluation/datasets/golden-v1.json',
    'deploy/search/feature-flags.yaml',
  ])
    assert.equal(existsSync(path), true, path);
  const dataset = JSON.parse(readFileSync('workers/evaluation/datasets/golden-v1.json', 'utf8'));
  assert.equal(dataset.dataset_version, '1.0.0');
  assert.equal(dataset.cases.length > 0, true);
});
