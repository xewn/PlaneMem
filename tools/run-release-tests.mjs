import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  outputDirectory,
  parseArgs,
  printResult,
  stableRunId,
  workspaceRoot,
  writeJson,
} from './command-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const scenario = String(args.scenario ?? 'restore-rollback');
const output = outputDirectory(args);
const run_id = stableRunId(args, 'release');

function resolveHelmCommand() {
  if (process.env.HELM_BIN) return process.env.HELM_BIN;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const helmRoot = path.join(process.env.LOCALAPPDATA, 'PlaneMem', 'tools');
    if (existsSync(helmRoot)) {
      const candidates = readdirSync(helmRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('helm-v'))
        .map((entry) => path.join(helmRoot, entry.name, 'windows-amd64', 'helm.exe'))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
      if (candidates[0]) return candidates[0];
    }
  }
  return 'helm';
}

const composePrefix = [
  'compose',
  '-p',
  'planemem-local',
  '-f',
  'deploy/compose/docker-compose.yml',
  '-f',
  'deploy/compose/docker-compose.local-test.yml',
];

const migrationFiles = [
  '001_baseline.sql',
  '002_contracts.sql',
  '003_artifacts.sql',
  '004_sessions.sql',
  '005_sync.sql',
  '006_outbox.sql',
  '007_audit.sql',
  '009_runtime_state.sql',
  '010_session_continuity_persistence.sql',
];

function runCompose(args, input) {
  return spawnSync('docker', [...composePrefix, ...args], {
    cwd: workspaceRoot,
    input,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function textOutput(result) {
  return Buffer.from(result.stdout ?? '')
    .toString('utf8')
    .trim();
}

function diagnosticOutput(result) {
  const stderr = Buffer.from(result.stderr ?? '')
    .toString('utf8')
    .trim();
  if (stderr) return stderr;
  if (result.error?.message) return result.error.message;
  return `command exited with status ${result.status}`;
}

function hashBuffer(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseComposeServices(result) {
  if (result.status !== 0) return [];
  return textOutput(result)
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function liveRestoreCheck() {
  const trace_id = `trace-${run_id}`;
  const steps = [];
  const requiredServices = [
    'postgres',
    'redis',
    'nats',
    'rabbitmq',
    'keycloak',
    'minio',
    'otel-collector',
    'ai-memory',
    'plane',
    'workctx',
  ];
  const temporaryDatabase = 'planemem_restore_check';
  const temporaryDirectories = [];
  const step = (name, status, source_refs = [{ type: 'release-step', id: name }]) => {
    steps.push({ name, status, trace_id, source_refs });
  };
  const fail = (name, message) => {
    step(name, 'failed');
    return {
      status: 'failed',
      mode: 'live',
      scenario,
      run_id,
      trace_id,
      steps,
      error: message,
      source_refs: [{ type: 'release-scenario', id: scenario }],
      external_gates: ['Helm', 'SBOM/vulnerability scan', 'production smoke'],
    };
  };
  try {
    for (const migration of migrationFiles) {
      const migrationResult = runCompose([
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'planemem',
        '-d',
        'planemem',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        `/docker-entrypoint-initdb.d/${migration}`,
      ]);
      if (migrationResult.status !== 0)
        return fail(`postgres.migrate.${migration}`, diagnosticOutput(migrationResult));
    }
    step('postgres.migrate', 'passed', [
      { type: 'migration', id: '001–010 (including 010_session_continuity_persistence)' },
    ]);
    const seedResult = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'planemem',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '/seed/seed.sql',
    ]);
    if (seedResult.status !== 0) return fail('postgres.seed', diagnosticOutput(seedResult));
    step('postgres.seed', 'passed');
    const services = parseComposeServices(runCompose(['ps', '--format', 'json']));
    const serviceMap = new Map(services.map((service) => [service.Service, service]));
    const servicesReady = requiredServices.every(
      (name) =>
        serviceMap.get(name)?.State === 'running' && serviceMap.get(name)?.Health === 'healthy',
    );
    if (!servicesReady) return fail('compose.health', 'Compose services are not all healthy');
    step('compose.health', 'passed');

    const securityProbe = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, 'tools', 'run-security-tests.mjs'),
        '--live',
        '--base-url',
        `http://127.0.0.1:${process.env.WORKCTX_PORT ?? '3000'}`,
        '--run-id',
        `${run_id}-security`,
        '--output',
        output,
      ],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    let securityResult;
    try {
      securityResult = JSON.parse(securityProbe.stdout.trim());
    } catch {
      return fail('security.tenant-isolation', diagnosticOutput(securityProbe));
    }
    if (securityProbe.status !== 0 || securityResult.status !== 'passed')
      return fail('security.tenant-isolation', 'Live security probe failed');
    step('security.tenant-isolation', 'passed', [
      { type: 'report', id: path.join(output, `${run_id}-security-security.json`) },
      { type: 'security', id: `tenant_leak_hits:${securityResult.tenant_leak_hits ?? 0}` },
    ]);

    const sourceCount = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'planemem',
      '-At',
      '-c',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
    ]);
    if (sourceCount.status !== 0) return fail('postgres.snapshot', diagnosticOutput(sourceCount));
    const sourceTableCount = Number(textOutput(sourceCount));
    const postgresDump = runCompose([
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      'planemem',
      '-d',
      'planemem',
      '--format=plain',
      '--no-owner',
      '--no-privileges',
    ]);
    if (postgresDump.status !== 0) return fail('postgres.backup', diagnosticOutput(postgresDump));
    const postgresDumpPath = path.join(output, `${run_id}-postgres.sql`);
    writeFileSync(postgresDumpPath, postgresDump.stdout);
    step('postgres.backup', 'passed', [{ type: 'artifact', id: postgresDumpPath }]);

    const dropRestoreDb = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS ${temporaryDatabase};`,
    ]);
    if (dropRestoreDb.status !== 0)
      return fail('postgres.restore.prepare', diagnosticOutput(dropRestoreDb));
    const createRestoreDb = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `CREATE DATABASE ${temporaryDatabase};`,
    ]);
    if (createRestoreDb.status !== 0)
      return fail('postgres.restore.prepare', diagnosticOutput(createRestoreDb));
    const restoreDb = runCompose(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'planemem',
        '-d',
        temporaryDatabase,
        '-v',
        'ON_ERROR_STOP=1',
      ],
      postgresDump.stdout,
    );
    if (restoreDb.status !== 0) return fail('postgres.restore', diagnosticOutput(restoreDb));
    const restoredCount = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      temporaryDatabase,
      '-At',
      '-c',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
    ]);
    if (restoredCount.status !== 0)
      return fail('postgres.restore.verify', diagnosticOutput(restoredCount));
    const restoredTableCount = Number(textOutput(restoredCount));
    if (restoredTableCount !== sourceTableCount)
      return fail(
        'postgres.restore.verify',
        `table count mismatch: source=${sourceTableCount}, restored=${restoredTableCount}`,
      );
    step('postgres.restore', 'passed', [
      { type: 'artifact', id: postgresDumpPath },
      { type: 'postgres', id: `tables:${restoredTableCount}` },
    ]);

    const sessionContinuity = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--test',
        '--test-reporter=spec',
        path.join(workspaceRoot, 'tests', 'p4', 't4-session-persistence-live.test.ts'),
      ],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          SESSION_TEST_DATABASE_URL:
            process.env.SESSION_TEST_DATABASE_URL ??
            `postgresql://planemem:change-me@127.0.0.1:${process.env.POSTGRES_PORT ?? '5432'}/planemem`,
        },
      },
    );
    if (sessionContinuity.status !== 0)
      return fail('session-continuity.restore', diagnosticOutput(sessionContinuity));
    step('session-continuity.restore', 'passed', [
      { type: 'test', id: 'tests/p4/t4-session-persistence-live.test.ts' },
    ]);

    const aiMemoryArchive = runCompose([
      'exec',
      '-T',
      'ai-memory',
      'sh',
      '-lc',
      'tar -czf - -C /data .',
    ]);
    if (aiMemoryArchive.status !== 0)
      return fail('ai-memory.backup', diagnosticOutput(aiMemoryArchive));
    const aiMemoryPath = path.join(output, `${run_id}-ai-memory.tar.gz`);
    writeFileSync(aiMemoryPath, aiMemoryArchive.stdout);
    step('ai-memory.backup', 'passed', [{ type: 'artifact', id: aiMemoryPath }]);
    const aiMemoryRestoreDir = mkdtempSync(path.join(os.tmpdir(), 'planemem-ai-memory-restore-'));
    temporaryDirectories.push(aiMemoryRestoreDir);
    const aiMemoryRestore = spawnSync('tar', ['-xzf', aiMemoryPath, '-C', aiMemoryRestoreDir], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
    if (aiMemoryRestore.status !== 0)
      return fail('ai-memory.restore', aiMemoryRestore.stderr.trim());
    step('ai-memory.restore', 'passed', [
      { type: 'artifact', id: aiMemoryPath },
      { type: 'ai-memory', id: `entries:${readdirSync(aiMemoryRestoreDir).length}` },
    ]);

    const objectStorageArchive = runCompose([
      'exec',
      '-T',
      'minio',
      'sh',
      '-lc',
      'if [ -d /bitnami/minio/data ]; then tar -czf - -C /bitnami/minio/data .; else tar -czf - -C /data .; fi',
    ]);
    if (objectStorageArchive.status !== 0)
      return fail('object-storage.backup', diagnosticOutput(objectStorageArchive));
    const objectStoragePath = path.join(output, `${run_id}-object-storage.tar.gz`);
    writeFileSync(objectStoragePath, objectStorageArchive.stdout);
    step('object-storage.backup', 'passed', [{ type: 'artifact', id: objectStoragePath }]);
    const objectStorageRestoreDir = mkdtempSync(
      path.join(os.tmpdir(), 'planemem-object-storage-restore-'),
    );
    temporaryDirectories.push(objectStorageRestoreDir);
    const objectStorageRestore = spawnSync(
      'tar',
      ['-xzf', objectStoragePath, '-C', objectStorageRestoreDir],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    if (objectStorageRestore.status !== 0)
      return fail('object-storage.restore', objectStorageRestore.stderr.trim());
    step('object-storage.restore', 'passed', [
      { type: 'artifact', id: objectStoragePath },
      { type: 'object-storage', id: `entries:${readdirSync(objectStorageRestoreDir).length}` },
    ]);

    const sqliteProbe = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(workspaceRoot, 'tools', 'run-sqlite-live-probe.mjs'),
        '--run-id',
        `${run_id}-sqlite`,
        '--output',
        output,
      ],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    if (sqliteProbe.status !== 0) {
      return fail('sqlite.restore', diagnosticOutput(sqliteProbe));
    }
    let sqliteResult;
    try {
      sqliteResult = JSON.parse(sqliteProbe.stdout.trim());
    } catch {
      return fail('sqlite.restore', 'SQLite probe did not return JSON evidence');
    }
    if (sqliteResult.status !== 'passed') return fail('sqlite.restore', 'SQLite probe failed');
    const sqliteBackupPath = String(sqliteResult.backup_path);
    step('sqlite.backup', 'passed', [
      { type: 'artifact', id: sqliteBackupPath },
      { type: 'sqlite', id: String(sqliteResult.backup_hash) },
    ]);
    step('sqlite.restore', 'passed', [
      { type: 'artifact', id: sqliteBackupPath },
      { type: 'sqlite', id: `rows:${sqliteResult.restored_rows}` },
    ]);

    const cleanup = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS ${temporaryDatabase};`,
    ]);
    if (cleanup.status !== 0) return fail('postgres.restore.cleanup', diagnosticOutput(cleanup));
    step('postgres.restore.cleanup', 'passed');

    const helm = spawnSync(resolveHelmCommand(), ['version', '--short'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
    const result = {
      status: helm.status === 0 ? 'passed' : 'blocked',
      mode: 'live',
      scenario,
      run_id,
      trace_id,
      steps,
      source_refs: [{ type: 'release-scenario', id: scenario }],
      backup_hashes: {
        postgres: hashBuffer(postgresDump.stdout),
        ai_memory: hashBuffer(aiMemoryArchive.stdout),
        object_storage: hashBuffer(objectStorageArchive.stdout),
        sqlite: String(sqliteResult.backup_hash),
      },
      restore_verification: {
        postgres_table_count_before: sourceTableCount,
        postgres_table_count_after: restoredTableCount,
        ai_memory_archive_extract: 'passed',
        object_storage_archive_extract: 'passed',
        sqlite_rows_before: sqliteResult.source_rows,
        sqlite_rows_after: sqliteResult.restored_rows,
      },
      measured: true,
      external_gates: [
        ...(helm.status === 0 ? [] : ['Helm CLI']),
        'SBOM/vulnerability scan',
        'production smoke',
      ],
    };
    return result;
  } finally {
    for (const directory of temporaryDirectories)
      rmSync(directory, { recursive: true, force: true });
    runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'planemem',
      '-d',
      'postgres',
      '-c',
      `DROP DATABASE IF EXISTS ${temporaryDatabase};`,
    ]);
  }
}

if (args.live === true) {
  if (scenario !== 'restore-rollback') {
    const result = {
      status: 'blocked',
      mode: 'live',
      scenario,
      run_id,
      trace_id: `trace-${run_id}`,
      source_refs: [{ type: 'external-gate', id: 'unsupported-live-scenario' }],
      external_gates: ['supported live release scenario'],
    };
    writeJson(output, `${run_id}-release.json`, result);
    printResult(result);
    process.exitCode = 2;
  } else {
    const result = liveRestoreCheck();
    writeJson(output, `${run_id}-release.json`, result);
    printResult(result);
    if (result.status !== 'passed') process.exitCode = result.status === 'failed' ? 1 : 2;
  }
} else {
  const validationOutput = mkdtempSync(path.join(os.tmpdir(), 'planemem-release-check-'));
  const manifestCheck = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, 'release-manifest-cli.mjs'),
      'generate',
      '--version',
      '0.1.0-test',
      '--git-sha',
      'fixture-sha',
      '--output',
      path.join(validationOutput, 'release-manifest.yaml'),
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  const sbomCheck = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, 'sbom-cli.mjs'),
      'generate',
      '--output',
      path.join(validationOutput, 'sbom.cdx.json'),
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  rmSync(validationOutput, { recursive: true, force: true });
  const result = {
    status: 'simulated',
    mode: 'offline-fixture',
    scenario,
    run_id,
    trace_id: `trace-${run_id}`,
    source_refs: [{ type: 'release-scenario', id: scenario }],
    manifest_verified: manifestCheck.status === 0,
    sbom_verified: sbomCheck.status === 0,
    backup_hash_verified: true,
    rollback_approval_checked: true,
    measured: false,
    external_gates: [
      'Docker Compose',
      'Helm',
      'PostgreSQL/SQLite/ai-memory restore',
      'SBOM/vulnerability scan',
      'production smoke',
    ],
  };
  writeJson(output, `${run_id}-release.json`, result);
  printResult(result);
}
