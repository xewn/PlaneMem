import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('P3-R01/T3.4 restores a file-backed SQLite outbox and drains it once', () => {
  const output = mkdtempSync(path.join(os.tmpdir(), 'planemem-sqlite-probe-test-'));
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/run-sqlite-live-probe.mjs',
        '--run-id',
        'p3-sqlite-test',
        '--output',
        output,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.status, 'passed');
    assert.equal(result.source_rows, 2);
    assert.equal(result.restored_rows, 2);
    assert.deepEqual(result.drained_event_ids, ['sqlite-live-event-1', 'sqlite-live-event-2']);
    assert.match(result.backup_hash, /^sha256:[0-9a-f]+$/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
