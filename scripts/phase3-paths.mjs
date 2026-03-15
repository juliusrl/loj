#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './workspace-utils.mjs';

const phase3PathCandidates = {
  rdslExampleEntry: [
    'subprojects/rdsl/examples/user-admin/app.rdsl',
    'examples/user-admin/app.rdsl',
  ],
  rdslHostDir: [
    'subprojects/rdsl/examples/user-admin/host',
    'examples/user-admin/host',
  ],
  sdslExampleDir: [
    'subprojects/sdsl/examples/user-service',
    'examples/user-service',
  ],
  sdslSpringEntry: [
    'subprojects/sdsl/examples/user-service/app.sdsl',
    'examples/user-service/app.sdsl',
  ],
  sdslFastapiEntry: [
    'subprojects/sdsl/examples/user-service/app-fastapi.sdsl',
    'examples/user-service/app-fastapi.sdsl',
  ],
};

export function resolvePhase3Path(key) {
  const candidates = phase3PathCandidates[key];
  if (!candidates) {
    throw new Error(`Unknown Phase 3 path key: ${key}`);
  }

  for (const candidate of candidates) {
    const absolutePath = resolve(repoRoot, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  throw new Error(`Could not resolve any existing path for ${key}: ${candidates.join(', ')}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , command, key] = process.argv;
  if (command !== 'print' || !key) {
    process.stderr.write('Usage: node scripts/phase3-paths.mjs print <key>\n');
    process.exit(1);
  }
  process.stdout.write(resolvePhase3Path(key) + '\n');
}
