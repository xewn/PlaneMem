#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgIndex = process.argv.indexOf('--output');
if (outputArgIndex < 0 || !process.argv[outputArgIndex + 1]) {
  throw new Error('Usage: node tools/stage-runtime.mjs --output <directory>');
}

const outputRoot = path.resolve(workspaceRoot, process.argv[outputArgIndex + 1]);
const nodeModulesRoot = path.join(outputRoot, 'node_modules');
const packageGroups = ['apps', 'packages', 'workers'];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(nodeModulesRoot, { recursive: true });

const staged = [];
const stagedExternal = [];
const externalQueue = [];
for (const group of packageGroups) {
  const groupRoot = path.join(workspaceRoot, group);
  const entries = await (
    await import('node:fs/promises')
  ).readdir(groupRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(groupRoot, entry.name);
    const packageFile = path.join(packageRoot, 'package.json');
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
    } catch {
      continue;
    }
    if (typeof packageJson.name !== 'string' || !packageJson.name.startsWith('@planemem/')) {
      continue;
    }

    const compiledSource = path.join(workspaceRoot, 'dist', group, entry.name, 'src');
    const packageDestination = path.join(nodeModulesRoot, ...packageJson.name.split('/'));
    try {
      await cp(compiledSource, path.join(packageDestination, 'src'), { recursive: true });
    } catch (error) {
      throw new Error(`Compiled source missing for ${packageJson.name}: ${compiledSource}`, {
        cause: error,
      });
    }

    const exports = Object.fromEntries(
      Object.entries(packageJson.exports ?? {}).map(([key, value]) => {
        if (typeof value !== 'string')
          throw new Error(`Unsupported exports entry in ${packageFile}`);
        return [key, value.replace(/\.ts$/u, '.js')];
      }),
    );
    const runtimePackage = {
      name: packageJson.name,
      version: packageJson.version ?? '0.1.0',
      private: true,
      type: packageJson.type ?? 'module',
      exports,
    };
    await writeFile(
      path.join(packageDestination, 'package.json'),
      `${JSON.stringify(runtimePackage, null, 2)}\n`,
      'utf8',
    );
    staged.push(packageJson.name);
    for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
      if (!dependency.startsWith('@planemem/')) externalQueue.push({ dependency, packageRoot });
    }
  }
}

const seenExternal = new Set();
while (externalQueue.length > 0) {
  const { dependency, packageRoot } = externalQueue.shift();
  if (seenExternal.has(dependency)) continue;
  seenExternal.add(dependency);
  const source = path.join(packageRoot, 'node_modules', dependency);
  const destination = path.join(nodeModulesRoot, ...dependency.split('/'));
  try {
    await cp(source, destination, { recursive: true, dereference: true });
  } catch (error) {
    throw new Error(`External runtime dependency missing for ${dependency}: ${source}`, {
      cause: error,
    });
  }
  stagedExternal.push(dependency);
  try {
    const dependencyManifest = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    );
    for (const nested of Object.keys(dependencyManifest.dependencies ?? {})) {
      if (!nested.startsWith('@planemem/'))
        externalQueue.push({ dependency: nested, packageRoot: destination });
    }
  } catch {
    // Packages without a manifest or dependencies remain usable as staged.
  }
}

await writeFile(
  path.join(outputRoot, 'runtime-manifest.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), packages: staged.sort(), external_packages: stagedExternal.sort() }, null, 2)}\n`,
  'utf8',
);
console.log(`Staged ${staged.length} workspace packages into ${outputRoot}`);
