#!/usr/bin/env node
/**
 * Quick demo: build the compiler, compile the example app.rdsl, and show
 * the generated files.
 */

import { readFileSync } from 'node:fs';
import { compile } from '@loj-lang/rdsl-compiler';
import { resolvePhase3Path } from './phase3-paths.mjs';

const source = readFileSync(resolvePhase3Path('rdslExampleEntry'), 'utf-8');
const result = compile(source, 'app.rdsl');

if (!result.success) {
  console.error('Compilation failed:');
  for (const err of result.errors) {
    console.error(`  [${err.phase}] ${err.message}${err.nodeId ? ` (${err.nodeId})` : ''}`);
  }
  process.exit(1);
}

console.log('Compilation successful.\n');

const sourceLines = source.split('\n').length;
const sourceTokens = source.split(/\s+/).length;
const genLines = result.files.reduce((sum, file) => sum + file.content.split('\n').length, 0);
const genTokens = result.files.reduce((sum, file) => sum + file.content.split(/\s+/).length, 0);

console.log('Stats:');
console.log(`  Source: ${sourceLines} lines, ${sourceTokens} tokens`);
console.log(`  Generated: ${genLines} lines, ${genTokens} tokens`);
console.log(`  Expansion: ${(genTokens / sourceTokens).toFixed(1)}x`);
console.log(`  Files: ${result.files.length}`);
console.log('');

console.log('Generated files:');
for (const file of result.files) {
  const lines = file.content.split('\n').length;
  console.log(`  ${file.path} (${lines} lines) <- ${file.sourceNode}`);
}
console.log('');

if (result.warnings.length > 0) {
  console.log('Warnings:');
  for (const warning of result.warnings) {
    console.log(`  ${warning.message}`);
  }
  console.log('');
}

const listFile = result.files.find((file) => file.path.includes('List'));
if (listFile) {
  console.log('-'.repeat(72));
  console.log(`${listFile.path}:`);
  console.log('-'.repeat(72));
  console.log(listFile.content);
  console.log('-'.repeat(72));
}
