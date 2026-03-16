#!/usr/bin/env node

import * as nodeFs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANONICAL_SDSL_SOURCE_SUFFIX,
  compileProject,
  describeSdslSourceSuffixes,
  isSdslSourceFile,
  parse,
  stripSdslSourceSuffix,
} from '@loj-lang/sdsl-compiler';
import { formatBackendTargetTriple } from '@loj-lang/sdsl-compiler/targets';
import {
  dirnameProjectPath,
  normalizeProjectPath,
  resolveProjectPath,
} from '@loj-lang/sdsl-compiler/project-paths';
import type { CompileResult } from '@loj-lang/sdsl-compiler';

export interface CliIO {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: Record<string, string | undefined>;
  runtime?: CliRuntime;
  onDevSession?: (session: DevSession) => void;
}

interface ValidateCommandOptions {
  sourceFile: string;
  projectRoot?: string;
  json: boolean;
}

interface BuildCommandOptions {
  sourceFile: string;
  outDir: string;
  projectRoot?: string;
  json: boolean;
}

interface DevCommandOptions {
  sourceFile: string;
  outDir: string;
  projectRoot?: string;
  json: boolean;
}

interface CommandContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  runtime: CliRuntime;
  onDevSession?: (session: DevSession) => void;
}

interface CommandParseError {
  error: string;
}

interface BuildOutput {
  outDir: string;
  files: string[];
}

interface ProjectWatchState {
  projectFiles: string[];
  scanDirectories: string[];
  hostFiles: string[];
}

export interface DevWatcher {
  close(): void;
}

export interface CliRuntime {
  watch(directory: string, listener: (eventType: string, fileName?: string) => void): DevWatcher;
}

export interface DevSession {
  close(): void;
  rebuild(trigger?: 'manual' | 'change'): void;
}

const activeDevSessions = new Set<DevSession>();
const BUILD_METADATA_DIR = '.sdsl';
const BUILD_MANIFEST_FILE = 'build-manifest.json';

function createLegacySdslDeprecationWarning(sourceFile: string): string | null {
  if (!sourceFile.toLowerCase().endsWith('.sdsl')) {
    return null;
  }
  return `Deprecated legacy backend-family suffix "${sourceFile}" detected. Prefer ${CANONICAL_SDSL_SOURCE_SUFFIX} over .sdsl for new and updated sources.`;
}

function emitAdvisoryWarnings(warnings: readonly string[], context: CommandContext, json: boolean): void {
  if (json) {
    return;
  }
  for (const warning of warnings) {
    context.stderr(`Warning: ${warning}\n`);
  }
}

const defaultRuntime: CliRuntime = {
  watch(directory, listener) {
    const watcher = watch(directory, (eventType, fileName) => {
      listener(
        String(eventType),
        typeof fileName === 'string' ? fileName : fileName ? String(fileName) : undefined,
      );
    });
    return {
      close() {
        watcher.close();
      },
    };
  },
};

export function runCli(args: string[], io: CliIO = {}): number {
  const context: CommandContext = {
    cwd: io.cwd ?? process.cwd(),
    stdout: io.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: io.stderr ?? ((text: string) => process.stderr.write(text)),
    env: io.env ?? {},
    runtime: io.runtime ?? defaultRuntime,
    onDevSession: io.onDevSession,
  };

  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    writeUsage(context.stdout);
    return 0;
  }

  const [command, ...rest] = args;
  switch (command) {
    case 'validate':
      return handleValidate(parseValidateArgs(rest), context);
    case 'build':
      return handleBuild(parseBuildArgs(rest), context);
    case 'dev':
      return handleDev(parseDevArgs(rest), context);
    default:
      context.stderr(`Unknown command: ${command}\n`);
      writeUsage(context.stderr);
      return 1;
  }
}

function handleValidate(
  options: ValidateCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = tryCompileFromFile(options.sourceFile, context.cwd, options.projectRoot, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }

  if (!loaded.result.success) {
    writeCompileFailure(loaded.result, context.stderr, context.stdout, options.json);
    return 1;
  }

  const advisoryWarnings = [createLegacySdslDeprecationWarning(options.sourceFile)]
    .filter((warning): warning is string => warning !== null);

  const payload = {
    success: true,
    entryFile: options.sourceFile,
    target: formatBackendTargetTriple(loaded.result.ir!.compiler),
    sourceFiles: loaded.result.sourceFiles,
    moduleGraph: loaded.result.moduleGraph,
    generatedFiles: loaded.result.files.length,
    warnings: loaded.result.warnings,
    advisoryWarnings,
    escapeStats: loaded.result.ir!.escapeStats ?? null,
  };

  if (options.json) {
    context.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  emitAdvisoryWarnings(advisoryWarnings, context, options.json);
  context.stdout(`Validation passed: ${options.sourceFile}\n`);
  context.stdout(`target: ${formatBackendTargetTriple(loaded.result.ir!.compiler)}\n`);
  context.stdout(`source files: ${payload.sourceFiles.length}\n`);
  context.stdout(`generated files: ${payload.generatedFiles}\n`);
  context.stdout(`warnings: ${payload.warnings.length}\n`);
  if (payload.escapeStats) {
    context.stdout(`escape percent: ${payload.escapeStats.escapePercent}%\n`);
  }
  return 0;
}

function handleBuild(
  options: BuildCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = tryCompileFromFile(options.sourceFile, context.cwd, options.projectRoot, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }

  if (!loaded.result.success) {
    writeCompileFailure(loaded.result, context.stderr, context.stdout, options.json);
    return 1;
  }

  const advisoryWarnings = [createLegacySdslDeprecationWarning(options.sourceFile)]
    .filter((warning): warning is string => warning !== null);

  const output = emitBuild(loaded.result, options.outDir, context.cwd);
  if (options.json) {
    context.stdout(`${JSON.stringify({
      success: true,
      entryFile: options.sourceFile,
      target: formatBackendTargetTriple(loaded.result.ir!.compiler),
      sourceFiles: loaded.result.sourceFiles,
      moduleGraph: loaded.result.moduleGraph,
      warnings: loaded.result.warnings,
      advisoryWarnings,
      outDir: output.outDir,
      files: output.files,
    }, null, 2)}\n`);
    return 0;
  }

  emitAdvisoryWarnings(advisoryWarnings, context, options.json);
  context.stdout(`Built SDSL project: ${options.sourceFile}\n`);
  context.stdout(`target: ${formatBackendTargetTriple(loaded.result.ir!.compiler)}\n`);
  context.stdout(`out dir: ${output.outDir}\n`);
  context.stdout(`source files: ${loaded.result.sourceFiles.length}\n`);
  context.stdout(`generated files: ${output.files.length}\n`);
  return 0;
}

function handleDev(
  options: DevCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const session = startDevSession(options, context);
  emitAdvisoryWarnings(
    [createLegacySdslDeprecationWarning(options.sourceFile)].filter((warning): warning is string => warning !== null),
    context,
    options.json,
  );
  activeDevSessions.add(session);
  context.onDevSession?.(session);
  return 0;
}

function parseValidateArgs(args: string[]): ValidateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: sdsl validate <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> [--project-root <dir>] [--json]` };
  }
  const json = args.includes('--json');
  const sourceFile = args.find((arg) => !arg.startsWith('--'));
  if (!sourceFile) {
    return { error: 'Missing source file for sdsl validate.' };
  }
  return { sourceFile, projectRoot: readOptionalFlag(args, '--project-root'), json };
}

function parseBuildArgs(args: string[]): BuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: sdsl build <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> --out-dir <dir> [--project-root <dir>] [--json]` };
  }

  let sourceFile: string | undefined;
  let outDir: string | undefined;
  let projectRoot: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--project-root') {
      projectRoot = args[index + 1];
      index += 1;
      continue;
    }
    if (!arg.startsWith('--') && !sourceFile) {
      sourceFile = arg;
      continue;
    }
  }

  if (!sourceFile) {
    return { error: 'Missing source file for sdsl build.' };
  }
  if (!outDir) {
    return { error: 'Missing required --out-dir for sdsl build.' };
  }

  return { sourceFile, outDir, projectRoot, json };
}

function parseDevArgs(args: string[]): DevCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: sdsl dev <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> [--out-dir <dir>] [--project-root <dir>] [--json]` };
  }

  const sourceFile = args.find((arg) => !arg.startsWith('--'));
  if (!sourceFile) {
    return { error: 'Missing source file for sdsl dev.' };
  }

  const outDirIndex = args.indexOf('--out-dir');
  const outDir = outDirIndex >= 0 ? args[outDirIndex + 1] : undefined;
  if (outDirIndex >= 0 && !outDir) {
    return { error: 'Missing value for --out-dir' };
  }
  const projectRootIndex = args.indexOf('--project-root');
  const projectRoot = projectRootIndex >= 0 ? args[projectRootIndex + 1] : undefined;
  if (projectRootIndex >= 0 && !projectRoot) {
    return { error: 'Missing value for --project-root' };
  }

  return {
    sourceFile,
    outDir: outDir ?? defaultDevOutDir(sourceFile),
    projectRoot,
    json: args.includes('--json'),
  };
}

function readOptionalFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function tryCompileFromFile(
  sourceFile: string,
  cwd: string,
  projectRoot?: string,
  env: Record<string, string | undefined> = {},
): { result: CompileResult } | { error: string } {
  try {
    return {
      result: withEnvOverrides(env, () => compileProject({
        entryFile: normalizePath(sourceFile),
        projectRoot: projectRoot ? normalizePath(projectRoot) : undefined,
        readFile(fileName: string) {
          return readFileSync(resolve(cwd, fileName), 'utf8');
        },
        listFiles(directory: string) {
          const absoluteDirectory = resolve(cwd, directory);
          return readdirSync(absoluteDirectory)
            .map((entry: string) => normalizePath(directory === '.' ? entry : `${directory}/${entry}`));
        },
      })),
    };
  } catch (error) {
    return {
      error: `Failed to read ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function emitBuild(result: CompileResult, outDir: string, cwd: string): BuildOutput {
  const absoluteOutDir = resolve(cwd, outDir);
  const nextFiles = result.files.map((file) => normalizePath(file.path));
  pruneStaleBuildFiles(
    absoluteOutDir,
    [
      ...listManagedOutputFiles(absoluteOutDir, BUILD_METADATA_DIR),
      ...loadPreviousBuildFiles(absoluteOutDir),
    ],
    new Set(nextFiles),
  );
  const writtenFiles: string[] = [];

  for (const file of result.files) {
    const absolutePath = resolve(absoluteOutDir, file.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.content, 'utf8');
    writtenFiles.push(normalizePath(file.path));
  }

  const metadataDir = resolve(absoluteOutDir, BUILD_METADATA_DIR);
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(
    resolve(metadataDir, BUILD_MANIFEST_FILE),
    `${JSON.stringify({ files: nextFiles }, null, 2)}\n`,
    'utf8',
  );

  return {
    outDir,
    files: writtenFiles,
  };
}

function loadPreviousBuildFiles(absoluteOutDir: string): string[] {
  const manifestPath = resolve(absoluteOutDir, BUILD_METADATA_DIR, BUILD_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return [];
  }
  try {
    const payload = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: unknown };
    if (!Array.isArray(payload.files)) {
      return [];
    }
    return payload.files
      .filter((file): file is string => typeof file === 'string' && file.length > 0)
      .map(normalizePath);
  } catch {
    return [];
  }
}

function pruneStaleBuildFiles(absoluteOutDir: string, previousFiles: string[], nextFiles: Set<string>): void {
  for (const filePath of previousFiles) {
    if (nextFiles.has(filePath)) {
      continue;
    }
    rmSync(resolve(absoluteOutDir, filePath), { force: true });
  }
}

function listManagedOutputFiles(absoluteOutDir: string, metadataDir: string): string[] {
  if (!existsSync(absoluteOutDir)) {
    return [];
  }
  return walkOutputFiles(absoluteOutDir, '', metadataDir);
}

function walkOutputFiles(absoluteOutDir: string, currentDir: string, metadataDir: string): string[] {
  const absoluteDir = currentDir.length > 0 ? resolve(absoluteOutDir, currentDir) : absoluteOutDir;
  let entries: string[];
  try {
    entries = readdirSync(absoluteDir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizePath(currentDir.length > 0 ? `${currentDir}/${entry}` : entry);
    if (relativePath === metadataDir || relativePath.startsWith(`${metadataDir}/`)) {
      continue;
    }
    const absolutePath = resolve(absoluteOutDir, relativePath);
    try {
      readdirSync(absolutePath);
      files.push(...walkOutputFiles(absoluteOutDir, relativePath, metadataDir));
    } catch {
      files.push(relativePath);
    }
  }
  return files;
}

function startDevSession(options: DevCommandOptions, context: CommandContext): DevSession {
  let closed = false;
  let lastChangeAt = 0;
  let lastProjectFiles = [normalizePath(options.sourceFile)];
  let lastScanDirectories: string[] = [];
  let lastHostFiles: string[] = [];
  const watchedFilesByDirectory = new Map<string, { fileNames: Set<string>; watchAllSdsl: boolean }>();
  const watchers = new Map<string, DevWatcher>();

  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'ready',
      sourceFile: options.sourceFile,
      outDir: options.outDir,
    })}\n`);
  } else {
    context.stdout(`Dev mode: watching ${options.sourceFile}\n`);
    context.stdout(`out dir: ${options.outDir}\n`);
  }

  const syncWatchers = (watchState: ProjectWatchState) => {
    const nextWatchedFilesByDirectory = new Map<string, { fileNames: Set<string>; watchAllSdsl: boolean }>();

    for (const projectFile of watchState.projectFiles) {
      const absoluteFile = resolve(context.cwd, projectFile);
      const directory = dirname(absoluteFile);
      const fileName = basename(absoluteFile);
      const directoryState = nextWatchedFilesByDirectory.get(directory);
      if (directoryState) {
        directoryState.fileNames.add(fileName);
      } else {
        nextWatchedFilesByDirectory.set(directory, {
          fileNames: new Set([fileName]),
          watchAllSdsl: false,
        });
      }
    }

    for (const hostFile of watchState.hostFiles) {
      const absoluteFile = resolve(context.cwd, hostFile);
      const directory = dirname(absoluteFile);
      const fileName = basename(absoluteFile);
      const directoryState = nextWatchedFilesByDirectory.get(directory);
      if (directoryState) {
        directoryState.fileNames.add(fileName);
      } else {
        nextWatchedFilesByDirectory.set(directory, {
          fileNames: new Set([fileName]),
          watchAllSdsl: false,
        });
      }
    }

    for (const scanDirectory of watchState.scanDirectories) {
      const absoluteDirectory = resolve(context.cwd, scanDirectory);
      const directoryState = nextWatchedFilesByDirectory.get(absoluteDirectory);
      if (directoryState) {
        directoryState.watchAllSdsl = true;
      } else {
        nextWatchedFilesByDirectory.set(absoluteDirectory, {
          fileNames: new Set<string>(),
          watchAllSdsl: true,
        });
      }
    }

    for (const [directory, watcher] of watchers) {
      if (!nextWatchedFilesByDirectory.has(directory)) {
        watcher.close();
        watchers.delete(directory);
        watchedFilesByDirectory.delete(directory);
      }
    }

    for (const [directory, directoryState] of nextWatchedFilesByDirectory) {
      watchedFilesByDirectory.set(directory, directoryState);
      if (watchers.has(directory)) {
        continue;
      }

      watchers.set(directory, context.runtime.watch(directory, (_eventType, fileName) => {
        if (closed) {
          return;
        }
        if (fileName) {
          const watchDirectoryState = watchedFilesByDirectory.get(directory);
          const watchedExplicitly = watchDirectoryState?.fileNames.has(fileName) ?? false;
          const watchedByDirectoryScan = (watchDirectoryState?.watchAllSdsl ?? false) && isSdslSourceFile(fileName);
          if (!watchedExplicitly && !watchedByDirectoryScan) {
            return;
          }
        }

        const now = Date.now();
        if (now - lastChangeAt < 40) {
          return;
        }
        lastChangeAt = now;

        const changedPath = fileName ? normalizePath(resolve(directory, fileName)) : options.sourceFile;

        if (options.json) {
          context.stdout(`${JSON.stringify({
            event: 'change',
            sourceFile: fileName ?? options.sourceFile,
          })}\n`);
        } else {
          context.stdout(`Change detected: ${fileName ?? options.sourceFile}\n`);
        }

        runBuild('change', changedPath);
      }));
    }
  };

  const runBuild = (
    trigger: 'initial' | 'change' | 'manual',
    changedFile?: string,
  ) => {
    const loaded = tryCompileFromFile(options.sourceFile, context.cwd, options.projectRoot, context.env);
    if ('error' in loaded) {
      writeDevReadFailure(options, trigger, loaded.error, context);
      return;
    }

    const compileResult = loaded.result;
    const watchState = collectProjectWatchState(
      compileResult.sourceFiles,
      compileResult.hostFiles,
      context.cwd,
      lastProjectFiles,
      lastScanDirectories,
      lastHostFiles,
    );
    lastProjectFiles = watchState.projectFiles;
    lastScanDirectories = watchState.scanDirectories;
    lastHostFiles = watchState.hostFiles;
    syncWatchers(watchState);

    if (!compileResult.success) {
      writeDevCompileFailure(options, trigger, compileResult, context);
      return;
    }

    try {
      const output = emitBuild(compileResult, options.outDir, context.cwd);
      writeDevBuildSuccess(options, trigger, compileResult, output, context);
    } catch (error) {
      writeDevReadFailure(
        options,
        trigger,
        `Build output failed: ${error instanceof Error ? error.message : String(error)}`,
        context,
      );
    }
  };

  syncWatchers({
    projectFiles: [options.sourceFile],
    scanDirectories: [],
    hostFiles: [],
  });
  runBuild('initial');

  const session: DevSession = {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      watchedFilesByDirectory.clear();
      activeDevSessions.delete(session);
      if (options.json) {
        context.stdout(`${JSON.stringify({
          event: 'stopped',
          sourceFile: options.sourceFile,
        })}\n`);
      } else {
        context.stdout(`Dev mode stopped: ${options.sourceFile}\n`);
      }
    },
    rebuild(trigger: 'manual' | 'change' = 'manual') {
      if (closed) {
        return;
      }
      runBuild(trigger);
    },
  };

  return session;
}

function collectProjectWatchState(
  sourceFiles: string[],
  hostFiles: string[],
  cwd: string,
  previousProjectFiles: string[] = [],
  previousScanDirectories: string[] = [],
  previousHostFiles: string[] = [],
): ProjectWatchState {
  const projectFiles = sourceFiles.length > 0 ? [...new Set(sourceFiles.map(normalizePath))] : [...previousProjectFiles];
  const scanDirectories = new Set(previousScanDirectories.map(normalizePath));
  const resolvedHostFiles = hostFiles.length > 0 ? [...new Set(hostFiles.map(normalizePath))] : [...previousHostFiles];

  for (const sourceFile of projectFiles) {
    try {
      const source = readFileSync(resolve(cwd, sourceFile), 'utf8');
      const parsed = parse(source, sourceFile);
      if (parsed.errors.length > 0) {
        continue;
      }
      for (const importPath of parsed.ast.imports) {
        if (!importPath.endsWith('/')) {
          continue;
        }
        scanDirectories.add(resolveProjectPath(dirnameProjectPath(sourceFile), importPath));
      }
    } catch {
      // Keep the last known watch graph when a file is temporarily unreadable.
    }
  }

  return {
    projectFiles,
    scanDirectories: [...scanDirectories].sort((left, right) => left.localeCompare(right)),
    hostFiles: resolvedHostFiles.sort((left, right) => left.localeCompare(right)),
  };
}

function writeCompileFailure(
  result: CompileResult,
  stderr: (text: string) => void,
  stdout: (text: string) => void,
  json: boolean,
): void {
  if (json) {
    stdout(`${JSON.stringify({
      success: false,
      errors: result.errors,
      warnings: result.warnings,
      sourceFiles: result.sourceFiles,
      moduleGraph: result.moduleGraph,
    }, null, 2)}\n`);
    return;
  }

  stderr('SDSL compile failed.\n');
  for (const error of result.errors) {
    const location = error.file ? `${error.file}${error.line ? `:${error.line}${error.col ? `:${error.col}` : ''}` : ''}` : undefined;
    stderr(`- [${error.phase}] ${location ? `${location} ` : ''}${error.message}\n`);
  }
  for (const warning of result.warnings) {
    stderr(`- [warning] ${warning.message}\n`);
  }
}

function writeFailure(
  message: string,
  stderr: (text: string) => void,
  json: boolean,
  stdout?: (text: string) => void,
): void {
  if (json && stdout) {
    stdout(`${JSON.stringify({ success: false, error: message }, null, 2)}\n`);
    return;
  }
  stderr(`${message}\n`);
}

function writeDevBuildSuccess(
  options: DevCommandOptions,
  trigger: 'initial' | 'change' | 'manual',
  result: CompileResult,
  output: BuildOutput,
  context: CommandContext,
): void {
  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'build',
      status: 'success',
      trigger,
      target: formatBackendTargetTriple(result.ir!.compiler),
      sourceFile: options.sourceFile,
      outDir: output.outDir,
      files: output.files,
      warnings: result.warnings,
    })}\n`);
    return;
  }

  context.stdout(`Dev build complete (${trigger}): ${options.sourceFile}\n`);
  context.stdout(`files written: ${output.files.length}\n`);
  if (result.warnings.length > 0) {
    context.stdout(`warnings: ${result.warnings.length}\n`);
  }
}

function writeDevCompileFailure(
  options: DevCommandOptions,
  trigger: 'initial' | 'change' | 'manual',
  result: CompileResult,
  context: CommandContext,
): void {
  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'build',
      status: 'failure',
      trigger,
      sourceFile: options.sourceFile,
      errors: result.errors,
      warnings: result.warnings,
    })}\n`);
    return;
  }

  context.stderr(`Dev build failed (${trigger}): ${options.sourceFile}\n`);
  for (const error of result.errors) {
    const location = error.file ? `${error.file}${error.line ? `:${error.line}${error.col ? `:${error.col}` : ''}` : ''}` : undefined;
    context.stderr(`- [${error.phase}] ${location ? `${location} ` : ''}${error.message}\n`);
  }
}

function writeDevReadFailure(
  options: DevCommandOptions,
  trigger: 'initial' | 'change' | 'manual',
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'build',
      status: 'failure',
      trigger,
      sourceFile: options.sourceFile,
      error: message,
    })}\n`);
    return;
  }

  context.stderr(`Dev build failed (${trigger}): ${options.sourceFile}\n`);
  context.stderr(`${message}\n`);
}

function defaultDevOutDir(sourceFile: string): string {
  const normalized = stripSdslSourceSuffix(normalizeProjectPath(sourceFile))
    .replace(/^\.\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `.sdsl-dev/${normalized || 'app'}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function withEnvOverrides<T>(
  env: Record<string, string | undefined>,
  run: () => T,
): T {
  const changedKeys: string[] = [];
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || process.env[key] !== undefined) {
      continue;
    }
    changedKeys.push(key);
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const key of changedKeys) {
      const previous = previousValues.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

function writeUsage(write: (text: string) => void): void {
  write('Usage:\n');
  write(`  sdsl validate <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> [--project-root <dir>] [--json]\n`);
  write(`  sdsl build <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> --out-dir <dir> [--project-root <dir>] [--json]\n`);
  write(`  sdsl dev <source${CANONICAL_SDSL_SOURCE_SUFFIX}|source.sdsl> [--out-dir <dir>] [--project-root <dir>] [--json]\n`);
}

function realpathCompat(path: string): string {
  return (nodeFs as typeof nodeFs & { realpathSync(path: string): string }).realpathSync(path);
}

const currentModulePath = decodeURIComponent(new URL(import.meta.url).pathname);
const invokedCliPath = process.argv[1];
let isDirectCliEntry = false;
if (invokedCliPath) {
  try {
    isDirectCliEntry = realpathCompat(invokedCliPath) === realpathCompat(currentModulePath);
  } catch {
    isDirectCliEntry = import.meta.url === pathToFileURL(invokedCliPath).href;
  }
}
if (isDirectCliEntry) {
  process.exitCode = runCli(process.argv.slice(2));
}
