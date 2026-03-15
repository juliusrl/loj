#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const initCwd = process.env.INIT_CWD && process.env.INIT_CWD.length > 0 ? process.env.INIT_CWD : process.cwd();

const result = spawnSync(process.execPath, [resolve(packageDir, 'dist/index.js'), ...process.argv.slice(2)], {
  cwd: initCwd,
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
