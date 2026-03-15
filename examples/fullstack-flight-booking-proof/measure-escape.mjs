#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../packages/loj-cli/dist/index.js';

const exampleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(exampleDir, '../..');
const artifactDir = resolve(exampleDir, '.artifacts', 'escape-budget');
const outputFile = resolve(artifactDir, 'summary.json');
const markdownFile = resolve(artifactDir, 'summary.md');
const thresholdPercent = 20;

const variants = [
  { key: 'spring', projectFile: 'loj.project.yaml', generatedBackendDir: resolve(exampleDir, 'generated', 'backend') },
  { key: 'fastapi', projectFile: 'loj.fastapi.project.yaml', generatedBackendDir: resolve(exampleDir, 'generated', 'backend-fastapi') },
];

const webLojFiles = collectFiles(resolve(exampleDir, 'frontend'), (filePath) => filePath.endsWith('.web.loj'));
const apiLojFiles = collectFiles(resolve(exampleDir, 'backend'), (filePath) => filePath.endsWith('.api.loj'));
const rulesLojFiles = collectFiles(resolve(exampleDir, 'rules'), (filePath) => filePath.endsWith('.rules.loj'));
const flowLojFiles = collectFiles(resolve(exampleDir, 'workflows'), (filePath) => filePath.endsWith('.flow.loj'));
const generatedReactFiles = collectFiles(
  resolve(exampleDir, 'generated', 'frontend'),
  (filePath) => ['.ts', '.tsx'].includes(extname(filePath)),
);
const generatedFrontendStyleFiles = collectFiles(
  resolve(exampleDir, 'generated', 'frontend'),
  (filePath) => extname(filePath) === '.css',
);

const sharedSourceVolume = {
  webLojLines: countLinesForFiles(webLojFiles),
  apiLojLines: countLinesForFiles(apiLojFiles),
  familySourceLines: countLinesForFiles([...webLojFiles, ...apiLojFiles]),
  rulesLojLines: countLinesForFiles(rulesLojFiles),
  flowLojLines: countLinesForFiles(flowLojFiles),
  linkedSubDslLines: countLinesForFiles([...rulesLojFiles, ...flowLojFiles]),
  totalLojLines: countLinesForFiles([...webLojFiles, ...apiLojFiles, ...rulesLojFiles, ...flowLojFiles]),
  projectShellLines: countLinesForFiles([
    resolve(exampleDir, 'loj.project.yaml'),
    resolve(exampleDir, 'loj.fastapi.project.yaml'),
  ]),
  generatedReactLines: countLinesForFiles(generatedReactFiles),
  generatedFrontendStyleLines: countLinesForFiles(generatedFrontendStyleFiles),
  generatedFrontendLines: countLinesForFiles([...generatedReactFiles, ...generatedFrontendStyleFiles]),
};

const measuredVariants = Object.fromEntries(variants.map((variant) => [variant.key, measureVariant(variant)]));
const combinedPercents = Object.values(measuredVariants).map((variant) => variant.escape.combined.escapePercent);
const summary = {
  artifact: 'loj.atrs-core-escape-budget',
  schemaVersion: 3,
  example: 'fullstack-flight-booking-proof',
  thresholdPercent,
  generatedAt: new Date().toISOString(),
  measurementNotes: {
    escapeStats: 'IR-level semantic-node ratio from validate --json',
    codeVolume: 'Physical non-empty line counts grouped by source and generated buckets',
    markedTargetLocalSections: 'Escape-hatch mock-data and business-logic lines come from explicit loj-measure section markers in handwritten handler files',
  },
  sharedCodeVolume: sharedSourceVolume,
  variants: measuredVariants,
  summary: {
    underThresholdAnyVariant: combinedPercents.some((percent) => percent <= thresholdPercent),
    underThresholdAllVariants: combinedPercents.every((percent) => percent <= thresholdPercent),
    minCombinedPercent: Math.min(...combinedPercents),
    maxCombinedPercent: Math.max(...combinedPercents),
  },
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(markdownFile, `${renderMarkdown(summary)}\n`, 'utf8');

process.stdout.write('Measured ATRS-core escape budget for fullstack-flight-booking-proof\n');
for (const [key, variant] of Object.entries(measuredVariants)) {
  process.stdout.write(`- ${key}: frontend ${variant.escape.frontend.escapePercent}% | backend ${variant.escape.backend.escapePercent}% | combined ${variant.escape.combined.escapePercent}%\n`);
  process.stdout.write(
    `  code volume: handwritten ${variant.codeVolume.totals.handwrittenLines} | generated ${variant.codeVolume.totals.generatedLines} | handwritten/generated ${variant.codeVolume.totals.handwrittenToGeneratedRatio}\n`,
  );
  process.stdout.write(
    `  breakdown: loj ${variant.codeVolume.totalLojLines} | react ${variant.codeVolume.generatedReactLines} | mock ${variant.codeVolume.targetLocalMockDataLines} | target-business ${variant.codeVolume.targetLocalBusinessLogicLines}\n`,
  );
}
process.stdout.write(
  `summary: any<=${thresholdPercent}% ${summary.summary.underThresholdAnyVariant ? 'yes' : 'no'}, all<=${thresholdPercent}% ${summary.summary.underThresholdAllVariants ? 'yes' : 'no'}\n`,
);
process.stdout.write(`artifact: ${relativeToExample(outputFile)}\n`);

process.exit(summary.summary.underThresholdAnyVariant ? 0 : 1);

function measureVariant(variant) {
  const payload = runProjectValidate(variant.projectFile);
  const frontend = readEscapeStats(payload, 'frontend');
  const backend = readEscapeStats(payload, 'backend');
  const targetLocalFiles = collectVariantTargetLocalFiles(variant.key);
  const targetLocalLines = countLinesForFiles(targetLocalFiles);
  const targetLocalMockDataLines = countMarkedSectionLines(targetLocalFiles, 'mock-data');
  const targetLocalBusinessLogicLines = countMarkedSectionLines(targetLocalFiles, 'business-logic');
  const targetLocalSupportLines = Math.max(0, targetLocalLines - targetLocalMockDataLines - targetLocalBusinessLogicLines);
  const generatedBackendLines = countLinesForFiles(
    collectFiles(variant.generatedBackendDir, (filePath) => isBackendGeneratedCodeFile(filePath, variant.key)),
  );
  const totals = {
    handwrittenLines: sharedSourceVolume.totalLojLines + targetLocalLines,
    generatedLines: sharedSourceVolume.generatedFrontendLines + generatedBackendLines,
  };
  return {
    projectFile: variant.projectFile,
    escape: {
      frontend,
      backend,
      combined: combineEscapeStats(frontend, backend),
    },
    codeVolume: {
      webLojLines: sharedSourceVolume.webLojLines,
      apiLojLines: sharedSourceVolume.apiLojLines,
      familySourceLines: sharedSourceVolume.familySourceLines,
      rulesLojLines: sharedSourceVolume.rulesLojLines,
      flowLojLines: sharedSourceVolume.flowLojLines,
      linkedSubDslLines: sharedSourceVolume.linkedSubDslLines,
      totalLojLines: sharedSourceVolume.totalLojLines,
      projectShellLines: sharedSourceVolume.projectShellLines,
      targetLocalMockDataLines,
      targetLocalBusinessLogicLines,
      targetLocalSupportLines,
      targetLocalLines,
      generatedReactLines: sharedSourceVolume.generatedReactLines,
      generatedFrontendStyleLines: sharedSourceVolume.generatedFrontendStyleLines,
      generatedFrontendLines: sharedSourceVolume.generatedFrontendLines,
      generatedBackendLines,
      totals: {
        ...totals,
        handwrittenToGeneratedRatio: formatRatio(totals.handwrittenLines, totals.generatedLines),
        lojToGeneratedReactRatio: formatRatio(sharedSourceVolume.totalLojLines, sharedSourceVolume.generatedReactLines),
      },
    },
  };
}

function runProjectValidate(projectFile) {
  const stdout = [];
  const stderr = [];
  const exitCode = runCli(['validate', `examples/fullstack-flight-booking-proof/${projectFile}`, '--json'], {
    cwd: repoRoot,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  if (exitCode !== 0) {
    throw new Error(`Failed to validate ${projectFile}:\n${stderr.join('') || stdout.join('')}`);
  }
  return JSON.parse(stdout.join(''));
}

function readEscapeStats(payload, alias) {
  const stats = payload.targets?.[alias]?.result?.escapeStats;
  if (!stats || typeof stats.totalNodes !== 'number') {
    throw new Error(`Missing escapeStats for target "${alias}"`);
  }
  return {
    totalNodes: stats.totalNodes,
    exprCount: stats.exprCount,
    fnCount: stats.fnCount,
    sqlCount: stats.sqlCount ?? 0,
    customCount: stats.customCount,
    escapePercent: stats.escapePercent,
    overBudget: Boolean(stats.overBudget),
  };
}

function combineEscapeStats(frontend, backend) {
  const totalNodes = frontend.totalNodes + backend.totalNodes;
  const exprCount = frontend.exprCount + backend.exprCount;
  const fnCount = frontend.fnCount + backend.fnCount;
  const sqlCount = (frontend.sqlCount ?? 0) + (backend.sqlCount ?? 0);
  const customCount = frontend.customCount + backend.customCount;
  const escapeTotal = exprCount + fnCount + sqlCount + customCount;
  const escapePercent = totalNodes > 0 ? Math.round((escapeTotal / totalNodes) * 100) : 0;
  return {
    totalNodes,
    exprCount,
    fnCount,
    sqlCount,
    customCount,
    escapePercent,
    overBudget: totalNodes > 0 ? escapePercent > thresholdPercent : false,
  };
}

function collectVariantTargetLocalFiles(variantKey) {
  const backendReadModelsDir = resolve(exampleDir, 'backend', 'read-models');
  return collectFiles(backendReadModelsDir, (filePath) => {
    if (variantKey === 'spring') {
      return filePath.endsWith('.java');
    }
    if (variantKey === 'fastapi') {
      return filePath.endsWith('.py');
    }
    return false;
  });
}

function collectFiles(rootDir, predicate) {
  try {
    if (!statSync(rootDir).isDirectory()) {
      return [];
    }
  } catch {
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

function isBackendGeneratedCodeFile(filePath, variantKey) {
  const extension = extname(filePath);
  if (variantKey === 'spring') {
    return extension === '.java';
  }
  if (variantKey === 'fastapi') {
    return extension === '.py';
  }
  return false;
}

function countLinesForFiles(files) {
  return files.reduce((total, filePath) => total + countNonEmptyLines(filePath), 0);
}

function countMarkedSectionLines(files, sectionName) {
  return files.reduce((total, filePath) => total + countMarkedSectionLinesInFile(filePath, sectionName), 0);
}

function countNonEmptyLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .length;
}

function countMarkedSectionLinesInFile(filePath, sectionName) {
  const beginMarker = `loj-measure:begin ${sectionName}`;
  const endMarker = `loj-measure:end ${sectionName}`;
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (line.includes(beginMarker)) {
      inSection = true;
      continue;
    }
    if (line.includes(endMarker)) {
      inSection = false;
      continue;
    }
    if (inSection && line.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

function formatRatio(numerator, denominator) {
  if (denominator <= 0) {
    return 'n/a';
  }
  return `${(numerator / denominator).toFixed(2)}x`;
}

function renderMarkdown(report) {
  const lines = [
    '# ATRS-Core Escape Budget',
    '',
    `Threshold: \`${report.thresholdPercent}%\``,
    '',
    '## Semantic Escape Ratio',
    '',
    '| Variant | Frontend | Backend | Combined |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const [key, variant] of Object.entries(report.variants)) {
    lines.push(`| ${key} | ${variant.escape.frontend.escapePercent}% | ${variant.escape.backend.escapePercent}% | ${variant.escape.combined.escapePercent}% |`);
  }
  lines.push('');
  lines.push(`Any current pair under threshold: **${report.summary.underThresholdAnyVariant ? 'yes' : 'no'}**`);
  lines.push(`All current pairs under threshold: **${report.summary.underThresholdAllVariants ? 'yes' : 'no'}**`);
  lines.push('');
  lines.push('## Code Volume');
  lines.push('');
  lines.push(`Shared web \`.web.loj\` lines: **${report.sharedCodeVolume.webLojLines}**`);
  lines.push(`Shared API \`.api.loj\` lines: **${report.sharedCodeVolume.apiLojLines}**`);
  lines.push(`Shared rules \`.rules.loj\` lines: **${report.sharedCodeVolume.rulesLojLines}**`);
  lines.push(`Shared flow \`.flow.loj\` lines: **${report.sharedCodeVolume.flowLojLines}**`);
  lines.push(`Shared total Loj lines: **${report.sharedCodeVolume.totalLojLines}**`);
  lines.push(`Shared project-shell lines: **${report.sharedCodeVolume.projectShellLines}**`);
  lines.push(`Shared generated React lines: **${report.sharedCodeVolume.generatedReactLines}**`);
  lines.push(`Shared generated frontend style lines: **${report.sharedCodeVolume.generatedFrontendStyleLines}**`);
  lines.push(`Shared generated frontend total lines: **${report.sharedCodeVolume.generatedFrontendLines}**`);
  lines.push('');
  lines.push('| Variant | Escape mock-data | Escape business logic | Escape support/wiring | Generated backend | Handwritten total | Generated total | Loj / React | Handwritten / generated |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [key, variant] of Object.entries(report.variants)) {
    lines.push(`| ${key} | ${variant.codeVolume.targetLocalMockDataLines} | ${variant.codeVolume.targetLocalBusinessLogicLines} | ${variant.codeVolume.targetLocalSupportLines} | ${variant.codeVolume.generatedBackendLines} | ${variant.codeVolume.totals.handwrittenLines} | ${variant.codeVolume.totals.generatedLines} | ${variant.codeVolume.totals.lojToGeneratedReactRatio} | ${variant.codeVolume.totals.handwrittenToGeneratedRatio} |`);
  }
  lines.push('');
  lines.push('Code-volume buckets:');
  lines.push('- Loj source = `.web.loj` + `.api.loj` + `.rules.loj` + `.flow.loj`');
  lines.push('- escape mock-data / business-logic lines = explicit `loj-measure` markers inside target-local handlers');
  lines.push('- escape support/wiring = target-local lines not marked as mock-data or business-logic');
  lines.push('- generated React = non-empty lines under `generated/frontend/` (`.ts` / `.tsx`)');
  lines.push('- generated frontend styles = non-empty lines under `generated/frontend/` (`.css`)');
  lines.push('- generated backend = non-empty lines under the variant backend output (`.java` or `.py`)');
  return lines.join('\n');
}

function relativeToExample(fileName) {
  return relative(exampleDir, fileName);
}
