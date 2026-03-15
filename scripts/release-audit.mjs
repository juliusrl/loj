#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifestPath = resolve(repoRoot, 'config/loj.release.json');
const policyPath = resolve(repoRoot, 'config/loj.release-policy.json');
const rootPackagePath = resolve(repoRoot, 'package.json');
const licensePath = resolve(repoRoot, 'LICENSE');
const jsonMode = process.argv.includes('--json');

const manifest = readJsonFile(manifestPath);
const policy = readJsonFile(policyPath);
const rootPackage = readJsonFile(rootPackagePath);
const errors = [];
const summaries = [];
const npmCacheDir = mkdtempSync(resolve(tmpdir(), 'loj-release-audit-'));

try {
  validateRootPackage(rootPackage, policy, errors);
  validateReleasePolicyAgainstManifest(manifest, policy, errors);

  for (const entry of manifest.releasePackages) {
    const packageDir = resolve(repoRoot, entry.path);
    const packageJsonPath = resolve(packageDir, 'package.json');
    const packageJson = readJsonFile(packageJsonPath);
    const summary = validateReleasePackage(entry, packageDir, packageJson, rootPackage, policy, errors);
    summaries.push(summary);
  }
} finally {
  rmSync(npmCacheDir, { force: true, recursive: true });
}

if (jsonMode) {
  process.stdout.write(
    JSON.stringify(
      {
        success: errors.length === 0,
        root: {
          name: rootPackage.name,
          private: rootPackage.private === true,
          license: rootPackage.license,
          hasLicenseFile: existsSync(licensePath),
          version: rootPackage.version,
        },
        policy,
        packages: summaries,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
} else if (errors.length === 0) {
  process.stdout.write('Release package audit passed.\n');
  for (const summary of summaries) {
    process.stdout.write(
      `- ${summary.currentName} (${summary.kind}, ${summary.family}) -> ${summary.phase3PackagePath}; packed ${summary.packEntryCount} files\n`,
    );
  }
} else {
  process.stderr.write('Release package audit failed.\n');
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
}

process.exitCode = errors.length === 0 ? 0 : 1;

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateRootPackage(rootPackage, policy, rootErrors) {
  if (rootPackage.private !== true) {
    rootErrors.push('Root package must remain private during the pre-transition phase.');
  }
  if (rootPackage.license !== 'Apache-2.0') {
    rootErrors.push(
      `Root package license must be Apache-2.0, found ${String(rootPackage.license ?? '(missing)')}.`,
    );
  }
  if (!existsSync(licensePath)) {
    rootErrors.push('Root LICENSE file is missing.');
  }
  if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes('packages/*')) {
    rootErrors.push('Root workspace globs must include packages/*.');
  }
  if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes('examples/*')) {
    rootErrors.push('Root workspace globs must include examples/*.');
  }
  if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes('subprojects/*/packages/*')) {
    rootErrors.push('Root workspace globs must include subprojects/*/packages/*.');
  }
  if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes('subprojects/*/examples/*')) {
    rootErrors.push('Root workspace globs must include subprojects/*/examples/*.');
  }
  if (!rootPackage.scripts || typeof rootPackage.scripts['ci:release-packaging'] !== 'string') {
    rootErrors.push('Root package is missing ci:release-packaging.');
  }
  if (!rootPackage.scripts || typeof rootPackage.scripts['release:audit'] !== 'string') {
    rootErrors.push('Root package is missing release:audit.');
  }
  if (!rootPackage.scripts || typeof rootPackage.scripts['ci:beta-candidate'] !== 'string') {
    rootErrors.push('Root package is missing ci:beta-candidate.');
  }
  if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
    rootErrors.push('Root package version is missing.');
  }
  if (policy.versionMode !== 'lockstep') {
    rootErrors.push(`Unsupported release policy versionMode ${String(policy.versionMode)}.`);
  }
  if (policy.versionSource !== 'root-package') {
    rootErrors.push(`Unsupported release policy versionSource ${String(policy.versionSource)}.`);
  }
  if (typeof policy.betaCandidateCommand !== 'string' || policy.betaCandidateCommand.length === 0) {
    rootErrors.push('Release policy betaCandidateCommand is missing.');
  } else if (policy.betaCandidateCommand !== 'npm run ci:beta-candidate') {
    rootErrors.push(
      `Release policy betaCandidateCommand must point at npm run ci:beta-candidate, found ${policy.betaCandidateCommand}.`,
    );
  }
  if (!Array.isArray(policy.publishOrder) || policy.publishOrder.length === 0) {
    rootErrors.push('Release policy publishOrder is missing.');
  }
}

function validateReleasePolicyAgainstManifest(manifest, policy, auditErrors) {
  const manifestNames = manifest.releasePackages.map((entry) => entry.currentName);
  const policyNames = Array.isArray(policy.publishOrder) ? policy.publishOrder : [];

  for (const name of manifestNames) {
    if (!policyNames.includes(name)) {
      auditErrors.push(`Release policy publishOrder is missing package ${name}.`);
    }
  }

  for (const name of policyNames) {
    if (!manifestNames.includes(name)) {
      auditErrors.push(`Release policy publishOrder contains unknown package ${name}.`);
    }
  }

  if (new Set(policyNames).size !== policyNames.length) {
    auditErrors.push('Release policy publishOrder contains duplicate package names.');
  }
}

function validateReleasePackage(entry, packageDir, packageJson, rootPackage, policy, packageErrors) {
  const prefix = `${entry.path}`;
  if (packageJson.name !== entry.currentName) {
    packageErrors.push(
      `${prefix}: expected package name ${entry.currentName}, found ${String(packageJson.name ?? '(missing)')}.`,
    );
  }
  if (packageJson.license !== 'Apache-2.0') {
    packageErrors.push(
      `${prefix}: license must be Apache-2.0, found ${String(packageJson.license ?? '(missing)')}.`,
    );
  }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    packageErrors.push(`${prefix}: version is missing.`);
  } else if (policy.versionMode === 'lockstep' && packageJson.version !== rootPackage.version) {
    packageErrors.push(
      `${prefix}: version ${packageJson.version} must match root lockstep version ${rootPackage.version}.`,
    );
  }
  if (packageJson.type !== 'module') {
    packageErrors.push(`${prefix}: package type must be module.`);
  }
  if (typeof packageJson.description !== 'string' || packageJson.description.trim().length === 0) {
    packageErrors.push(`${prefix}: description is missing.`);
  }
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    packageErrors.push(`${prefix}: files allowlist is missing.`);
  }
  if (!packageJson.engines || typeof packageJson.engines.node !== 'string') {
    packageErrors.push(`${prefix}: engines.node is missing.`);
  }
  if (!packageJson.publishConfig || packageJson.publishConfig.access !== 'public') {
    packageErrors.push(`${prefix}: publishConfig.access must be public.`);
  }
  if (typeof packageJson.main !== 'string') {
    packageErrors.push(`${prefix}: main field is missing.`);
  } else if (!existsSync(resolve(packageDir, packageJson.main))) {
    packageErrors.push(`${prefix}: main file ${packageJson.main} does not exist. Build before auditing.`);
  }
  if (policy.requiredPackageReadme === true && !existsSync(resolve(packageDir, 'README.md'))) {
    packageErrors.push(`${prefix}: package-local README.md is missing.`);
  }

  if (entry.kind !== 'vscode-extension') {
    if (typeof packageJson.types !== 'string') {
      packageErrors.push(`${prefix}: types field is missing.`);
    } else if (!existsSync(resolve(packageDir, packageJson.types))) {
      packageErrors.push(`${prefix}: types file ${packageJson.types} does not exist. Build before auditing.`);
    }
  } else if (!packageJson.engines || typeof packageJson.engines.vscode !== 'string') {
    packageErrors.push(`${prefix}: VSCode extension package must declare engines.vscode.`);
  }

  if (packageJson.bin && typeof packageJson.bin === 'object') {
    for (const binPath of Object.values(packageJson.bin)) {
      if (typeof binPath !== 'string') {
        packageErrors.push(`${prefix}: bin entry must point to a string path.`);
        continue;
      }
      if (!existsSync(resolve(packageDir, binPath))) {
        packageErrors.push(`${prefix}: bin file ${binPath} does not exist. Build before auditing.`);
      }
    }
  }

  const packOutputPath = resolve(
    npmCacheDir,
    `${entry.currentName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-pack.json`,
  );
  const packResult = spawnSync('/bin/bash', ['-lc', `npm pack --json --dry-run --ignore-scripts > ${JSON.stringify(packOutputPath)}`], {
    cwd: packageDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
  });

  if (packResult.status !== 0) {
    packageErrors.push(
      `${prefix}: npm pack --dry-run failed with exit code ${String(packResult.status)}: ${packResult.stderr.trim() || packResult.stdout.trim()}`,
    );
    return {
      currentName: entry.currentName,
      family: entry.family,
      kind: entry.kind,
      phase3PackagePath: entry.phase3PackagePath,
      packEntryCount: 0,
    };
  }

  const packStdout = existsSync(packOutputPath) ? readFileSync(packOutputPath, 'utf8').trim() : '';
  if (packStdout.length === 0) {
    packageErrors.push(`${prefix}: npm pack --dry-run produced no JSON output.`);
    return {
      currentName: entry.currentName,
      family: entry.family,
      kind: entry.kind,
      phase3PackagePath: entry.phase3PackagePath,
      packEntryCount: 0,
    };
  }

  let packPayload;
  try {
    packPayload = JSON.parse(packStdout);
  } catch (error) {
    packageErrors.push(
      `${prefix}: could not parse npm pack JSON output: ${error instanceof Error ? error.message : String(error)}.`,
    );
    return {
      currentName: entry.currentName,
      family: entry.family,
      kind: entry.kind,
      phase3PackagePath: entry.phase3PackagePath,
      packEntryCount: 0,
    };
  }
  const tarball = Array.isArray(packPayload) ? packPayload[0] : packPayload;
  const packedFiles = Array.isArray(tarball.files) ? tarball.files.map((file) => file.path) : [];
  const forbiddenPrefixes = ['src/', 'tests/', 'examples/', 'docs/', 'node_modules/'];
  const forbiddenFiles = ['tsconfig.json', 'vitest.config.ts', 'package-lock.json'];

  for (const file of packedFiles) {
    if (!isAllowedPackedPath(file, entry.allowedPrefixes)) {
      packageErrors.push(`${prefix}: packed file ${file} is outside the allowlist.`);
    }
    if (forbiddenPrefixes.some((forbiddenPrefix) => file.startsWith(forbiddenPrefix))) {
      packageErrors.push(`${prefix}: packed file ${file} should not ship in the package tarball.`);
    }
    if (forbiddenFiles.includes(file)) {
      packageErrors.push(`${prefix}: packed file ${file} should not ship in the package tarball.`);
    }
  }

  for (const requiredFile of entry.requiredFiles) {
    if (!packedFiles.includes(requiredFile)) {
      packageErrors.push(`${prefix}: required packed file ${requiredFile} is missing.`);
    }
  }

  return {
    currentName: entry.currentName,
    family: entry.family,
    kind: entry.kind,
    phase3PackagePath: entry.phase3PackagePath,
    packEntryCount: packedFiles.length,
  };
}

function isAllowedPackedPath(file, allowedPrefixes) {
  if (file === 'package.json' || file === 'README.md' || file === 'LICENSE') {
    return true;
  }
  return allowedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix));
}
