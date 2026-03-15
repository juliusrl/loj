#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const sourceDir = resolve(repoRoot, 'skills', 'loj-authoring');
const targetRoot = resolve(packageDir, 'agent-assets');
const targetDir = resolve(targetRoot, 'loj-authoring');

if (!existsSync(resolve(sourceDir, 'SKILL.md'))) {
  throw new Error(`Missing bundled skill source: ${sourceDir}`);
}

mkdirSync(targetRoot, { recursive: true });
const stagingRoot = mkdtempSync(resolve(targetRoot, '.staging-'));
const stagedTargetDir = resolve(stagingRoot, 'loj-authoring');
cpSync(sourceDir, stagedTargetDir, { recursive: true });

const retryableCodes = new Set(['EEXIST', 'ENOENT', 'ENOTEMPTY', 'EPERM']);
let replaced = false;
let lastError = null;

for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    rmSync(targetDir, { recursive: true, force: true });
    renameSync(stagedTargetDir, targetDir);
    replaced = true;
    break;
  } catch (error) {
    lastError = error;
    if (!retryableCodes.has(error?.code) || attempt === 4) {
      throw error;
    }
  }
}

rmSync(stagingRoot, { recursive: true, force: true });

if (!replaced && lastError) {
  throw lastError;
}
