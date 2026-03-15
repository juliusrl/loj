#!/usr/bin/env node

import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const exampleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(exampleDir, '../..');
const generatedFrontendDir = resolve(exampleDir, 'generated', 'frontend');

const generatedFiles = collectFiles(
  generatedFrontendDir,
  (filePath) => ['.ts', '.tsx'].includes(extname(filePath)),
);

const shimSource = `
declare module '*.css' {
  const css: string;
  export default css;
}

declare namespace React {
  type ReactNode = any;
  type FormEvent = any;
}
`;

if (generatedFiles.length === 0) {
  process.stderr.write('No generated frontend files found. Run build:generated first.\n');
  process.exit(1);
}

const tempRoot = mkdtempSync(resolve(tmpdir(), 'loj-proof-generated-frontend-'));
const shimPath = resolve(tempRoot, 'generated-frontend-shims.d.ts');
writeFileSync(shimPath, shimSource, 'utf8');

const program = ts.createProgram(
  [
    ...generatedFiles,
    shimPath,
    resolve(repoRoot, 'subprojects/rdsl/packages/runtime/src/react-shim.d.ts'),
  ],
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.React,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: repoRoot,
    allowSyntheticDefaultImports: true,
    paths: {
      '@loj-lang/shared-contracts': ['packages/loj-shared-contracts/src/index.ts'],
      '@loj-lang/rdsl-runtime': ['subprojects/rdsl/packages/runtime/src/index.ts'],
      '@loj-lang/rdsl-runtime/*': ['subprojects/rdsl/packages/runtime/src/*'],
    },
  },
);

const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => '\n',
  };
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  process.exit(1);
}

process.stdout.write(`Generated frontend typecheck passed (${generatedFiles.length} files)\n`);

function collectFiles(rootDir, predicate) {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }
      files.push(...collectFiles(entryPath, predicate));
      continue;
    }
    if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}
