#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const PUBLISHABLE_PACKAGES = [
  'subprojects/rdsl/packages/compiler',
  'subprojects/rdsl/packages/runtime',
  'subprojects/rdsl/packages/host-react',
  'subprojects/rdsl/packages/cli',
  'subprojects/sdsl/packages/compiler',
  'subprojects/sdsl/packages/cli',
  'packages/loj-cli',
];

const SKILL_DIR = 'skills/loj-authoring';

const BANNED_SKILL_REFERENCES = [
  '/mnt/e/dsl',
  'subprojects/',
  'docs/',
  'README.md',
  'llm-reference.md',
  'sdsl-reference.md',
  'runtime-contract.md',
  'trace-manifest.md',
  'loj-project-file-contract.md',
  'loj-transport-contract.md',
  'internal-release/',
];

function parseArgs(argv) {
  const options = {
    outDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      options.outDir = argv[index + 1] ?? '';
      index += 1;
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
  console.log(`Usage: node scripts/local-prepublish-smoke.mjs [--out-dir <dir>]

Creates a local "agent smoke bundle" that simulates how a real user would try Loj before npm publish:

- packs the publishable @loj-lang/* tarballs
- copies the self-contained loj-authoring skill bundle
- scaffolds an empty app project with package.json and validation/build scripts
- writes a realistic full-stack agent brief instead of pre-writing DSL files
`);
}

function ensureBuiltArtifacts() {
  const missing = PUBLISHABLE_PACKAGES.filter((packageDir) => !existsSync(join(REPO_ROOT, packageDir, 'dist')));
  if (missing.length > 0) {
    throw new Error(
      `Missing dist/ for packaged workspaces:\n${missing.map((item) => `- ${item}`).join('\n')}\nRun "npm run build" first.`,
    );
  }
}

function listFilesRecursively(rootDir) {
  const pending = [rootDir];
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

function assertSkillBundleIsPortable() {
  const skillRoot = join(REPO_ROOT, SKILL_DIR);
  const violations = [];

  for (const filePath of listFilesRecursively(skillRoot)) {
    const relativePath = relative(skillRoot, filePath);
    const contents = readFileSync(filePath, 'utf8');
    for (const needle of BANNED_SKILL_REFERENCES) {
      if (contents.includes(needle)) {
        violations.push(`${relativePath}: contains "${needle}"`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `loj-authoring is not self-contained. Remove repo-external references first:\n${violations.join('\n')}`,
    );
  }
}

function packWorkspace(packageDir, tarballDir, npmCacheDir) {
  const absolutePackageDir = join(REPO_ROOT, packageDir);
  const before = new Set(readdirSync(tarballDir));
  execFileSync(
    'npm',
    ['pack', '--silent', '--pack-destination', tarballDir],
    {
      cwd: absolutePackageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
      },
    },
  );

  const after = readdirSync(tarballDir).filter((name) => !before.has(name) && name.endsWith('.tgz'));
  const tarballName = after.length === 1 ? after[0] : '';
  if (!tarballName) {
    throw new Error(`Failed to parse npm pack output for ${packageDir}`);
  }

  const packageJson = JSON.parse(readFileSync(join(absolutePackageDir, 'package.json'), 'utf8'));
  return {
    packageDir,
    packageName: packageJson.name,
    tarballName,
  };
}

function createAppPackageJson(tarballs) {
  const dependencyNames = [
    '@loj-lang/rdsl-compiler',
    '@loj-lang/rdsl-runtime',
    '@loj-lang/rdsl-host-react',
    '@loj-lang/rdsl-cli',
    '@loj-lang/sdsl-compiler',
    '@loj-lang/sdsl-cli',
    '@loj-lang/cli',
  ];

  const dependencies = Object.fromEntries(
    dependencyNames.map((packageName) => {
      const tarball = tarballs.find((item) => item.packageName === packageName);
      if (!tarball) {
        throw new Error(`Missing packed tarball for ${packageName}`);
      }
      return [packageName, `file:../tarballs/${tarball.tarballName}`];
    }),
  );

  return {
    name: 'loj-agent-smoke-app',
    private: true,
    type: 'module',
    engines: {
      node: '>=20.19.0',
    },
    scripts: {
      'validate:web': 'rdsl validate frontend/app.web.loj',
      'validate:api:spring': 'sdsl validate backend/app.api.loj',
      'validate:api:fastapi': 'sdsl validate backend/app.fastapi.api.loj',
      'validate:project': 'loj validate loj.project.yaml',
      'build:project': 'loj build loj.project.yaml',
      'build:api:fastapi': 'sdsl build backend/app.fastapi.api.loj --out-dir generated/backend-fastapi',
    },
    dependencies,
  };
}

function writeFile(targetPath, contents) {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents);
}

function createBundleReadme(bundleDir) {
  const readme = `# Local Prepublish Agent Smoke

This bundle simulates how a real user would try Loj before npm publish.

## What is included

- \`tarballs/\`: local \`@loj-lang/*\` package tarballs
- \`skill/loj-authoring/\`: portable authoring skill bundle
- \`app/\`: empty project skeleton that an external agent should fill in

## Recommended flow

1. Enter \`app/\`
2. Run \`npm install\`
3. Give an agent:
   - \`../skill/loj-authoring/\`
   - \`AGENT-BRIEF.md\`
4. Let the agent author:
   - \`frontend/app.web.loj\`
   - \`backend/app.api.loj\`
   - \`backend/app.fastapi.api.loj\`
   - \`loj.project.yaml\`
5. Validate and build:
   - \`npm run validate:web\`
   - \`npm run validate:api:spring\`
   - \`npm run validate:api:fastapi\`
   - \`npm run validate:project\`
   - \`npm run build:project\`
   - \`npm run build:api:fastapi\`

## Notes

- \`npm install\` may fetch third-party dependencies such as \`yaml\` and React peers from the public registry.
- This bundle intentionally does **not** pre-write the DSL files. The point is to test whether an agent can author them from the bundled skill.
`;

  writeFile(join(bundleDir, 'README.md'), readme);
}

function createAgentBrief(appDir) {
  const brief = `# Agent Brief

Create a capability-range real application using only the bundled \`loj-authoring\` skill.

## Goal

Build a small internal operations product called **Team Hub**:

- a web frontend in \`frontend/app.web.loj\`
- a Spring backend in \`backend/app.api.loj\`
- a FastAPI backend variant in \`backend/app.fastapi.api.loj\`
- a project file in \`loj.project.yaml\`

## Product Requirements

Frontend:

- app name: \`Team Hub\`
- theme: \`light\`
- auth: \`session\`
- dashboard page titled \`Team Overview\`
- dashboard blocks:
  - metric for total members
  - chart for active members
- navigation entries for dashboard and members
- model \`Member\` with:
  - fullName
  - email
  - role
  - status
  - joinedAt
- resource \`members\` on \`/api/members\`
- list view:
  - filters: email, role, status
  - columns: fullName, email, role, status, joinedAt
  - actions: create, edit, delete
  - numbered pagination size 25
- edit view:
  - fields: fullName, email, role, status
  - email disabled
  - manager-only enabledIf / allowIf / enforce
  - on success: refresh members + toast descriptor with \`defaultMessage: "Updated {name}"\` using \`form.fullName\`
- create view:
  - fields: fullName, email, role, status
  - on success: redirect to members.list + toast \`Member invited\`

Backend family:

- keep the same business semantics for both backends
- use shared backend-family primitives only
- model \`Member\` and resource \`members\` on \`/api/members\`
- auth mode authenticated
- roles: \`MANAGER\`
- operations: list, get, create, update, delete all enabled
- Spring file uses:
  - target: \`spring-boot\`
  - language: \`java\`
  - profile: \`mvc-jpa-security\`
- FastAPI file uses:
  - target: \`fastapi\`
  - language: \`python\`
  - profile: \`rest-sqlalchemy-auth\`

Project shell:

- \`loj.project.yaml\` should compose the web frontend and Spring backend
- use canonical target types:
  - frontend: \`type: web\`
  - backend: \`type: api\`

## Constraints

- Stay strictly within implemented syntax.
- Use canonical suffixes: \`.web.loj\` and \`.api.loj\`.
- Do not invent unsupported backend escape hatches.
- Do not use string interpolation for dynamic frontend messages.
- Use only the bundled skill and its bundled references.

## Acceptance

The authored files should pass:

- \`npm run validate:web\`
- \`npm run validate:api:spring\`
- \`npm run validate:api:fastapi\`
- \`npm run validate:project\`
- \`npm run build:project\`
- \`npm run build:api:fastapi\`
`;

  writeFile(join(appDir, 'AGENT-BRIEF.md'), brief);
}

function createAppReadme(appDir) {
  const readme = `# Agent Smoke App

This directory starts empty on purpose.

## Files an agent should create

- \`frontend/app.web.loj\`
- \`backend/app.api.loj\`
- \`backend/app.fastapi.api.loj\`
- \`loj.project.yaml\`

## Install

\`\`\`bash
npm install
\`\`\`

## Validate

\`\`\`bash
npm run validate:web
npm run validate:api:spring
npm run validate:api:fastapi
npm run validate:project
\`\`\`

## Build

\`\`\`bash
npm run build:project
npm run build:api:fastapi
\`\`\`
`;

  writeFile(join(appDir, 'README.md'), readme);
}

function createBundle(outDir) {
  const tarballDir = join(outDir, 'tarballs');
  const npmCacheDir = join(outDir, '.npm-cache');
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(npmCacheDir, { recursive: true });
  const tarballs = PUBLISHABLE_PACKAGES.map((packageDir) => packWorkspace(packageDir, tarballDir, npmCacheDir));

  cpSync(join(REPO_ROOT, SKILL_DIR), join(outDir, 'skill', 'loj-authoring'), { recursive: true });

  const appDir = join(outDir, 'app');
  mkdirSync(join(appDir, 'frontend'), { recursive: true });
  mkdirSync(join(appDir, 'backend'), { recursive: true });

  writeFile(join(appDir, 'package.json'), `${JSON.stringify(createAppPackageJson(tarballs), null, 2)}\n`);
  createAgentBrief(appDir);
  createAppReadme(appDir);
  createBundleReadme(outDir);
  rmSync(npmCacheDir, { recursive: true, force: true });

  return { appDir, tarballs };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureBuiltArtifacts();
  assertSkillBundleIsPortable();

  const outDir = options.outDir
    ? resolve(process.cwd(), options.outDir)
    : mkdtempSync(join(tmpdir(), 'loj-local-prepublish-smoke-'));

  mkdirSync(outDir, { recursive: true });
  const result = createBundle(outDir);

  console.log(`Created local prepublish agent smoke bundle at ${outDir}`);
  console.log('');
  console.log('Next steps:');
  console.log(`1. cd ${join(outDir, 'app')}`);
  console.log('2. npm install');
  console.log('3. Give an agent the bundled ../skill/loj-authoring plus AGENT-BRIEF.md');
  console.log('4. Run npm run validate:project && npm run build:project');
  console.log('');
  console.log('Packed tarballs:');
  for (const tarball of result.tarballs) {
    console.log(`- ${tarball.packageName}: tarballs/${tarball.tarballName}`);
  }
}

main();
