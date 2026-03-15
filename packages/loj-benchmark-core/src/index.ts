#!/usr/bin/env node

import {
  CANONICAL_RDSL_SOURCE_SUFFIX,
  LEGACY_RDSL_SOURCE_SUFFIX,
  compile,
  stripRdslSourceSuffix,
} from '@loj-lang/rdsl-compiler';
import type { CompileError } from '@loj-lang/rdsl-compiler';
import type {
  EffectNode,
  EscapeHatchStats,
  ExprNode,
  IRAction,
  IRApp,
  IRFieldDecorator,
  IRModelField,
  IRResource,
  RuleValue,
} from '@loj-lang/rdsl-compiler/ir';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Lane = 'docs-only';
type CompilerTarget = 'react';
type ScalarFieldType = 'string' | 'number' | 'boolean' | 'datetime';
type ViewName = 'list' | 'edit' | 'create';
type RuleName = 'visibleIf' | 'enabledIf' | 'allowIf' | 'enforce';
type EffectType = EffectNode['type'];
type CheckStatus = 'passed' | 'failed' | 'skipped';
type ImportAdapterName = 'jsonl' | 'openai-responses';

const BENCHMARK_SOURCE_SUFFIXES = [
  CANONICAL_RDSL_SOURCE_SUFFIX,
  LEGACY_RDSL_SOURCE_SUFFIX,
] as const;

export interface AuthoringTask {
  artifact: 'rdsl.authoring-task';
  schemaVersion: '0.1.0';
  id: string;
  lane: Lane;
  title: string;
  prompt: string;
}

export interface AuthoringExpectationBudgets {
  maxWarnings?: number;
  maxEscapePercent?: number;
  maxExprCount?: number;
  maxFnCount?: number;
  maxCustomCount?: number;
}

type ExpectedToastMessageValue =
  | string
  | number
  | boolean
  | null
  | { ref: string };

interface ExpectedToastMessageDescriptor {
  key: string;
  defaultMessage?: string;
  values?: Record<string, ExpectedToastMessageValue>;
}

export type AuthoringExpectationCheck =
  | { id: string; type: 'appNameEquals'; value: string }
  | { id: string; type: 'compilerTargetEquals'; value: CompilerTarget }
  | { id: string; type: 'modelExists'; model: string }
  | {
      id: string;
      type: 'modelFieldExists';
      model: string;
      field: string;
      fieldType: ScalarFieldType | 'enum';
      enumValues?: string[];
      decorators?: string[];
    }
  | {
      id: string;
      type: 'resourceExists';
      resource: string;
      model?: string;
      api?: string;
      views?: ViewName[];
    }
  | { id: string; type: 'listFilterExists'; resource: string; field: string }
  | { id: string; type: 'listColumnExists'; resource: string; field: string; decorators?: string[] }
  | { id: string; type: 'actionExists'; resource: string; action: string; confirm?: string }
  | { id: string; type: 'paginationEquals'; resource: string; size: number; style: 'numbered' | 'infinite' | 'loadMore' }
  | { id: string; type: 'viewFieldExists'; resource: string; view: 'edit' | 'create'; field: string; decorators?: string[] }
  | {
      id: string;
      type: 'viewRuleEquals';
      resource: string;
      view: ViewName;
      rule: RuleName;
      source?: RuleValue['source'];
      canonicalExpr?: string;
      fnPath?: string;
    }
  | {
      id: string;
      type: 'effectExists';
      resource: string;
      view: 'edit' | 'create';
      effectType: EffectType;
      target?: string;
      message?: string | ExpectedToastMessageDescriptor;
      dialog?: string;
      event?: string;
    }
  | { id: string; type: 'pageExists'; page: string; pageType?: 'dashboard' | 'custom'; title?: string }
  | { id: string; type: 'pageBlockExists'; page: string; blockType: 'metric' | 'chart' | 'table' | 'custom'; title: string; data?: string }
  | { id: string; type: 'navItemExists'; target: string; group?: string; label?: string };

export interface AuthoringExpectation {
  artifact: 'rdsl.authoring-expected';
  schemaVersion: '0.1.0';
  taskId: string;
  budgets?: AuthoringExpectationBudgets;
  checks: AuthoringExpectationCheck[];
}

export interface AuthoringRunMeta {
  artifact: 'rdsl.authoring-run';
  schemaVersion: '0.1.0';
  runId?: string;
  lane?: Lane;
  model?: string;
  provider?: string;
  wrapper?: string;
  referenceDocs?: string;
  notes?: string;
}

export interface AttemptMeta {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface BenchmarkCheckResult {
  id: string;
  type: string;
  status: CheckStatus;
  message: string;
}

export interface AttemptReport {
  attempt: number;
  sourceFile: string;
  meta?: AttemptMeta;
  compileSuccess: boolean;
  warningCount: number;
  errors: CompileError[];
  warnings: CompileError[];
  checks: BenchmarkCheckResult[];
  valid: boolean;
  escapeStats?: EscapeHatchStats;
}

export interface TaskReport {
  taskId: string;
  title: string;
  expectedCheckCount: number;
  firstPassValid: boolean;
  winningAttempt: number | null;
  repairsBeforeFirstValid: number | null;
  status: 'first-pass-valid' | 'repaired' | 'failed' | 'missing';
  attempts: AttemptReport[];
  failureArtifacts: string[];
}

export interface RunSummary {
  taskCount: number;
  attemptedTaskCount: number;
  solvedTaskCount: number;
  failedTaskCount: number;
  firstPassValidCount: number;
  firstPassValidRate: number;
  solvedRate: number;
  averageRepairsBeforeFirstValid: number;
  totalAttemptCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  winningAttemptEscapeUsage: {
    exprCount: number;
    fnCount: number;
    customCount: number;
    averagePercent: number;
  };
}

export interface AuthoringBenchmarkReport {
  artifact: 'rdsl.authoring-report';
  schemaVersion: '0.1.0';
  generatedAt: string;
  run: Required<Pick<AuthoringRunMeta, 'runId' | 'lane'>> & Omit<AuthoringRunMeta, 'runId' | 'lane'>;
  corpusDir: string;
  submissionsDir: string;
  reportDir: string;
  referenceDocs: string;
  tasks: TaskReport[];
  summary: RunSummary;
}

export interface PromptManifest {
  artifact: 'rdsl.authoring-prompt-manifest';
  schemaVersion: '0.1.0';
  generatedAt: string;
  lane: Lane;
  corpusDir: string;
  referenceDocs: string;
  outDir: string;
  prompts: Array<{ taskId: string; path: string }>;
}

export interface ExportPromptsOptions {
  corpusDir?: string;
  referenceDocs?: string;
  outDir?: string;
}

export interface RunBenchmarkOptions {
  corpusDir?: string;
  submissionsDir: string;
  referenceDocs?: string;
  reportDir?: string;
}

export interface ImportAuthoringRunOptions {
  adapter: ImportAdapterName;
  inputPath: string;
  outDir: string;
  corpusDir?: string;
  runId?: string;
  lane?: Lane;
  model?: string;
  provider?: string;
  wrapper?: string;
  referenceDocs?: string;
  notes?: string;
}

interface ImportedAttemptRecord {
  taskId: string;
  attempt: number;
  output: string;
  meta?: AttemptMeta;
  sourcePath?: string;
}

export interface AuthoringImportManifest {
  artifact: 'rdsl.authoring-import-manifest';
  schemaVersion: '0.1.0';
  generatedAt: string;
  adapter: ImportAdapterName;
  inputPath: string;
  corpusDir: string;
  outDir: string;
  run: Required<Pick<AuthoringRunMeta, 'runId' | 'lane'>> & Omit<AuthoringRunMeta, 'runId' | 'lane'>;
  attempts: Array<{
    taskId: string;
    attempt: number;
    sourcePath?: string;
    outputPath: string;
    metaPath?: string;
  }>;
}

interface LoadedCorpus {
  tasks: AuthoringTask[];
  expectations: Map<string, AuthoringExpectation>;
}

export interface CliIO {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const BENCHMARK_SCHEMA_VERSION = '0.1.0';
const DEFAULT_LANE: Lane = 'docs-only';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const defaultCorpusDir = resolve(repoRoot, 'benchmarks/authoring');
const defaultReferenceDocs = resolve(repoRoot, 'subprojects/rdsl/docs/rdsl-reference.md');
const defaultPromptsOutDir = resolve(defaultCorpusDir, 'prompts/docs-only');
const defaultReportsDir = resolve(repoRoot, 'benchmarks/reports');

export function exportPrompts(options: ExportPromptsOptions = {}): PromptManifest {
  const corpusDir = resolve(options.corpusDir ?? defaultCorpusDir);
  const referenceDocs = resolve(options.referenceDocs ?? defaultReferenceDocs);
  const outDir = resolve(options.outDir ?? defaultPromptsOutDir);

  const reference = readFileSync(referenceDocs, 'utf8').trim();
  const corpus = loadCorpus(corpusDir);

  mkdirSync(outDir, { recursive: true });

  const prompts = corpus.tasks.map((task) => {
    const outputPath = join(outDir, `${task.id}.md`);
    writeFileSync(outputPath, buildPromptDocument(task, reference), 'utf8');
    return {
      taskId: task.id,
      path: outputPath,
    };
  });

  const manifest: PromptManifest = {
    artifact: 'rdsl.authoring-prompt-manifest',
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    lane: DEFAULT_LANE,
    corpusDir,
    referenceDocs,
    outDir,
    prompts,
  };

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export function runAuthoringBenchmark(options: RunBenchmarkOptions): AuthoringBenchmarkReport {
  const corpusDir = resolve(options.corpusDir ?? defaultCorpusDir);
  const submissionsDir = resolve(options.submissionsDir);
  const referenceDocs = resolve(options.referenceDocs ?? defaultReferenceDocs);
  const runMeta = loadRunMeta(submissionsDir, referenceDocs);
  const reportDir = resolve(
    options.reportDir ?? join(defaultReportsDir, formatLocalDate(new Date()), runMeta.runId),
  );

  const corpus = loadCorpus(corpusDir);
  const taskReports = corpus.tasks.map((task) =>
    evaluateTask(task, corpus.expectations.get(task.id)!, submissionsDir),
  );
  const summary = buildSummary(taskReports);

  const report: AuthoringBenchmarkReport = {
    artifact: 'rdsl.authoring-report',
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    run: runMeta,
    corpusDir,
    submissionsDir,
    reportDir,
    referenceDocs,
    tasks: taskReports,
    summary,
  };

  writeBenchmarkReport(report);
  return report;
}

export function importAuthoringRun(options: ImportAuthoringRunOptions): AuthoringImportManifest {
  const inputPath = resolve(options.inputPath);
  const outDir = resolve(options.outDir);
  const corpusDir = resolve(options.corpusDir ?? defaultCorpusDir);
  const referenceDocs = resolve(options.referenceDocs ?? defaultReferenceDocs);
  const corpus = loadCorpus(corpusDir);
  const knownTaskIds = new Set(corpus.tasks.map((task) => task.id));
  const importedAttempts = loadImportedAttempts(inputPath, options.adapter)
    .sort((left, right) => {
      if (left.taskId === right.taskId) {
        return left.attempt - right.attempt;
      }
      return left.taskId.localeCompare(right.taskId);
    });

  const seenAttemptKeys = new Set<string>();
  for (const attempt of importedAttempts) {
    if (!knownTaskIds.has(attempt.taskId)) {
      throw new Error(`Imported task "${attempt.taskId}" does not exist in corpus "${corpusDir}"`);
    }
    const attemptKey = `${attempt.taskId}#${attempt.attempt}`;
    if (seenAttemptKeys.has(attemptKey)) {
      throw new Error(`Duplicate imported attempt "${attemptKey}"`);
    }
    seenAttemptKeys.add(attemptKey);
  }

  const run = {
    artifact: 'rdsl.authoring-run' as const,
    schemaVersion: BENCHMARK_SCHEMA_VERSION as '0.1.0',
    runId: options.runId ?? basename(outDir),
    lane: options.lane ?? DEFAULT_LANE,
    model: options.model,
    provider: options.provider ?? inferProvider(options.adapter),
    wrapper: options.wrapper ?? options.adapter,
    referenceDocs,
    notes: options.notes,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');

  const attempts = importedAttempts.map((attempt) => {
    const taskDir = join(outDir, attempt.taskId);
    mkdirSync(taskDir, { recursive: true });

    const outputPath = join(taskDir, `attempt-${attempt.attempt}${CANONICAL_RDSL_SOURCE_SUFFIX}`);
    writeFileSync(outputPath, normalizeImportedOutput(attempt.output), 'utf8');

    let metaPath: string | undefined;
    if (attempt.meta && hasAttemptMeta(attempt.meta)) {
      metaPath = join(taskDir, `attempt-${attempt.attempt}.meta.json`);
      writeFileSync(metaPath, JSON.stringify(attempt.meta, null, 2), 'utf8');
    }

    return {
      taskId: attempt.taskId,
      attempt: attempt.attempt,
      sourcePath: attempt.sourcePath,
      outputPath,
      metaPath,
    };
  });

  const manifest: AuthoringImportManifest = {
    artifact: 'rdsl.authoring-import-manifest',
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    adapter: options.adapter,
    inputPath,
    corpusDir,
    outDir,
    run,
    attempts,
  };

  writeFileSync(join(outDir, 'import-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export function runCli(argv: string[], io: CliIO = {}): number {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout(getUsage());
    return 0;
  }

  const command = argv[0];

  try {
    if (command === 'export-prompts') {
      const parsed = parseExportPromptsArgs(argv.slice(1), cwd);
      const manifest = exportPrompts(parsed);
      if (parsed.json) {
        stdout(`${JSON.stringify(manifest, null, 2)}\n`);
      } else {
        stdout(`Exported ${manifest.prompts.length} prompts to ${manifest.outDir}\n`);
      }
      return 0;
    }

    if (command === 'run') {
      const parsed = parseRunArgs(argv.slice(1), cwd);
      const report = runAuthoringBenchmark(parsed);
      if (parsed.json) {
        stdout(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        stdout(`Benchmark run complete: ${report.run.runId}\n`);
        stdout(`report: ${report.reportDir}\n`);
        stdout(`tasks: ${report.summary.taskCount}\n`);
        stdout(`first-pass validity: ${formatRate(report.summary.firstPassValidRate)} (${report.summary.firstPassValidCount}/${report.summary.taskCount})\n`);
        stdout(`solved rate: ${formatRate(report.summary.solvedRate)} (${report.summary.solvedTaskCount}/${report.summary.taskCount})\n`);
        stdout(`average repairs before first valid: ${report.summary.averageRepairsBeforeFirstValid.toFixed(2)}\n`);
      }
      return report.summary.failedTaskCount === 0 ? 0 : 1;
    }

    if (command === 'import') {
      const parsed = parseImportArgs(argv.slice(1), cwd);
      const manifest = importAuthoringRun(parsed);
      if (parsed.json) {
        stdout(`${JSON.stringify(manifest, null, 2)}\n`);
      } else {
        stdout(`Imported ${manifest.attempts.length} attempts to ${manifest.outDir}\n`);
        stdout(`run: ${manifest.run.runId}\n`);
        stdout(`adapter: ${manifest.adapter}\n`);
      }
      return 0;
    }

    stderr(`Unknown command: ${command}\n`);
    stderr(getUsage());
    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`${message}\n`);
    return 1;
  }
}

function getUsage(): string {
  return [
    'ReactDSL benchmark harness',
    '',
    'Commands:',
    '  rdsl-benchmark export-prompts [--corpus <dir>] [--reference <file>] [--out-dir <dir>] [--json]',
    '  rdsl-benchmark import --adapter <jsonl|openai-responses> --input <path> --out-dir <dir> [--corpus <dir>] [--run-id <id>] [--model <model>] [--provider <provider>] [--wrapper <name>] [--json]',
    '  rdsl-benchmark run --submissions <dir> [--corpus <dir>] [--reference <file>] [--report-dir <dir>] [--json]',
    '',
  ].join('\n');
}

function parseExportPromptsArgs(argv: string[], cwd: string): ExportPromptsOptions & { json: boolean } {
  let corpusDir: string | undefined;
  let referenceDocs: string | undefined;
  let outDir: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--corpus') {
      corpusDir = resolve(cwd, requireValue(argv, ++index, '--corpus'));
    } else if (arg === '--reference') {
      referenceDocs = resolve(cwd, requireValue(argv, ++index, '--reference'));
    } else if (arg === '--out-dir') {
      outDir = resolve(cwd, requireValue(argv, ++index, '--out-dir'));
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`Unknown argument for export-prompts: ${arg}`);
    }
  }

  return { corpusDir, referenceDocs, outDir, json };
}

function parseRunArgs(argv: string[], cwd: string): RunBenchmarkOptions & { json: boolean } {
  let corpusDir: string | undefined;
  let submissionsDir: string | undefined;
  let referenceDocs: string | undefined;
  let reportDir: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--corpus') {
      corpusDir = resolve(cwd, requireValue(argv, ++index, '--corpus'));
    } else if (arg === '--submissions') {
      submissionsDir = resolve(cwd, requireValue(argv, ++index, '--submissions'));
    } else if (arg === '--reference') {
      referenceDocs = resolve(cwd, requireValue(argv, ++index, '--reference'));
    } else if (arg === '--report-dir') {
      reportDir = resolve(cwd, requireValue(argv, ++index, '--report-dir'));
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`Unknown argument for run: ${arg}`);
    }
  }

  if (!submissionsDir) {
    throw new Error('Missing required argument: --submissions <dir>');
  }

  return { corpusDir, submissionsDir, referenceDocs, reportDir, json };
}

function parseImportArgs(argv: string[], cwd: string): ImportAuthoringRunOptions & { json: boolean } {
  let adapter: ImportAdapterName | undefined;
  let inputPath: string | undefined;
  let outDir: string | undefined;
  let corpusDir: string | undefined;
  let runId: string | undefined;
  let lane: Lane | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let wrapper: string | undefined;
  let referenceDocs: string | undefined;
  let notes: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--adapter') {
      const value = requireValue(argv, ++index, '--adapter');
      if (value !== 'jsonl' && value !== 'openai-responses') {
        throw new Error(`Unsupported import adapter: ${value}`);
      }
      adapter = value;
    } else if (arg === '--input') {
      inputPath = resolve(cwd, requireValue(argv, ++index, '--input'));
    } else if (arg === '--out-dir') {
      outDir = resolve(cwd, requireValue(argv, ++index, '--out-dir'));
    } else if (arg === '--corpus') {
      corpusDir = resolve(cwd, requireValue(argv, ++index, '--corpus'));
    } else if (arg === '--run-id') {
      runId = requireValue(argv, ++index, '--run-id');
    } else if (arg === '--lane') {
      const value = requireValue(argv, ++index, '--lane');
      if (value !== DEFAULT_LANE) {
        throw new Error(`Unsupported benchmark lane: ${value}`);
      }
      lane = value;
    } else if (arg === '--model') {
      model = requireValue(argv, ++index, '--model');
    } else if (arg === '--provider') {
      provider = requireValue(argv, ++index, '--provider');
    } else if (arg === '--wrapper') {
      wrapper = requireValue(argv, ++index, '--wrapper');
    } else if (arg === '--reference') {
      referenceDocs = resolve(cwd, requireValue(argv, ++index, '--reference'));
    } else if (arg === '--notes') {
      notes = requireValue(argv, ++index, '--notes');
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`Unknown argument for import: ${arg}`);
    }
  }

  if (!adapter) {
    throw new Error('Missing required argument: --adapter <jsonl|openai-responses>');
  }
  if (!inputPath) {
    throw new Error('Missing required argument: --input <path>');
  }
  if (!outDir) {
    throw new Error('Missing required argument: --out-dir <dir>');
  }

  return {
    adapter,
    inputPath,
    outDir,
    corpusDir,
    runId,
    lane,
    model,
    provider,
    wrapper,
    referenceDocs,
    notes,
    json,
  };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function loadImportedAttempts(inputPath: string, adapter: ImportAdapterName): ImportedAttemptRecord[] {
  if (adapter === 'jsonl') {
    return loadJsonlImportedAttempts(inputPath);
  }
  return loadOpenAiImportedAttempts(inputPath);
}

function loadJsonlImportedAttempts(inputPath: string): ImportedAttemptRecord[] {
  const content = readFileSync(inputPath, 'utf8');
  const attempts: ImportedAttemptRecord[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${inputPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }

    attempts.push(normalizeImportedAttempt(parsed, `${inputPath}:${index + 1}`));
  }

  return attempts;
}

function loadOpenAiImportedAttempts(inputPath: string): ImportedAttemptRecord[] {
  const jsonFiles = collectJsonFiles(inputPath);
  return jsonFiles.map((filePath) => {
    const parsed = loadJson<Record<string, unknown>>(filePath);
    return normalizeOpenAiImportedAttempt(parsed, filePath);
  });
}

function collectJsonFiles(inputPath: string): string[] {
  const stats = statSync(inputPath);
  if (stats.isFile()) {
    if (!inputPath.endsWith('.json')) {
      throw new Error(`Expected a .json file for openai-responses adapter: ${inputPath}`);
    }
    return [inputPath];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsupported import input path: ${inputPath}`);
  }

  const files: string[] = [];
  for (const entry of readdirSync(inputPath)) {
    const childPath = join(inputPath, entry);
    const childStats = statSync(childPath);
    if (childStats.isDirectory()) {
      files.push(...collectJsonFiles(childPath));
    } else if (childStats.isFile() && childPath.endsWith('.json')) {
      files.push(childPath);
    }
  }
  return files.sort();
}

function normalizeImportedAttempt(record: unknown, label: string): ImportedAttemptRecord {
  const object = asRecord(record, label);
  const taskId = getString(object.taskId) ?? getString(object.task_id);
  if (!taskId) {
    throw new Error(`Missing taskId in imported record: ${label}`);
  }

  const attempt = getPositiveInteger(object.attempt) ?? 1;
  const output = extractOutputText(record);
  if (!output) {
    throw new Error(`Missing output text in imported record: ${label}`);
  }

  return {
    taskId,
    attempt,
    output,
    meta: extractAttemptMeta(record),
    sourcePath: label,
  };
}

function normalizeOpenAiImportedAttempt(record: Record<string, unknown>, filePath: string): ImportedAttemptRecord {
  const responseRecord = asRecord(record.response ?? record, filePath);
  const fileInfo = parseTaskDescriptorFromPath(filePath);
  const taskId = getString(record.taskId) ?? getString(responseRecord.taskId) ?? fileInfo.taskId;
  if (!taskId) {
    throw new Error(`Missing taskId in imported response file: ${filePath}`);
  }

  const attempt = getPositiveInteger(record.attempt) ?? getPositiveInteger(responseRecord.attempt) ?? fileInfo.attempt ?? 1;
  const output = extractOutputText(record.response ?? record);
  if (!output) {
    throw new Error(`Missing output text in imported response file: ${filePath}`);
  }

  return {
    taskId,
    attempt,
    output,
    meta: extractAttemptMeta(record.response ?? record),
    sourcePath: filePath,
  };
}

function parseTaskDescriptorFromPath(filePath: string): { taskId?: string; attempt?: number } {
  const parentName = basename(dirname(filePath));
  const fileName = basename(filePath, '.json');
  const fileMatch = fileName.match(/^(.*?)(?:[-_.]attempt[-_.]?(\d+))?$/);
  const parentAttempt = parentName.match(/^attempt[-_.]?(\d+)$/);

  if (parentAttempt) {
    return {
      taskId: basename(dirname(dirname(filePath))),
      attempt: Number.parseInt(parentAttempt[1], 10),
    };
  }

  if (!fileMatch) {
    return {};
  }

  const rawTaskId = fileMatch[1]?.trim();
  const attempt = fileMatch[2] ? Number.parseInt(fileMatch[2], 10) : undefined;
  return {
    taskId: rawTaskId || (parentName !== '.' ? parentName : undefined),
    attempt,
  };
}

function extractOutputText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = getString(record.output) ?? getString(record.rdsl) ?? getString(record.text) ?? getString(record.content);
  if (direct) {
    return direct;
  }

  const directOutputText = getString(record.output_text);
  if (directOutputText) {
    return directOutputText;
  }

  if (record.response) {
    const nested = extractOutputText(record.response);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(record.output)) {
    const joined = flattenResponseText(record.output);
    if (joined) {
      return joined;
    }
  }

  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      const choiceRecord = asOptionalRecord(choice);
      const messageRecord = asOptionalRecord(choiceRecord?.message);
      const messageContent = messageRecord?.content;
      if (typeof messageContent === 'string') {
        return messageContent;
      }
      if (Array.isArray(messageContent)) {
        const joined = flattenResponseText(messageContent);
        if (joined) {
          return joined;
        }
      }
    }
  }

  return undefined;
}

function flattenResponseText(items: unknown[]): string | undefined {
  const chunks: string[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      chunks.push(item);
      continue;
    }

    const record = asOptionalRecord(item);
    if (!record) {
      continue;
    }

    const direct = getString(record.text) ?? getString(record.output_text);
    if (direct) {
      chunks.push(direct);
    }

    if (Array.isArray(record.content)) {
      const nested = flattenResponseText(record.content);
      if (nested) {
        chunks.push(nested);
      }
    }
  }

  const text = chunks.join('\n').trim();
  return text || undefined;
}

function extractAttemptMeta(value: unknown): AttemptMeta | undefined {
  const record = asOptionalRecord(value);
  if (!record) {
    return undefined;
  }

  const usage = asOptionalRecord(record.usage);
  const promptTokens =
    getFiniteNumber(record.promptTokens) ??
    getFiniteNumber(record.prompt_tokens) ??
    getFiniteNumber(usage?.promptTokens) ??
    getFiniteNumber(usage?.prompt_tokens) ??
    getFiniteNumber(usage?.inputTokens) ??
    getFiniteNumber(usage?.input_tokens);
  const completionTokens =
    getFiniteNumber(record.completionTokens) ??
    getFiniteNumber(record.completion_tokens) ??
    getFiniteNumber(usage?.completionTokens) ??
    getFiniteNumber(usage?.completion_tokens) ??
    getFiniteNumber(usage?.outputTokens) ??
    getFiniteNumber(usage?.output_tokens);
  const totalTokens =
    getFiniteNumber(record.totalTokens) ??
    getFiniteNumber(record.total_tokens) ??
    getFiniteNumber(usage?.totalTokens) ??
    getFiniteNumber(usage?.total_tokens);
  const latencyMs =
    getFiniteNumber(record.latencyMs) ??
    getFiniteNumber(record.latency_ms) ??
    getFiniteNumber(record.durationMs) ??
    getFiniteNumber(record.duration_ms);

  const meta: AttemptMeta = {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens ?? deriveTotalTokens(promptTokens, completionTokens),
    latencyMs,
  };

  return hasAttemptMeta(meta) ? meta : undefined;
}

function deriveTotalTokens(promptTokens?: number, completionTokens?: number): number | undefined {
  if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
    return promptTokens + completionTokens;
  }
  return undefined;
}

function hasAttemptMeta(meta: AttemptMeta): boolean {
  return typeof meta.promptTokens === 'number' ||
    typeof meta.completionTokens === 'number' ||
    typeof meta.totalTokens === 'number' ||
    typeof meta.latencyMs === 'number';
}

function normalizeImportedOutput(output: string): string {
  const fenced = output.match(/```(?:yaml|yml|rdsl)?\s*\n([\s\S]*?)```/i);
  const normalized = fenced ? fenced[1] : output;
  const trimmed = normalized.trim();
  return trimmed ? `${trimmed}\n` : '';
}

function inferProvider(adapter: ImportAdapterName): string {
  return adapter === 'openai-responses' ? 'openai' : 'unknown';
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`Expected an object for ${label}`);
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  const numberValue = getFiniteNumber(value);
  if (typeof numberValue !== 'number') {
    return undefined;
  }
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function loadCorpus(corpusDir: string): LoadedCorpus {
  const tasksDir = join(corpusDir, 'tasks');
  const expectedDir = join(corpusDir, 'expected');
  const taskFiles = readdirSync(tasksDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  const tasks = taskFiles.map((entry) => loadJson<AuthoringTask>(join(tasksDir, entry)));
  const expectations = new Map<string, AuthoringExpectation>();

  for (const task of tasks) {
    assertArtifact(task.artifact, 'rdsl.authoring-task', `task ${task.id}`);
    const expectedFile = join(expectedDir, `${task.id}.json`);
    if (!existsSync(expectedFile)) {
      throw new Error(`Missing expectation file for task "${task.id}": ${expectedFile}`);
    }

    const expectation = loadJson<AuthoringExpectation>(expectedFile);
    assertArtifact(expectation.artifact, 'rdsl.authoring-expected', `expectation ${task.id}`);
    if (expectation.taskId !== task.id) {
      throw new Error(`Expectation taskId mismatch for "${task.id}"`);
    }
    expectations.set(task.id, expectation);
  }

  return { tasks, expectations };
}

function assertArtifact(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`Invalid artifact for ${label}: expected "${expected}", received "${actual}"`);
  }
}

function loadRunMeta(submissionsDir: string, referenceDocs: string): Required<Pick<AuthoringRunMeta, 'runId' | 'lane'>> & Omit<AuthoringRunMeta, 'runId' | 'lane'> {
  const runFile = join(submissionsDir, 'run.json');
  if (!existsSync(runFile)) {
    return {
      artifact: 'rdsl.authoring-run',
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      runId: basename(submissionsDir),
      lane: DEFAULT_LANE,
      referenceDocs,
    };
  }

  const runMeta = loadJson<AuthoringRunMeta>(runFile);
  assertArtifact(runMeta.artifact, 'rdsl.authoring-run', `run metadata ${runFile}`);
  return {
    ...runMeta,
    runId: runMeta.runId ?? basename(submissionsDir),
    lane: runMeta.lane ?? DEFAULT_LANE,
    referenceDocs: runMeta.referenceDocs ?? referenceDocs,
  };
}

function evaluateTask(
  task: AuthoringTask,
  expectation: AuthoringExpectation,
  submissionsDir: string,
): TaskReport {
  const taskDir = join(submissionsDir, task.id);
  if (!existsSync(taskDir)) {
    return {
      taskId: task.id,
      title: task.title,
      expectedCheckCount: expectation.checks.length + budgetCheckCount(expectation.budgets),
      firstPassValid: false,
      winningAttempt: null,
      repairsBeforeFirstValid: null,
      status: 'missing',
      attempts: [],
      failureArtifacts: [],
    };
  }

  const attemptFiles = readdirSync(taskDir)
    .filter((entry) => BENCHMARK_SOURCE_SUFFIXES.some((suffix) => new RegExp(`^attempt-\\d+${escapeRegExp(suffix)}$`).test(entry)))
    .sort((left, right) => extractAttemptNumber(left) - extractAttemptNumber(right));

  const attempts = attemptFiles.map((entry) =>
    evaluateAttempt({
      sourceFile: join(taskDir, entry),
      attempt: extractAttemptNumber(entry),
      expectation,
    }),
  );

  const winningAttempt = attempts.find((attempt) => attempt.valid);
  const firstPassValid = attempts[0]?.valid ?? false;

  return {
    taskId: task.id,
    title: task.title,
    expectedCheckCount: expectation.checks.length + budgetCheckCount(expectation.budgets),
    firstPassValid,
    winningAttempt: winningAttempt?.attempt ?? null,
    repairsBeforeFirstValid: winningAttempt ? winningAttempt.attempt - 1 : null,
    status: !attempts.length
      ? 'missing'
      : firstPassValid
        ? 'first-pass-valid'
        : winningAttempt
          ? 'repaired'
          : 'failed',
    attempts,
    failureArtifacts: [],
  };
}

function evaluateAttempt(input: {
  sourceFile: string;
  attempt: number;
  expectation: AuthoringExpectation;
}): AttemptReport {
  const source = readFileSync(input.sourceFile, 'utf8');
  const compileResult = compile(source, input.sourceFile);
  const ir = compileResult.ir;
  const checks = ir
    ? [
        ...input.expectation.checks.map((check) => evaluateExpectationCheck(check, ir)),
        ...evaluateBudgetChecks(input.expectation.budgets, compileResult.warnings.length, ir.escapeStats),
      ]
    : [
        ...input.expectation.checks.map((check) => ({
          id: check.id,
          type: check.type,
          status: 'skipped' as const,
          message: 'Skipped because compilation failed.',
        })),
        ...evaluateBudgetChecks(input.expectation.budgets, compileResult.warnings.length, undefined),
      ];

  const meta = loadAttemptMeta(input.sourceFile);
  const valid =
    compileResult.success &&
    checks.every((check) => check.status === 'passed');

  return {
    attempt: input.attempt,
    sourceFile: input.sourceFile,
    meta,
    compileSuccess: compileResult.success,
    warningCount: compileResult.warnings.length,
    errors: compileResult.errors,
    warnings: compileResult.warnings,
    checks,
    valid,
    escapeStats: compileResult.ir?.escapeStats,
  };
}

function loadAttemptMeta(sourceFile: string): AttemptMeta | undefined {
  const metaFile = `${stripRdslSourceSuffix(sourceFile)}.meta.json`;
  if (!existsSync(metaFile)) {
    return undefined;
  }
  return loadJson<AttemptMeta>(metaFile);
}

function evaluateBudgetChecks(
  budgets: AuthoringExpectationBudgets | undefined,
  warningCount: number,
  escapeStats: EscapeHatchStats | undefined,
): BenchmarkCheckResult[] {
  if (!budgets) {
    return [];
  }

  const results: BenchmarkCheckResult[] = [];

  if (typeof budgets.maxWarnings === 'number') {
    results.push({
      id: 'budget.maxWarnings',
      type: 'budget',
      status: warningCount <= budgets.maxWarnings ? 'passed' : 'failed',
      message: `Warnings ${warningCount}/${budgets.maxWarnings}.`,
    });
  }

  if (!escapeStats) {
    if (
      typeof budgets.maxEscapePercent === 'number' ||
      typeof budgets.maxExprCount === 'number' ||
      typeof budgets.maxFnCount === 'number' ||
      typeof budgets.maxCustomCount === 'number'
    ) {
      results.push({
        id: 'budget.escapeStats',
        type: 'budget',
        status: 'skipped',
        message: 'Skipped because compilation failed.',
      });
    }
    return results;
  }

  if (typeof budgets.maxEscapePercent === 'number') {
    results.push({
      id: 'budget.maxEscapePercent',
      type: 'budget',
      status: escapeStats.escapePercent <= budgets.maxEscapePercent ? 'passed' : 'failed',
      message: `Escape percent ${escapeStats.escapePercent}%/${budgets.maxEscapePercent}%.`,
    });
  }

  if (typeof budgets.maxExprCount === 'number') {
    results.push({
      id: 'budget.maxExprCount',
      type: 'budget',
      status: escapeStats.exprCount <= budgets.maxExprCount ? 'passed' : 'failed',
      message: `@expr count ${escapeStats.exprCount}/${budgets.maxExprCount}.`,
    });
  }

  if (typeof budgets.maxFnCount === 'number') {
    results.push({
      id: 'budget.maxFnCount',
      type: 'budget',
      status: escapeStats.fnCount <= budgets.maxFnCount ? 'passed' : 'failed',
      message: `@fn count ${escapeStats.fnCount}/${budgets.maxFnCount}.`,
    });
  }

  if (typeof budgets.maxCustomCount === 'number') {
    results.push({
      id: 'budget.maxCustomCount',
      type: 'budget',
      status: escapeStats.customCount <= budgets.maxCustomCount ? 'passed' : 'failed',
      message: `@custom count ${escapeStats.customCount}/${budgets.maxCustomCount}.`,
    });
  }

  return results;
}

function budgetCheckCount(budgets: AuthoringExpectationBudgets | undefined): number {
  if (!budgets) {
    return 0;
  }

  let count = 0;
  if (typeof budgets.maxWarnings === 'number') count += 1;
  if (
    typeof budgets.maxEscapePercent === 'number' ||
    typeof budgets.maxExprCount === 'number' ||
    typeof budgets.maxFnCount === 'number' ||
    typeof budgets.maxCustomCount === 'number'
  ) {
    count += Number(typeof budgets.maxEscapePercent === 'number');
    count += Number(typeof budgets.maxExprCount === 'number');
    count += Number(typeof budgets.maxFnCount === 'number');
    count += Number(typeof budgets.maxCustomCount === 'number');
  }
  return count;
}

function evaluateExpectationCheck(check: AuthoringExpectationCheck, ir: IRApp): BenchmarkCheckResult {
  switch (check.type) {
    case 'appNameEquals':
      return compareValue(check.id, check.type, ir.name, check.value, `App name is "${ir.name}".`);
    case 'compilerTargetEquals':
      return compareValue(check.id, check.type, ir.compiler.target, check.value, `Compiler target is "${ir.compiler.target}".`);
    case 'modelExists': {
      const model = ir.models.find((entry) => entry.name === check.model);
      return booleanResult(check.id, check.type, Boolean(model), model ? `Model "${check.model}" exists.` : `Model "${check.model}" is missing.`);
    }
    case 'modelFieldExists': {
      const model = ir.models.find((entry) => entry.name === check.model);
      if (!model) {
        return missingDependency(check, `Model "${check.model}" is missing.`);
      }
      const field = model.fields.find((entry) => entry.name === check.field);
      if (!field) {
        return booleanResult(check.id, check.type, false, `Field "${check.field}" is missing from model "${check.model}".`);
      }
      if (!matchesFieldType(field, check.fieldType, check.enumValues)) {
        return booleanResult(check.id, check.type, false, `Field "${check.field}" has the wrong type.`);
      }
      if (!hasDecorators(field.decorators, check.decorators)) {
        return booleanResult(check.id, check.type, false, `Field "${check.field}" is missing required decorators.`);
      }
      return booleanResult(check.id, check.type, true, `Field "${check.field}" on model "${check.model}" matches.`);
    }
    case 'resourceExists': {
      const resource = findResource(ir, check.resource);
      if (!resource) {
        return booleanResult(check.id, check.type, false, `Resource "${check.resource}" is missing.`);
      }
      if (check.model && resource.model !== check.model) {
        return booleanResult(check.id, check.type, false, `Resource "${check.resource}" points to model "${resource.model}".`);
      }
      if (check.api && resource.api !== check.api) {
        return booleanResult(check.id, check.type, false, `Resource "${check.resource}" points to API "${resource.api}".`);
      }
      if (check.views && !check.views.every((view) => hasView(resource, view))) {
        return booleanResult(check.id, check.type, false, `Resource "${check.resource}" is missing one or more required views.`);
      }
      return booleanResult(check.id, check.type, true, `Resource "${check.resource}" matches.`);
    }
    case 'listFilterExists': {
      const list = getListView(ir, check.resource);
      if (!list) {
        return missingDependency(check, `List view for resource "${check.resource}" is missing.`);
      }
      return booleanResult(
        check.id,
        check.type,
        list.filters.some((filter) => filter.field === check.field),
        `List filter "${check.field}" ${list.filters.some((filter) => filter.field === check.field) ? 'exists' : 'is missing'} on "${check.resource}".`,
      );
    }
    case 'listColumnExists': {
      const list = getListView(ir, check.resource);
      if (!list) {
        return missingDependency(check, `List view for resource "${check.resource}" is missing.`);
      }
      const column = list.columns.find((entry) => entry.field === check.field);
      if (!column) {
        return booleanResult(check.id, check.type, false, `Column "${check.field}" is missing from "${check.resource}".`);
      }
      if (!hasDecorators(column.decorators, check.decorators)) {
        return booleanResult(check.id, check.type, false, `Column "${check.field}" is missing required decorators.`);
      }
      return booleanResult(check.id, check.type, true, `Column "${check.field}" exists on "${check.resource}".`);
    }
    case 'actionExists': {
      const list = getListView(ir, check.resource);
      if (!list) {
        return missingDependency(check, `List view for resource "${check.resource}" is missing.`);
      }
      const action = list.actions.find((entry) => actionMatches(entry, check.action, check.confirm));
      return booleanResult(
        check.id,
        check.type,
        Boolean(action),
        action ? `Action "${check.action}" exists on "${check.resource}".` : `Action "${check.action}" is missing from "${check.resource}".`,
      );
    }
    case 'paginationEquals': {
      const list = getListView(ir, check.resource);
      if (!list?.pagination) {
        return missingDependency(check, `Pagination for resource "${check.resource}" is missing.`);
      }
      const passed = list.pagination.size === check.size && list.pagination.style === check.style;
      return booleanResult(
        check.id,
        check.type,
        passed,
        `Pagination is ${list.pagination.size}/${list.pagination.style}.`,
      );
    }
    case 'viewFieldExists': {
      const view = getFormView(ir, check.resource, check.view);
      if (!view) {
        return missingDependency(check, `${check.view} view for resource "${check.resource}" is missing.`);
      }
      const field = view.fields.find((entry) => entry.field === check.field);
      if (!field) {
        return booleanResult(check.id, check.type, false, `Field "${check.field}" is missing from ${check.view} view "${check.resource}".`);
      }
      if (!hasDecorators(field.decorators, check.decorators)) {
        return booleanResult(check.id, check.type, false, `Field "${check.field}" is missing required decorators.`);
      }
      return booleanResult(check.id, check.type, true, `Field "${check.field}" exists in ${check.view} view "${check.resource}".`);
    }
    case 'viewRuleEquals': {
      const view = getAnyView(ir, check.resource, check.view);
      if (!view?.rules) {
        return missingDependency(check, `${check.view} view rules for resource "${check.resource}" are missing.`);
      }
      const rule = view.rules[check.rule];
      if (!rule) {
        return booleanResult(check.id, check.type, false, `Rule "${check.rule}" is missing from ${check.view} view "${check.resource}".`);
      }
      if (check.source && rule.source !== check.source) {
        return booleanResult(check.id, check.type, false, `Rule "${check.rule}" uses source "${rule.source}".`);
      }
      if (check.canonicalExpr) {
        const actual = serializeRule(rule);
        if (actual !== check.canonicalExpr) {
          return booleanResult(check.id, check.type, false, `Rule "${check.rule}" serializes to "${actual}".`);
        }
      }
      if (check.fnPath && (rule.source !== 'escape-fn' || rule.escape.path !== check.fnPath)) {
        return booleanResult(check.id, check.type, false, `Rule "${check.rule}" does not use fn path "${check.fnPath}".`);
      }
      return booleanResult(check.id, check.type, true, `Rule "${check.rule}" matches on "${check.resource}".`);
    }
    case 'effectExists': {
      const view = getFormView(ir, check.resource, check.view);
      if (!view) {
        return missingDependency(check, `${check.view} view for resource "${check.resource}" is missing.`);
      }
      const matched = view.onSuccess.some((effect) => matchesEffect(effect, check));
      return booleanResult(
        check.id,
        check.type,
        matched,
        matched ? `Effect "${check.effectType}" exists on "${check.resource}.${check.view}".` : `Effect "${check.effectType}" is missing from "${check.resource}.${check.view}".`,
      );
    }
    case 'pageExists': {
      const page = ir.pages.find((entry) => entry.name === check.page);
      if (!page) {
        return booleanResult(check.id, check.type, false, `Page "${check.page}" is missing.`);
      }
      if (check.pageType && page.pageType !== check.pageType) {
        return booleanResult(check.id, check.type, false, `Page "${check.page}" has type "${page.pageType}".`);
      }
      if (check.title && page.title !== check.title) {
        return booleanResult(check.id, check.type, false, `Page "${check.page}" has title "${page.title}".`);
      }
      return booleanResult(check.id, check.type, true, `Page "${check.page}" matches.`);
    }
    case 'pageBlockExists': {
      const page = ir.pages.find((entry) => entry.name === check.page);
      if (!page) {
        return missingDependency(check, `Page "${check.page}" is missing.`);
      }
      const block = page.blocks.find((entry) =>
        entry.blockType === check.blockType &&
        entry.title === check.title &&
        (check.data ? entry.data === check.data : true),
      );
      return booleanResult(
        check.id,
        check.type,
        Boolean(block),
        block ? `Block "${check.title}" exists on page "${check.page}".` : `Block "${check.title}" is missing from page "${check.page}".`,
      );
    }
    case 'navItemExists': {
      const group = check.group
        ? ir.navigation.find((entry) => entry.group === check.group)
        : undefined;
      const candidates = group ? group.items : ir.navigation.flatMap((entry) => entry.items);
      const item = candidates.find((entry) =>
        entry.target === check.target &&
        (check.label ? entry.label === check.label : true),
      );
      return booleanResult(
        check.id,
        check.type,
        Boolean(item),
        item ? `Navigation target "${check.target}" exists.` : `Navigation target "${check.target}" is missing.`,
      );
    }
  }
}

function buildSummary(tasks: TaskReport[]): RunSummary {
  const taskCount = tasks.length;
  const attemptedTaskCount = tasks.filter((task) => task.attempts.length > 0).length;
  const solvedTasks = tasks.filter((task) => task.winningAttempt !== null);
  const failedTaskCount = tasks.filter((task) => task.winningAttempt === null).length;
  const firstPassValidCount = tasks.filter((task) => task.firstPassValid).length;
  const totalAttemptCount = tasks.reduce((sum, task) => sum + task.attempts.length, 0);
  const repairValues = solvedTasks
    .map((task) => task.repairsBeforeFirstValid ?? 0);
  const averageRepairsBeforeFirstValid = repairValues.length
    ? repairValues.reduce((sum, value) => sum + value, 0) / repairValues.length
    : 0;

  const tokenUsage = tasks.reduce(
    (summary, task) => {
      for (const attempt of task.attempts) {
        summary.promptTokens += attempt.meta?.promptTokens ?? 0;
        summary.completionTokens += attempt.meta?.completionTokens ?? 0;
        summary.totalTokens += attempt.meta?.totalTokens ?? 0;
      }
      return summary;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );

  const winningAttempts = solvedTasks
    .map((task) => task.attempts.find((attempt) => attempt.attempt === task.winningAttempt))
    .filter((attempt): attempt is AttemptReport => Boolean(attempt && attempt.escapeStats));
  const winningAttemptEscapeUsage = winningAttempts.reduce(
    (summary, attempt) => {
      summary.exprCount += attempt.escapeStats?.exprCount ?? 0;
      summary.fnCount += attempt.escapeStats?.fnCount ?? 0;
      summary.customCount += attempt.escapeStats?.customCount ?? 0;
      summary.averagePercent += attempt.escapeStats?.escapePercent ?? 0;
      return summary;
    },
    { exprCount: 0, fnCount: 0, customCount: 0, averagePercent: 0 },
  );

  if (winningAttempts.length) {
    winningAttemptEscapeUsage.averagePercent /= winningAttempts.length;
  }

  return {
    taskCount,
    attemptedTaskCount,
    solvedTaskCount: solvedTasks.length,
    failedTaskCount,
    firstPassValidCount,
    firstPassValidRate: taskCount ? firstPassValidCount / taskCount : 0,
    solvedRate: taskCount ? solvedTasks.length / taskCount : 0,
    averageRepairsBeforeFirstValid,
    totalAttemptCount,
    tokenUsage,
    winningAttemptEscapeUsage,
  };
}

function writeBenchmarkReport(report: AuthoringBenchmarkReport): void {
  mkdirSync(report.reportDir, { recursive: true });
  writeFileSync(join(report.reportDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(report.reportDir, 'summary.md'), buildSummaryMarkdown(report), 'utf8');

  for (const task of report.tasks) {
    const failuresDir = join(report.reportDir, 'failures', task.taskId);
    mkdirSync(failuresDir, { recursive: true });

    if (!task.attempts.length) {
      const missingPath = join(failuresDir, 'missing.json');
      writeFileSync(
        missingPath,
        JSON.stringify(
          {
            taskId: task.taskId,
            reason: 'No attempts found for task.',
          },
          null,
          2,
        ),
        'utf8',
      );
      task.failureArtifacts.push(relative(report.reportDir, missingPath));
      continue;
    }

    for (const attempt of task.attempts) {
      if (attempt.valid) {
        continue;
      }
      const copiedSource = join(failuresDir, `attempt-${attempt.attempt}${sourceFileSuffix(attempt.sourceFile)}`);
      writeFileSync(copiedSource, readFileSync(attempt.sourceFile, 'utf8'), 'utf8');
      const diagnostics = join(failuresDir, `attempt-${attempt.attempt}.diagnostics.json`);
      writeFileSync(
        diagnostics,
        JSON.stringify(
          {
            taskId: task.taskId,
            attempt: attempt.attempt,
            sourceFile: attempt.sourceFile,
            compileSuccess: attempt.compileSuccess,
            warningCount: attempt.warningCount,
            errors: attempt.errors,
            warnings: attempt.warnings,
            failedChecks: attempt.checks.filter((check) => check.status !== 'passed'),
          },
          null,
          2,
        ),
        'utf8',
      );
      task.failureArtifacts.push(relative(report.reportDir, copiedSource));
      task.failureArtifacts.push(relative(report.reportDir, diagnostics));
    }
  }

  writeFileSync(join(report.reportDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
}

function buildSummaryMarkdown(report: AuthoringBenchmarkReport): string {
  const lines = [
    '# ReactDSL Authoring Benchmark Report',
    '',
    `- Run: ${report.run.runId}`,
    `- Model: ${report.run.model ?? 'unknown'}`,
    `- Lane: ${report.run.lane}`,
    `- Provider: ${report.run.provider ?? 'unknown'}`,
    `- Generated: ${report.generatedAt}`,
    `- Corpus: ${report.corpusDir}`,
    `- Submissions: ${report.submissionsDir}`,
    '',
    '## Summary',
    '',
    `- Tasks: ${report.summary.taskCount}`,
    `- Attempted tasks: ${report.summary.attemptedTaskCount}`,
    `- First-pass validity rate: ${formatRate(report.summary.firstPassValidRate)} (${report.summary.firstPassValidCount}/${report.summary.taskCount})`,
    `- Solved rate: ${formatRate(report.summary.solvedRate)} (${report.summary.solvedTaskCount}/${report.summary.taskCount})`,
    `- Average repairs before first valid: ${report.summary.averageRepairsBeforeFirstValid.toFixed(2)}`,
    `- Total attempts: ${report.summary.totalAttemptCount}`,
    `- Token usage: prompt ${report.summary.tokenUsage.promptTokens}, completion ${report.summary.tokenUsage.completionTokens}, total ${report.summary.tokenUsage.totalTokens}`,
    `- Winning-attempt escape usage: @expr ${report.summary.winningAttemptEscapeUsage.exprCount}, @fn ${report.summary.winningAttemptEscapeUsage.fnCount}, @custom ${report.summary.winningAttemptEscapeUsage.customCount}, avg ${report.summary.winningAttemptEscapeUsage.averagePercent.toFixed(2)}%`,
    '',
    '## Tasks',
    '',
    '| Task | Status | First Pass | Winning Attempt | Repairs | Checks | Warnings |',
    '|------|--------|------------|-----------------|---------|--------|----------|',
  ];

  for (const task of report.tasks) {
    const winningAttempt = task.winningAttempt ?? '-';
    const repairs = task.repairsBeforeFirstValid ?? '-';
    const attempt = task.winningAttempt
      ? task.attempts.find((entry) => entry.attempt === task.winningAttempt)
      : task.attempts[0];
    const passedChecks = attempt ? attempt.checks.filter((check) => check.status === 'passed').length : 0;
    const totalChecks = attempt ? attempt.checks.length : task.expectedCheckCount;
    const warnings = attempt ? attempt.warningCount : '-';
    lines.push(
      `| ${task.taskId} | ${task.status} | ${task.firstPassValid ? 'yes' : 'no'} | ${winningAttempt} | ${repairs} | ${passedChecks}/${totalChecks} | ${warnings} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildPromptDocument(task: AuthoringTask, reference: string): string {
  return [
    `# ReactDSL Benchmark Prompt: ${task.title}`,
    '',
    `Task ID: ${task.id}`,
    `Lane: ${task.lane}`,
    '',
    `Return exactly one valid \`${CANONICAL_RDSL_SOURCE_SUFFIX}\` document and nothing else.`,
    'Do not explain your answer. Do not wrap the output in Markdown fences.',
    '',
    '## Reference',
    '',
    reference,
    '',
    '## Task',
    '',
    task.prompt.trim(),
    '',
  ].join('\n');
}

function compareValue(id: string, type: string, actual: string, expected: string, message: string): BenchmarkCheckResult {
  return {
    id,
    type,
    status: actual === expected ? 'passed' : 'failed',
    message: actual === expected ? message : `Expected "${expected}", received "${actual}".`,
  };
}

function booleanResult(id: string, type: string, passed: boolean, message: string): BenchmarkCheckResult {
  return {
    id,
    type,
    status: passed ? 'passed' : 'failed',
    message,
  };
}

function missingDependency(check: { id: string; type: string }, message: string): BenchmarkCheckResult {
  return {
    id: check.id,
    type: check.type,
    status: 'failed',
    message,
  };
}

function matchesFieldType(field: IRModelField, expectedType: ScalarFieldType | 'enum', enumValues?: string[]): boolean {
  if (expectedType === 'enum') {
    return field.fieldType.type === 'enum' &&
      (enumValues ? JSON.stringify(field.fieldType.values) === JSON.stringify(enumValues) : true);
  }
  return field.fieldType.type === 'scalar' && field.fieldType.name === expectedType;
}

function hasDecorators(decorators: Array<IRFieldDecorator | { name: string }>, expected: string[] | undefined): boolean {
  if (!expected?.length) {
    return true;
  }
  const actualNames = new Set(decorators.map((decorator) => decorator.name));
  return expected.every((name) => actualNames.has(name));
}

function findResource(ir: IRApp, name: string): IRResource | undefined {
  return ir.resources.find((entry) => entry.name === name);
}

function getListView(ir: IRApp, resourceName: string) {
  return findResource(ir, resourceName)?.views.list;
}

function getFormView(ir: IRApp, resourceName: string, viewName: 'edit' | 'create') {
  const resource = findResource(ir, resourceName);
  if (!resource) {
    return undefined;
  }
  return viewName === 'edit' ? resource.views.edit : resource.views.create;
}

function getAnyView(ir: IRApp, resourceName: string, viewName: ViewName) {
  const resource = findResource(ir, resourceName);
  if (!resource) {
    return undefined;
  }
  return resource.views[viewName];
}

function hasView(resource: IRResource, viewName: ViewName): boolean {
  return Boolean(resource.views[viewName]);
}

function actionMatches(action: IRAction, expectedName: string, expectedConfirm?: string): boolean {
  return action.name === expectedName && (expectedConfirm ? action.confirm === expectedConfirm : true);
}

function matchesEffect(
  effect: EffectNode,
  check: Extract<AuthoringExpectationCheck, { type: 'effectExists' }>,
): boolean {
  if (effect.type !== check.effectType) {
    return false;
  }

  switch (effect.type) {
    case 'refresh':
    case 'invalidate':
    case 'redirect':
      return effect.target === check.target;
    case 'toast':
      return check.message === undefined ? true : matchesToastMessage(effect.message, check.message);
    case 'openDialog':
      return effect.dialog === check.dialog;
    case 'emitEvent':
      return effect.event === check.event;
  }
}

function matchesToastMessage(
  actual: Extract<EffectNode, { type: 'toast' }>['message'],
  expected: string | ExpectedToastMessageDescriptor,
): boolean {
  if (typeof expected === 'string') {
    return actual === expected;
  }

  if (typeof actual === 'string') {
    return false;
  }

  return JSON.stringify(normalizeToastDescriptorForCompare(actual)) ===
    JSON.stringify(normalizeToastDescriptorForCompare(expected));
}

function normalizeToastDescriptorForCompare(message: ExpectedToastMessageDescriptor) {
  const values = Object.entries(message.values ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, normalizeToastValueForCompare(value)] as const);

  return {
    key: message.key,
    defaultMessage: message.defaultMessage ?? null,
    values,
  };
}

function normalizeToastValueForCompare(value: ExpectedToastMessageValue) {
  if (typeof value === 'object' && value !== null && 'ref' in value) {
    return { ref: value.ref };
  }
  return value;
}

function serializeRule(rule: RuleValue): string {
  if (rule.source === 'escape-expr') {
    return rule.escape.raw;
  }
  if (rule.source === 'escape-fn') {
    return rule.escape.path;
  }
  return serializeExpr(rule.expr);
}

function serializeExpr(expr: ExprNode): string {
  switch (expr.type) {
    case 'literal':
      return typeof expr.value === 'string' ? JSON.stringify(expr.value) : String(expr.value);
    case 'identifier':
      return expr.path.join('.');
    case 'binary':
      return `${serializeExpr(expr.left)} ${expr.op} ${serializeExpr(expr.right)}`;
    case 'unary':
      return `${expr.op} ${serializeExpr(expr.operand)}`;
    case 'call':
      return `${expr.fn}(${expr.args.map((arg) => serializeExpr(arg)).join(', ')})`;
    case 'member':
      return `${serializeExpr(expr.object)}.${expr.property}`;
    case 'in':
      return `${serializeExpr(expr.value)} in [${expr.list.map((entry) => serializeExpr(entry)).join(', ')}]`;
  }
}

function extractAttemptNumber(entry: string): number {
  const match = entry.match(/^attempt-(\d+)(\.[A-Za-z0-9.-]+)$/);
  if (!match) {
    throw new Error(`Invalid attempt file name: ${entry}`);
  }
  return Number.parseInt(match[1], 10);
}

function sourceFileSuffix(fileName: string): string {
  for (const suffix of BENCHMARK_SOURCE_SUFFIXES) {
    if (fileName.endsWith(suffix)) {
      return suffix;
    }
  }
  return CANONICAL_RDSL_SOURCE_SUFFIX;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exitCode = runCli(process.argv.slice(2));
}
