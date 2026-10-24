import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, printResult, stableRunId, workspaceRoot } from './command-utils.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const run_id = stableRunId(args, 'manifest');

function digest(name, version) {
  return `sha256:${createHash('sha256').update(`${name}@${version}`).digest('hex')}`;
}

function outputPath() {
  const requested = String(
    args.output ?? path.join(workspaceRoot, 'artifacts', 'release', 'release-manifest.yaml'),
  );
  return requested.endsWith('.yaml') || requested.endsWith('.yml')
    ? path.resolve(requested)
    : path.join(path.resolve(requested), 'release-manifest.yaml');
}

if (command !== 'generate') {
  printResult({ status: 'passed', command: 'help', commands: ['generate'] });
} else {
  const version = String(args.version ?? '0.1.0');
  const git_sha = String(args.git_sha ?? 'unknown');
  const artifacts = [
    ['work-continuity-platform', 'package', version],
    ['schema-v1', 'schema', '1'],
    ['migration-007-audit', 'migration', '1'],
    ['golden-p7', 'fixture', '1.0.0'],
    ['plane', 'image', '0.26.0'],
    ['ai-memory', 'image', '3.0.0'],
  ].map(([name, kind, itemVersion]) => ({
    name,
    kind,
    version: itemVersion,
    digest: digest(name, itemVersion),
  }));
  const lines = [
    'schema_version: 1',
    `release_version: ${version}`,
    `git_sha: ${git_sha}`,
    'approval:',
    '  required: true',
    '  status: pending',
    'feature_flags:',
    '  proposal_enabled: false',
    '  vector_enabled: false',
    'external:',
    '  plane_version: 0.26.0',
    '  ai_memory_version: 3.0.0',
    '  compose_version: 3',
    'artifacts:',
    ...artifacts.flatMap((item) => [
      `  - name: ${item.name}`,
      `    kind: ${item.kind}`,
      `    version: '${item.version}'`,
      `    digest: ${item.digest}`,
    ]),
  ];
  const file = outputPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  printResult({
    status: 'passed',
    command,
    mode: 'offline-fixture',
    run_id,
    trace_id: `trace-${run_id}`,
    source_refs: [{ type: 'release-manifest', id: version }],
    output: path.relative(workspaceRoot, file).replaceAll('\\', '/'),
    release_version: version,
    artifact_count: artifacts.length,
    placeholder_count: 0,
    digest_source: 'deterministic-fixture',
  });
}
