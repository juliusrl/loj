#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

function parseArgs(argv) {
  const options = {
    outDir: resolve(REPO_ROOT, '../loj-public-snapshot'),
    gitInit: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      options.outDir = resolve(process.cwd(), argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg === '--git-init') {
      options.gitInit = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/create-public-snapshot.mjs [options]

Options:
  --out-dir <dir>   Output directory (default: ../loj-public-snapshot)
  --force           Remove the output directory first if it already exists
  --git-init        Initialize a fresh git repository inside the snapshot

The snapshot includes current tracked/untracked working-tree files except anything
filtered by the repo's ignore rules, including .git/info/exclude.`);
}

function listCandidateFiles() {
  const result = runGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return result.split('\0').filter(Boolean);
}

function filterIgnored(files) {
  if (files.length === 0) {
    return [];
  }

  const ignoredOutput = runGit(['check-ignore', '--no-index', '--stdin', '-z'], `${files.join('\0')}\0`);

  const ignored = new Set(ignoredOutput.split('\0').filter(Boolean));
  return files.filter((file) => !ignored.has(file));
}

function runGit(args, input = '') {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.error?.message || `git ${args.join(' ')} failed`;
    throw new Error(stderr);
  }

  return result.stdout ?? '';
}

function ensureOutDir(outDir, force) {
  if (existsSync(outDir)) {
    if (!force) {
      throw new Error(`Output directory already exists: ${outDir}\nUse --force to replace it.`);
    }
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
}

function copyFiles(files, outDir) {
  let copied = 0;
  let skippedMissing = 0;

  for (const relativeFile of files) {
    const source = join(REPO_ROOT, relativeFile);
    if (!existsSync(source)) {
      skippedMissing += 1;
      continue;
    }
    const target = join(outDir, relativeFile);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: false, force: true });
    copied += 1;
  }

  return { copied, skippedMissing };
}

function initGit(outDir) {
  execFileSync('git', ['init'], { cwd: outDir, stdio: 'inherit' });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidates = listCandidateFiles();
  const included = filterIgnored(candidates);

  ensureOutDir(options.outDir, options.force);
  const { copied, skippedMissing } = copyFiles(included, options.outDir);

  if (options.gitInit) {
    initGit(options.outDir);
  }

  console.log(`Created public snapshot: ${options.outDir}`);
  console.log(`Included files: ${copied}`);
  if (skippedMissing > 0) {
    console.log(`Skipped missing working-tree files: ${skippedMissing}`);
  }
  console.log(`Ignored by git rules: ${candidates.length - included.length}`);
}

main();
