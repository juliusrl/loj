#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findWorkspacePackageDir } from './workspace-utils.mjs';

const [, , packageName, ...argv] = process.argv;

if (!packageName) {
  process.stderr.write('Usage: node scripts/run-workspace-bin.mjs <workspace-package-name> [args...]\n');
  process.exit(1);
}

const packageDir = findWorkspacePackageDir(packageName);
const packageJson = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
const binPath = resolveBinPath(packageJson.bin);

const result = spawnSync(process.execPath, [resolve(packageDir, binPath), ...argv], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);

function resolveBinPath(binField) {
  if (typeof binField === 'string') {
    return binField;
  }
  if (binField && typeof binField === 'object') {
    const binEntries = Object.values(binField).filter((value) => typeof value === 'string');
    if (binEntries.length === 1) {
      return binEntries[0];
    }
    if (binEntries.length > 1) {
      throw new Error('Workspace package exposes multiple bin entries; add explicit support before using this helper.');
    }
  }
  throw new Error('Workspace package does not expose a runnable bin entry.');
}
