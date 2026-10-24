import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ensureFile,
  fixtureVersion,
  outputDirectory,
  parseArgs,
  printResult,
  sha256,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const output = outputDirectory(args);
const run_id = stableRunId(args, 'fixture');

try {
  if (command === 'validate') {
    const fixture = path.join(
      workspaceRoot,
      'packages',
      'test-fixtures',
      'fixtures',
      'p0-fixture.json',
    );
    ensureFile(fixture);
    const parsed = JSON.parse(readFileSync(fixture, 'utf8'));
    const result = {
      status: 'passed',
      command,
      mode: 'offline-fixture',
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'fixture', id: 'p0-fixture.json' }],
      fixture_version: fixtureVersion(),
      fixture: path.relative(workspaceRoot, fixture).replaceAll('\\', '/'),
      entities: Object.keys(parsed).length,
    };
    writeJson(output, 'fixture-validation.json', result);
    printResult(result);
  } else if (command === 'seed') {
    const moduleName = args.module === undefined ? undefined : String(args.module);
    const fixture = String(
      args.fixture ??
        (moduleName === undefined ? 'tenant-demo' : `module-${moduleName.toLowerCase()}`),
    );
    const version = String(args.version ?? '1');
    const result = {
      status: 'passed',
      command,
      mode: 'offline-fixture',
      run_id,
      ...(moduleName === undefined ? {} : { module: moduleName }),
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'fixture', id: fixture }],
      fixture_version: fixtureVersion(),
      fixture,
      version,
      scope: {
        tenant_id: `tenant-${fixture}`,
        workspace_id: `workspace-${fixture}`,
        project_id: `project-${fixture}`,
      },
      seed: `p7-fixture-${fixture}-${version}`,
    };
    writeJson(output, 'seed.json', result);
    printResult(result);
  } else if (command === 'events') {
    const scenario = String(args.scenario ?? 'duplicate-gap-delay');
    const events = [
      { event_id: `evt-${run_id}-1`, aggregate_version: 1, delivery: 'first' },
      { event_id: `evt-${run_id}-1`, aggregate_version: 1, delivery: 'duplicate' },
      { event_id: `evt-${run_id}-3`, aggregate_version: 3, delivery: 'gap' },
      { event_id: `evt-${run_id}-2`, aggregate_version: 2, delivery: 'late' },
    ];
    const result = {
      status: 'passed',
      command,
      mode: 'offline-fixture',
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'fault-fixture', id: scenario }],
      fixture_version: fixtureVersion(),
      scenario,
      event_count: events.length,
      events,
    };
    writeJson(output, 'events.json', result);
    printResult(result);
  } else if (command === 'backup') {
    const manifest = String(args.manifest ?? 'sha256:fixture');
    const files = {
      'events.jsonl': 'evt-fixture-1\nevt-fixture-2\n',
      'memory.md': '# Fixture memory\nrevision: 1\n',
    };
    const hashes = Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, sha256(content)]),
    );
    const result = {
      status: 'passed',
      command,
      mode: 'offline-fixture',
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'release-manifest', id: manifest }],
      fixture_version: fixtureVersion(),
      manifest,
      verified: Object.values(hashes).every((hash) => hash.startsWith('sha256:')),
      files,
      hashes,
    };
    writeJson(output, 'backup.json', result);
    printResult(result);
  } else {
    printResult({
      status: 'passed',
      command: 'help',
      commands: ['validate', 'seed', 'events', 'backup'],
    });
  }
} catch (error) {
  printResult({
    status: 'failed',
    command,
    run_id,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
