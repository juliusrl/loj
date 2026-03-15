#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_DIR = process.cwd();
const GENERATED_DIR = resolve(PROJECT_DIR, process.env.LOJ_FASTAPI_GENERATED_DIR ?? 'generated-fastapi');
const VENV_DIR = resolve(PROJECT_DIR, process.env.LOJ_FASTAPI_VENV_DIR ?? '.venv-fastapi');
const JUNIT_PATH = resolve(GENERATED_DIR, process.env.LOJ_FASTAPI_PYTEST_JUNIT ?? 'pytest-report.xml');
const PYTHON_LAUNCHER = process.env.PYTHON ?? 'python3';
const VENV_PYTHON = process.platform === 'win32'
  ? resolve(VENV_DIR, 'Scripts', 'python.exe')
  : resolve(VENV_DIR, 'bin', 'python');
const INSTALL_STAMP_PATH = resolve(VENV_DIR, '.loj-fastapi-install.json');

main();

function main() {
  const pyprojectPath = resolve(GENERATED_DIR, 'pyproject.toml');
  if (!existsSync(pyprojectPath)) {
    throw new Error(
      `Missing generated FastAPI project at ${pyprojectPath}. Run "npm run build:generated:fastapi --workspace=@loj-lang/example-user-service" first.`,
    );
  }

  ensureVirtualEnvironment();
  ensureEditableInstall(pyprojectPath);
  runChecked(VENV_PYTHON, [
    '-m',
    'pytest',
    '--junitxml',
    JUNIT_PATH,
  ], { cwd: GENERATED_DIR });
}

function ensureVirtualEnvironment() {
  if (existsSync(VENV_PYTHON)) {
    return;
  }
  mkdirSync(VENV_DIR, { recursive: true });
  runChecked(PYTHON_LAUNCHER, ['-m', 'venv', VENV_DIR], { cwd: PROJECT_DIR });
}

function ensureEditableInstall(pyprojectPath) {
  const pyprojectHash = hashFile(pyprojectPath);
  const existingStamp = readInstallStamp();
  if (existingStamp?.pyprojectHash === pyprojectHash && existsSync(VENV_PYTHON)) {
    return;
  }

  runChecked(VENV_PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', 'setuptools>=68', 'wheel'], { cwd: GENERATED_DIR });
  runChecked(VENV_PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-build-isolation', '-e', '.[dev]'], { cwd: GENERATED_DIR });
  writeFileSync(INSTALL_STAMP_PATH, `${JSON.stringify({ pyprojectHash }, null, 2)}\n`, 'utf8');
}

function readInstallStamp() {
  if (!existsSync(INSTALL_STAMP_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(INSTALL_STAMP_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    process.exit(1);
  }
}
