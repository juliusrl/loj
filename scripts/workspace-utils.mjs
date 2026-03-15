#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(scriptDir, '..');

let cachedWorkspacePackageDirs = null;

export function listWorkspacePackageDirs() {
  if (cachedWorkspacePackageDirs) {
    return cachedWorkspacePackageDirs;
  }

  const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  const dirs = [];
  const seen = new Set();

  for (const workspaceGlob of workspaces) {
    for (const dir of expandWorkspaceGlob(workspaceGlob)) {
      const packageJsonPath = resolve(dir, 'package.json');
      if (!existsSync(packageJsonPath) || seen.has(dir)) {
        continue;
      }
      dirs.push(dir);
      seen.add(dir);
    }
  }

  cachedWorkspacePackageDirs = dirs;
  return dirs;
}

export function findWorkspacePackageDir(packageName) {
  const matches = [];

  for (const dir of listWorkspacePackageDirs()) {
    const packageJson = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
    if (packageJson.name === packageName) {
      matches.push(dir);
    }
  }

  if (matches.length === 0) {
    throw new Error(`Workspace package ${packageName} was not found under configured root workspaces.`);
  }
  if (matches.length > 1) {
    throw new Error(`Workspace package ${packageName} was found multiple times: ${matches.join(', ')}`);
  }
  return matches[0];
}

function expandWorkspaceGlob(workspaceGlob) {
  return expandSegments(repoRoot, workspaceGlob.split('/').filter(Boolean));
}

function expandSegments(baseDir, segments) {
  if (segments.length === 0) {
    return [baseDir];
  }

  const [head, ...tail] = segments;
  if (head === '*') {
    if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) {
      return [];
    }
    const matches = [];
    for (const child of readdirSync(baseDir)) {
      const childPath = resolve(baseDir, child);
      if (!statSync(childPath).isDirectory()) {
        continue;
      }
      matches.push(...expandSegments(childPath, tail));
    }
    return matches;
  }

  const nextDir = resolve(baseDir, head);
  if (!existsSync(nextDir) || !statSync(nextDir).isDirectory()) {
    return [];
  }
  return expandSegments(nextDir, tail);
}
