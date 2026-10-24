import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SqliteOutbox } from '../apps/context-bridge/src/outbox/sqlite.ts';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const output = outputDirectory(args);
const run_id = stableRunId(args, 'sqlite-live');
const trace_id = `trace-${run_id}`;
const scope = {
  tenant_id: '01HF7YAT000000000000000001',
  workspace_id: '01HF7YAT000000000000000002',
  project_id: '01HF7YAT000000000000000003',
};
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'planemem-sqlite-live-'));
const sourcePath = path.join(temporaryDirectory, 'outbox.sqlite');
const backupPath = path.join(output, `${run_id}-outbox.sqlite`);
const steps = [];

function hashFile(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

async function main() {
  try {
    const source = new SqliteOutbox(sourcePath);
    source.enqueueDurably({
      ...scope,
      event_id: 'sqlite-live-event-1',
      event_type: 'ContextCaptured',
      payload: { value: 'first' },
      idempotency_key: 'sqlite-live-idem-1',
      trace_id,
      source_refs: [{ type: 'probe', id: 'sqlite-live-1' }],
    });
    source.enqueueDurably({
      ...scope,
      event_id: 'sqlite-live-event-2',
      event_type: 'ContextCaptured',
      payload: { value: 'second' },
      idempotency_key: 'sqlite-live-idem-2',
      trace_id,
      source_refs: [{ type: 'probe', id: 'sqlite-live-2' }],
    });
    const sourceRows = source.inspect(scope);
    if (sourceRows.length !== 2) throw new Error(`source outbox row count=${sourceRows.length}`);
    source.close();
    steps.push({ name: 'sqlite.backup', status: 'passed' });

    copyFileSync(sourcePath, backupPath);
    if (statSync(backupPath).size === 0) throw new Error('SQLite backup is empty');
    steps.push({ name: 'sqlite.restore.copy', status: 'passed' });

    const restored = new SqliteOutbox(backupPath);
    const restoredRows = restored.inspect(scope);
    if (restoredRows.length !== 2 || restoredRows.some((row) => row.status !== 'pending')) {
      throw new Error('SQLite restore did not preserve pending rows');
    }
    const published = [];
    const drained = await restored.drain((event) => published.push(event.event_id));
    if (drained.sent.length !== 2 || published.length !== 2) {
      throw new Error(`SQLite restore drain mismatch: ${JSON.stringify(drained)}`);
    }
    const afterDrain = restored.inspect(scope);
    if (afterDrain.some((row) => row.status !== 'sent')) {
      throw new Error('SQLite restored rows were not durably marked sent');
    }
    restored.close();
    steps.push({ name: 'sqlite.restore.verify', status: 'passed' });

    const result = {
      status: 'passed',
      mode: 'live',
      run_id,
      trace_id,
      source_refs: [{ type: 'live-probe', id: 'sqlite-outbox' }],
      steps,
      source_rows: sourceRows.length,
      restored_rows: restoredRows.length,
      drained_event_ids: published,
      backup_path: backupPath,
      backup_hash: hashFile(backupPath),
      measured: true,
    };
    writeJson(output, `${run_id}-sqlite.json`, result);
    writeJson(output, `${run_id}-verification.json`, result);
    printResult(result);
  } catch (error) {
    const result = {
      status: 'failed',
      mode: 'live',
      run_id,
      trace_id,
      steps,
      error: error instanceof Error ? error.message : String(error),
    };
    writeJson(output, `${run_id}-sqlite.json`, result);
    printResult(result);
    process.exitCode = 1;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
