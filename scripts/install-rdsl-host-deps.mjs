#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolvePhase3Path } from './phase3-paths.mjs';

const hostDir = resolvePhase3Path('rdslHostDir');
const result = spawnSync('npm', ['ci'], {
  cwd: hostDir,
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
