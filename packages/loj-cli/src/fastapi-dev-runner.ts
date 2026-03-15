#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FastApiDevRunnerOptions {
  generatedDir: string;
  host: string;
  port: string;
  debugpyHost?: string;
  debugpyPort?: string;
  rootPath?: string;
  shutdownMode: 'immediate' | 'graceful';
  shutdownTimeoutSeconds: number;
  forwardedHeadersMode: 'none' | 'standard';
  trustedProxyMode: 'local' | 'all' | 'cidrs';
  trustedProxyCidrs?: string;
}

const options = parseArgs(process.argv.slice(2));
const generatedDir = resolve(process.cwd(), options.generatedDir);
const venvDir = resolve(process.env.LOJ_FASTAPI_VENV_DIR ?? resolve(process.cwd(), '.venv-fastapi-dev'));
const pythonLauncher = process.env.PYTHON ?? 'python3';
const venvPython = process.platform === 'win32'
  ? resolve(venvDir, 'Scripts', 'python.exe')
  : resolve(venvDir, 'bin', 'python');
const installStampPath = resolve(venvDir, '.loj-fastapi-install.json');

main();

function main() {
  const pyprojectPath = resolve(generatedDir, 'pyproject.toml');
  if (!existsSync(pyprojectPath)) {
    throw new Error(`Missing generated FastAPI project at ${pyprojectPath}`);
  }

  ensureVirtualEnvironment();
  ensureEditableInstall(pyprojectPath);
  runServer();
}

function ensureVirtualEnvironment() {
  if (existsSync(venvPython)) {
    return;
  }
  mkdirSync(venvDir, { recursive: true });
  runChecked(pythonLauncher, ['-m', 'venv', venvDir], { cwd: generatedDir });
}

function ensureEditableInstall(pyprojectPath: string) {
  const pyprojectHash = hashFile(pyprojectPath);
  const existingStamp = readInstallStamp();
  if (existingStamp?.pyprojectHash === pyprojectHash && existsSync(venvPython)) {
    return;
  }

  runChecked(
    venvPython,
    ['-m', 'pip', 'install', '--disable-pip-version-check', 'setuptools>=68', 'wheel'],
    { cwd: generatedDir },
  );
  runChecked(
    venvPython,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-build-isolation', '-e', '.'],
    { cwd: generatedDir },
  );
  writeFileSync(installStampPath, `${JSON.stringify({ pyprojectHash }, null, 2)}\n`, 'utf8');
}

function readInstallStamp(): { pyprojectHash?: string } | null {
  if (!existsSync(installStampPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(installStampPath, 'utf8')) as { pyprojectHash?: string };
  } catch {
    return null;
  }
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath, 'utf8')).digest('hex');
}

function runServer() {
  const child = spawn(
    venvPython,
    [
      ...(options.debugpyHost && options.debugpyPort
        ? [
          '-m',
          'debugpy',
          '--listen',
          `${options.debugpyHost}:${options.debugpyPort}`,
          '-m',
          'uvicorn',
          'app.main:app',
        ]
        : [
          '-m',
          'uvicorn',
          'app.main:app',
        ]),
      '--host',
      options.host,
      '--port',
      options.port,
      ...(options.rootPath ? ['--root-path', options.rootPath] : []),
      ...(options.shutdownMode === 'graceful'
        ? ['--timeout-graceful-shutdown', String(options.shutdownTimeoutSeconds)]
        : []),
      ...(options.forwardedHeadersMode === 'standard'
        ? ['--proxy-headers', '--forwarded-allow-ips', renderTrustedProxyForwardedAllowIps(options)]
        : []),
    ],
    {
      cwd: generatedDir,
      env: process.env,
      stdio: 'inherit',
    },
  );

  let shuttingDown = false;

  const forwardSignal = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000).unref();
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function runChecked(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
  },
) {
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

function parseArgs(args: string[]): FastApiDevRunnerOptions {
  let generatedDir: string | undefined;
  let host: string | undefined;
  let port: string | undefined;
  let debugpyHost: string | undefined;
  let debugpyPort: string | undefined;
  let rootPath: string | undefined;
  let shutdownMode: 'immediate' | 'graceful' = 'graceful';
  let shutdownTimeoutSeconds = 30;
  let forwardedHeadersMode: 'none' | 'standard' = 'none';
  let trustedProxyMode: 'local' | 'all' | 'cidrs' = 'local';
  let trustedProxyCidrs: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--generated-dir') {
      generatedDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--host') {
      host = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--port') {
      port = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--debugpy-host') {
      const value = args[index + 1];
      if (typeof value === 'string' && value.trim().length > 0) {
        debugpyHost = value.trim();
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --debugpy-host must be a non-empty string');
    }
    if (arg === '--debugpy-port') {
      const value = args[index + 1];
      if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value.trim())) {
        debugpyPort = value.trim();
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --debugpy-port must be a positive integer');
    }
    if (arg === '--root-path') {
      const value = args[index + 1];
      if (typeof value === 'string' && value.trim().startsWith('/')) {
        rootPath = value.trim();
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --root-path must start with "/"');
    }
    if (arg === '--shutdown-mode') {
      const value = args[index + 1];
      if (value === 'immediate' || value === 'graceful') {
        shutdownMode = value;
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --shutdown-mode must be "immediate" or "graceful"');
    }
    if (arg === '--shutdown-timeout') {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('fastapi-dev-runner --shutdown-timeout must be a positive number');
      }
      shutdownTimeoutSeconds = value;
      index += 1;
      continue;
    }
    if (arg === '--forwarded-headers-mode') {
      const value = args[index + 1];
      if (value === 'none' || value === 'standard') {
        forwardedHeadersMode = value;
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --forwarded-headers-mode must be "none" or "standard"');
    }
    if (arg === '--trusted-proxy-mode') {
      const value = args[index + 1];
      if (value === 'local' || value === 'all' || value === 'cidrs') {
        trustedProxyMode = value;
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --trusted-proxy-mode must be "local", "all", or "cidrs"');
    }
    if (arg === '--trusted-proxy-cidrs') {
      const value = args[index + 1];
      if (typeof value === 'string' && value.trim().length > 0) {
        trustedProxyCidrs = value.trim();
        index += 1;
        continue;
      }
      throw new Error('fastapi-dev-runner --trusted-proxy-cidrs must be a non-empty comma-separated string');
    }
  }

  if (!generatedDir || !host || !port) {
    throw new Error('Usage: fastapi-dev-runner --generated-dir <dir> --host <host> --port <port> [--debugpy-host <host> --debugpy-port <port>] [--shutdown-mode graceful|immediate] [--shutdown-timeout <seconds>] [--forwarded-headers-mode none|standard] [--trusted-proxy-mode local|all|cidrs] [--trusted-proxy-cidrs <cidr1,cidr2>]');
  }
  if ((debugpyHost && !debugpyPort) || (!debugpyHost && debugpyPort)) {
    throw new Error('fastapi-dev-runner --debugpy-host and --debugpy-port must be provided together');
  }

  return {
    generatedDir,
    host,
    port,
    debugpyHost,
    debugpyPort,
    rootPath,
    shutdownMode,
    shutdownTimeoutSeconds,
    forwardedHeadersMode,
    trustedProxyMode,
    trustedProxyCidrs,
  };
}

function renderTrustedProxyForwardedAllowIps(options: FastApiDevRunnerOptions): string {
  if (options.trustedProxyMode === 'all') {
    return '*';
  }
  if (options.trustedProxyMode === 'cidrs' && options.trustedProxyCidrs) {
    return options.trustedProxyCidrs;
  }
  return '127.0.0.1,::1';
}
