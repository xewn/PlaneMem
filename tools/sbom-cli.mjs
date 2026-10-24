import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, printResult, stableRunId, workspaceRoot } from './command-utils.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const run_id = stableRunId(args, 'sbom');

function packageFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name, 'package.json');
    return entry.isDirectory() && existsSync(candidate) ? [candidate] : [];
  });
}

function outputPath() {
  const requested = String(
    args.output ?? path.join(workspaceRoot, 'artifacts', 'release', 'sbom.cdx.json'),
  );
  return requested.endsWith('.json')
    ? path.resolve(requested)
    : path.join(path.resolve(requested), 'sbom.cdx.json');
}

if (command !== 'generate') {
  printResult({ status: 'passed', command: 'help', commands: ['generate'] });
} else {
  const files = [
    path.join(workspaceRoot, 'package.json'),
    ...packageFiles(path.join(workspaceRoot, 'packages')),
    ...packageFiles(path.join(workspaceRoot, 'apps')),
    ...packageFiles(path.join(workspaceRoot, 'workers')),
  ];
  const components = files
    .map((file) => {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      return {
        type: 'library',
        name: pkg.name,
        version: pkg.version,
        purl: `pkg:npm/${pkg.name}@${pkg.version}`,
        scope: 'required',
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${run_id}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'PlaneMem', name: 'sbom-cli', version: '0.1.0' }],
    },
    components,
  };
  const file = outputPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
  printResult({
    status: 'passed',
    command,
    mode: 'offline-fixture',
    run_id,
    trace_id: `trace-${run_id}`,
    source_refs: [{ type: 'sbom', id: file }],
    output: path.relative(workspaceRoot, file).replaceAll('\\', '/'),
    component_count: components.length,
    vulnerability_scan: 'external-gate',
  });
}
