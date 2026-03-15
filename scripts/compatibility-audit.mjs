#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const compatibilityPath = resolve(repoRoot, 'config/loj.compatibility.json');
const releaseManifestPath = resolve(repoRoot, 'config/loj.release.json');
const jsonMode = process.argv.includes('--json');

const compatibility = readJsonFile(compatibilityPath);
const releaseManifest = readJsonFile(releaseManifestPath);
const errors = [];
const warnings = [];

validateCompatibilityManifest(errors);
validateReleaseSurface(errors);

const filesToScan = collectFilesForScan([
  'README.md',
  'docs',
  'examples',
  'packages',
  'subprojects',
  'scripts',
  'config/loj.compatibility.json',
  'config/loj.release.json',
  'package.json',
]);

const legacyScopeMatches = collectMatches(filesToScan, /@reactdsl\/[A-Za-z0-9._/-]+/g);
const legacyCommandMatches = collectMatches(filesToScan, /\breactdsl\.[A-Za-z0-9._-]+\b/g);

const unexpectedLegacyScopeFiles = legacyScopeMatches.files.filter(
  (entry) => !compatibility.allowedLegacyScopeRefFiles.includes(entry.path),
);
const unexpectedLegacyCommandFiles = legacyCommandMatches.files.filter(
  (entry) => !compatibility.allowedLegacyCommandAliasFiles.includes(entry.path),
);

for (const entry of unexpectedLegacyScopeFiles) {
  errors.push(`Unexpected legacy package-scope reference in ${entry.path}: ${entry.matches.join(', ')}`);
}
for (const entry of unexpectedLegacyCommandFiles) {
  errors.push(`Unexpected legacy command reference in ${entry.path}: ${entry.matches.join(', ')}`);
}

for (const entry of legacyCommandMatches.files) {
  for (const match of entry.matches) {
    if (!compatibility.allowedLegacyCommandAliases.includes(match)) {
      errors.push(`Unsupported legacy command alias ${match} in ${entry.path}.`);
    }
  }
}

if (compatibility.phase3CompatibilityMode === 'no-bridge' && compatibility.publicLegacyPackagesReleased === false) {
  if (legacyScopeMatches.totalRefs === 0 && legacyCommandMatches.totalRefs === 0) {
    warnings.push('No legacy references remain; consider removing the compatibility manifest in a later cycle.');
  }
} else {
  warnings.push('Compatibility mode is not the default no-bridge path; review bridge-package policy before release.');
}

const summary = {
  success: errors.length === 0,
  compatibilityMode: compatibility.phase3CompatibilityMode,
  publicLegacyPackagesReleased: compatibility.publicLegacyPackagesReleased,
  legacyScope: {
    totalRefs: legacyScopeMatches.totalRefs,
    fileCount: legacyScopeMatches.fileCount,
    allowedFiles: compatibility.allowedLegacyScopeRefFiles,
    unexpectedFiles: unexpectedLegacyScopeFiles.map((entry) => entry.path),
  },
  legacyCommands: {
    totalRefs: legacyCommandMatches.totalRefs,
    fileCount: legacyCommandMatches.fileCount,
    allowedFiles: compatibility.allowedLegacyCommandAliasFiles,
    allowedAliases: compatibility.allowedLegacyCommandAliases,
    unexpectedFiles: unexpectedLegacyCommandFiles.map((entry) => entry.path),
  },
  warnings,
  errors,
};

if (jsonMode) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else if (errors.length === 0) {
  process.stdout.write('Compatibility audit passed.\n');
  process.stdout.write(
    `- mode: ${compatibility.phase3CompatibilityMode}; public legacy release exists: ${compatibility.publicLegacyPackagesReleased ? 'yes' : 'no'}\n`,
  );
  process.stdout.write(
    `- legacy @reactdsl/* references: ${legacyScopeMatches.totalRefs} across ${legacyScopeMatches.fileCount} files (allowed)\n`,
  );
  process.stdout.write(
    `- legacy reactdsl.* command aliases: ${legacyCommandMatches.totalRefs} across ${legacyCommandMatches.fileCount} files (allowed)\n`,
  );
  if (warnings.length > 0) {
    process.stdout.write('Warnings:\n');
    for (const warning of warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
} else {
  process.stderr.write('Compatibility audit failed.\n');
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
}

process.exitCode = errors.length === 0 ? 0 : 1;

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateCompatibilityManifest(auditErrors) {
  if (!existsSync(compatibilityPath)) {
    auditErrors.push('config/loj.compatibility.json is missing.');
    return;
  }
  if (
    compatibility.phase3CompatibilityMode !== 'no-bridge' &&
    compatibility.phase3CompatibilityMode !== 'bridge-release'
  ) {
    auditErrors.push('phase3CompatibilityMode must be no-bridge or bridge-release.');
  }
  if (typeof compatibility.publicLegacyPackagesReleased !== 'boolean') {
    auditErrors.push('publicLegacyPackagesReleased must be a boolean.');
  }
  if (!Array.isArray(compatibility.allowedLegacyScopeRefFiles)) {
    auditErrors.push('allowedLegacyScopeRefFiles must be an array.');
  }
  if (!Array.isArray(compatibility.allowedLegacyCommandAliasFiles)) {
    auditErrors.push('allowedLegacyCommandAliasFiles must be an array.');
  }
  if (!Array.isArray(compatibility.allowedLegacyCommandAliases)) {
    auditErrors.push('allowedLegacyCommandAliases must be an array.');
  }
  if (compatibility.phase3CompatibilityMode === 'no-bridge' && compatibility.publicLegacyPackagesReleased !== false) {
    auditErrors.push('no-bridge mode requires publicLegacyPackagesReleased to be false.');
  }
}

function validateReleaseSurface(auditErrors) {
  if (!Array.isArray(releaseManifest.releasePackages)) {
    auditErrors.push('config/loj.release.json is missing releasePackages.');
    return;
  }
  if (compatibility.phase3CompatibilityMode === 'no-bridge') {
    for (const entry of releaseManifest.releasePackages) {
      if (typeof entry.currentName === 'string' && entry.currentName.startsWith('@reactdsl/')) {
        auditErrors.push(`No-bridge mode does not allow legacy package ${entry.currentName} in config/loj.release.json.`);
      }
      if (typeof entry.phase3PackageName === 'string' && entry.phase3PackageName.startsWith('@reactdsl/')) {
        auditErrors.push(`No-bridge mode does not allow legacy phase3 package ${entry.phase3PackageName} in config/loj.release.json.`);
      }
    }
  }
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
    extension === '' ||
    extension === '.json' ||
    extension === '.md' ||
    extension === '.mjs' ||
    extension === '.cjs' ||
    extension === '.js' ||
    extension === '.ts' ||
    extension === '.tsx' ||
    extension === '.yaml' ||
    extension === '.yml'
  );
}

function collectMatches(files, pattern) {
  const fileEntries = [];

  for (const file of files) {
    const rel = relative(repoRoot, file);
    const content = readFileSync(file, 'utf8');
    const matches = Array.from(content.matchAll(pattern), (match) => match[0]);
    if (matches.length === 0) {
      continue;
    }
    fileEntries.push({
      path: rel,
      matches: Array.from(new Set(matches)).sort(),
      totalRefs: matches.length,
    });
  }

  return {
    totalRefs: fileEntries.reduce((sum, entry) => sum + entry.totalRefs, 0),
    fileCount: fileEntries.length,
    files: fileEntries,
  };
}
