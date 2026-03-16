#!/usr/bin/env node

import * as nodeFs from 'node:fs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  collectHostFiles,
  compileProject,
  CANONICAL_RDSL_SOURCE_SUFFIX,
  createProjectCache,
  describeRdslSourceSuffixes,
  findTraceNode,
  invalidateProjectCache,
  isRdslSourceFile,
  inspectSemanticNode,
  listMaterializedHostFiles,
  listManifestHostFilesForNode,
  listTraceRegionsForNode,
  resolveTraceLocation,
  restoreProjectCache,
  semanticNodeInspectionToLines,
  serializeProjectCache,
  stripRdslSourceSuffix,
} from '@loj-lang/rdsl-compiler';
import { createReactDslViteHostTemplate } from '@loj-lang/rdsl-host-react/template';
import type {
  CompileError,
  CompileResult,
  ProjectCache,
  ProjectGraphSnapshot,
  ProjectCacheSnapshot,
  SemanticManifest,
  TraceLocationMatch,
  TraceLookupResult,
  TraceManifest,
  TraceNodeEntry,
  HostFileEntry,
} from '@loj-lang/rdsl-compiler';
import type { CreateReactDslViteHostTemplateOptions, ReactDslHostTemplateFile } from '@loj-lang/rdsl-host-react/template';

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

interface InspectCommandOptions {
  sourceFile: string;
  nodeId?: string;
  json: boolean;
}

interface TraceCommandOptions {
  sourceFile: string;
  generatedLocation: string;
  json: boolean;
}

interface HostTemplateCommandOptions {
  mode: 'export-react' | 'sync-react';
  outDir: string;
  json: boolean;
  force: boolean;
  templateOptions: CreateReactDslViteHostTemplateOptions;
}

interface CommandParseError {
  error: string;
}

interface CommandContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  runtime: CliRuntime;
  onDevSession?: (session: DevSession) => void;
}

interface BuildOutput {
  outDir: string;
  files: string[];
  semanticManifest: string;
  traceManifest: string;
  projectCache?: string;
}

interface HostTemplateOutput {
  outDir: string;
  templatePath: string;
  writtenFiles: string[];
  overwrittenFiles: string[];
  preservedStarterFiles: string[];
}

interface ProjectWatchState {
  projectFiles: string[];
  scanDirectories: string[];
}

interface LoadedArtifacts {
  sourceKind: 'source' | 'build';
  semanticManifest: SemanticManifest;
  traceManifest: TraceManifest;
  compileResult?: CompileResult;
}

type CliJsonArtifact =
  | 'rdsl.validate.result'
  | 'rdsl.build.result'
  | 'rdsl.inspect.result'
  | 'rdsl.trace.result'
  | 'rdsl.host.result'
  | 'rdsl.dev.event';

const CLI_JSON_SCHEMA_VERSION = '0.1.0';

type LoadArtifactsResult =
  | { artifacts: LoadedArtifacts }
  | { compileFailure: CompileResult }
  | { error: string };

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
const BUILD_MANIFEST_FILE = 'build-manifest.json';

function createLegacyRdslDeprecationWarning(sourceFile: string): string | null {
  if (!sourceFile.toLowerCase().endsWith('.rdsl')) {
    return null;
  }
  return `Deprecated legacy frontend-family suffix "${sourceFile}" detected. Prefer ${CANONICAL_RDSL_SOURCE_SUFFIX} over .rdsl for new and updated sources.`;
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
    case 'inspect':
      return handleInspect(parseInspectArgs(rest), context);
    case 'trace':
      return handleTrace(parseTraceArgs(rest), context);
    case 'host':
      return handleHost(rest, context);
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

  const loaded = tryCompileFromFile(options.sourceFile, context.cwd, undefined, undefined, options.projectRoot, context.env);
  if ('error' in loaded) {
    writeFailure('rdsl.validate.result', loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }

  const compileResult = loaded.result;
  if (!compileResult.success) {
    writeCompileFailure('rdsl.validate.result', compileResult, context.stderr, context.stdout, options.json);
    return 1;
  }

  const advisoryWarnings = [createLegacyRdslDeprecationWarning(options.sourceFile)]
    .filter((warning): warning is string => warning !== null);

  const payload = {
    success: true,
    entryFile: options.sourceFile,
    sourceFiles: compileResult.semanticManifest?.sourceFiles ?? [options.sourceFile],
    warnings: compileResult.warnings,
    advisoryWarnings,
    generatedFiles: compileResult.files.length,
    traceNodes: compileResult.traceManifest?.nodes.length ?? 0,
    traceRegions: compileResult.traceManifest?.regions.length ?? 0,
    escapeStats: compileResult.ir?.escapeStats ?? null,
  };

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.validate.result', payload);
    return 0;
  }

  emitAdvisoryWarnings(advisoryWarnings, context, options.json);
  context.stdout(`Validation passed: ${options.sourceFile}\n`);
  context.stdout(`source files: ${payload.sourceFiles.length}\n`);
  context.stdout(`generated files: ${payload.generatedFiles}\n`);
  context.stdout(`warnings: ${payload.warnings.length}\n`);
  context.stdout(`trace nodes: ${payload.traceNodes}\n`);
  context.stdout(`trace regions: ${payload.traceRegions}\n`);
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

  const projectCache = loadPersistentProjectCache(options.outDir, context.cwd) ?? createProjectCache();
  const loaded = tryCompileFromFile(options.sourceFile, context.cwd, projectCache, undefined, options.projectRoot, context.env);
  if ('error' in loaded) {
    writeFailure('rdsl.build.result', loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }

  const compileResult = loaded.result;
  if (!compileResult.success) {
    writeCompileFailure('rdsl.build.result', compileResult, context.stderr, context.stdout, options.json);
    return 1;
  }

  const advisoryWarnings = [createLegacyRdslDeprecationWarning(options.sourceFile)]
    .filter((warning): warning is string => warning !== null);

  let output: BuildOutput;
  try {
    output = emitBuildArtifacts(compileResult, options.outDir, context.cwd, projectCache);
  } catch (error) {
    writeFailure(
      'rdsl.build.result',
      `Build output failed: ${error instanceof Error ? error.message : String(error)}`,
      context.stderr,
      options.json,
      context.stdout,
    );
    return 1;
  }

  const payload = {
    success: true,
    entryFile: options.sourceFile,
    outDir: output.outDir,
    files: output.files,
    semanticManifest: output.semanticManifest,
    traceManifest: output.traceManifest,
    projectCache: output.projectCache,
    warnings: compileResult.warnings,
    advisoryWarnings,
  };

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.build.result', payload);
    return 0;
  }

  emitAdvisoryWarnings(advisoryWarnings, context, options.json);
  context.stdout(`Build complete: ${options.sourceFile}\n`);
  context.stdout(`out dir: ${output.outDir}\n`);
  context.stdout(`files written: ${output.files.length}\n`);
  context.stdout(`semantic manifest: ${output.semanticManifest}\n`);
  context.stdout(`trace manifest: ${output.traceManifest}\n`);
  if (output.projectCache) {
    context.stdout(`project cache: ${output.projectCache}\n`);
  }
  if (advisoryWarnings.length > 0) {
    context.stdout(`warnings: ${advisoryWarnings.length}\n`);
  }
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

  emitAdvisoryWarnings(
    [createLegacyRdslDeprecationWarning(options.sourceFile)].filter((warning): warning is string => warning !== null),
    context,
    options.json,
  );
  const session = startDevSession(options, context);
  activeDevSessions.add(session);
  context.onDevSession?.(session);
  return 0;
}

function handleInspect(
  options: InspectCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = tryLoadArtifacts(options.sourceFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure('rdsl.inspect.result', loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }
  if ('compileFailure' in loaded) {
    writeCompileFailure('rdsl.inspect.result', loaded.compileFailure, context.stderr, context.stdout, options.json);
    return 1;
  }

  const { semanticManifest, traceManifest } = loaded.artifacts;

  if (!options.nodeId) {
    const summary = {
      success: true,
      mode: 'summary',
      entryFile: semanticManifest.entryFile,
      sourceFiles: semanticManifest.sourceFiles.length,
      hostFiles: semanticManifest.hostFiles?.length ?? 0,
      appName: semanticManifest.ir.name,
      target: semanticManifest.ir.compiler.target,
      language: semanticManifest.ir.compiler.language,
      profile: semanticManifest.ir.compiler.profile ?? null,
      generatedFiles: traceManifest.generatedFiles.length,
      nodes: traceManifest.nodes.length,
      regions: traceManifest.regions.length,
      sourceKind: loaded.artifacts.sourceKind,
    };

    if (options.json) {
      writeJsonArtifact(context.stdout, 'rdsl.inspect.result', summary);
      return 0;
    }

    context.stdout(`entry: ${summary.entryFile}\n`);
    context.stdout(`source files: ${summary.sourceFiles}\n`);
    context.stdout(`host files: ${summary.hostFiles}\n`);
    context.stdout(`app: ${summary.appName}\n`);
    context.stdout(`target: ${summary.target}\n`);
    context.stdout(`language: ${summary.language}\n`);
    if (summary.profile) {
      context.stdout(`profile: ${summary.profile}\n`);
    }
    context.stdout(`generated files: ${summary.generatedFiles}\n`);
    context.stdout(`trace nodes: ${summary.nodes}\n`);
    context.stdout(`trace regions: ${summary.regions}\n`);
    context.stdout(`source kind: ${summary.sourceKind}\n`);
    return 0;
  }

  const node = findTraceNode(traceManifest, options.nodeId);
  if (!node) {
    writeFailure('rdsl.inspect.result', `Node not found: ${options.nodeId}`, context.stderr, options.json, context.stdout);
    return 1;
  }

  const regions = listTraceRegionsForNode(traceManifest, options.nodeId);
  const hostFiles = listManifestHostFilesForNode(semanticManifest, options.nodeId);
  const semantic = inspectSemanticNode(semanticManifest.ir, options.nodeId);
  const payload = {
    success: true,
    mode: 'node',
    sourceKind: loaded.artifacts.sourceKind,
    entryFile: semanticManifest.entryFile,
    node,
    semantic,
    regions,
    hostFiles,
  };

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.inspect.result', payload);
    return 0;
  }

  context.stdout(`node: ${node.id}\n`);
  context.stdout(`kind: ${node.kind}\n`);
  context.stdout(`parent: ${node.parentId ?? '-'}\n`);
  context.stdout(`source: ${formatSourceSpan(node.sourceSpan)}\n`);
  if (semantic) {
    context.stdout(`details:\n`);
    for (const line of semanticNodeInspectionToLines(semantic)) {
      context.stdout(`- ${line}\n`);
    }
  }
  context.stdout(`host files:\n`);
  if (hostFiles.length === 0) {
    context.stdout(`- none\n`);
  } else {
    for (const hostFile of hostFiles) {
      const dependencySummary = (hostFile.dependencies ?? [])
        .map((dependency) => `${dependency.path} [${dependency.kind}]`)
        .join(', ');
      context.stdout(`- ${hostFile.path} (${hostFile.references.map((reference) => reference.role).join(', ')})`);
      if (dependencySummary) {
        context.stdout(` -> ${dependencySummary}`);
      }
      context.stdout(`\n`);
    }
  }
  context.stdout(`regions:\n`);
  for (const region of regions) {
    context.stdout(`- ${region.generatedFile}:${region.range.startLine}:${region.range.startCol}-${region.range.endLine}:${region.range.endCol} (${region.role})\n`);
  }
  return 0;
}

function handleTrace(
  options: TraceCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = tryLoadArtifacts(options.sourceFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure('rdsl.trace.result', loaded.error, context.stderr, options.json, context.stdout);
    return 1;
  }
  if ('compileFailure' in loaded) {
    writeCompileFailure('rdsl.trace.result', loaded.compileFailure, context.stderr, context.stdout, options.json);
    return 1;
  }

  const { traceManifest } = loaded.artifacts;

  const parsedLocation = parseGeneratedLocation(options.generatedLocation);
  if ('error' in parsedLocation) {
    writeFailure('rdsl.trace.result', parsedLocation.error, context.stderr, options.json, context.stdout);
    return 1;
  }

  const lookup = resolveTraceLocation(
    traceManifest,
    parsedLocation.generatedFile,
    parsedLocation.line,
    parsedLocation.col,
  );

  if (!lookup) {
    writeFailure('rdsl.trace.result', `No trace match for ${options.generatedLocation}`, context.stderr, options.json, context.stdout);
    return 1;
  }

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.trace.result', {
      success: lookup.kind !== 'ambiguous',
      sourceKind: loaded.artifacts.sourceKind,
      generatedLocation: options.generatedLocation,
      ...serializeLookup(lookup),
    });
    return lookup.kind === 'ambiguous' ? 1 : 0;
  }

  if (lookup.kind === 'ambiguous') {
    context.stderr(`Ambiguous trace for ${options.generatedLocation}\n`);
    for (const match of lookup.matches) {
      printTraceMatch(match, context.stderr);
    }
    return 1;
  }

  printTraceMatch(lookup.matches[0], context.stdout);
  return 0;
}

function handleHost(args: string[], context: CommandContext): number {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'export-react':
      return handleHostTemplate(parseHostTemplateArgs('export-react', rest), context);
    case 'sync-react':
      return handleHostTemplate(parseHostTemplateArgs('sync-react', rest), context);
    default:
      context.stderr('Usage: rdsl host <export-react|sync-react> <out-dir> [options]\n');
      return 1;
  }
}

function handleHostTemplate(
  options: HostTemplateCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const template = createReactDslViteHostTemplate(options.templateOptions);
  let output: HostTemplateOutput;
  try {
    output = emitHostTemplate(template.files, options.outDir, context.cwd, options.mode, options.force);
  } catch (error) {
    writeFailure(
      'rdsl.host.result',
      `Host template ${options.mode} failed: ${error instanceof Error ? error.message : String(error)}`,
      context.stderr,
      options.json,
      context.stdout,
    );
    return 1;
  }

  const payload = {
    success: true,
    mode: options.mode,
    outDir: output.outDir,
    templatePath: output.templatePath,
    writtenFiles: output.writtenFiles,
    overwrittenFiles: output.overwrittenFiles,
    preservedStarterFiles: output.preservedStarterFiles,
  };

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.host.result', payload);
    return 0;
  }

  context.stdout(`Host template ${options.mode}: ${output.outDir}\n`);
  context.stdout(`template metadata: ${output.templatePath}\n`);
  context.stdout(`files written: ${output.writtenFiles.length}\n`);
  context.stdout(`files overwritten: ${output.overwrittenFiles.length}\n`);
  context.stdout(`starter files preserved: ${output.preservedStarterFiles.length}\n`);
  return 0;
}

function parseValidateArgs(args: string[]): ValidateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: rdsl validate <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> [--project-root <dir>] [--json]` };
  }

  return {
    sourceFile: args[0],
    projectRoot: readOptionalFlag(args, '--project-root'),
    json: args.includes('--json'),
  };
}

function parseBuildArgs(args: string[]): BuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: rdsl build <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> --out-dir <dir> [--project-root <dir>] [--json]` };
  }

  const outDirIndex = args.indexOf('--out-dir');
  const outDir = outDirIndex >= 0 ? args[outDirIndex + 1] : undefined;
  if (!outDir) {
    return { error: 'Missing required --out-dir <dir>' };
  }

  return {
    sourceFile: args[0],
    outDir,
    projectRoot: readOptionalFlag(args, '--project-root'),
    json: args.includes('--json'),
  };
}

function parseDevArgs(args: string[]): DevCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: rdsl dev <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> [--out-dir <dir>] [--project-root <dir>] [--json]` };
  }

  const outDirIndex = args.indexOf('--out-dir');
  const outDir = outDirIndex >= 0 ? args[outDirIndex + 1] : undefined;
  if (outDirIndex >= 0 && !outDir) {
    return { error: 'Missing value for --out-dir' };
  }

  return {
    sourceFile: args[0],
    outDir: outDir ?? defaultDevOutDir(args[0]),
    projectRoot: readOptionalFlag(args, '--project-root'),
    json: args.includes('--json'),
  };
}

function parseInspectArgs(args: string[]): InspectCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: `Usage: rdsl inspect <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> [--node <id>] [--json]` };
  }

  const sourceFile = args[0];
  const nodeIndex = args.indexOf('--node');
  const nodeId = nodeIndex >= 0 ? args[nodeIndex + 1] : undefined;
  if (nodeIndex >= 0 && !nodeId) {
    return { error: 'Missing value for --node' };
  }

  return {
    sourceFile,
    nodeId,
    json: args.includes('--json'),
  };
}

function parseTraceArgs(args: string[]): TraceCommandOptions | CommandParseError {
  if (args.length < 2) {
    return { error: `Usage: rdsl trace <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> <generated-file:line[:col]> [--json]` };
  }

  return {
    sourceFile: args[0],
    generatedLocation: args[1],
    json: args.includes('--json'),
  };
}

function parseHostTemplateArgs(
  mode: HostTemplateCommandOptions['mode'],
  args: string[],
): HostTemplateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return {
      error: `Usage: rdsl host ${mode} <out-dir> [--title <title>] [--package-name <name>] [--generated-dir <dir>] [--api-base <url>] [--host <host>] [--port <n>] [--preview-port <n>] [--force] [--json]`,
    };
  }

  const outDir = args[0];
  const title = readOptionalFlag(args, '--title');
  const packageName = readOptionalFlag(args, '--package-name');
  const defaultGeneratedDir = readOptionalFlag(args, '--generated-dir');
  const defaultApiBase = readOptionalFlag(args, '--api-base');
  const defaultHost = readOptionalFlag(args, '--host');
  const defaultPort = readOptionalPortFlag(args, '--port');
  if ('error' in defaultPort) {
    return defaultPort;
  }
  const defaultPreviewPort = readOptionalPortFlag(args, '--preview-port');
  if ('error' in defaultPreviewPort) {
    return defaultPreviewPort;
  }

  return {
    mode,
    outDir,
    json: args.includes('--json'),
    force: args.includes('--force'),
    templateOptions: {
      title,
      packageName,
      defaultGeneratedDir,
      defaultApiBase,
      defaultHost,
      defaultPort: defaultPort.value,
      defaultPreviewPort: defaultPreviewPort.value,
    },
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

function readOptionalPortFlag(
  args: string[],
  flag: string,
): { value: number | undefined } | CommandParseError {
  const rawValue = readOptionalFlag(args, flag);
  if (!rawValue) {
    return { value: undefined };
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: `Invalid value for ${flag}: ${rawValue}` };
  }
  return { value: parsed };
}

function parseGeneratedLocation(input: string):
  | { generatedFile: string; line: number; col: number }
  | { error: string } {
  const parts = input.split(':');
  if (parts.length < 2) {
    return { error: `Invalid generated location: ${input}` };
  }

  const maybeCol = Number(parts[parts.length - 1]);
  const maybeLine = Number(parts[parts.length - 2]);

  if (Number.isInteger(maybeCol) && Number.isInteger(maybeLine)) {
    return {
      generatedFile: parts.slice(0, -2).join(':'),
      line: maybeLine,
      col: maybeCol,
    };
  }

  if (Number.isInteger(maybeCol)) {
    return {
      generatedFile: parts.slice(0, -1).join(':'),
      line: maybeCol,
      col: 1,
    };
  }

  return { error: `Invalid generated location: ${input}` };
}

function tryCompileFromFile(
  sourceFile: string,
  cwd: string,
  cache?: ProjectCache,
  changedFiles?: Iterable<string>,
  projectRoot?: string,
  env: Record<string, string | undefined> = {},
): { result: CompileResult } | { error: string } {
  try {
    return {
      result: withEnvOverrides(env, () => compileProject({
        entryFile: sourceFile.replace(/\\/g, '/'),
        projectRoot: projectRoot?.replace(/\\/g, '/'),
        cache,
        changedFiles,
        readFile(fileName) {
          const absolutePath = resolve(cwd, fileName);
          return readFileSync(absolutePath, 'utf8');
        },
        listFiles(directory) {
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

function tryLoadArtifacts(
  sourceOrBuildTarget: string,
  cwd: string,
  env: Record<string, string | undefined> = {},
): LoadArtifactsResult {
  if (isRdslSourceFile(sourceOrBuildTarget)) {
    const loaded = tryCompileFromFile(sourceOrBuildTarget, cwd, undefined, undefined, undefined, env);
    if ('error' in loaded) return loaded;

    const compileResult = loaded.result;
    if (!compileResult.success) {
      return { compileFailure: compileResult };
    }

    if (!compileResult.semanticManifest || !compileResult.traceManifest) {
      return { error: 'Missing trace metadata in compile result.' };
    }

    return {
      artifacts: {
        sourceKind: 'source',
        semanticManifest: compileResult.semanticManifest,
        traceManifest: compileResult.traceManifest,
        compileResult,
      },
    };
  }

  const absoluteTarget = resolve(cwd, sourceOrBuildTarget);
  const semanticManifestPath = resolve(absoluteTarget, '.rdsl', 'semantic-manifest.json');
  const traceManifestPath = resolve(absoluteTarget, '.rdsl', 'trace-manifest.json');
  if (!existsSync(semanticManifestPath) || !existsSync(traceManifestPath)) {
    return {
      error: `Could not find build manifests under ${sourceOrBuildTarget}/.rdsl`,
    };
  }

  try {
    const semanticManifest = JSON.parse(readFileSync(semanticManifestPath, 'utf8')) as SemanticManifest;
    const traceManifest = JSON.parse(readFileSync(traceManifestPath, 'utf8')) as TraceManifest;
    return {
      artifacts: {
        sourceKind: 'build',
        semanticManifest,
        traceManifest,
      },
    };
  } catch (error) {
    return {
      error: `Failed to read build manifests from ${sourceOrBuildTarget}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function collectProjectWatchState(
  result: CompileResult,
  fallbackGraph?: ProjectGraphSnapshot,
  previousProjectFiles: string[] = [],
  previousScanDirectories: string[] = [],
): ProjectWatchState {
  const sourceFiles = result.semanticManifest?.sourceFiles ?? fallbackGraph?.sourceFiles ?? [];
  const scanDirectories = fallbackGraph?.scanDirectories ?? previousScanDirectories;
  const hostFiles = collectManifestHostFiles(result);
  const entryFile = result.semanticManifest?.entryFile ?? fallbackGraph?.entryFile;
  const projectRoot = entryFile ? inferManifestProjectRoot(entryFile) : '.';
  const projectFiles = Array.from(new Set([
    ...sourceFiles,
    ...listMaterializedHostFiles(hostFiles).map((filePath) => resolveProjectFile(projectRoot, filePath)),
  ]));
  return {
    projectFiles: projectFiles.length > 0 ? projectFiles : [...previousProjectFiles],
    scanDirectories: [...scanDirectories],
  };
}

function collectManifestHostFiles(result: CompileResult): HostFileEntry[] {
  if (result.semanticManifest?.hostFiles) {
    return result.semanticManifest.hostFiles;
  }
  return collectHostFiles(result.ir);
}

function resolveProjectFile(projectRoot: string, filePath: string): string {
  return normalizePath(projectRoot === '.' ? filePath : `${projectRoot}/${filePath}`);
}

function inferManifestProjectRoot(entryFile: string): string {
  return isAbsolutePath(entryFile) ? dirname(entryFile) : '.';
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
}

function loadPersistentProjectCache(outDir: string, cwd: string): ProjectCache | null {
  const cachePath = resolve(cwd, outDir, '.rdsl', 'project-cache.json');
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const snapshot = JSON.parse(readFileSync(cachePath, 'utf8')) as ProjectCacheSnapshot;
    const cache = restoreProjectCache(snapshot);
    const invalidatedHostFiles = Array.from(new Set(
      Object.values(snapshot.internals.results)
        .flatMap((entry) => entry.result.semanticManifest?.hostFiles ?? [])
        .flatMap((hostFile) => listMaterializedHostFiles([hostFile])),
    ));
    if (invalidatedHostFiles.length > 0) {
      invalidateProjectCache(cache, invalidatedHostFiles);
    }
    return cache;
  } catch {
    return null;
  }
}

function emitBuildArtifacts(
  result: CompileResult,
  outDir: string,
  cwd: string,
  projectCache?: ProjectCache,
): BuildOutput {
  const absoluteOutDir = resolve(cwd, outDir);
  const hostFiles = collectManifestHostFiles(result);
  const materializedHostFiles = listMaterializedHostFiles(hostFiles).filter((hostFilePath) => !isSemanticDslHostFile(hostFilePath));
  const projectRoot = result.semanticManifest?.entryFile
    ? inferManifestProjectRoot(result.semanticManifest.entryFile)
    : '.';
  const nextFiles = [
    ...result.files.map((file) => normalizePath(file.path)),
    ...materializedHostFiles.map(normalizePath),
  ];
  pruneStaleBuildArtifacts(
    absoluteOutDir,
    [
      ...listManagedOutputFiles(absoluteOutDir, '.rdsl'),
      ...loadPreviousBuildArtifacts(absoluteOutDir),
    ],
    new Set(nextFiles),
  );
  const writtenFiles: string[] = [];

  for (const file of result.files) {
    const absoluteFile = resolve(absoluteOutDir, file.path);
    mkdirSync(dirname(absoluteFile), { recursive: true });
    writeFileSync(absoluteFile, file.content, 'utf8');
    writtenFiles.push(file.path);
  }

  for (const hostFilePath of materializedHostFiles) {
    const absoluteSourceFile = resolve(cwd, resolveProjectFile(projectRoot, hostFilePath));
    const absoluteTargetFile = resolve(absoluteOutDir, hostFilePath);
    mkdirSync(dirname(absoluteTargetFile), { recursive: true });
    copyFileSync(absoluteSourceFile, absoluteTargetFile);
    writtenFiles.push(hostFilePath);
  }

  const metadataDir = resolve(absoluteOutDir, '.rdsl');
  mkdirSync(metadataDir, { recursive: true });

  const semanticManifestPath = resolve(metadataDir, 'semantic-manifest.json');
  const traceManifestPath = resolve(metadataDir, 'trace-manifest.json');
  const projectCachePath = resolve(metadataDir, 'project-cache.json');
  const buildManifestPath = resolve(metadataDir, BUILD_MANIFEST_FILE);
  writeFileSync(semanticManifestPath, JSON.stringify(result.semanticManifest, null, 2), 'utf8');
  writeFileSync(traceManifestPath, JSON.stringify(result.traceManifest, null, 2), 'utf8');
  if (projectCache) {
    writeFileSync(projectCachePath, JSON.stringify(serializeProjectCache(projectCache), null, 2), 'utf8');
  }
  writeFileSync(buildManifestPath, `${JSON.stringify({ files: nextFiles }, null, 2)}\n`, 'utf8');

  return {
    outDir: outDir.replace(/\\/g, '/'),
    files: writtenFiles,
    semanticManifest: relativeOutputPath(absoluteOutDir, semanticManifestPath),
    traceManifest: relativeOutputPath(absoluteOutDir, traceManifestPath),
    projectCache: projectCache ? relativeOutputPath(absoluteOutDir, projectCachePath) : undefined,
  };
}

function isSemanticDslHostFile(hostFilePath: string): boolean {
  return hostFilePath.endsWith('.flow.loj')
    || hostFilePath.endsWith('.rules.loj')
    || hostFilePath.endsWith('.style.loj');
}

function loadPreviousBuildArtifacts(absoluteOutDir: string): string[] {
  const manifestPath = resolve(absoluteOutDir, '.rdsl', BUILD_MANIFEST_FILE);
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

function pruneStaleBuildArtifacts(absoluteOutDir: string, previousFiles: string[], nextFiles: Set<string>): void {
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

function emitHostTemplate(
  files: ReactDslHostTemplateFile[],
  outDir: string,
  cwd: string,
  mode: HostTemplateCommandOptions['mode'],
  force: boolean,
): HostTemplateOutput {
  const absoluteOutDir = resolve(cwd, outDir);
  const writtenFiles: string[] = [];
  const overwrittenFiles: string[] = [];
  const preservedStarterFiles: string[] = [];
  const collisions: string[] = [];

  if (mode === 'export-react' && !force) {
    for (const file of files) {
      if (existsSync(resolve(absoluteOutDir, file.path))) {
        collisions.push(file.path);
      }
    }
  }

  if (collisions.length > 0) {
    throw new Error(`refusing to overwrite existing files without --force: ${collisions.join(', ')}`);
  }

  for (const file of files) {
    const absolutePath = resolve(absoluteOutDir, file.path);
    const fileExists = existsSync(absolutePath);
    const shouldWriteStarter =
      file.mode === 'starter'
        ? mode === 'export-react'
          ? force || !fileExists
          : !fileExists
        : true;

    if (!shouldWriteStarter) {
      preservedStarterFiles.push(file.path);
      continue;
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.content, 'utf8');
    writtenFiles.push(file.path);
    if (fileExists) {
      overwrittenFiles.push(file.path);
    }
  }

  return {
    outDir: outDir.replace(/\\/g, '/'),
    templatePath: `${outDir.replace(/\\/g, '/')}/.rdsl-host/template.json`.replace(/\/+/g, '/'),
    writtenFiles,
    overwrittenFiles,
    preservedStarterFiles,
  };
}

function startDevSession(options: DevCommandOptions, context: CommandContext): DevSession {
  let closed = false;
  let lastChangeAt = 0;
  let lastProjectFiles = [normalizePath(options.sourceFile)];
  let lastScanDirectories: string[] = [];
  const watchedFilesByDirectory = new Map<string, { fileNames: Set<string>; watchAllRdsl: boolean }>();
  const watchers = new Map<string, DevWatcher>();
  const projectCache = loadPersistentProjectCache(options.outDir, context.cwd) ?? createProjectCache();

  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.dev.event', {
      event: 'ready',
      sourceFile: options.sourceFile,
      outDir: options.outDir,
    });
  } else {
    context.stdout(`Dev mode: watching ${options.sourceFile}\n`);
    context.stdout(`out dir: ${options.outDir}\n`);
  }

  const syncWatchers = (watchState: ProjectWatchState) => {
    const nextWatchedFilesByDirectory = new Map<string, { fileNames: Set<string>; watchAllRdsl: boolean }>();

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
          watchAllRdsl: false,
        });
      }
    }

    for (const scanDirectory of watchState.scanDirectories) {
      const absoluteDirectory = resolve(context.cwd, scanDirectory);
      const directoryState = nextWatchedFilesByDirectory.get(absoluteDirectory);
      if (directoryState) {
        directoryState.watchAllRdsl = true;
      } else {
        nextWatchedFilesByDirectory.set(absoluteDirectory, {
          fileNames: new Set<string>(),
          watchAllRdsl: true,
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
        if (closed) return;
        if (fileName) {
          const watchDirectoryState = watchedFilesByDirectory.get(directory);
          const watchedExplicitly = watchDirectoryState?.fileNames.has(fileName) ?? false;
          const watchedByDirectoryScan = (watchDirectoryState?.watchAllRdsl ?? false) && isRdslSourceFile(fileName);
          if (!watchedExplicitly && !watchedByDirectoryScan) {
            return;
          }
        }

        const now = Date.now();
        if (now - lastChangeAt < 40) return;
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
    const changedDslFiles = changedFile && isRdslSourceFile(changedFile)
      ? [changedFile]
      : changedFile
        ? [changedFile]
        : undefined;
    const loaded = tryCompileFromFile(options.sourceFile, context.cwd, projectCache, changedDslFiles, options.projectRoot, context.env);
    if ('error' in loaded) {
      writeDevReadFailure(options, trigger, loaded.error, context);
      return;
    }

    const compileResult = loaded.result;
    const projectGraph = projectCache.graphs.get(normalizePath(options.sourceFile));
    const watchState = collectProjectWatchState(
      compileResult,
      projectGraph,
      lastProjectFiles,
      lastScanDirectories,
    );
    lastProjectFiles = watchState.projectFiles;
    lastScanDirectories = watchState.scanDirectories;
    syncWatchers(watchState);
    if (!compileResult.success) {
      writeDevCompileFailure(options, trigger, compileResult, context);
      return;
    }

    try {
      const output = emitBuildArtifacts(compileResult, options.outDir, context.cwd, projectCache);
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
  });
  runBuild('initial');

  const session: DevSession = {
    close() {
      if (closed) return;
      closed = true;
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      watchedFilesByDirectory.clear();
      activeDevSessions.delete(session);
      if (options.json) {
        writeJsonArtifact(context.stdout, 'rdsl.dev.event', {
          event: 'stopped',
          sourceFile: options.sourceFile,
        });
      } else {
        context.stdout(`Dev mode stopped: ${options.sourceFile}\n`);
      }
    },
    rebuild(trigger: 'manual' | 'change' = 'manual') {
      if (closed) return;
      runBuild(trigger);
    },
  };

  return session;
}

function writeCompileFailure(
  artifact: CliJsonArtifact,
  result: CompileResult,
  stderr: (text: string) => void,
  stdout: (text: string) => void,
  json: boolean,
): void {
  if (json) {
    writeJsonArtifact(stdout, artifact, serializeCompileFailure(result));
    return;
  }
  printCompileErrors(result, stderr);
}

function writeFailure(
  artifact: CliJsonArtifact,
  message: string,
  stderr: (text: string) => void,
  json: boolean,
  stdout?: (text: string) => void,
): void {
  if (json && stdout) {
    writeJsonArtifact(stdout, artifact, { success: false, error: message });
    return;
  }
  stderr(`${message}\n`);
}

function writeJsonArtifact(
  stdout: (text: string) => void,
  artifact: CliJsonArtifact,
  payload: Record<string, unknown>,
): void {
  stdout(`${JSON.stringify({
    artifact,
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    ...payload,
  }, null, 2)}\n`);
}

function printCompileErrors(result: CompileResult, stderr: (text: string) => void): void {
  stderr('Compilation failed:\n');
  for (const error of result.errors) {
    stderr(`- [${error.phase}] ${formatCompileError(error)}\n`);
  }
}

function formatCompileError(error: CompileError): string {
  const file = error.file ? `${error.file}: ` : '';
  const position = error.line ? ` (${error.line}${error.col ? `:${error.col}` : ''})` : '';
  const nodeId = error.nodeId ? ` [${error.nodeId}]` : '';
  return `${file}${error.message}${position}${nodeId}`;
}

function printTraceMatch(match: TraceLocationMatch, write: (text: string) => void): void {
  write(`node: ${match.region.nodeId}\n`);
  write(`kind: ${match.node?.kind ?? '-'}\n`);
  write(`role: ${match.region.role}\n`);
  write(`generated: ${match.region.generatedFile}:${match.region.range.startLine}:${match.region.range.startCol}-${match.region.range.endLine}:${match.region.range.endCol}\n`);
  write(`source: ${formatSourceSpan(match.node?.sourceSpan)}\n`);
}

function serializeLookup(lookup: TraceLookupResult) {
  return {
    kind: lookup.kind,
    matches: lookup.matches.map((match) => ({
      node: match.node,
      region: match.region,
    })),
  };
}

function serializeCompileFailure(result: CompileResult) {
  return {
    success: false,
    errors: result.errors,
    warnings: result.warnings,
  };
}

function formatSourceSpan(sourceSpan: TraceNodeEntry['sourceSpan']): string {
  if (!sourceSpan) return '-';
  return `${sourceSpan.file}:${sourceSpan.startLine}:${sourceSpan.startCol}-${sourceSpan.endLine}:${sourceSpan.endCol}`;
}

function defaultDevOutDir(sourceFile: string): string {
  const normalized = stripRdslSourceSuffix(normalizePath(sourceFile))
    .replace(/^\.\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `.rdsl-dev/${normalized || 'app'}`;
}

function relativeOutputPath(rootDir: string, absolutePath: string): string {
  const normalizedRoot = normalizePath(rootDir).replace(/\/+$/, '');
  const normalizedPath = normalizePath(absolutePath);
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
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
  write(`  rdsl validate <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> [--project-root <dir>] [--json]\n`);
  write(`  rdsl build <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> --out-dir <dir> [--project-root <dir>] [--json]\n`);
  write(`  rdsl dev <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl> [--out-dir <dir>] [--project-root <dir>] [--json]\n`);
  write(`  rdsl inspect <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl|build-dir> [--node <id>] [--json]\n`);
  write(`  rdsl trace <source${CANONICAL_RDSL_SOURCE_SUFFIX}|source.rdsl|build-dir> <generated-file:line[:col]> [--json]\n`);
  write('  rdsl host export-react <out-dir> [--title <title>] [--package-name <name>] [--generated-dir <dir>] [--api-base <url>] [--host <host>] [--port <n>] [--preview-port <n>] [--force] [--json]\n');
  write('  rdsl host sync-react <out-dir> [--title <title>] [--package-name <name>] [--generated-dir <dir>] [--api-base <url>] [--host <host>] [--port <n>] [--preview-port <n>] [--json]\n');
}

function writeDevBuildSuccess(
  options: DevCommandOptions,
  trigger: 'initial' | 'change' | 'manual',
  result: CompileResult,
  output: BuildOutput,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.dev.event', {
      event: 'build',
      status: 'success',
      trigger,
      sourceFile: options.sourceFile,
      outDir: output.outDir,
      files: output.files,
      warnings: result.warnings,
    });
    return;
  }

  context.stdout(`Dev build complete (${trigger}): ${options.sourceFile}\n`);
  context.stdout(`files written: ${output.files.length}\n`);
  context.stdout(`semantic manifest: ${output.semanticManifest}\n`);
  context.stdout(`trace manifest: ${output.traceManifest}\n`);
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
    writeJsonArtifact(context.stdout, 'rdsl.dev.event', {
      event: 'build',
      status: 'failure',
      trigger,
      sourceFile: options.sourceFile,
      errors: result.errors,
      warnings: result.warnings,
    });
    return;
  }

  context.stderr(`Dev build failed (${trigger}): ${options.sourceFile}\n`);
  printCompileErrors(result, context.stderr);
}

function writeDevReadFailure(
  options: DevCommandOptions,
  trigger: 'initial' | 'change' | 'manual',
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(context.stdout, 'rdsl.dev.event', {
      event: 'build',
      status: 'failure',
      trigger,
      sourceFile: options.sourceFile,
      error: message,
    });
    return;
  }

  context.stderr(`Dev build failed (${trigger}): ${options.sourceFile}\n`);
  context.stderr(`${message}\n`);
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
