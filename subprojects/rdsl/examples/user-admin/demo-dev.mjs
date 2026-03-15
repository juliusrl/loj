#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const exampleDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(exampleDir, '..', '..');
const cliDist = path.resolve(repoRoot, 'packages', 'cli', 'dist', 'index.js');

export function resolveDemoDevConfig(env = process.env) {
  const apiPort = parsePort(env.RDSL_DEMO_API_PORT, 3001);
  const hostPort = parsePort(env.RDSL_DEMO_HOST_PORT, 5173);
  const previewPort = parsePort(env.RDSL_DEMO_HOST_PREVIEW_PORT, 4173);
  return {
    exampleDir,
    repoRoot,
    cliDist,
    generatedDir: '.rdsl-dev/generated',
    generatedDirFromHost: '../.rdsl-dev/generated',
    apiBindHost: env.RDSL_DEMO_API_BIND || '127.0.0.1',
    apiBase: env.RDSL_DEMO_API_BASE || `http://127.0.0.1:${apiPort}`,
    apiPort,
    hostBindHost: env.RDSL_DEMO_HOST_BIND || '127.0.0.1',
    hostPort,
    previewPort,
  };
}

export function createDemoDevPlan(config = resolveDemoDevConfig()) {
  return {
    hostUrl: `http://127.0.0.1:${config.hostPort}`,
    apiUrl: config.apiBase,
    services: [
      {
        key: 'api',
        label: 'mock-api',
        command: process.execPath,
        args: ['mock-server.mjs'],
        cwd: config.exampleDir,
        env: {
          HOST: config.apiBindHost,
          PORT: String(config.apiPort),
        },
      },
      {
        key: 'generated',
        label: 'rdsl-dev',
        command: process.execPath,
        args: [
          cliDist,
          'dev',
          'app.web.loj',
          '--out-dir',
          config.generatedDir,
        ],
        cwd: config.exampleDir,
        env: {},
      },
      {
        key: 'host',
        label: 'host',
        command: resolveNpmCommand(),
        args: ['--prefix', 'host', 'run', 'dev'],
        cwd: config.exampleDir,
        env: {
          RDSL_GENERATED_DIR: config.generatedDirFromHost,
          VITE_RDSL_API_BASE: config.apiBase,
          HOST: config.hostBindHost,
          PORT: String(config.hostPort),
          PREVIEW_PORT: String(config.previewPort),
        },
      },
    ],
  };
}

export async function runDemoDev({
  dryRun = false,
  json = false,
  env = process.env,
} = {}) {
  const config = resolveDemoDevConfig(env);
  const plan = createDemoDevPlan(config);

  if (dryRun) {
    writePlan(plan, json);
    return 0;
  }

  ensureHostInstall(config.exampleDir);

  if (json) {
    process.stdout.write(`${JSON.stringify({
      event: 'ready',
      hostUrl: plan.hostUrl,
      apiUrl: plan.apiUrl,
      services: plan.services.map(serializeService),
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`ReactDSL demo dev starting\n`);
    process.stdout.write(`host: ${plan.hostUrl}\n`);
    process.stdout.write(`api: ${plan.apiUrl}\n`);
  }

  const children = [];
  let shuttingDown = false;
  let settled = false;

  const stopAll = (signal = 'SIGINT') => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    }
    setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGTERM');
        }
      }
    }, 300);
  };

  const settle = (code) => {
    if (settled) return;
    settled = true;
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    if (!shuttingDown) {
      stopAll(code === 0 ? 'SIGINT' : 'SIGTERM');
    }
    process.exitCode = code;
  };

  const handleSignal = () => {
    if (!json) {
      process.stdout.write(`Stopping demo dev\n`);
    }
    settle(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  for (const service of plan.services) {
    const child = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: {
        ...process.env,
        ...service.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    pipeOutput(service.label, child.stdout, process.stdout);
    pipeOutput(service.label, child.stderr, process.stderr);
    child.on('exit', (code, signal) => {
      if (shuttingDown) {
        if (children.every(isChildFinished)) {
          settle(process.exitCode ?? 0);
        }
        return;
      }

      const exitCode = code ?? (signal ? 1 : 0);
      if (json) {
        process.stdout.write(`${JSON.stringify({
          event: 'service-exit',
          service: service.label,
          code: exitCode,
          signal: signal ?? null,
        })}\n`);
      } else {
        process.stderr.write(`[${service.label}] exited with ${signal ?? exitCode}\n`);
      }
      settle(exitCode === 0 ? 0 : exitCode);
    });
  }

  return await new Promise((resolve) => {
    const poll = setInterval(() => {
      if (settled && children.every(isChildFinished)) {
        clearInterval(poll);
        resolve(process.exitCode ?? 0);
      }
    }, 50);
  });
}

function pipeOutput(label, stream, target) {
  if (!stream) return;
  const reader = readline.createInterface({ input: stream });
  reader.on('line', (line) => {
    target.write(`[${label}] ${line}\n`);
  });
}

function serializeService(service) {
  return {
    label: service.label,
    command: service.command,
    args: service.args,
    cwd: path.relative(exampleDir, service.cwd) || '.',
    env: service.env,
  };
}

function writePlan(plan, json) {
  const payload = {
    hostUrl: plan.hostUrl,
    apiUrl: plan.apiUrl,
    services: plan.services.map(serializeService),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`ReactDSL demo dev plan\n`);
  process.stdout.write(`host: ${payload.hostUrl}\n`);
  process.stdout.write(`api: ${payload.apiUrl}\n`);
  for (const service of payload.services) {
    process.stdout.write(`- ${service.label}: ${service.command} ${service.args.join(' ')}\n`);
  }
}

function ensureHostInstall(rootDir) {
  const vitePackage = path.resolve(rootDir, 'host', 'node_modules', 'vite', 'package.json');
  if (!existsSync(vitePackage)) {
    throw new Error(
      'Missing host dependencies. Run `npm run ci:install-rdsl-host-deps` before `npm run demo:dev --workspace=@loj-lang/example-user-admin`.',
    );
  }
}

function resolveNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function parsePort(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isChildFinished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const json = args.includes('--json');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDemoDev({ dryRun, json }).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
