import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = path.resolve(toolsDirectory, '..');

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replaceAll('-', '_');
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

export function outputDirectory(
  args,
  fallback = path.join(workspaceRoot, 'artifacts', 'command-reports'),
) {
  const directory = path.resolve(String(args.output ?? fallback));
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

export function stableRunId(args, prefix = 'run') {
  return String(
    args.run_id ??
      `${prefix}-${new Date()
        .toISOString()
        .replaceAll(/[-:.TZ]/g, '')
        .slice(0, 14)}`,
  );
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function fixtureVersion() {
  return '0.1.0';
}

export function externalGate(args) {
  return args.live === true || args.mode === 'live';
}

export function printResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function failResult(message, details = {}) {
  printResult({ status: 'failed', error: message, ...details });
  process.exitCode = 1;
}

export function ensureFile(file) {
  if (!existsSync(file)) throw new Error(`missing file: ${file}`);
}
