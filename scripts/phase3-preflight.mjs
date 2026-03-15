#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifestPath = resolve(repoRoot, 'config/loj.release.json');
const compatibilityPath = resolve(repoRoot, 'config/loj.compatibility.json');
const rootPackagePath = resolve(repoRoot, 'package.json');
const jsonMode = process.argv.includes('--json');

const manifest = readJsonFile(manifestPath);
const compatibility = readJsonFile(compatibilityPath);
const rootPackage = readJsonFile(rootPackagePath);
const errors = [];
const warnings = [];

const groupedEntries = {
  'rdsl-subproject': [],
  'sdsl-subproject': [],
  'loj-root': [],
};

validateManifest(errors);

for (const entry of manifest.releasePackages) {
  if (entry.phase3MoveGroup in groupedEntries) {
    groupedEntries[entry.phase3MoveGroup].push(entry);
  }
}

const currentWorkspaceGlobs = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
const recommendedWorkspaceGlobs = [
  'packages/*',
  'examples/*',
  'subprojects/*/packages/*',
  'subprojects/*/examples/*',
];
const missingRecommendedWorkspaceGlobs = recommendedWorkspaceGlobs.filter(
  (glob) => !currentWorkspaceGlobs.includes(glob),
);

const filesToScan = collectFilesForScan([
  'README.md',
  'docs',
  'examples',
  'packages',
  'subprojects',
  'scripts',
  'config/loj.release.json',
  'package.json',
]);

const currentScopeRefs = collectScopeRefs(filesToScan, '@loj-lang/');
const legacyScopeRefs = collectScopeRefs(filesToScan, '@reactdsl/');

if (currentScopeRefs.totalRefs === 0) {
  warnings.push('No @loj-lang/* references were found; verify the scan roots still match the repo layout.');
}

const summary = {
  success: errors.length === 0,
  root: {
    name: rootPackage.name,
    version: rootPackage.version,
    currentWorkspaceGlobs,
    recommendedWorkspaceGlobs,
    missingRecommendedWorkspaceGlobs,
  },
  moveGroups: Object.entries(groupedEntries).map(([moveGroup, entries]) => ({
    moveGroup,
    count: entries.length,
    entries: entries.map((entry) => ({
      currentName: entry.currentName,
      phase3PackageName: entry.phase3PackageName,
      path: entry.path,
      phase3PackagePath: entry.phase3PackagePath,
    })),
  })),
  pending: {
    packageRenames: manifest.releasePackages.filter(
      (entry) => entry.currentName !== entry.phase3PackageName,
    ).length,
    packageMoves: manifest.releasePackages.filter((entry) => entry.path !== entry.phase3PackagePath).length,
    currentScopeReferences: currentScopeRefs.totalRefs,
    currentScopeFiles: currentScopeRefs.fileCount,
    legacyScopeReferences: legacyScopeRefs.totalRefs,
    legacyScopeFiles: legacyScopeRefs.fileCount,
  },
  compatibility: {
    mode: compatibility.phase3CompatibilityMode,
    publicLegacyPackagesReleased: compatibility.publicLegacyPackagesReleased,
    allowedLegacyScopeRefFiles: compatibility.allowedLegacyScopeRefFiles,
    allowedLegacyCommandAliasFiles: compatibility.allowedLegacyCommandAliasFiles,
    allowedLegacyCommandAliases: compatibility.allowedLegacyCommandAliases,
  },
  scopeRefs: {
    current: currentScopeRefs,
    legacy: legacyScopeRefs,
  },
  warnings,
  errors,
};

if (jsonMode) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else if (errors.length === 0) {
  process.stdout.write('Phase 3 preflight passed.\n');
  process.stdout.write(
    `- pending package renames: ${summary.pending.packageRenames}; pending package moves: ${summary.pending.packageMoves}\n`,
  );
  process.stdout.write(
    `- @loj-lang/* references: ${currentScopeRefs.totalRefs} across ${currentScopeRefs.fileCount} files\n`,
  );
  process.stdout.write(
    `- legacy @reactdsl/* references: ${legacyScopeRefs.totalRefs} across ${legacyScopeRefs.fileCount} files\n`,
  );
  process.stdout.write(
    `- compatibility mode: ${compatibility.phase3CompatibilityMode}; public legacy release exists: ${compatibility.publicLegacyPackagesReleased ? 'yes' : 'no'}\n`,
  );
  process.stdout.write(
    `- recommended future workspaces missing today: ${missingRecommendedWorkspaceGlobs.length === 0 ? '(none)' : missingRecommendedWorkspaceGlobs.join(', ')}\n`,
  );
  for (const group of summary.moveGroups) {
    process.stdout.write(
      `- ${group.moveGroup}: ${group.count} package(s) -> ${group.entries.map((entry) => entry.phase3PackageName).join(', ') || '(none)'}\n`,
    );
  }
  if (warnings.length > 0) {
    process.stdout.write('Warnings:\n');
    for (const warning of warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
} else {
  process.stderr.write('Phase 3 preflight failed.\n');
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
}

process.exitCode = errors.length === 0 ? 0 : 1;

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateManifest(manifestErrors) {
  if (!Array.isArray(manifest.releasePackages) || manifest.releasePackages.length === 0) {
    manifestErrors.push('config/loj.release.json must contain at least one release package.');
    return;
  }

  const currentNames = new Set();
  const currentPaths = new Set();
  const phase3Names = new Set();
  const phase3Paths = new Set();

  for (const entry of manifest.releasePackages) {
    const prefix = `${entry.path}`;

    if (entry.kind !== 'vscode-extension') {
      if (typeof entry.currentName !== 'string' || !entry.currentName.startsWith('@loj-lang/')) {
        manifestErrors.push(`${prefix}: currentName must start with @loj-lang/.`);
      }
      if (typeof entry.phase3PackageName !== 'string' || !entry.phase3PackageName.startsWith('@loj-lang/')) {
        manifestErrors.push(`${prefix}: phase3PackageName must start with @loj-lang/.`);
      }
    }
    if (
      entry.phase3MoveGroup !== 'rdsl-subproject' &&
      entry.phase3MoveGroup !== 'sdsl-subproject' &&
      entry.phase3MoveGroup !== 'loj-root'
    ) {
      manifestErrors.push(`${prefix}: phase3MoveGroup must be rdsl-subproject, sdsl-subproject, or loj-root.`);
    }

    validateUnique(currentNames, entry.currentName, `${prefix}: duplicate currentName ${entry.currentName}.`, manifestErrors);
    validateUnique(currentPaths, entry.path, `${prefix}: duplicate current path ${entry.path}.`, manifestErrors);
    validateUnique(
      phase3Names,
      entry.phase3PackageName,
      `${prefix}: duplicate phase3PackageName ${entry.phase3PackageName}.`,
      manifestErrors,
    );
    validateUnique(
      phase3Paths,
      entry.phase3PackagePath,
      `${prefix}: duplicate phase3PackagePath ${entry.phase3PackagePath}.`,
      manifestErrors,
    );

    if (entry.family === 'rdsl' && entry.phase3MoveGroup !== 'rdsl-subproject') {
      manifestErrors.push(`${prefix}: rdsl packages must move in the rdsl-subproject batch.`);
    }
    if (entry.family === 'sdsl' && entry.phase3MoveGroup !== 'sdsl-subproject') {
      manifestErrors.push(`${prefix}: sdsl packages must move in the sdsl-subproject batch.`);
    }
    if (entry.family === 'loj' && entry.phase3MoveGroup !== 'loj-root') {
      manifestErrors.push(`${prefix}: loj packages must remain in the loj-root batch.`);
    }

    if (entry.phase3MoveGroup === 'rdsl-subproject' && !String(entry.phase3PackagePath).startsWith('subprojects/rdsl/')) {
      manifestErrors.push(`${prefix}: rdsl-subproject targets must live under subprojects/rdsl/.`);
    }
    if (entry.phase3MoveGroup === 'sdsl-subproject' && !String(entry.phase3PackagePath).startsWith('subprojects/sdsl/')) {
      manifestErrors.push(`${prefix}: sdsl-subproject targets must live under subprojects/sdsl/.`);
    }
    if (entry.phase3MoveGroup === 'loj-root' && !String(entry.phase3PackagePath).startsWith('packages/')) {
      manifestErrors.push(`${prefix}: loj-root targets must remain under packages/.`);
    }
  }
}

if (
  compatibility.phase3CompatibilityMode !== 'no-bridge' &&
  compatibility.phase3CompatibilityMode !== 'bridge-release'
) {
  errors.push('config/loj.compatibility.json: phase3CompatibilityMode must be no-bridge or bridge-release.');
}
if (typeof compatibility.publicLegacyPackagesReleased !== 'boolean') {
  errors.push('config/loj.compatibility.json: publicLegacyPackagesReleased must be a boolean.');
}

function validateUnique(bucket, value, message, manifestErrors) {
  if (bucket.has(value)) {
    manifestErrors.push(message);
    return;
  }
  bucket.add(value);
}

function collectFilesForScan(roots) {
  const files = [];
  for (const root of roots) {
    const target = resolve(repoRoot, root);
    if (!existsSync(target)) {
      continue;
    }
    walk(target, files);
  }
  return files;
}

function walk(target, files) {
  const stat = statSync(target);
  const rel = relative(repoRoot, target);

  if (stat.isDirectory()) {
    const base = rel.split(sep).pop() ?? '';
    if (
      base === 'dist' ||
      base === 'node_modules' ||
      base.startsWith('generated') ||
      base === '.rdsl' ||
      base === '.rdsl-dev' ||
      base === '.artifacts' ||
      base === '.loj-python' ||
      base.startsWith('.venv') ||
      base === '.m2' ||
      base === '.pytest_cache' ||
      base === '__pycache__' ||
      base === '.loj-python' ||
      base === '.mypy_cache' ||
      base === '.ruff_cache'
    ) {
      return;
    }
    for (const child of readdirSync(target)) {
      walk(resolve(target, child), files);
    }
    return;
  }

  if (!isTextFile(target)) {
    return;
  }
  if (rel.endsWith('package-lock.json') || rel.endsWith('pnpm-lock.yaml') || rel.endsWith('yarn.lock')) {
    return;
  }
  files.push(target);
}

function isTextFile(path) {
  const extension = extname(path).toLowerCase();
  return (
    extension === '.md' ||
    extension === '.json' ||
    extension === '.ts' ||
    extension === '.tsx' ||
    extension === '.js' ||
    extension === '.mjs' ||
    extension === '.yml' ||
    extension === '.yaml' ||
    extension === '.rdsl' ||
    extension === '.sdsl' ||
    extension === '.properties' ||
    extension === '.txt' ||
    path.endsWith('/LICENSE') ||
    path.endsWith('/package.json') ||
    path.endsWith('/README.md')
  );
}

function collectScopeRefs(files, needle) {
  const topLevelBuckets = new Map();
  let totalRefs = 0;
  let fileCount = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(new RegExp(escapeRegExp(needle), 'g'));
    if (!matches || matches.length === 0) {
      continue;
    }
    const rel = relative(repoRoot, file);
    const topLevel = rel.includes(sep) ? rel.split(sep)[0] : rel;
    totalRefs += matches.length;
    fileCount += 1;
    topLevelBuckets.set(topLevel, (topLevelBuckets.get(topLevel) ?? 0) + matches.length);
  }

  return {
    totalRefs,
    fileCount,
    topLevelAreas: Array.from(topLevelBuckets.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([area, refs]) => ({ area, refs })),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
