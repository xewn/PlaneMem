import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const moduleName = args.find((arg) => /^P\d$/.test(arg));
const directoryFlagIndex = args.indexOf('--directory');
const contractMode = args.includes('--contract');
const edge = args.find((arg) => /^IF-P\d-P\d$/.test(arg));
const edgeFlagIndex = args.indexOf('--edge');
const requestedDirectory = directoryFlagIndex >= 0 ? args[directoryFlagIndex + 1] : undefined;
let testDirectories = requestedDirectory
  ? [requestedDirectory]
  : moduleName
    ? [path.join('tests', moduleName.toLowerCase())]
    : ['tests'];
if (edgeFlagIndex >= 0) {
  const requestedEdge = args[edgeFlagIndex + 1];
  if (!edge || requestedEdge !== edge) {
    console.error('Contract edge must use the form IF-Px-Py');
    process.exit(1);
  }
  const [, provider, consumer] = edge.match(/^IF-(P\d)-(P\d)$/);
  testDirectories = [
    path.join('tests', provider.toLowerCase()),
    path.join('tests', consumer.toLowerCase()),
    path.join('tests', 'contract'),
  ];
}
if (contractMode && moduleName) {
  testDirectories.push(path.join('tests', 'contract'));
}

function collectTestFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTestFiles(entryPath);
    }
    return /\.(?:test|spec)\.(?:mjs|js|ts)$/.test(entry.name) ? [entryPath] : [];
  });
}

const files = testDirectories.flatMap(collectTestFiles);
if (files.length === 0) {
  console.error(`No test files found under ${testDirectories.join(', ')}`);
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    ...files,
    ...args.filter(
      (arg, index) =>
        !/^P\d$/.test(arg) &&
        arg !== '--contract' &&
        arg !== '--edge' &&
        index !== edgeFlagIndex + 1 &&
        index !== directoryFlagIndex &&
        index !== directoryFlagIndex + 1,
    ),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
