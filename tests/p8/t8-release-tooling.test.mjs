import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

test('P8-C02/T8.2 validates Compose offline and generates an immutable manifest and SBOM', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'planemem-release-'));
  try {
    const doctor = spawnSync(
      process.execPath,
      [path.join(root, 'deploy/compose/health/doctor.mjs'), '--offline'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).status, 'ok');
    const health = spawnSync(
      process.execPath,
      [path.join(root, 'deploy/compose/health/healthcheck.mjs'), '--offline'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(health.status, 0, health.stderr);
    assert.equal(JSON.parse(health.stdout).readiness, 'ready');
    const manifest = run('release-manifest-cli.mjs', [
      'generate',
      '--version',
      '0.1.0-test',
      '--git-sha',
      'fixture-sha',
      '--output',
      path.join(output, 'release-manifest.yaml'),
    ]);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.mode, 'offline-fixture');
    assert.equal(manifest.placeholder_count, 0);
    assert.equal(
      readFileSync(path.join(output, 'release-manifest.yaml'), 'utf8').includes('SET_BY_CI'),
      false,
    );
    const sbom = run('sbom-cli.mjs', ['generate', '--output', path.join(output, 'sbom.cdx.json')]);
    assert.equal(sbom.status, 'passed');
    assert.equal(sbom.mode, 'offline-fixture');
    const document = JSON.parse(readFileSync(path.join(output, 'sbom.cdx.json'), 'utf8'));
    assert.equal(document.bomFormat, 'CycloneDX');
    assert.equal(document.components.length > 10, true);
    assert.equal(existsSync(path.join(output, 'sbom.cdx.json')), true);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('P8-C01/T8.2 stages the compiled runtime and pins the application image entrypoint', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'planemem-runtime-'));
  try {
    const staged = spawnSync(
      process.execPath,
      [path.join(root, 'tools/stage-runtime.mjs'), '--output', output],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(staged.status, 0, staged.stderr);
    const runtimePackage = JSON.parse(
      readFileSync(path.join(output, 'node_modules/@planemem/api-gateway/package.json'), 'utf8'),
    );
    assert.equal(runtimePackage.exports['.'], './src/index.js');
    assert.equal(
      existsSync(path.join(output, 'node_modules/@planemem/api-gateway/src/server.js')),
      true,
    );
    const dockerfile = readFileSync(path.join(root, 'deploy/images/platform/Dockerfile'), 'utf8');
    assert.match(
      dockerfile,
      /ARG NODE_BASE_IMAGE=node:24-alpine3\.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d/,
    );
    assert.match(dockerfile, /apk add --no-cache zlib=1\.3\.2-r1/);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    assert.match(dockerfile, /ENTRYPOINT \["node", "dist\/apps\/api-gateway\/src\/server\.js"\]/);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]+127\.0\.0\.1:3000\/health\/ready/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('P8-C02/T8.2 rejects malformed Helm delimiters before the live Helm gate', () => {
  const deployment = readFileSync(
    path.join(root, 'deploy/helm/planemem/templates/deployment.yaml'),
    'utf8',
  );
  assert.doesNotMatch(deployment, /\{\s+\{/);
  assert.match(deployment, /\{\{\s*\.Values\.replicaCount\s*\}\}/);
  assert.match(deployment, /\{\{-\s*toYaml\s+\.Values\.resources\s+\|\s+nindent\s+12\s*\}\}/);
  assert.match(deployment, /imagePullPolicy:\s+IfNotPresent/);
});

test('P8-C02/T8.2 pins the local MinIO compatibility override and its writable data path', () => {
  const override = readFileSync(
    path.join(root, 'deploy/compose/docker-compose.local-test.yml'),
    'utf8',
  );
  assert.match(override, /bitnamilegacy\/minio:2025\.7\.23-debian-12-r5@sha256:[0-9a-f]{64}/);
  assert.match(override, /server['\", ]+\/bitnami\/minio\/data/);
  assert.match(override, /mc['\", ]+ready['\", ]+local/);
  assert.match(override, /nats:/);
  assert.match(override, /--http_port['\", ]+8222/);
  assert.match(override, /keycloak:[\s\S]+bash/);
  assert.match(override, /otel-collector:[\s\S]+\/otelcol-contrib['\", ]+validate/);
  assert.match(override, /ai-memory:/);
  assert.match(override, /planemem\/ai-memory:3\.1\.1-local@sha256:[0-9a-f]{64}/);
  assert.match(override, /serve['\", ]+--transport['\", ]+http/);
  assert.match(override, /49374/);
  assert.match(override, /workctx:[\s\S]+AI_MEMORY_URL:\s+http:\/\/ai-memory:49374/);
  assert.match(
    override,
    /workctx:[\s\S]+planemem-platform:0\.1\.0(?:-transport|-wavemate)?@sha256:[0-9a-f]{64}/,
  );
  assert.match(override, /workctx:[\s\S]+127\.0\.0\.1:3000\/health\/ready/);
  assert.match(override, /plane:[\s\S]+docker-entrypoint-api\.sh/);
  assert.match(override, /plane:[\s\S]+makeplane\/plane-backend:v0\.26\.0/);
  assert.match(override, /rabbitmq:/);
  assert.match(override, /AMQP_URL:\s+amqp:\/\/planemem:change-me@rabbitmq:5672/);
  assert.match(override, /GUNICORN_WORKERS:\s+'1'/);
  assert.match(override, /USE_MINIO:\s+'1'/);
  assert.match(override, /AWS_S3_ENDPOINT_URL:\s+http:\/\/minio:9000/);
});

test('P8-C03/T8.3 emits a release readiness report without masking external blockers', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'rc-readiness.mjs'), '--offline'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.status, 'simulated');
  assert.equal(report.mode, 'offline-fixture');
  assert.equal(report.local_status, 'passed');
  assert.equal(report.external_status, 'blocked');
  assert.equal(
    report.release_blockers.some((gate) => gate.status === 'not-run'),
    true,
  );
});
