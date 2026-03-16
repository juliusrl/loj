#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { runCli as runReactCli } from '@loj-lang/rdsl-cli';
import { compileProject as compileFrontendProject } from '@loj-lang/rdsl-compiler';
import { runCli as runSpringCli } from '@loj-lang/sdsl-cli';
import { compileProject as compileBackendProject } from '@loj-lang/sdsl-compiler';
import type { IRSdslProgram } from '@loj-lang/sdsl-compiler';
import {
  buildRulesManifestFileName,
  countRulesEntries,
  compileRulesSource,
  isRulesSourceFile,
} from './rules-proof.js';
import {
  buildFlowManifestFileName,
  compileFlowSource,
  isFlowSourceFile,
} from './flow-proof.js';
import {
  collectProjectEnvironmentFileNames,
  createEnvironmentSignature,
  createProcessEnvironmentOverlay,
  loadProjectEnvironment,
} from './env.js';
import type { ProjectEnvironment } from './env.js';
import { generateNativeSqlSchema } from './database-native-sql.js';

export interface CliIO {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: Record<string, string | undefined>;
  runtime?: CliRuntime;
  onDevSession?: (session: DevSession) => void;
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

interface ValidateCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
}

interface BuildCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
}

interface DevCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
  debug: boolean;
}

interface StatusCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
}

interface StopCommandOptions {
  projectFile: string;
  json: boolean;
}

interface DoctorCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
}

type GraphSurface = 'source' | 'frontend' | 'backend' | 'all';

interface GraphCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
  surface: GraphSurface;
  outDir?: string;
}

interface RebuildCommandOptions {
  projectFile: string;
  json: boolean;
  targetAliases: string[];
}

type RestartService = 'host' | 'server' | 'all';

interface RestartCommandOptions {
  projectFile: string;
  json: boolean;
  service: RestartService;
}

interface RulesHelpCommand {
  help: true;
}

interface RulesValidateCommandOptions {
  command: 'validate';
  file: string;
  json: boolean;
}

interface RulesBuildCommandOptions {
  command: 'build';
  file: string;
  outDir?: string;
  json: boolean;
}

interface FlowHelpCommand {
  help: true;
}

interface FlowValidateCommandOptions {
  command: 'validate';
  file: string;
  json: boolean;
}

interface FlowBuildCommandOptions {
  command: 'build';
  file: string;
  outDir?: string;
  json: boolean;
}

interface AgentHelpCommand {
  help: true;
}

interface AgentInstallCommandOptions {
  command: 'install';
  agent: AgentRuntime;
  scope: AgentInstallScope;
  skillsDir?: string;
  json: boolean;
}

interface AgentAddCommandOptions {
  command: 'add';
  agent: AgentRuntime;
  scope: AgentInstallScope;
  source: string;
  skillsDir?: string;
  json: boolean;
}

interface AgentExportCommandOptions {
  command: 'export';
  agent: AgentRuntime;
  outDir: string;
  json: boolean;
}

type TargetType = 'rdsl' | 'sdsl';
type DevHostType = 'react-vite';
type TriggerKind = 'initial' | 'change' | 'manual';
type ManagedProcessKind = 'host' | 'server';
type AgentRuntime = 'codex' | 'windsurf' | 'generic';
type AgentInstallScope = 'user' | 'project';

const BUNDLED_SKILL_NAME = 'loj-authoring';
const AGENT_JSON_SCHEMA_VERSION = 1;
const BUNDLED_SKILL_FILES = [
  'SKILL.md',
  'metadata.json',
  'agents/openai.yaml',
  'references/backend-family.md',
  'references/backend-targets.md',
  'references/frontend-family.md',
  'references/frontend-runtime-trace.md',
  'references/policy-rules-proof.md',
  'references/project-and-transport.md',
] as const;

interface LojTargetConfig {
  alias: string;
  type: TargetType;
  legacyTypeAlias?: TargetType;
  entry: string;
  outDir?: string;
  database?: LojTargetDatabaseConfig;
  runtime?: LojTargetRuntimeConfig;
}

type ProjectDatabaseVendor = 'h2' | 'sqlite' | 'postgres' | 'mysql' | 'mariadb' | 'sqlserver' | 'oracle';
type ProjectDatabaseMode = 'embedded' | 'external' | 'docker-compose';
type ProjectDatabaseMigrations = 'none' | 'native-sql' | 'flyway';

interface LojTargetDatabaseConfig {
  vendor: ProjectDatabaseVendor;
  mode: ProjectDatabaseMode;
  name: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  migrations: ProjectDatabaseMigrations;
  autoProvision: boolean;
}

type ProjectRuntimeShutdownMode = 'immediate' | 'graceful';
type ProjectRuntimeForwardedHeadersMode = 'none' | 'standard';
type ProjectRuntimeTrustedProxyMode = 'local' | 'all' | 'cidrs';

interface LojTargetRuntimeShutdownConfig {
  mode: ProjectRuntimeShutdownMode;
  timeout: string;
  timeoutSeconds: number;
}

interface LojTargetRuntimeProbeConfig {
  path: string;
}

interface LojTargetRuntimeCorsConfig {
  origins: string[];
  methods?: string[];
  headers?: string[];
  credentials: boolean;
}

interface LojTargetRuntimeForwardedHeadersConfig {
  mode: ProjectRuntimeForwardedHeadersMode;
}

interface LojTargetRuntimeTrustedProxyConfig {
  mode: ProjectRuntimeTrustedProxyMode;
  cidrs?: string[];
}

interface LojTargetRuntimeRequestSizeLimitConfig {
  source: string;
  bytes: number;
}

interface LojTargetRuntimeConfig {
  basePath?: string;
  shutdown?: LojTargetRuntimeShutdownConfig;
  health?: LojTargetRuntimeProbeConfig;
  readiness?: LojTargetRuntimeProbeConfig;
  drain?: LojTargetRuntimeProbeConfig;
  cors?: LojTargetRuntimeCorsConfig;
  forwardedHeaders?: LojTargetRuntimeForwardedHeadersConfig;
  trustedProxy?: LojTargetRuntimeTrustedProxyConfig;
  requestSizeLimit?: LojTargetRuntimeRequestSizeLimitConfig;
}

function presentTargetType(type: TargetType): 'web' | 'api' {
  return type === 'rdsl' ? 'web' : 'api';
}

function normalizeTargetType(value: unknown): TargetType | null {
  if (value === 'rdsl' || value === 'web') {
    return 'rdsl';
  }
  if (value === 'sdsl' || value === 'api') {
    return 'sdsl';
  }
  return null;
}

interface LojDevHostConfig {
  type: DevHostType;
  target: string;
  dir: string;
  host: string;
  port: number;
  previewPort: number;
  apiBase: string;
  proxyTarget?: string;
  proxyAuth?: string;
}

interface LojDevServerConfig {
  target: string;
  host: string;
  port: number;
}

interface LojProjectDevConfig {
  host?: LojDevHostConfig;
  server?: LojDevServerConfig;
}

interface LojProjectConfig {
  appName: string;
  projectFile: string;
  projectDir: string;
  targets: LojTargetConfig[];
  dev?: LojProjectDevConfig;
}

interface LoadedProjectConfig {
  project: LojProjectConfig;
  environment: ProjectEnvironment;
}

interface TargetInvocationResult {
  alias: string;
  type: TargetType;
  entry: string;
  outDir?: string;
  success: boolean;
  payload?: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface BuildPostProcessResult {
  addedFiles: string[];
}

function createLegacyTargetWarnings(target: LojTargetConfig): string[] {
  const warnings: string[] = [];
  if (target.type === 'rdsl' && target.entry.toLowerCase().endsWith('.rdsl')) {
    warnings.push(`target "${target.alias}" uses legacy frontend-family suffix "${target.entry}". Prefer .web.loj over .rdsl.`);
  }
  if (target.type === 'sdsl' && target.entry.toLowerCase().endsWith('.sdsl')) {
    warnings.push(`target "${target.alias}" uses legacy backend-family suffix "${target.entry}". Prefer .api.loj over .sdsl.`);
  }
  return warnings;
}

function createLegacyProjectWarnings(project: LojProjectConfig): string[] {
  const warnings: string[] = [];
  for (const target of project.targets) {
    if (target.legacyTypeAlias === 'rdsl') {
      warnings.push(`target "${target.alias}" uses legacy type "rdsl". Prefer "web" in loj.project.yaml.`);
    }
    if (target.legacyTypeAlias === 'sdsl') {
      warnings.push(`target "${target.alias}" uses legacy type "sdsl". Prefer "api" in loj.project.yaml.`);
    }
    warnings.push(...createLegacyTargetWarnings(target));
  }
  return [...new Set(warnings)];
}

function emitProjectWarnings(warnings: readonly string[], context: CommandContext, json: boolean): void {
  if (json) {
    return;
  }
  for (const warning of warnings) {
    context.stderr(`Warning: ${warning}\n`);
  }
}

export interface DevWatcher {
  close(): void;
}

export interface DevProcess {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  close(signal?: string): void;
}

export interface SpawnProcessOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onExit?: (code: number | null, signal: string | null) => void;
}

export interface CliRuntime {
  watch(directory: string, listener: (eventType: string, fileName?: string) => void): DevWatcher;
  spawn(command: string, args: string[], options: SpawnProcessOptions): DevProcess;
  exists(path: string): boolean;
  npmCommand(): string;
}

export interface DevSession {
  close(): void;
  rebuild(trigger?: 'manual' | 'change'): void;
}

type DevSessionCommandArtifact =
  | {
      artifact: 'loj.dev.command';
      schemaVersion: 1;
      command: 'rebuild';
      targetAliases: string[];
    }
  | {
      artifact: 'loj.dev.command';
      schemaVersion: 1;
      command: 'restart';
      services: Array<'host' | 'server'>;
    };

interface TargetDevSession {
  config: LojTargetConfig;
  outDir: string;
  envSignature: string;
  targetTriple?: string;
  session: DevSession;
}

interface TargetDevEvent {
  event?: string;
  status?: string;
  target?: string;
  trigger?: TriggerKind;
  sourceFile?: string;
  outDir?: string;
  files?: string[];
  warnings?: unknown[];
  errors?: Array<{
    phase?: string;
    file?: string;
    line?: number;
    col?: number;
    message?: string;
  }>;
  error?: string;
}

interface ManagedProcessSpec {
  key: string;
  kind: ManagedProcessKind;
  signature: string;
  targetAlias: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  url: string;
  description: string;
  preflightPath?: string;
  preflightError?: string;
}

interface ManagedProcessState {
  spec: ManagedProcessSpec;
  process: DevProcess;
  restarting: boolean;
}

interface DatabaseProvisionSpec {
  key: string;
  signature: string;
  targetAlias: string;
  composeFile: string;
  projectName: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

interface DatabaseProvisionState {
  spec: DatabaseProvisionSpec;
  phase: 'starting' | 'ready' | 'stopping';
  process?: DevProcess;
}

type BackendServerRuntime = 'spring-boot' | 'fastapi';
type DebuggerAttachKind = 'java' | 'debugpy';

interface ProjectDebuggerSummary {
  targetAlias: string;
  runtime: BackendServerRuntime;
  attachKind: DebuggerAttachKind;
  host: string;
  port: number;
}

interface ProjectDevSummary {
  hostUrl?: string;
  backendUrl?: string;
  apiBase?: string;
  proxyUrl?: string;
  hostDir?: string;
  debuggers?: ProjectDebuggerSummary[];
}

interface ActiveDevSessionRecord {
  projectFile: string;
  session: DevSession;
  dispatchCommand(command: DevSessionCommandArtifact): void;
}

interface DevSessionStateService {
  kind: ManagedProcessKind;
  targetAlias: string;
  url: string;
  description: string;
}

interface DevSessionStateDatabase {
  targetAlias: string;
  phase: DatabaseProvisionState['phase'];
  composeFile: string;
}

interface DevSessionStateTarget {
  alias: string;
  type: 'web' | 'api';
  entry: string;
  outDir: string;
}

interface DevSessionStateArtifact {
  artifact: 'loj.dev.session';
  schemaVersion: 1;
  projectFile: string;
  app: {
    name: string;
  };
  pid: number;
  startedAt: string;
  updatedAt: string;
  debug: boolean;
  targets: DevSessionStateTarget[];
  dev: {
    hostUrl?: string;
    backendUrl?: string;
    apiBase?: string;
    proxyUrl?: string;
    hostDir?: string;
  };
  debuggers: ProjectDebuggerSummary[];
  services: DevSessionStateService[];
  databases: DevSessionStateDatabase[];
}

interface ProjectStatusProbeSummary {
  targetAlias: string;
  kind: 'health' | 'readiness' | 'drain';
  url: string;
}

interface DoctorCheck {
  severity: 'error' | 'warning' | 'info';
  message: string;
  target?: string;
}

const activeDevSessions = new Map<string, ActiveDevSessionRecord>();
const fastApiDevRunnerPath = fileURLToPath(new URL('./fastapi-dev-runner.js', import.meta.url));
const springDebugPort = 5005;
const fastApiDebugPort = 5678;
const localDebugHost = '127.0.0.1';
const lojVersion = '0.5.5';
const lojReleaseName = 'Logos';

function formatLojVersionLabel(): string {
  return `${lojVersion} (${lojReleaseName})`;
}

function sortDevSessionServices(services: DevSessionStateService[]): DevSessionStateService[] {
  return [...services].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    if (left.targetAlias !== right.targetAlias) {
      return left.targetAlias.localeCompare(right.targetAlias);
    }
    return left.url.localeCompare(right.url);
  });
}

function sortDevSessionDatabases(databases: DevSessionStateDatabase[]): DevSessionStateDatabase[] {
  return [...databases].sort((left, right) => {
    if (left.targetAlias !== right.targetAlias) {
      return left.targetAlias.localeCompare(right.targetAlias);
    }
    if (left.phase !== right.phase) {
      return left.phase.localeCompare(right.phase);
    }
    return left.composeFile.localeCompare(right.composeFile);
  });
}

function sortDoctorChecks(checks: DoctorCheck[]): DoctorCheck[] {
  const severityRank: Record<DoctorCheck['severity'], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...checks].sort((left, right) => {
    if (severityRank[left.severity] !== severityRank[right.severity]) {
      return severityRank[left.severity] - severityRank[right.severity];
    }
    const leftTarget = left.target ?? '';
    const rightTarget = right.target ?? '';
    if (leftTarget !== rightTarget) {
      return leftTarget.localeCompare(rightTarget);
    }
    return left.message.localeCompare(right.message);
  });
}

function sortProjectStatusProbes(probes: ProjectStatusProbeSummary[]): ProjectStatusProbeSummary[] {
  const kindRank: Record<ProjectStatusProbeSummary['kind'], number> = {
    health: 0,
    readiness: 1,
    drain: 2,
  };
  return [...probes].sort((left, right) => {
    if (left.targetAlias !== right.targetAlias) {
      return left.targetAlias.localeCompare(right.targetAlias);
    }
    if (kindRank[left.kind] !== kindRank[right.kind]) {
      return kindRank[left.kind] - kindRank[right.kind];
    }
    return left.url.localeCompare(right.url);
  });
}

function sortProjectDebuggers(debuggers: ProjectDebuggerSummary[]): ProjectDebuggerSummary[] {
  return [...debuggers].sort((left, right) => {
    if (left.targetAlias !== right.targetAlias) {
      return left.targetAlias.localeCompare(right.targetAlias);
    }
    if (left.attachKind !== right.attachKind) {
      return left.attachKind.localeCompare(right.attachKind);
    }
    if (left.host !== right.host) {
      return left.host.localeCompare(right.host);
    }
    return left.port - right.port;
  });
}

function createProjectDebuggerSummary(
  runtime: BackendServerRuntime,
  targetAlias: string,
): ProjectDebuggerSummary {
  if (runtime === 'fastapi') {
    return {
      targetAlias,
      runtime,
      attachKind: 'debugpy',
      host: localDebugHost,
      port: fastApiDebugPort,
    };
  }
  return {
    targetAlias,
    runtime,
    attachKind: 'java',
    host: localDebugHost,
    port: springDebugPort,
  };
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
  spawn(command, args, options) {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    attachLineEmitter(child.stdout, options.onStdoutLine);
    attachLineEmitter(child.stderr, options.onStderrLine);
    child.on('exit', (code, signal) => {
      options.onExit?.(code, signal);
    });
    return {
      get exitCode() {
        return child.exitCode;
      },
      get signalCode() {
        return child.signalCode;
      },
      close(signal = 'SIGINT') {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        child.kill(signal);
      },
    };
  },
  exists(path) {
    return existsSync(path);
  },
  npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  },
};

export function runCli(args: string[], io: CliIO = {}): number {
  const context: CommandContext = {
    cwd: io.cwd ?? process.cwd(),
    stdout: io.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: io.stderr ?? ((text: string) => process.stderr.write(text)),
    env: io.env ?? process.env,
    runtime: io.runtime ?? defaultRuntime,
    onDevSession: io.onDevSession,
  };

  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    writeUsage(context.stdout);
    return 0;
  }
  if (args[0] === '--version') {
    context.stdout(`${formatLojVersionLabel()}\n`);
    return 0;
  }

  const [command, ...rest] = args;
  switch (command) {
    case 'version':
      context.stdout(`${formatLojVersionLabel()}\n`);
      return 0;
    case 'validate':
      return handleValidate(parseValidateArgs(rest), context);
    case 'build':
      return handleBuild(parseBuildArgs(rest), context);
    case 'dev':
      return handleDev(parseDevArgs(rest), context);
    case 'rebuild':
      return handleRebuild(parseRebuildArgs(rest), context);
    case 'restart':
      return handleRestart(parseRestartArgs(rest), context);
    case 'status':
      return handleStatus(parseStatusArgs(rest), context);
    case 'stop':
      return handleStop(parseStopArgs(rest), context);
    case 'doctor':
      return handleDoctor(parseDoctorArgs(rest), context);
    case 'graph':
      return handleGraph(parseGraphArgs(rest), context);
    case 'rules':
      return handleRules(parseRulesArgs(rest), context);
    case 'flow':
      return handleFlow(parseFlowArgs(rest), context);
    case 'agent':
      return handleAgent(parseAgentArgs(rest), context);
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

  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
  if ('error' in selectedTargets) {
    writeFailure(selectedTargets.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const activeProject = selectedTargets.project;

  const targetResults = activeProject.targets.map((target) =>
    runTargetCommand(
      'validate',
      target,
      activeProject.projectDir,
      createProcessEnvironmentOverlay(loaded.environment.targets[target.alias]?.effectiveValues ?? {}, context.env),
    ),
  );
  const projectWarnings = createLegacyProjectWarnings(activeProject);
  const targetConfigErrors = collectTargetConfigErrors(activeProject, targetResults);
  const success = targetResults.every((result) => result.success) && targetConfigErrors.length === 0;
  const payload = {
    success,
    projectFile: options.projectFile,
    app: { name: loaded.project.appName },
    envFiles: loaded.environment.files,
    warnings: projectWarnings,
    configErrors: targetConfigErrors,
    targets: Object.fromEntries(targetResults.map((result) => [
      result.alias,
      {
        type: presentTargetType(result.type),
        entry: result.entry,
        database: serializeDatabaseConfig(activeProject.targets.find((target) => target.alias === result.alias)?.database) ?? undefined,
        runtime: serializeRuntimeConfig(activeProject.targets.find((target) => target.alias === result.alias)?.runtime) ?? undefined,
        envFiles: loaded.environment.targets[result.alias]?.files ?? [],
        success: result.success,
        result: result.payload ?? null,
        stderr: result.stderr || undefined,
      },
    ])),
  };

  if (options.json) {
    context.stdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (success) {
    emitProjectWarnings(projectWarnings, context, options.json);
    writeCliBanner(context.stdout, 'loj validate', 'check current project-shell configuration');
    context.stdout(`Validation passed: ${options.projectFile}\n`);
    writeCliSection(context.stdout, 'overview', [
      `project: ${options.projectFile}`,
      `app: ${activeProject.appName}`,
      `version: ${formatLojVersionLabel()}`,
      `env files: ${loaded.environment.files.length}`,
    ]);
    writeCliSection(
      context.stdout,
      'targets',
      targetResults.map((result) => {
        const generatedFiles = asNumber(result.payload?.generatedFiles) ?? 0;
        const sourceFiles = countSourceFiles(result.payload?.sourceFiles);
        return `${result.alias} (${presentTargetType(result.type)}) entry=${result.entry} source files=${sourceFiles} generated files=${generatedFiles}`;
      }),
    );
    writeCliSection(context.stdout, 'next', [
      `build generated outputs: loj build ${options.projectFile}`,
      `start the project loop: loj dev ${options.projectFile}`,
    ]);
  } else {
    context.stderr(`Loj validate failed: ${options.projectFile}\n`);
    for (const error of targetConfigErrors) {
      context.stderr(`- config error: ${error}\n`);
    }
    for (const result of targetResults.filter((target) => !target.success)) {
      context.stderr(`- ${result.alias} (${presentTargetType(result.type)}) failed\n`);
      writeTargetFailure(result, context.stderr);
    }
  }

  return success ? 0 : 1;
}

function handleBuild(
  options: BuildCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
  if ('error' in selectedTargets) {
    writeFailure(selectedTargets.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const activeProject = selectedTargets.project;

  const targetResults = activeProject.targets.map((target) =>
    runTargetCommand(
      'build',
      target,
      activeProject.projectDir,
      createProcessEnvironmentOverlay(loaded.environment.targets[target.alias]?.effectiveValues ?? {}, context.env),
      resolveTargetOutDir(target),
    ),
  );
  const projectWarnings = createLegacyProjectWarnings(activeProject);
  const targetConfigErrors = collectTargetConfigErrors(activeProject, targetResults);
  const buildPostProcessErrors: string[] = [];
  if (targetResults.every((result) => result.success) && targetConfigErrors.length === 0) {
    for (const target of activeProject.targets) {
      const result = targetResults.find((entry) => entry.alias === target.alias);
      if (!result) {
        continue;
      }
      const applied = applyTargetBuildProfiles(target, result, activeProject.projectDir);
      if ('error' in applied) {
        buildPostProcessErrors.push(applied.error);
        continue;
      }
      if (Array.isArray(result.payload?.files)) {
        result.payload.files.push(...applied.addedFiles);
      }
    }
  }
  const success = targetResults.every((result) => result.success)
    && targetConfigErrors.length === 0
    && buildPostProcessErrors.length === 0;
  const payload = {
    success,
    projectFile: options.projectFile,
    app: { name: loaded.project.appName },
    envFiles: loaded.environment.files,
    warnings: projectWarnings,
    configErrors: targetConfigErrors,
    postProcessErrors: buildPostProcessErrors,
    targets: Object.fromEntries(targetResults.map((result) => [
      result.alias,
      {
        type: presentTargetType(result.type),
        entry: result.entry,
        outDir: result.outDir,
        database: serializeDatabaseConfig(activeProject.targets.find((target) => target.alias === result.alias)?.database) ?? undefined,
        runtime: serializeRuntimeConfig(activeProject.targets.find((target) => target.alias === result.alias)?.runtime) ?? undefined,
        envFiles: loaded.environment.targets[result.alias]?.files ?? [],
        success: result.success,
        result: result.payload ?? null,
        stderr: result.stderr || undefined,
      },
    ])),
  };

  if (options.json) {
    context.stdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (success) {
    emitProjectWarnings(projectWarnings, context, options.json);
    writeCliBanner(context.stdout, 'loj build', 'emit generated outputs for the selected project');
    context.stdout(`Built loj project: ${options.projectFile}\n`);
    writeCliSection(context.stdout, 'overview', [
      `project: ${options.projectFile}`,
      `app: ${activeProject.appName}`,
      `version: ${formatLojVersionLabel()}`,
      `env files: ${loaded.environment.files.length}`,
    ]);
    writeCliSection(
      context.stdout,
      'targets',
      targetResults.map((result) => `${result.alias} (${presentTargetType(result.type)}) out=${result.outDir} generated files=${countGeneratedFiles(result.payload)}`),
    );
    writeCliSection(context.stdout, 'next', [
      `inspect runtime state: loj status ${options.projectFile}`,
      `start the project loop: loj dev ${options.projectFile}`,
    ]);
  } else {
    context.stderr(`Loj build failed: ${options.projectFile}\n`);
    for (const error of targetConfigErrors) {
      context.stderr(`- config error: ${error}\n`);
    }
    for (const error of buildPostProcessErrors) {
      context.stderr(`- post-build error: ${error}\n`);
    }
    for (const result of targetResults.filter((target) => !target.success)) {
      context.stderr(`- ${result.alias} (${result.type}) failed\n`);
      writeTargetFailure(result, context.stderr);
    }
  }

  return success ? 0 : 1;
}

function handleDev(
  options: DevCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
  if ('error' in selectedTargets) {
    writeFailure(selectedTargets.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const existingSession = activeDevSessions.get(projectAbsoluteFile);
  if (existingSession) {
    writeFailure(`Loj dev is already running for ${normalizePath(projectAbsoluteFile)}. Use \`loj status\` or \`loj stop\` first.`, context.stderr, context.stdout, options.json);
    return 1;
  }

  const session = startDevSession(options, {
    project: selectedTargets.project,
    environment: loaded.environment,
  }, context);
  emitProjectWarnings(createLegacyProjectWarnings(selectedTargets.project), context, options.json);
  context.onDevSession?.(session);
  return 0;
}

function handleRebuild(
  options: RebuildCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const command: DevSessionCommandArtifact = {
    artifact: 'loj.dev.command',
    schemaVersion: 1,
    command: 'rebuild',
    targetAliases: [...new Set(options.targetAliases)],
  };
  const dispatched = dispatchDevCommand(projectAbsoluteFile, command);
  if ('error' in dispatched) {
    writeFailure(dispatched.error, context.stderr, context.stdout, options.json);
    return 1;
  }

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.rebuild.result', {
      success: true,
      projectFile: normalizePath(projectAbsoluteFile),
      accepted: true,
      mode: dispatched.mode,
      targetAliases: command.targetAliases,
    });
  } else {
    writeCliBanner(context.stdout, 'loj rebuild', 'rebuild selected generated targets inside the active session');
    context.stdout(`Queued rebuild: ${normalizePath(projectAbsoluteFile)}\n`);
    writeCliSection(context.stdout, 'overview', [
      `project: ${normalizePath(projectAbsoluteFile)}`,
      `mode: ${dispatched.mode}`,
      `targets: ${command.targetAliases.length > 0 ? command.targetAliases.join(', ') : 'all active targets'}`,
      `version: ${formatLojVersionLabel()}`,
    ]);
    writeCliSection(context.stdout, 'next', [
      `inspect runtime state: loj status ${options.projectFile}`,
    ]);
  }
  return 0;
}

function handleRestart(
  options: RestartCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const services = options.service === 'all' ? ['host', 'server'] as Array<'host' | 'server'> : [options.service];
  const command: DevSessionCommandArtifact = {
    artifact: 'loj.dev.command',
    schemaVersion: 1,
    command: 'restart',
    services,
  };
  const dispatched = dispatchDevCommand(projectAbsoluteFile, command);
  if ('error' in dispatched) {
    writeFailure(dispatched.error, context.stderr, context.stdout, options.json);
    return 1;
  }

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.restart.result', {
      success: true,
      projectFile: normalizePath(projectAbsoluteFile),
      accepted: true,
      mode: dispatched.mode,
      services,
    });
  } else {
    writeCliBanner(context.stdout, 'loj restart', 'restart selected managed services inside the active session');
    context.stdout(`Queued restart: ${normalizePath(projectAbsoluteFile)}\n`);
    writeCliSection(context.stdout, 'overview', [
      `project: ${normalizePath(projectAbsoluteFile)}`,
      `mode: ${dispatched.mode}`,
      `services: ${options.service === 'all' ? 'host, server' : options.service}`,
      `version: ${formatLojVersionLabel()}`,
    ]);
    writeCliSection(context.stdout, 'next', [
      `inspect runtime state: loj status ${options.projectFile}`,
    ]);
  }
  return 0;
}

function handleStatus(
  options: StatusCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const stateLookup = loadResolvedDevSessionState(projectAbsoluteFile);
  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  const selectedTargets = 'error' in loaded
    ? undefined
    : selectProjectTargets(loaded.project, options.targetAliases);
  const currentProject = !selectedTargets || 'error' in selectedTargets ? undefined : selectedTargets.project;
  const probes = currentProject
    ? collectProjectStatusProbes(currentProject, stateLookup.state?.dev.backendUrl)
    : [];

  const payload = {
    success: true,
    projectFile: normalizePath(projectAbsoluteFile),
    running: stateLookup.running,
    stale: stateLookup.stale,
    app: currentProject
      ? { name: currentProject.appName }
      : stateLookup.state?.app ?? undefined,
    targets: currentProject
      ? currentProject.targets.map((target) => ({
        alias: target.alias,
        type: presentTargetType(target.type),
        entry: target.entry,
        outDir: resolveTargetOutDir(target),
      }))
      : (stateLookup.state?.targets ?? []),
    dev: stateLookup.state?.dev ?? {},
    debuggers: sortProjectDebuggers(stateLookup.state?.debuggers ?? []),
    services: sortDevSessionServices(stateLookup.state?.services ?? []),
    databases: sortDevSessionDatabases(stateLookup.state?.databases ?? []),
    probes,
    warnings: [
      ...('error' in loaded ? [loaded.error] : []),
      ...(selectedTargets && 'error' in selectedTargets ? [selectedTargets.error] : []),
      ...(stateLookup.stale ? ['Removed stale dev-session state file for a no-longer-running loj dev process.'] : []),
    ],
  };

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.status.result', payload);
    return 0;
  }

  writeCliBanner(context.stdout, 'loj status', 'inspect current project-shell session');
  context.stdout(`Project status: ${normalizePath(projectAbsoluteFile)}\n`);
  writeCliSection(context.stdout, 'overview', [
    `project: ${normalizePath(projectAbsoluteFile)}`,
    `running: ${payload.running ? 'yes' : 'no'}`,
    ...(payload.app?.name ? [`app: ${payload.app.name}`] : []),
    `version: ${formatLojVersionLabel()}`,
    ...(payload.stale ? ['session: cleared stale state file from a previous loj dev process'] : []),
  ]);
  writeCliSection(
    context.stdout,
    'targets',
    payload.targets.map((target) => `${target.alias} (${target.type}) entry=${target.entry} out=${target.outDir}`),
  );
  writeCliSection(context.stdout, 'urls', [
    ...(payload.dev.hostUrl ? [`host: ${payload.dev.hostUrl}`] : []),
    ...(payload.dev.backendUrl ? [`backend: ${payload.dev.backendUrl}`] : []),
  ]);
  writeCliSection(
    context.stdout,
    'services',
    payload.services.map((service) => `${service.kind} ${service.targetAlias} ${service.url}`),
  );
  writeCliSection(
    context.stdout,
    'databases',
    payload.databases.map((database) => `${database.targetAlias} (${database.phase}) ${database.composeFile}`),
  );
  writeCliSection(
    context.stdout,
    'debuggers',
    payload.debuggers.map((debuggerEntry) => `${debuggerEntry.targetAlias} ${debuggerEntry.attachKind} ${debuggerEntry.host}:${debuggerEntry.port}`),
  );
  writeCliSection(
    context.stdout,
    'probes',
    payload.probes.map((probe) => `${probe.targetAlias} ${probe.kind} ${probe.url}`),
  );
  writeCliSection(context.stdout, 'next', [
    payload.running
      ? `stop services: loj stop ${options.projectFile}`
      : `start services: loj dev ${options.projectFile}`,
    `inspect health: loj doctor ${options.projectFile}`,
  ]);
  for (const warning of payload.warnings) {
    context.stderr(`Warning: ${warning}\n`);
  }
  return 0;
}

function handleStop(
  options: StopCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const activeSession = activeDevSessions.get(projectAbsoluteFile);
  if (activeSession) {
    activeSession.session.close();
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.stop.result', {
        success: true,
        projectFile: normalizePath(projectAbsoluteFile),
        stopped: true,
        mode: 'in-process',
      });
    } else {
      writeCliBanner(context.stdout, 'loj stop', 'stop the active managed project-shell session');
      context.stdout(`Stopped loj dev: ${normalizePath(projectAbsoluteFile)}\n`);
      writeCliSection(context.stdout, 'next', [
        `restart services: loj dev ${options.projectFile}`,
        `inspect current health: loj status ${options.projectFile}`,
      ]);
    }
    return 0;
  }

  const stateLookup = loadResolvedDevSessionState(projectAbsoluteFile);
  if (!stateLookup.state || !stateLookup.running) {
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.stop.result', {
        success: true,
        projectFile: normalizePath(projectAbsoluteFile),
        stopped: false,
        stale: stateLookup.stale,
      });
      } else {
      writeCliBanner(context.stdout, 'loj stop', 'no active managed session found');
      context.stdout(`No running loj dev session: ${normalizePath(projectAbsoluteFile)}\n`);
      if (stateLookup.stale) {
        context.stdout('Removed stale dev-session state file.\n');
      }
      writeCliSection(context.stdout, 'next', [
        `start services: loj dev ${options.projectFile}`,
        `inspect project readiness: loj doctor ${options.projectFile}`,
      ]);
    }
    return 0;
  }

  try {
    process.kill(stateLookup.state.pid, 'SIGINT');
  } catch (error) {
    writeFailure(`Failed to stop loj dev for ${normalizePath(projectAbsoluteFile)}: ${error instanceof Error ? error.message : String(error)}`, context.stderr, context.stdout, options.json);
    return 1;
  }

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.stop.result', {
      success: true,
      projectFile: normalizePath(projectAbsoluteFile),
      stopped: true,
      mode: 'signal',
      pid: stateLookup.state.pid,
    });
  } else {
    writeCliBanner(context.stdout, 'loj stop', 'stop signal sent to the managed session');
    context.stdout(`Stop signal sent: ${normalizePath(projectAbsoluteFile)} (pid ${stateLookup.state.pid})\n`);
    writeCliSection(context.stdout, 'next', [
      `recheck when the process exits: loj status ${options.projectFile}`,
    ]);
  }
  return 0;
}

function handleDoctor(
  options: DoctorCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
  if ('error' in selectedTargets) {
    writeFailure(selectedTargets.error, context.stderr, context.stdout, options.json);
    return 1;
  }

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const projectDir = dirname(projectAbsoluteFile);
  const targetResults = selectedTargets.project.targets.map((target) => runTargetCommand(
    'validate',
    target,
    projectDir,
    createProcessEnvironmentOverlay(loaded.environment.targets[target.alias]?.effectiveValues ?? {}, context.env),
  ));
  const sessionLookup = loadResolvedDevSessionState(projectAbsoluteFile);
  const surfaceCounts = collectProjectSurfaceCounts(projectDir);
  const checks = collectDoctorChecks(selectedTargets.project, targetResults, projectDir, sessionLookup, context);
  const hasErrors = checks.some((check) => check.severity === 'error');
  const payload = {
    success: !hasErrors,
    projectFile: normalizePath(projectAbsoluteFile),
    app: { name: selectedTargets.project.appName },
    running: sessionLookup.running,
    targets: selectedTargets.project.targets.map((target) => ({
      alias: target.alias,
      type: presentTargetType(target.type),
      entry: target.entry,
      outDir: resolveTargetOutDir(target),
      validated: targetResults.find((result) => result.alias === target.alias)?.success ?? false,
    })),
    surfaceCounts,
    checks: sortDoctorChecks(checks),
    dev: sessionLookup.state?.dev ?? {},
    services: sortDevSessionServices(sessionLookup.state?.services ?? []),
    databases: sortDevSessionDatabases(sessionLookup.state?.databases ?? []),
  };
  const checkSummary = summarizeDoctorChecks(payload.checks);

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.doctor.result', payload);
    return hasErrors ? 1 : 0;
  }

  writeCliBanner(context.stdout, 'loj doctor', 'validate project-shell readiness');
  context.stdout(`Loj doctor: ${normalizePath(projectAbsoluteFile)}\n`);
  writeCliSection(context.stdout, 'overview', [
    `project: ${normalizePath(projectAbsoluteFile)}`,
    `app: ${payload.app.name}`,
    `version: ${formatLojVersionLabel()}`,
    `running: ${payload.running ? 'yes' : 'no'}`,
    `surfaces: resources=${surfaceCounts.resources} readModels=${surfaceCounts.readModels} workflows=${surfaceCounts.workflows} rules=${surfaceCounts.rules}`,
    `checks: errors=${checkSummary.errors} warnings=${checkSummary.warnings} info=${checkSummary.info}`,
  ]);
  writeCliSection(
    context.stdout,
    'targets',
    payload.targets.map((target) => `${target.alias} (${target.type}) validated=${target.validated ? 'yes' : 'no'} out=${target.outDir}`),
  );
  for (const check of payload.checks) {
    const sink = check.severity === 'error' ? context.stderr : context.stdout;
    sink(`[${check.severity}] ${check.target ? `${check.target}: ` : ''}${check.message}\n`);
  }
  writeCliSection(context.stdout, 'next', hasErrors
    ? [
        `fix the reported errors, then rerun: loj doctor ${options.projectFile}`,
        `rebuild generated outputs when needed: loj build ${options.projectFile}`,
      ]
    : [
        `start the project loop: loj dev ${options.projectFile}`,
        `inspect current runtime state: loj status ${options.projectFile}`,
      ]);
  return hasErrors ? 1 : 0;
}

function resolveProjectAbsoluteFile(projectFile: string, cwd: string): string {
  return normalizePath(resolve(cwd, projectFile));
}

function resolveDevSessionStateFile(projectAbsoluteFile: string): string {
  return normalizePath(resolve(
    dirname(projectAbsoluteFile),
    '.loj',
    'dev',
    `${sanitizeSessionFileName(basename(projectAbsoluteFile))}.session.json`,
  ));
}

function resolveDevSessionCommandFile(projectAbsoluteFile: string): string {
  return normalizePath(resolve(
    dirname(projectAbsoluteFile),
    '.loj',
    'dev',
    `${sanitizeSessionFileName(basename(projectAbsoluteFile))}.command.json`,
  ));
}

function sanitizeSessionFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function loadResolvedDevSessionState(projectAbsoluteFile: string): {
  stateFile: string;
  state?: DevSessionStateArtifact;
  running: boolean;
  stale: boolean;
} {
  const stateFile = resolveDevSessionStateFile(projectAbsoluteFile);
  const state = readDevSessionState(stateFile);
  if (!state) {
    return { stateFile, running: false, stale: false };
  }
  if (state.pid === process.pid && !activeDevSessions.has(projectAbsoluteFile)) {
    deleteDevSessionStateFile(stateFile);
    return { stateFile, state, running: false, stale: true };
  }
  const running = isProcessAlive(state.pid);
  if (running) {
    return { stateFile, state, running: true, stale: false };
  }
  deleteDevSessionStateFile(stateFile);
  return { stateFile, state, running: false, stale: true };
}

function dispatchDevCommand(
  projectAbsoluteFile: string,
  command: DevSessionCommandArtifact,
): { mode: 'in-process' | 'queued' } | { error: string } {
  const activeSession = activeDevSessions.get(projectAbsoluteFile);
  if (activeSession) {
    activeSession.dispatchCommand(command);
    return { mode: 'in-process' };
  }

  const stateLookup = loadResolvedDevSessionState(projectAbsoluteFile);
  if (!stateLookup.state || !stateLookup.running) {
    return { error: `No running loj dev session: ${normalizePath(projectAbsoluteFile)}` };
  }

  const commandFile = resolveDevSessionCommandFile(projectAbsoluteFile);
  writeDevSessionCommandFile(commandFile, command);
  return { mode: 'queued' };
}

function readDevSessionState(stateFile: string): DevSessionStateArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<DevSessionStateArtifact>;
    if (parsed.artifact !== 'loj.dev.session' || parsed.schemaVersion !== 1) {
      return undefined;
    }
    if (typeof parsed.projectFile !== 'string' || typeof parsed.pid !== 'number') {
      return undefined;
    }
    return parsed as DevSessionStateArtifact;
  } catch {
    return undefined;
  }
}

function readDevSessionCommand(commandFile: string): DevSessionCommandArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(commandFile, 'utf8')) as Partial<DevSessionCommandArtifact>;
    if (parsed.artifact !== 'loj.dev.command' || parsed.schemaVersion !== 1) {
      return undefined;
    }
    if (parsed.command === 'rebuild' && Array.isArray(parsed.targetAliases)) {
      return {
        artifact: 'loj.dev.command',
        schemaVersion: 1,
        command: 'rebuild',
        targetAliases: parsed.targetAliases.filter((value): value is string => typeof value === 'string'),
      };
    }
    if (parsed.command === 'restart' && Array.isArray(parsed.services)) {
      const services = parsed.services.filter((value): value is 'host' | 'server' => value === 'host' || value === 'server');
      return {
        artifact: 'loj.dev.command',
        schemaVersion: 1,
        command: 'restart',
        services,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function collectProjectStatusProbes(
  project: LojProjectConfig,
  backendUrl: string | undefined,
): ProjectStatusProbeSummary[] {
  if (!backendUrl) {
    return [];
  }
  const probes: ProjectStatusProbeSummary[] = [];
  for (const target of project.targets) {
    if (target.type !== 'sdsl' || !target.runtime) {
      continue;
    }
    if (target.runtime.health) {
      probes.push({
        targetAlias: target.alias,
        kind: 'health',
        url: appendBasePathToUrl(backendUrl, target.runtime.health.path),
      });
    }
    if (target.runtime.readiness) {
      probes.push({
        targetAlias: target.alias,
        kind: 'readiness',
        url: appendBasePathToUrl(backendUrl, target.runtime.readiness.path),
      });
    }
    if (target.runtime.drain) {
      probes.push({
        targetAlias: target.alias,
        kind: 'drain',
        url: appendBasePathToUrl(backendUrl, target.runtime.drain.path),
      });
    }
  }
  return sortProjectStatusProbes(probes);
}

function writeDevSessionStateFile(stateFile: string, state: DevSessionStateArtifact): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function writeDevSessionCommandFile(commandFile: string, command: DevSessionCommandArtifact): void {
  mkdirSync(dirname(commandFile), { recursive: true });
  writeFileSync(commandFile, `${JSON.stringify(command, null, 2)}\n`, 'utf8');
}

function deleteDevSessionStateFile(stateFile: string): void {
  try {
    nodeFs.rmSync(stateFile, { force: true });
  } catch {
    // best-effort cleanup
  }
}

function deleteDevSessionCommandFile(commandFile: string): void {
  try {
    nodeFs.rmSync(commandFile, { force: true });
  } catch {
    // best-effort cleanup
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function collectProjectSurfaceCounts(projectDir: string): {
  resources: number;
  readModels: number;
  workflows: number;
  rules: number;
} {
  const counts = {
    resources: 0,
    readModels: 0,
    workflows: 0,
    rules: 0,
  };
  const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git', '.rdsl-dev']);
  const pending = [projectDir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = nodeFs.readdirSync(current, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name === '.loj') {
          continue;
        }
        pending.push(resolve(current, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileName = resolve(current, entry.name);
      let source = '';
      try {
        source = readFileSync(fileName, 'utf8');
      } catch {
        continue;
      }
      if (entry.name.endsWith('.web.loj') || entry.name.endsWith('.api.loj') || entry.name.endsWith('.rdsl') || entry.name.endsWith('.sdsl')) {
        counts.resources += countPatternOccurrences(source, /^\s*resource\s+[A-Za-z_][\w-]*\s*:/gm);
        counts.readModels += countPatternOccurrences(source, /^\s*readModel\s+[A-Za-z_][\w-]*\s*:/gm);
      }
      if (entry.name.endsWith('.flow.loj')) {
        counts.workflows += countPatternOccurrences(source, /^\s*workflow\s+[A-Za-z_][\w-]*\s*:/gm);
      }
      if (entry.name.endsWith('.rules.loj')) {
        counts.rules += countPatternOccurrences(source, /^\s*rules\s+[A-Za-z_][\w-]*\s*:/gm);
      }
    }
  }
  return counts;
}

function countPatternOccurrences(source: string, pattern: RegExp): number {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

type LinkedArtifactKind = 'rules' | 'flow' | 'sql';

interface LinkedArtifactReference {
  kind: LinkedArtifactKind;
  sourceFile: string;
  rawPath: string;
}

function collectProjectLinkedArtifactReferences(projectDir: string): LinkedArtifactReference[] {
  const references: LinkedArtifactReference[] = [];
  const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git', '.rdsl-dev', '.loj']);
  const pending = [projectDir];
  const patterns: Array<{ kind: LinkedArtifactKind; expression: RegExp }> = [
    { kind: 'rules', expression: /@rules\((['"])(.+?)\1\)/g },
    { kind: 'flow', expression: /@flow\((['"])(.+?)\1\)/g },
    { kind: 'sql', expression: /@sql\((['"])(.+?)\1\)/g },
  ];

  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = nodeFs.readdirSync(current, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) {
          continue;
        }
        pending.push(resolve(current, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!(entry.name.endsWith('.web.loj') || entry.name.endsWith('.api.loj') || entry.name.endsWith('.rdsl') || entry.name.endsWith('.sdsl'))) {
        continue;
      }

      const fileName = resolve(current, entry.name);
      let source = '';
      try {
        source = readFileSync(fileName, 'utf8');
      } catch {
        continue;
      }

      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern.expression)) {
          const rawPath = match[2]?.trim();
          if (!rawPath) {
            continue;
          }
          references.push({
            kind: pattern.kind,
            sourceFile: normalizePath(fileName),
            rawPath,
          });
        }
      }
    }
  }

  return references;
}

function resolveLinkedArtifactCandidates(sourceFile: string, kind: LinkedArtifactKind, rawPath: string): string[] {
  const resolvedBase = normalizePath(resolve(dirname(sourceFile), rawPath));
  const candidates = new Set<string>([resolvedBase]);
  if (kind === 'rules' && !resolvedBase.endsWith('.rules.loj')) {
    candidates.add(`${resolvedBase}.rules.loj`);
  }
  if (kind === 'flow' && !resolvedBase.endsWith('.flow.loj')) {
    candidates.add(`${resolvedBase}.flow.loj`);
  }
  if (kind === 'sql' && !resolvedBase.endsWith('.sql')) {
    candidates.add(`${resolvedBase}.sql`);
  }
  return [...candidates];
}

function collectMissingLinkedArtifactChecks(projectDir: string, context: CommandContext): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const seen = new Set<string>();
  for (const reference of collectProjectLinkedArtifactReferences(projectDir)) {
    const candidates = resolveLinkedArtifactCandidates(reference.sourceFile, reference.kind, reference.rawPath);
    const found = candidates.some((candidate) => context.runtime.exists(candidate));
    if (found) {
      continue;
    }
    const key = `${reference.kind}:${reference.sourceFile}:${reference.rawPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    checks.push({
      severity: 'error',
      message: `linked @${reference.kind}(...) file is missing: ${reference.rawPath} (from ${normalizePath(relative(projectDir, reference.sourceFile))})`,
    });
  }
  return checks;
}

function collectGeneratedOutputChecks(project: LojProjectConfig, projectDir: string, context: CommandContext): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const target of project.targets) {
    const absoluteOutDir = resolve(projectDir, resolveTargetOutDir(target));
    if (!context.runtime.exists(absoluteOutDir)) {
      checks.push({
        severity: 'warning',
        target: target.alias,
        message: `generated output is missing at ${normalizePath(relative(projectDir, absoluteOutDir))}; run \`loj build${project.targets.length > 1 ? ` --target ${target.alias}` : ''}\` to materialize it.`,
      });
      continue;
    }
    checks.push({
      severity: 'info',
      target: target.alias,
      message: `generated output exists at ${normalizePath(relative(projectDir, absoluteOutDir))}`,
    });
  }
  return checks;
}

function collectDoctorChecks(
  project: LojProjectConfig,
  targetResults: TargetInvocationResult[],
  projectDir: string,
  sessionLookup: ReturnType<typeof loadResolvedDevSessionState>,
  context: CommandContext,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(...collectMissingLinkedArtifactChecks(projectDir, context));
  checks.push(...collectGeneratedOutputChecks(project, projectDir, context));
  for (const result of targetResults) {
    if (!result.success) {
      checks.push({
        severity: 'error',
        target: result.alias,
        message: `target validation failed for ${result.entry}; run \`loj validate${project.targets.length > 1 ? ` --target ${result.alias}` : ''}\` for the focused target output.`,
      });
      continue;
    }
    const warningCount = Array.isArray(result.payload?.warnings) ? result.payload.warnings.length : 0;
    if (warningCount > 0) {
      checks.push({
        severity: 'warning',
        target: result.alias,
        message: `target validation produced ${warningCount} warning${warningCount === 1 ? '' : 's'}`,
      });
    }
  }

  if (project.dev?.host) {
    const hostDir = resolve(projectDir, project.dev.host.dir);
    const hostPackageJson = resolve(hostDir, 'package.json');
    const vitePackageJson = resolve(hostDir, 'node_modules', 'vite', 'package.json');
    if (!context.runtime.exists(hostPackageJson)) {
      checks.push({
        severity: 'error',
        target: project.dev.host.target,
        message: `dev host directory is missing package.json: ${normalizePath(relative(projectDir, hostPackageJson))}`,
      });
    } else if (!context.runtime.exists(vitePackageJson)) {
      checks.push({
        severity: 'warning',
        target: project.dev.host.target,
        message: `dev host dependencies are missing. Run \`npm install --prefix ${normalizePath(relative(projectDir, hostDir))}\`, then rerun \`loj doctor\`.`,
      });
    } else {
      checks.push({
        severity: 'info',
        target: project.dev.host.target,
        message: 'dev host dependencies look present',
      });
    }
  }

  for (const target of project.targets) {
    if (target.type !== 'sdsl' || !target.database?.autoProvision || target.database.mode !== 'docker-compose') {
      continue;
    }
    const composeFile = resolve(projectDir, resolveTargetOutDir(target), 'docker-compose.database.yaml');
    if (!context.runtime.exists(composeFile)) {
      checks.push({
        severity: 'warning',
        target: target.alias,
        message: `database auto-provision is configured but ${normalizePath(relative(projectDir, composeFile))} does not exist yet; run \`loj build\` once to materialize it.`,
      });
    } else {
      checks.push({
        severity: 'info',
        target: target.alias,
        message: `database auto-provision compose file is ready at ${normalizePath(relative(projectDir, composeFile))}`,
      });
    }
  }

  if (sessionLookup.running) {
    checks.push({
      severity: 'info',
      message: 'loj dev is currently running for this project',
    });
  } else if (sessionLookup.stale) {
    checks.push({
      severity: 'warning',
      message: 'removed a stale dev-session state file from a previous loj dev process',
    });
  } else {
    checks.push({
      severity: 'info',
      message: 'loj dev is not currently running for this project',
    });
  }

  return checks;
}

function handleAgent(
  options: AgentHelpCommand | AgentInstallCommandOptions | AgentAddCommandOptions | AgentExportCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  if ('help' in options) {
    writeAgentUsage(context.stdout);
    return 0;
  }

  try {
    if (options.command === 'install' || options.command === 'add') {
      const sourceDir = resolveAgentSkillSource(options, context);
      if ('error' in sourceDir) {
        writeAgentFailure(options, sourceDir.error, context);
        return 1;
      }
      const destination = resolveAgentInstallDestination(options, context, sourceDir.skillName);
      copyDirectoryRecursive(sourceDir.rootDir, destination);
      const payload = {
        success: true,
        agent: options.agent,
        skill: sourceDir.skillName,
        source: options.command === 'add' ? options.source : 'bundled',
        scope: options.scope,
        destination,
        autoDiscovered:
          options.skillsDir?.trim().length
            ? false
            : options.agent === 'codex'
              ? options.scope === 'user'
              : options.agent === 'windsurf'
                ? true
                : false,
        note:
          options.skillsDir?.trim().length
            ? 'Installed to an explicit skills directory override.'
            : options.scope === 'project' && options.agent === 'codex'
              ? 'Project scope vendors a pinned copy only. Point your agent workflow at this path explicitly.'
              : options.agent === 'generic'
                ? 'Generic agent installs require explicit --skills-dir management.'
                : undefined,
      };
      if (sourceDir.cleanupDir) {
        nodeFs.rmSync(sourceDir.cleanupDir, { recursive: true, force: true });
      }
      if (options.json) {
        writeJsonArtifact(context.stdout, options.command === 'install' ? 'loj.agent.install.result' : 'loj.agent.add.result', payload);
      } else {
        context.stdout(`${options.command === 'install' ? 'Installed bundled' : 'Added'} ${sourceDir.skillName} for ${options.agent}\n`);
        context.stdout(`scope: ${options.scope}\n`);
        context.stdout(`destination: ${destination}\n`);
        if (options.command === 'add') {
          context.stdout(`source: ${options.source}\n`);
        }
        if (payload.note) {
          context.stdout(`note: ${payload.note}\n`);
        }
      }
      return 0;
    }

    const destination = normalizePath(resolve(context.cwd, options.outDir, BUNDLED_SKILL_NAME));
    const sourceDir = resolveBundledSkillSourceDir();
    if ('error' in sourceDir) {
      writeAgentFailure(options, sourceDir.error, context);
      return 1;
    }
    syncBundledSkill(sourceDir.path, destination);
    const payload = {
      success: true,
      agent: options.agent,
      skill: BUNDLED_SKILL_NAME,
      destination,
      autoDiscovered: false,
      note: 'Exported bundle for manual installation or project vendoring.',
    };
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.agent.export.result', payload);
    } else {
      context.stdout(`Exported ${BUNDLED_SKILL_NAME} for ${options.agent}\n`);
      context.stdout(`destination: ${destination}\n`);
      context.stdout(`note: ${payload.note}\n`);
    }
    return 0;
  } catch (error) {
    writeAgentFailure(
      options,
      `Failed to ${options.command} ${BUNDLED_SKILL_NAME}: ${error instanceof Error ? error.message : String(error)}`,
      context,
    );
    return 1;
  }
}

function handleRules(
  options: RulesHelpCommand | RulesValidateCommandOptions | RulesBuildCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  if ('help' in options) {
    writeRulesUsage(context.stdout);
    return 0;
  }

  const sourcePath = resolve(context.cwd, options.file);
  const displayFile = normalizePath(relative(context.cwd, sourcePath) || basename(sourcePath));
  if (!isRulesSourceFile(displayFile)) {
    writeRulesFailure(options, `Rules source must use the .rules.loj suffix: ${options.file}`, context);
    return 1;
  }

  let source = '';
  try {
    source = readFileSync(sourcePath, 'utf8');
  } catch (error) {
    writeRulesFailure(
      options,
      `Failed to read ${options.file}: ${error instanceof Error ? error.message : String(error)}`,
      context,
    );
    return 1;
  }

  const result = compileRulesSource(source, displayFile);
  if (!result.success || !result.program || !result.manifest) {
    writeRulesCompileFailure(options, displayFile, result.errors, context);
    return 1;
  }
  const entryCount = countRulesEntries(result.program);

  if (options.command === 'validate') {
    const payload = {
      success: true,
      file: displayFile,
      ruleSet: result.program.name,
      rules: entryCount,
      manifestArtifact: result.manifest.artifact,
      warnings: result.warnings,
    };
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.rules.validate.result', payload);
    } else {
      context.stdout(`Validated rules file: ${displayFile}\n`);
      context.stdout(`rule set: ${result.program.name}\n`);
      context.stdout(`rules: ${entryCount}\n`);
      context.stdout(`manifest: ${result.manifest.artifact}\n`);
    }
    return 0;
  }

  const manifestOutDir = resolve(context.cwd, options.outDir ?? 'generated/rules');
  const manifestFile = resolve(manifestOutDir, buildRulesManifestFileName(displayFile));
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  const displayOutFile = normalizePath(relative(context.cwd, manifestFile) || basename(manifestFile));
  const payload = {
    success: true,
    file: displayFile,
    ruleSet: result.program.name,
    rules: entryCount,
    outputFile: displayOutFile,
    manifestArtifact: result.manifest.artifact,
    warnings: result.warnings,
  };
  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.rules.build.result', payload);
  } else {
    context.stdout(`Built rules file: ${displayFile}\n`);
    context.stdout(`rule set: ${result.program.name}\n`);
    context.stdout(`rules: ${entryCount}\n`);
    context.stdout(`manifest: ${displayOutFile}\n`);
  }
  return 0;
}

interface GraphDocument {
  id: string;
  title: string;
  mermaid: string;
}

interface GraphPayloadTargetSummary {
  alias: string;
  type: 'web' | 'api';
  entry: string;
}

function handleGraph(
  options: GraphCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  const loaded = loadProject(options.projectFile, context.cwd, context.env);
  if ('error' in loaded) {
    writeFailure(loaded.error, context.stderr, context.stdout, options.json);
    return 1;
  }
  const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
  if ('error' in selectedTargets) {
    writeFailure(selectedTargets.error, context.stderr, context.stdout, options.json);
    return 1;
  }

  const activeProject = selectedTargets.project;
  const graphDocuments: GraphDocument[] = [];
  const compileErrors: string[] = [];

  if (options.surface === 'source' || options.surface === 'all') {
    const sourceGraphs = buildProjectSourceGraphs(activeProject);
    if ('error' in sourceGraphs) {
      compileErrors.push(sourceGraphs.error);
    } else {
      graphDocuments.push(...sourceGraphs.documents);
    }
  }

  if (options.surface === 'frontend' || options.surface === 'all') {
    for (const target of activeProject.targets.filter((entry) => entry.type === 'rdsl')) {
      const frontendGraph = buildFrontendGeneratedGraph(target, activeProject.projectDir);
      if ('error' in frontendGraph) {
        compileErrors.push(frontendGraph.error);
        continue;
      }
      graphDocuments.push(frontendGraph.document);
    }
  }

  if (options.surface === 'backend' || options.surface === 'all') {
    for (const target of activeProject.targets.filter((entry) => entry.type === 'sdsl')) {
      const backendGraph = buildBackendGeneratedGraph(target, activeProject.projectDir);
      if ('error' in backendGraph) {
        compileErrors.push(backendGraph.error);
        continue;
      }
      graphDocuments.push(backendGraph.document);
    }
  }

  if (compileErrors.length > 0) {
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.graph.result', {
        success: false,
        projectFile: options.projectFile,
        surface: options.surface,
        app: { name: activeProject.appName },
        targets: activeProject.targets.map((target) => ({
          alias: target.alias,
          type: presentTargetType(target.type),
          entry: target.entry,
        })),
        errors: compileErrors,
        graphs: [],
      });
      return 1;
    }
    writeFailure(compileErrors.join('\n'), context.stderr, context.stdout, false);
    return 1;
  }

  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.graph.result', {
      success: true,
      projectFile: options.projectFile,
      surface: options.surface,
      app: { name: activeProject.appName },
      targets: activeProject.targets.map((target): GraphPayloadTargetSummary => ({
        alias: target.alias,
        type: presentTargetType(target.type),
        entry: target.entry,
      })),
      graphs: graphDocuments,
    });
    return 0;
  }

  if (options.outDir) {
    const absoluteOutDir = resolve(context.cwd, options.outDir);
    mkdirSync(absoluteOutDir, { recursive: true });
    for (const graph of graphDocuments) {
      const graphFile = resolve(absoluteOutDir, `${graph.id}.mmd`);
      writeFileSync(graphFile, `${graph.mermaid}\n`, 'utf8');
    }
  }

  writeCliBanner(context.stdout, 'loj graph', 'emit mermaid architecture views for the selected project');
  context.stdout(`Project graph: ${normalizePath(resolveProjectAbsoluteFile(options.projectFile, context.cwd))}\n\n`);
  for (const graph of graphDocuments) {
    context.stdout(`${graph.title}\n`);
    context.stdout('```mermaid\n');
    context.stdout(`${graph.mermaid}\n`);
    context.stdout('```\n\n');
  }
  writeCliSection(context.stdout, 'next', [
    ...(options.outDir ? [`wrote mermaid files to: ${normalizePath(options.outDir)}`] : []),
    `copy a graph into docs or release notes`,
    `re-run with JSON output: loj graph ${options.projectFile} --json`,
  ]);
  return 0;
}

function handleFlow(
  options: FlowHelpCommand | FlowValidateCommandOptions | FlowBuildCommandOptions | CommandParseError,
  context: CommandContext,
): number {
  if ('error' in options) {
    context.stderr(`${options.error}\n`);
    return 1;
  }

  if ('help' in options) {
    writeFlowUsage(context.stdout);
    return 0;
  }

  const sourcePath = resolve(context.cwd, options.file);
  const displayFile = normalizePath(relative(context.cwd, sourcePath) || basename(sourcePath));
  if (!isFlowSourceFile(displayFile)) {
    writeFlowFailure(options, `Flow source must use the .flow.loj suffix: ${options.file}`, context);
    return 1;
  }

  let source = '';
  try {
    source = readFileSync(sourcePath, 'utf8');
  } catch (error) {
    writeFlowFailure(
      options,
      `Failed to read ${options.file}: ${error instanceof Error ? error.message : String(error)}`,
      context,
    );
    return 1;
  }

  const result = compileFlowSource(source, displayFile);
  if (!result.success || !result.program || !result.manifest) {
    writeFlowCompileFailure(options, displayFile, result.errors, context);
    return 1;
  }

  const transitionCount = result.program.transitions.length;
  const stepCount = result.program.wizard?.steps.length ?? 0;
  if (options.command === 'validate') {
    const payload = {
      success: true,
      file: displayFile,
      workflow: result.program.name,
      states: result.program.states.length,
      transitions: transitionCount,
      steps: stepCount,
      manifestArtifact: result.manifest.artifact,
      warnings: result.warnings,
    };
    if (options.json) {
      writeJsonArtifact(context.stdout, 'loj.flow.validate.result', payload);
    } else {
      context.stdout(`Validated flow file: ${displayFile}\n`);
      context.stdout(`workflow: ${result.program.name}\n`);
      context.stdout(`states: ${result.program.states.length}\n`);
      context.stdout(`transitions: ${transitionCount}\n`);
      context.stdout(`steps: ${stepCount}\n`);
      context.stdout(`manifest: ${result.manifest.artifact}\n`);
    }
    return 0;
  }

  const manifestOutDir = resolve(context.cwd, options.outDir ?? 'generated/flow');
  const manifestFile = resolve(manifestOutDir, buildFlowManifestFileName(displayFile));
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  const displayOutFile = normalizePath(relative(context.cwd, manifestFile) || basename(manifestFile));
  const payload = {
    success: true,
    file: displayFile,
    workflow: result.program.name,
    states: result.program.states.length,
    transitions: transitionCount,
    steps: stepCount,
    outputFile: displayOutFile,
    manifestArtifact: result.manifest.artifact,
    warnings: result.warnings,
  };
  if (options.json) {
    writeJsonArtifact(context.stdout, 'loj.flow.build.result', payload);
  } else {
    context.stdout(`Built flow file: ${displayFile}\n`);
    context.stdout(`workflow: ${result.program.name}\n`);
    context.stdout(`states: ${result.program.states.length}\n`);
    context.stdout(`transitions: ${transitionCount}\n`);
    context.stdout(`steps: ${stepCount}\n`);
    context.stdout(`manifest: ${displayOutFile}\n`);
  }
  return 0;
}

function parseValidateArgs(args: string[]): ValidateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj validate <loj.project.yaml> [--target <alias>] [--json]' };
  }
  let json = false;
  let projectFile = '';
  const targetAliases: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--target') {
      const value = args[index + 1] ?? '';
      if (value.trim().length === 0) {
        return { error: 'loj validate --target must be a non-empty target alias' };
      }
      targetAliases.push(value.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj validate: ${arg}` };
    }
    if (projectFile) {
      return { error: `Unexpected extra argument for loj validate: ${arg}` };
    }
    projectFile = arg;
  }
  if (!projectFile) {
    return { error: 'Missing project file for loj validate.' };
  }
  return { projectFile, json, targetAliases };
}

function parseBuildArgs(args: string[]): BuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj build <loj.project.yaml> [--target <alias>] [--json]' };
  }
  return parseProjectTargetArgs('build', args);
}

function parseDevArgs(args: string[]): DevCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj dev <loj.project.yaml> [--target <alias>] [--debug] [--json]' };
  }
  const parsed = parseProjectTargetArgs('dev', args, { debug: true });
  if ('error' in parsed) {
    return parsed;
  }
  return { ...parsed, debug: Boolean(parsed.debug) };
}

function parseRebuildArgs(args: string[]): RebuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj rebuild <loj.project.yaml> [--target <alias>] [--json]' };
  }
  const parsed = parseProjectTargetArgs('rebuild', args);
  if ('error' in parsed) {
    return parsed;
  }
  return parsed;
}

function parseRestartArgs(args: string[]): RestartCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj restart <loj.project.yaml> [--service host|server|all] [--json]' };
  }
  let json = false;
  let projectFile = '';
  let service: RestartService = 'all';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--service') {
      const value = (args[index + 1] ?? '').trim();
      if (value !== 'host' && value !== 'server' && value !== 'all') {
        return { error: 'loj restart --service must be one of: host, server, all' };
      }
      service = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj restart: ${arg}` };
    }
    if (projectFile) {
      return { error: `Unexpected extra argument for loj restart: ${arg}` };
    }
    projectFile = arg;
  }
  if (!projectFile) {
    return { error: 'Missing project file for loj restart.' };
  }
  return { projectFile, json, service };
}

function parseStatusArgs(args: string[]): StatusCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj status <loj.project.yaml> [--target <alias>] [--json]' };
  }
  const parsed = parseProjectTargetArgs('status', args);
  if ('error' in parsed) {
    return parsed;
  }
  return parsed;
}

function parseStopArgs(args: string[]): StopCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj stop <loj.project.yaml> [--json]' };
  }
  let json = false;
  let projectFile = '';
  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj stop: ${arg}` };
    }
    if (projectFile) {
      return { error: `Unexpected extra argument for loj stop: ${arg}` };
    }
    projectFile = arg;
  }
  if (!projectFile) {
    return { error: 'Missing project file for loj stop.' };
  }
  return { projectFile, json };
}

function parseDoctorArgs(args: string[]): DoctorCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj doctor <loj.project.yaml> [--target <alias>] [--json]' };
  }
  const parsed = parseProjectTargetArgs('doctor', args);
  if ('error' in parsed) {
    return parsed;
  }
  return parsed;
}

function parseGraphArgs(args: string[]): GraphCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj graph <loj.project.yaml> [--surface source|frontend|backend|all] [--target <alias>] [--out-dir <dir>] [--json]' };
  }
  let surface: GraphSurface = 'all';
  let outDir: string | undefined;
  const filteredArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--surface') {
      const value = (args[index + 1] ?? '').trim();
      if (value !== 'source' && value !== 'frontend' && value !== 'backend' && value !== 'all') {
        return { error: 'loj graph --surface must be one of: source, frontend, backend, all' };
      }
      surface = value;
      index += 1;
      continue;
    }
    if (arg === '--out-dir') {
      const value = (args[index + 1] ?? '').trim();
      if (!value) {
        return { error: 'loj graph --out-dir must be a non-empty path' };
      }
      outDir = value;
      index += 1;
      continue;
    }
    filteredArgs.push(arg);
  }
  const parsed = parseProjectTargetArgs('graph', filteredArgs);
  if ('error' in parsed) {
    return parsed;
  }
  return {
    ...parsed,
    surface,
    outDir,
  };
}

function parseProjectTargetArgs(
  command: 'build' | 'dev' | 'rebuild' | 'status' | 'doctor' | 'graph',
  args: string[],
  options: { debug?: boolean } = {},
): { projectFile: string; json: boolean; targetAliases: string[]; debug?: boolean } | CommandParseError {
  let json = false;
  let debug = false;
  let projectFile = '';
  const targetAliases: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (options.debug && arg === '--debug') {
      debug = true;
      continue;
    }
    if (arg === '--target') {
      const value = args[index + 1] ?? '';
      if (value.trim().length === 0) {
        return { error: `loj ${command} --target must be a non-empty target alias` };
      }
      targetAliases.push(value.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj ${command}: ${arg}` };
    }
    if (projectFile) {
      return { error: `Unexpected extra argument for loj ${command}: ${arg}` };
    }
    projectFile = arg;
  }
  if (!projectFile) {
    return { error: `Missing project file for loj ${command}.` };
  }
  return { projectFile, json, targetAliases, debug };
}

function parseRulesArgs(
  args: string[],
): RulesHelpCommand | RulesValidateCommandOptions | RulesBuildCommandOptions | CommandParseError {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    return { help: true };
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'validate':
      return parseRulesValidateArgs(rest);
    case 'build':
      return parseRulesBuildArgs(rest);
    default:
      return { error: `Unknown rules command: ${subcommand}` };
  }
}

function parseFlowArgs(
  args: string[],
): FlowHelpCommand | FlowValidateCommandOptions | FlowBuildCommandOptions | CommandParseError {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    return { help: true };
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'validate':
      return parseFlowValidateArgs(rest);
    case 'build':
      return parseFlowBuildArgs(rest);
    default:
      return { error: `Unknown flow command: ${subcommand}` };
  }
}

function parseRulesValidateArgs(args: string[]): RulesValidateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj rules validate <file.rules.loj> [--json]' };
  }
  const json = args.includes('--json');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) {
    return { error: 'Missing rules source file for loj rules validate.' };
  }
  return {
    command: 'validate',
    file,
    json,
  };
}

function parseRulesBuildArgs(args: string[]): RulesBuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj rules build <file.rules.loj> [--out-dir <dir>] [--json]' };
  }

  let json = false;
  let file = '';
  let outDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj rules build: ${arg}` };
    }
    if (file) {
      return { error: `Unexpected extra argument for loj rules build: ${arg}` };
    }
    file = arg;
  }

  if (!file) {
    return { error: 'Missing rules source file for loj rules build.' };
  }
  if (outDir !== undefined && outDir.trim().length === 0) {
    return { error: 'loj rules build --out-dir must be a non-empty path' };
  }

  return {
    command: 'build',
    file,
    outDir,
    json,
  };
}

function parseFlowValidateArgs(args: string[]): FlowValidateCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj flow validate <file.flow.loj> [--json]' };
  }
  const json = args.includes('--json');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) {
    return { error: 'Missing flow source file for loj flow validate.' };
  }
  return {
    command: 'validate',
    file,
    json,
  };
}

function parseFlowBuildArgs(args: string[]): FlowBuildCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj flow build <file.flow.loj> [--out-dir <dir>] [--json]' };
  }

  let json = false;
  let file = '';
  let outDir: string | undefined;

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
    if (!arg.startsWith('--') && !file) {
      file = arg;
    }
  }

  if (!file) {
    return { error: 'Missing flow source file for loj flow build.' };
  }
  if (!outDir) {
    outDir = 'generated/flow';
  }
  return {
    command: 'build',
    file,
    outDir,
    json,
  };
}

function parseAgentArgs(
  args: string[],
): AgentHelpCommand | AgentInstallCommandOptions | AgentAddCommandOptions | AgentExportCommandOptions | CommandParseError {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    return { help: true };
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'install':
      return parseAgentInstallArgs(rest);
    case 'add':
      return parseAgentAddArgs(rest);
    case 'export':
      return parseAgentExportArgs(rest);
    default:
      return { error: `Unknown agent command: ${subcommand}` };
  }
}

function parseAgentInstallArgs(args: string[]): AgentInstallCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj agent install <codex|windsurf|generic> [--scope user|project] [--skills-dir <dir>] [--json]' };
  }

  let json = false;
  let scope: AgentInstallScope = 'user';
  let agent: AgentRuntime | null = null;
  let skillsDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--scope') {
      const value = args[index + 1];
      if (value !== 'user' && value !== 'project') {
        return { error: 'loj agent install --scope must be "user" or "project"' };
      }
      scope = value;
      index += 1;
      continue;
    }
    if (arg === '--skills-dir') {
      skillsDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj agent install: ${arg}` };
    }
    if (agent) {
      return { error: `Unexpected extra argument for loj agent install: ${arg}` };
    }
    agent = normalizeAgentRuntime(arg);
    if (!agent) {
      return { error: `Unsupported agent runtime for loj agent install: ${arg}` };
    }
  }

  if (!agent) {
    return { error: 'Missing agent runtime for loj agent install.' };
  }
  if (skillsDir !== undefined && skillsDir.trim().length === 0) {
    return { error: 'Missing directory after --skills-dir for loj agent install.' };
  }
  if (agent === 'generic' && (!skillsDir || skillsDir.trim().length === 0)) {
    return { error: 'loj agent install generic requires --skills-dir <dir>.' };
  }

  return {
    command: 'install',
    agent,
    scope,
    skillsDir,
    json,
  };
}

function parseAgentAddArgs(args: string[]): AgentAddCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj agent add <codex|windsurf|generic> --from <source> [--scope user|project] [--skills-dir <dir>] [--json]' };
  }

  let json = false;
  let scope: AgentInstallScope = 'user';
  let agent: AgentRuntime | null = null;
  let source = '';
  let skillsDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--scope') {
      const value = args[index + 1];
      if (value !== 'user' && value !== 'project') {
        return { error: 'loj agent add --scope must be "user" or "project"' };
      }
      scope = value;
      index += 1;
      continue;
    }
    if (arg === '--from') {
      source = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--skills-dir') {
      skillsDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj agent add: ${arg}` };
    }
    if (agent) {
      return { error: `Unexpected extra argument for loj agent add: ${arg}` };
    }
    agent = normalizeAgentRuntime(arg);
    if (!agent) {
      return { error: `Unsupported agent runtime for loj agent add: ${arg}` };
    }
  }

  if (!agent) {
    return { error: 'Missing agent runtime for loj agent add.' };
  }
  if (source.trim().length === 0) {
    return { error: 'Missing --from <source> for loj agent add.' };
  }
  if (skillsDir !== undefined && skillsDir.trim().length === 0) {
    return { error: 'Missing directory after --skills-dir for loj agent add.' };
  }
  if (agent === 'generic' && (!skillsDir || skillsDir.trim().length === 0)) {
    return { error: 'loj agent add generic requires --skills-dir <dir>.' };
  }

  return {
    command: 'add',
    agent,
    scope,
    source,
    skillsDir,
    json,
  };
}

function parseAgentExportArgs(args: string[]): AgentExportCommandOptions | CommandParseError {
  if (args.length === 0) {
    return { error: 'Usage: loj agent export <codex|windsurf|generic> --out-dir <dir> [--json]' };
  }

  let json = false;
  let agent: AgentRuntime | null = null;
  let outDir = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option for loj agent export: ${arg}` };
    }
    if (agent) {
      return { error: `Unexpected extra argument for loj agent export: ${arg}` };
    }
    agent = normalizeAgentRuntime(arg);
    if (!agent) {
      return { error: `Unsupported agent runtime for loj agent export: ${arg}` };
    }
  }

  if (!agent) {
    return { error: 'Missing agent runtime for loj agent export.' };
  }
  if (outDir.trim().length === 0) {
    return { error: 'Missing --out-dir for loj agent export.' };
  }

  return {
    command: 'export',
    agent,
    outDir,
    json,
  };
}

function loadProject(projectFile: string, cwd: string, shellEnv: Record<string, string | undefined>): LoadedProjectConfig | { error: string } {
  const absoluteFile = resolve(cwd, projectFile);
  try {
    const source = readFileSync(absoluteFile, 'utf8');
    const document = YAML.parseDocument(source, { merge: false, uniqueKeys: true });
    if (document.errors.length > 0) {
      return {
        error: document.errors.map((entry) => entry.message).join('; '),
      };
    }
    const parsed = document.toJSON();
    const targetAliases = collectProjectTargetAliases(parsed);
    const loadedEnvironment = loadProjectEnvironment(dirname(absoluteFile), targetAliases, shellEnv);
    if ('error' in loadedEnvironment) {
      return loadedEnvironment;
    }
    const normalized = normalizeProjectConfig(
      parsed,
      projectFile,
      dirname(absoluteFile),
      loadedEnvironment.environment,
    );
    if ('error' in normalized) {
      return normalized;
    }
    return {
      project: normalized.project,
      environment: loadedEnvironment.environment,
    };
  } catch (error) {
    return {
      error: `Failed to read ${projectFile}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function normalizeProjectConfig(
  value: unknown,
  projectFile: string,
  projectDir: string,
  environment: ProjectEnvironment,
): { project: LojProjectConfig } | { error: string } {
  if (!isRecord(value)) {
    return { error: 'loj.project.yaml must be a YAML mapping at the top level' };
  }

  if (value.shared !== undefined) {
    return { error: 'shared is reserved for future target-neutral schemas and is not supported yet' };
  }

  const app = value.app;
  if (!isRecord(app)) {
    return { error: 'app must be a mapping with at least app.name' };
  }
  if (typeof app.name !== 'string' || app.name.trim().length === 0) {
    return { error: 'app.name must be a non-empty string' };
  }

  const targetsValue = value.targets;
  if (!isRecord(targetsValue)) {
    return { error: 'targets must be a mapping of named target entries' };
  }

  const targets: LojTargetConfig[] = [];
  for (const [alias, targetValue] of Object.entries(targetsValue)) {
    if (!isRecord(targetValue)) {
      return { error: `target "${alias}" must be a mapping` };
    }
    const normalizedType = normalizeTargetType(targetValue.type);
    if (!normalizedType) {
      return { error: `target "${alias}" must set type to "web", "api", "rdsl", or "sdsl"` };
    }
    if (typeof targetValue.entry !== 'string' || targetValue.entry.trim().length === 0) {
      return { error: `target "${alias}" must set a non-empty entry path` };
    }
    if (!isRelativeProjectPath(targetValue.entry)) {
      return { error: `target "${alias}" entry must be a relative path: "${targetValue.entry}"` };
    }
    if (targetValue.outDir !== undefined) {
      if (typeof targetValue.outDir !== 'string' || targetValue.outDir.trim().length === 0) {
        return { error: `target "${alias}" outDir must be a non-empty string when provided` };
      }
      if (!isRelativeProjectPath(targetValue.outDir)) {
        return { error: `target "${alias}" outDir must be a relative path: "${targetValue.outDir}"` };
      }
    }
    const normalizedDatabase = normalizeTargetDatabaseConfig(targetValue.database, alias, normalizedType, app.name);
    if ('error' in normalizedDatabase) {
      return normalizedDatabase;
    }
    const normalizedRuntime = normalizeTargetRuntimeConfig(targetValue.runtime, alias, normalizedType);
    if ('error' in normalizedRuntime) {
      return normalizedRuntime;
    }
    targets.push({
      alias,
      type: normalizedType,
      legacyTypeAlias: targetValue.type === 'rdsl' || targetValue.type === 'sdsl' ? targetValue.type : undefined,
      entry: normalizePath(targetValue.entry),
      outDir: typeof targetValue.outDir === 'string' ? normalizePath(targetValue.outDir) : undefined,
      database: normalizedDatabase.database,
      runtime: normalizedRuntime.runtime,
    });
  }

  if (targets.length === 0) {
    return { error: 'targets must define at least one target entry' };
  }

  const dev = normalizeProjectDevConfig(value.dev, targets, environment);
  if ('error' in dev) {
    return dev;
  }

  return {
    project: {
      appName: app.name,
      projectFile: normalizePath(projectFile),
      projectDir,
      targets,
      dev: dev.dev,
    },
  };
}

function normalizeProjectDevConfig(
  value: unknown,
  targets: LojTargetConfig[],
  environment: ProjectEnvironment,
): { dev?: LojProjectDevConfig } | { error: string } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return { error: 'dev must be a mapping when provided' };
  }

  const targetByAlias = new Map(targets.map((target) => [target.alias, target]));
  let serverConfig: LojDevServerConfig | undefined;
  let hostConfig: LojDevHostConfig | undefined;

  if (value.server !== undefined) {
    if (!isRecord(value.server)) {
      return { error: 'dev.server must be a mapping' };
    }
    if (typeof value.server.target !== 'string' || value.server.target.trim().length === 0) {
      return { error: 'dev.server.target must be a non-empty string' };
    }
    const serverTarget = targetByAlias.get(value.server.target);
    if (!serverTarget) {
      return { error: `dev.server.target must reference an existing target alias: "${value.server.target}"` };
    }
    if (serverTarget.type !== 'sdsl') {
      return { error: `dev.server.target must reference an api target (legacy: sdsl): "${value.server.target}"` };
    }
    const parsedPort = normalizePort(environment.devOverrides.serverPort ?? value.server.port, 3001);
    if ('error' in parsedPort) {
      return { error: `dev.server.port ${parsedPort.error}` };
    }
    serverConfig = {
      target: value.server.target,
      host: environment.devOverrides.serverHost
        ?? (typeof value.server.host === 'string' && value.server.host.trim().length > 0 ? value.server.host.trim() : '127.0.0.1'),
      port: parsedPort.port,
    };
  }

  if (value.host !== undefined) {
    if (!isRecord(value.host)) {
      return { error: 'dev.host must be a mapping' };
    }
    if (value.host.type !== undefined && value.host.type !== 'react-vite') {
      return { error: 'dev.host.type must be "react-vite" when provided' };
    }
    if (typeof value.host.target !== 'string' || value.host.target.trim().length === 0) {
      return { error: 'dev.host.target must be a non-empty string' };
    }
    const hostTarget = targetByAlias.get(value.host.target);
    if (!hostTarget) {
      return { error: `dev.host.target must reference an existing target alias: "${value.host.target}"` };
    }
    if (hostTarget.type !== 'rdsl') {
      return { error: `dev.host.target must reference a web target (legacy: rdsl): "${value.host.target}"` };
    }
    if (typeof value.host.dir !== 'string' || value.host.dir.trim().length === 0) {
      return { error: 'dev.host.dir must be a non-empty relative path' };
    }
    if (!isRelativeProjectPath(value.host.dir)) {
      return { error: `dev.host.dir must be a relative path: "${value.host.dir}"` };
    }
    const port = normalizePort(environment.devOverrides.hostPort ?? value.host.port, 5173);
    if ('error' in port) {
      return { error: `dev.host.port ${port.error}` };
    }
    const previewPort = normalizePort(environment.devOverrides.hostPreviewPort ?? value.host.previewPort, 4173);
    if ('error' in previewPort) {
      return { error: `dev.host.previewPort ${previewPort.error}` };
    }
    const apiBase = environment.devOverrides.apiBase
      ?? (typeof value.host.apiBase === 'string' && value.host.apiBase.trim().length > 0
        ? value.host.apiBase.trim()
        : '/api');
    let proxyTarget = typeof value.host.proxyTarget === 'string' && value.host.proxyTarget.trim().length > 0
      ? value.host.proxyTarget.trim()
      : undefined;
    const proxyAuth = environment.devOverrides.proxyAuth
      ?? (typeof value.host.proxyAuth === 'string' && value.host.proxyAuth.trim().length > 0
        ? value.host.proxyAuth.trim()
        : undefined);
    if (!proxyTarget && serverConfig) {
      proxyTarget = serverConfig.target;
    }
    if (proxyTarget) {
      const proxyTargetConfig = targetByAlias.get(proxyTarget);
      if (!proxyTargetConfig) {
        return { error: `dev.host.proxyTarget must reference an existing target alias: "${proxyTarget}"` };
      }
      if (proxyTargetConfig.type !== 'sdsl') {
        return { error: `dev.host.proxyTarget must reference an api target (legacy: sdsl): "${proxyTarget}"` };
      }
      if (!serverConfig) {
        return { error: 'dev.host.proxyTarget requires dev.server so loj dev can run the backend locally' };
      }
      if (serverConfig.target !== proxyTarget) {
        return { error: 'dev.host.proxyTarget must match dev.server.target in the first implementation' };
      }
      if (!apiBase.startsWith('/')) {
        return { error: 'dev.host.apiBase must start with "/" when proxyTarget is configured' };
      }
    }
    hostConfig = {
      type: 'react-vite',
      target: value.host.target,
      dir: normalizePath(value.host.dir),
      host: environment.devOverrides.hostHost
        ?? (typeof value.host.host === 'string' && value.host.host.trim().length > 0 ? value.host.host.trim() : '127.0.0.1'),
      port: port.port,
      previewPort: previewPort.port,
      apiBase,
      proxyTarget,
      proxyAuth,
    };
  }

  if (!hostConfig && !serverConfig) {
    return {};
  }

  return {
    dev: {
      host: hostConfig,
      server: serverConfig,
    },
  };
}

function normalizeTargetDatabaseConfig(
  value: unknown,
  alias: string,
  targetType: TargetType,
  appName: string,
): { database?: LojTargetDatabaseConfig } | { error: string } {
  if (value === undefined) {
    return {};
  }
  if (targetType !== 'sdsl') {
    return { error: `target "${alias}" database config is only supported on api targets` };
  }
  if (!isRecord(value)) {
    return { error: `target "${alias}" database must be a mapping` };
  }

  const vendor = normalizeProjectDatabaseVendor(value.vendor);
  if (!vendor) {
    return { error: `target "${alias}" database.vendor must be one of "h2", "sqlite", "postgres", "mysql", "mariadb", "sqlserver", or "oracle"` };
  }
  const mode = normalizeProjectDatabaseMode(value.mode) ?? defaultDatabaseMode(vendor);
  if ((vendor === 'h2' || vendor === 'sqlite') && mode !== 'embedded') {
    return { error: `target "${alias}" database.mode "${mode}" is not supported for ${vendor}; use embedded or omit mode` };
  }
  if (vendorSupportsComposeMode(vendor) === false && mode === 'docker-compose') {
    return { error: `target "${alias}" database.mode "docker-compose" is not supported for ${vendor}; use external or omit mode` };
  }
  if ((vendor === 'postgres' || vendor === 'mysql' || vendor === 'mariadb' || vendor === 'sqlserver' || vendor === 'oracle') && mode === 'embedded') {
    return { error: `target "${alias}" database.mode "embedded" is not supported for ${vendor}` };
  }
  const migrations = normalizeProjectDatabaseMigrations(value.migrations) ?? 'none';
  if (vendor === 'sqlite' && migrations === 'flyway') {
    return { error: `target "${alias}" database.migrations "flyway" is not supported for sqlite` };
  }
  const autoProvision = value.autoProvision === true;
  if (autoProvision && mode !== 'docker-compose') {
    return { error: `target "${alias}" database.autoProvision requires database.mode "docker-compose"` };
  }
  if (autoProvision && !vendorSupportsComposeMode(vendor)) {
    return { error: `target "${alias}" database.autoProvision is not supported for ${vendor}` };
  }

  const parsedPort = normalizeOptionalPort(value.port);
  if ('error' in parsedPort) {
    return { error: `target "${alias}" database.port ${parsedPort.error}` };
  }
  const host = typeof value.host === 'string' && value.host.trim().length > 0
    ? value.host.trim()
    : undefined;
  const name = typeof value.name === 'string' && value.name.trim().length > 0
    ? value.name.trim()
    : defaultDatabaseName(appName, vendor);
  const username = typeof value.username === 'string' && value.username.trim().length > 0
    ? value.username.trim()
    : defaultDatabaseUsername(vendor);
  const password = typeof value.password === 'string'
    ? value.password
    : defaultDatabasePassword(vendor);

  if ((vendor === 'postgres' || vendor === 'mysql' || vendor === 'mariadb' || vendor === 'sqlserver' || vendor === 'oracle') && host === undefined && mode === 'external') {
    return {
      database: {
        vendor,
        mode,
        name,
        host: '127.0.0.1',
        port: parsedPort.port ?? defaultDatabasePort(vendor),
        username,
        password,
        migrations,
        autoProvision,
      },
    };
  }

  return {
    database: {
      vendor,
      mode,
      name,
      host,
      port: parsedPort.port ?? defaultDatabasePort(vendor),
      username,
      password,
      migrations,
      autoProvision,
    },
  };
}

function normalizeTargetRuntimeConfig(
  value: unknown,
  alias: string,
  targetType: TargetType,
): { runtime?: LojTargetRuntimeConfig } | { error: string } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return { error: `target "${alias}" runtime must be a mapping` };
  }

  let basePath: string | undefined;
  if (value.basePath !== undefined) {
    const normalizedBasePath = normalizeRuntimeBasePath(value.basePath, alias);
    if ('error' in normalizedBasePath) {
      return normalizedBasePath;
    }
    basePath = normalizedBasePath.basePath;
  }

  if (targetType === 'rdsl') {
    const unsupportedRuntimeField = ['shutdown', 'health', 'readiness', 'drain', 'cors', 'forwardedHeaders', 'trustedProxy', 'requestSizeLimit']
      .find((key) => value[key] !== undefined);
    if (unsupportedRuntimeField) {
      return { error: `target "${alias}" runtime.${unsupportedRuntimeField} is only supported on api targets` };
    }
    return {
      runtime: basePath
        ? { basePath }
        : {},
    };
  }
  if (targetType !== 'sdsl') {
    return { error: `target "${alias}" runtime config is only supported on api targets` };
  }

  let shutdown: LojTargetRuntimeShutdownConfig | undefined;
  let health: LojTargetRuntimeProbeConfig | undefined;
  let readiness: LojTargetRuntimeProbeConfig | undefined;
  let drain: LojTargetRuntimeProbeConfig | undefined;
  let cors: LojTargetRuntimeCorsConfig | undefined;
  let forwardedHeaders: LojTargetRuntimeForwardedHeadersConfig | undefined;
  let trustedProxy: LojTargetRuntimeTrustedProxyConfig | undefined;
  let requestSizeLimit: LojTargetRuntimeRequestSizeLimitConfig | undefined;
  if (value.shutdown !== undefined) {
    if (!isRecord(value.shutdown)) {
      return { error: `target "${alias}" runtime.shutdown must be a mapping` };
    }
    const mode = value.shutdown.mode === undefined
      ? 'graceful'
      : normalizeProjectRuntimeShutdownMode(value.shutdown.mode);
    if (!mode) {
      return { error: `target "${alias}" runtime.shutdown.mode must be "graceful" or "immediate"` };
    }
    const normalizedTimeout = normalizeShutdownTimeout(value.shutdown.timeout);
    if ('error' in normalizedTimeout) {
      return { error: `target "${alias}" runtime.shutdown.timeout ${normalizedTimeout.error}` };
    }
    shutdown = {
      mode,
      timeout: normalizedTimeout.timeout,
      timeoutSeconds: normalizedTimeout.timeoutSeconds,
    };
  }
  if (value.health !== undefined) {
    const normalizedProbe = normalizeRuntimeProbeConfig(value.health, alias, 'health');
    if ('error' in normalizedProbe) {
      return normalizedProbe;
    }
    health = normalizedProbe.probe;
  }
  if (value.readiness !== undefined) {
    const normalizedProbe = normalizeRuntimeProbeConfig(value.readiness, alias, 'readiness');
    if ('error' in normalizedProbe) {
      return normalizedProbe;
    }
    readiness = normalizedProbe.probe;
  }
  if (value.drain !== undefined) {
    const normalizedProbe = normalizeRuntimeProbeConfig(value.drain, alias, 'drain');
    if ('error' in normalizedProbe) {
      return normalizedProbe;
    }
    drain = normalizedProbe.probe;
  }
  if (value.cors !== undefined) {
    const normalizedCors = normalizeRuntimeCorsConfig(value.cors, alias);
    if ('error' in normalizedCors) {
      return normalizedCors;
    }
    cors = normalizedCors.cors;
  }
  if (value.forwardedHeaders !== undefined) {
    const normalizedForwardedHeaders = normalizeRuntimeForwardedHeadersConfig(value.forwardedHeaders, alias);
    if ('error' in normalizedForwardedHeaders) {
      return normalizedForwardedHeaders;
    }
    forwardedHeaders = normalizedForwardedHeaders.forwardedHeaders;
  }
  if (value.trustedProxy !== undefined) {
    const normalizedTrustedProxy = normalizeRuntimeTrustedProxyConfig(value.trustedProxy, alias);
    if ('error' in normalizedTrustedProxy) {
      return normalizedTrustedProxy;
    }
    trustedProxy = normalizedTrustedProxy.trustedProxy;
  }
  if (value.requestSizeLimit !== undefined) {
    const normalizedRequestSizeLimit = normalizeRuntimeRequestSizeLimit(value.requestSizeLimit, alias);
    if ('error' in normalizedRequestSizeLimit) {
      return normalizedRequestSizeLimit;
    }
    requestSizeLimit = normalizedRequestSizeLimit.requestSizeLimit;
  }
  if (trustedProxy && (!forwardedHeaders || forwardedHeaders.mode === 'none')) {
    forwardedHeaders = { mode: 'standard' };
  }

  return {
    runtime: basePath || shutdown || health || readiness || drain || cors || forwardedHeaders || trustedProxy || requestSizeLimit
      ? { basePath, shutdown, health, readiness, drain, cors, forwardedHeaders, trustedProxy, requestSizeLimit }
      : {},
  };
}

function normalizeRuntimeBasePath(
  value: unknown,
  alias: string,
): { basePath: string } | { error: string } {
  if (typeof value !== 'string') {
    return { error: `target "${alias}" runtime.basePath must be a string starting with "/"` };
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    return { error: `target "${alias}" runtime.basePath must start with "/"` };
  }
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return { error: `target "${alias}" runtime.basePath must not end with "/" unless it is "/"` };
  }
  return { basePath: trimmed };
}

function normalizeRuntimeProbeConfig(
  value: unknown,
  alias: string,
  key: 'health' | 'readiness' | 'drain',
): { probe: LojTargetRuntimeProbeConfig } | { error: string } {
  if (!isRecord(value)) {
    return { error: `target "${alias}" runtime.${key} must be a mapping` };
  }
  if (typeof value.path !== 'string' || value.path.trim().length === 0) {
    return { error: `target "${alias}" runtime.${key}.path must be a non-empty string` };
  }
  const path = value.path.trim();
  if (!path.startsWith('/')) {
    return { error: `target "${alias}" runtime.${key}.path must start with "/"` };
  }
  return { probe: { path } };
}

function normalizeRuntimeCorsConfig(
  value: unknown,
  alias: string,
): { cors: LojTargetRuntimeCorsConfig } | { error: string } {
  if (!isRecord(value)) {
    return { error: `target "${alias}" runtime.cors must be a mapping` };
  }
  const origins = normalizeStringArrayConfig(value.origins, `target "${alias}" runtime.cors.origins`);
  if ('error' in origins) {
    return origins;
  }
  const methods = normalizeOptionalStringArrayConfig(value.methods, `target "${alias}" runtime.cors.methods`);
  if ('error' in methods) {
    return methods;
  }
  const headers = normalizeOptionalStringArrayConfig(value.headers, `target "${alias}" runtime.cors.headers`);
  if ('error' in headers) {
    return headers;
  }
  if (typeof value.credentials !== 'boolean' && value.credentials !== undefined) {
    return { error: `target "${alias}" runtime.cors.credentials must be a boolean when provided` };
  }
  return {
    cors: {
      origins: origins.values,
      methods: methods.values,
      headers: headers.values,
      credentials: value.credentials === true,
    },
  };
}

function normalizeRuntimeForwardedHeadersConfig(
  value: unknown,
  alias: string,
): { forwardedHeaders: LojTargetRuntimeForwardedHeadersConfig } | { error: string } {
  if (!isRecord(value)) {
    return { error: `target "${alias}" runtime.forwardedHeaders must be a mapping` };
  }
  const mode = value.mode === undefined ? 'standard' : normalizeProjectRuntimeForwardedHeadersMode(value.mode);
  if (!mode) {
    return { error: `target "${alias}" runtime.forwardedHeaders.mode must be "none" or "standard"` };
  }
  return { forwardedHeaders: { mode } };
}

function normalizeRuntimeTrustedProxyConfig(
  value: unknown,
  alias: string,
): { trustedProxy: LojTargetRuntimeTrustedProxyConfig } | { error: string } {
  if (!isRecord(value)) {
    return { error: `target "${alias}" runtime.trustedProxy must be a mapping` };
  }
  const mode = value.mode === undefined ? 'local' : normalizeProjectRuntimeTrustedProxyMode(value.mode);
  if (!mode) {
    return { error: `target "${alias}" runtime.trustedProxy.mode must be "local", "all", or "cidrs"` };
  }
  const cidrs = normalizeOptionalStringArrayConfig(value.cidrs, `target "${alias}" runtime.trustedProxy.cidrs`);
  if ('error' in cidrs) {
    return cidrs;
  }
  if (mode === 'cidrs') {
    if (!cidrs.values || cidrs.values.length === 0) {
      return { error: `target "${alias}" runtime.trustedProxy.cidrs must be a non-empty string array when mode is "cidrs"` };
    }
    return { trustedProxy: { mode, cidrs: cidrs.values } };
  }
  if (cidrs.values) {
    return { error: `target "${alias}" runtime.trustedProxy.cidrs is only allowed when mode is "cidrs"` };
  }
  return { trustedProxy: { mode } };
}

function normalizeRuntimeRequestSizeLimit(
  value: unknown,
  alias: string,
): { requestSizeLimit: LojTargetRuntimeRequestSizeLimitConfig } | { error: string } {
  if (typeof value !== 'string') {
    return { error: `target "${alias}" runtime.requestSizeLimit must be a duration-free size string like "10mb" or "512kb"` };
  }
  const trimmed = value.trim().toLowerCase();
  const match = /^([1-9][0-9]*)(b|kb|mb)$/.exec(trimmed);
  if (!match) {
    return { error: `target "${alias}" runtime.requestSizeLimit must be a size string like "10mb" or "512kb"` };
  }
  const amount = Number(match[1]);
  const multiplier = match[2] === 'mb' ? 1024 * 1024 : match[2] === 'kb' ? 1024 : 1;
  return {
    requestSizeLimit: {
      source: trimmed,
      bytes: amount * multiplier,
    },
  };
}

function normalizeStringArrayConfig(
  value: unknown,
  label: string,
): { values: string[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: `${label} must be a non-empty string array` };
  }
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return { error: `${label} must only contain non-empty strings` };
    }
    values.push(entry.trim());
  }
  return { values };
}

function normalizeOptionalStringArrayConfig(
  value: unknown,
  label: string,
): { values?: string[] } | { error: string } {
  if (value === undefined) {
    return {};
  }
  return normalizeStringArrayConfig(value, label);
}

function normalizePort(value: unknown, fallback: number): { port: number } | { error: string } {
  if (value === undefined) {
    return { port: fallback };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    return { error: 'must be a positive integer' };
  }
  return { port: value };
}

function runTargetCommand(
  command: 'validate' | 'build',
  target: LojTargetConfig,
  projectDir: string,
  env: Record<string, string | undefined>,
  outDir?: string,
): TargetInvocationResult {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const args = command === 'build'
    ? [command, target.entry, '--out-dir', outDir ?? resolveTargetOutDir(target), '--project-root', '.', '--json']
    : [command, target.entry, '--project-root', '.', '--json'];

  const exitCode = target.type === 'rdsl'
    ? runReactCli(args, {
      cwd: projectDir,
      env,
      stdout: (text: string) => stdoutChunks.push(text),
      stderr: (text: string) => stderrChunks.push(text),
    })
    : runSpringCli(args, {
      cwd: projectDir,
      env,
      stdout: (text: string) => stdoutChunks.push(text),
      stderr: (text: string) => stderrChunks.push(text),
    });

  const stdout = stdoutChunks.join('');
  const stderr = stderrChunks.join('');
  const parsedPayload = parseJsonPayload(stdout);
  return {
    alias: target.alias,
    type: target.type,
    entry: target.entry,
    outDir: command === 'build' ? outDir ?? resolveTargetOutDir(target) : undefined,
    success: exitCode === 0 && parsedPayload !== undefined && parsedPayload.success !== false,
    payload: parsedPayload,
    stdout,
    stderr,
    exitCode,
  };
}

function startDevSession(
  options: DevCommandOptions,
  initialLoadedProject: LoadedProjectConfig,
  context: CommandContext,
): DevSession {
  let closed = false;
  let lastProjectChangeAt = 0;
  let currentProject = initialLoadedProject.project;
  let currentEnvironment = initialLoadedProject.environment;
  let session: DevSession;

  const projectAbsoluteFile = resolveProjectAbsoluteFile(options.projectFile, context.cwd);
  const projectDirectory = dirname(projectAbsoluteFile);
  const projectFileName = basename(projectAbsoluteFile);
  const sessionStateFile = resolveDevSessionStateFile(projectAbsoluteFile);
  const sessionCommandFile = resolveDevSessionCommandFile(projectAbsoluteFile);
  mkdirSync(dirname(sessionStateFile), { recursive: true });
  const startedAt = new Date().toISOString();
  let watchedProjectFiles = collectProjectEnvironmentFileNames(initialLoadedProject.project.targets.map((target) => target.alias));
  watchedProjectFiles.add(projectFileName);
  const targetSessions = new Map<string, TargetDevSession>();
  const managedProcesses = new Map<string, ManagedProcessState>();
  const databaseProvisions = new Map<string, DatabaseProvisionState>();
  let lastDevSummary: ProjectDevSummary = {};

  const persistDevSessionState = () => {
    if (closed) {
      return;
    }
    writeDevSessionStateFile(sessionStateFile, {
      artifact: 'loj.dev.session',
      schemaVersion: 1,
      projectFile: normalizePath(projectAbsoluteFile),
      app: {
        name: currentProject.appName,
      },
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      debug: options.debug,
      targets: currentProject.targets.map((target) => ({
        alias: target.alias,
        type: presentTargetType(target.type),
        entry: target.entry,
        outDir: resolveTargetOutDir(target),
      })),
      dev: {
        hostUrl: lastDevSummary.hostUrl,
        backendUrl: lastDevSummary.backendUrl,
        apiBase: lastDevSummary.apiBase,
        proxyUrl: lastDevSummary.proxyUrl,
        hostDir: lastDevSummary.hostDir,
      },
      debuggers: sortProjectDebuggers(lastDevSummary.debuggers ?? []),
      services: sortDevSessionServices(Array.from(managedProcesses.values()).map((state) => ({
        kind: state.spec.kind,
        targetAlias: state.spec.targetAlias,
        url: state.spec.url,
        description: state.spec.description,
      }))),
      databases: sortDevSessionDatabases(Array.from(databaseProvisions.values()).map((state) => ({
        targetAlias: state.spec.targetAlias,
        phase: state.phase,
        composeFile: normalizePath(relative(projectDirectory, state.spec.composeFile)),
      }))),
    });
  };

  const handleProcessSignal = () => {
    if (closed) {
      return;
    }
    session.close();
  };
  process.on('SIGINT', handleProcessSignal);
  process.on('SIGTERM', handleProcessSignal);
  const projectWatcher = context.runtime.watch(projectDirectory, (_eventType, fileName) => {
    if (closed || !fileName || !watchedProjectFiles.has(fileName)) {
      return;
    }

    const now = Date.now();
    if (now - lastProjectChangeAt < 40) {
      return;
    }
    lastProjectChangeAt = now;

    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'project',
        status: 'change',
        projectFile: options.projectFile,
        changedFile: fileName,
      })}\n`);
    } else {
      context.stdout(`${fileName === projectFileName ? 'Project file changed' : 'Project env changed'}: ${fileName}\n`);
    }

    reloadProjectConfig();
  });
  const sessionDirectoryWatcher = context.runtime.watch(dirname(sessionStateFile), (_eventType, fileName) => {
    if (closed) {
      return;
    }
    if (fileName && fileName !== basename(sessionCommandFile)) {
      return;
    }
    const command = readDevSessionCommand(sessionCommandFile);
    if (!command) {
      return;
    }
    deleteDevSessionCommandFile(sessionCommandFile);
    dispatchDevSessionCommand(command);
  });

  const writeManagedProcessLine = (kind: ManagedProcessKind, line: string, stream: 'stdout' | 'stderr') => {
    const prefix = kind === 'host' ? '[host]' : '[backend-server]';
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'service-log',
        service: kind,
        stream,
        text: line,
      })}\n`);
      return;
    }
    const sink = stream === 'stderr' ? context.stderr : context.stdout;
    sink(`${prefix} ${line}\n`);
  };

  const stopManagedProcess = (state: ManagedProcessState, signal = 'SIGINT') => {
    state.restarting = true;
    state.process.close(signal);
  };

  const closeAllManagedProcesses = () => {
    for (const state of managedProcesses.values()) {
      stopManagedProcess(state);
    }
    managedProcesses.clear();
  };

  const reportManagedProcessFailure = (message: string) => {
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'service',
        status: 'failure',
        projectFile: options.projectFile,
        error: message,
      })}\n`);
      return;
    }
    context.stderr(`Loj dev service failed: ${message}\n`);
  };

  const emitManagedProcessSummary = (summary: ProjectDevSummary) => {
    lastDevSummary = summary;
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'dev-summary',
        projectFile: options.projectFile,
        hostUrl: summary.hostUrl ?? null,
        backendUrl: summary.backendUrl ?? null,
        apiBase: summary.apiBase ?? null,
        proxyUrl: summary.proxyUrl ?? null,
        hostDir: summary.hostDir ?? null,
      })}\n`);
      return;
    }
    if (summary.hostUrl) {
      context.stdout(`host url: ${summary.hostUrl}\n`);
    }
    if (summary.backendUrl) {
      context.stdout(`backend url: ${summary.backendUrl}\n`);
    }
    if (summary.proxyUrl && summary.apiBase) {
      context.stdout(`api proxy: ${summary.apiBase} -> ${summary.proxyUrl}\n`);
    }
    if (summary.hostDir) {
      context.stdout(`host dir: ${summary.hostDir}\n`);
    }
    persistDevSessionState();
  };

  const writeDatabaseProvisionLine = (line: string, stream: 'stdout' | 'stderr') => {
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'database-log',
        stream,
        text: line,
      })}\n`);
      return;
    }
    const sink = stream === 'stderr' ? context.stderr : context.stdout;
    sink(`[database] ${line}\n`);
  };

  const stopDatabaseProvision = (state: DatabaseProvisionState, deleteAfter = true) => {
    if (state.phase === 'stopping') {
      return;
    }
    state.phase = 'stopping';
    persistDevSessionState();
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'database',
        status: 'stopping',
        target: state.spec.targetAlias,
        composeFile: normalizePath(relative(projectDirectory, state.spec.composeFile)),
      })}\n`);
    } else {
      context.stdout(`Stopping database auto-provision: ${state.spec.targetAlias}\n`);
    }
    const process = context.runtime.spawn('docker', [
      'compose',
      '-p',
      state.spec.projectName,
      '-f',
      state.spec.composeFile,
      'down',
    ], {
      cwd: state.spec.cwd,
      env: state.spec.env,
      onStdoutLine(line) {
        writeDatabaseProvisionLine(line, 'stdout');
      },
      onStderrLine(line) {
        writeDatabaseProvisionLine(line, 'stderr');
      },
      onExit(code, signal) {
        if (deleteAfter) {
          databaseProvisions.delete(state.spec.key);
        }
        if (closed) {
          return;
        }
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0) {
          reportManagedProcessFailure(`database compose down failed for ${state.spec.targetAlias} with ${signal ?? exitCode}`);
        }
        persistDevSessionState();
      },
    });
    state.process = process;
  };

  const closeAllDatabaseProvisions = () => {
    for (const state of databaseProvisions.values()) {
      stopDatabaseProvision(state);
    }
    databaseProvisions.clear();
  };

  const startDatabaseProvision = (spec: DatabaseProvisionSpec) => {
    if (!context.runtime.exists(spec.composeFile)) {
      return;
    }
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'database',
        status: 'starting',
        target: spec.targetAlias,
        composeFile: normalizePath(relative(projectDirectory, spec.composeFile)),
      })}\n`);
    } else {
      context.stdout(`Starting database auto-provision: ${spec.targetAlias}\n`);
    }

    const state: DatabaseProvisionState = { spec, phase: 'starting' };
    persistDevSessionState();
    const process = context.runtime.spawn('docker', [
      'compose',
      '-p',
      spec.projectName,
      '-f',
      spec.composeFile,
      'up',
      '-d',
    ], {
      cwd: spec.cwd,
      env: spec.env,
      onStdoutLine(line) {
        writeDatabaseProvisionLine(line, 'stdout');
      },
      onStderrLine(line) {
        writeDatabaseProvisionLine(line, 'stderr');
      },
      onExit(code, signal) {
        if (closed) {
          return;
        }
        const current = databaseProvisions.get(spec.key);
        if (!current || current.spec.signature !== spec.signature) {
          return;
        }
        current.process = undefined;
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0) {
          databaseProvisions.delete(spec.key);
          reportManagedProcessFailure(`database compose up failed for ${spec.targetAlias} with ${signal ?? exitCode}`);
          return;
        }
        current.phase = 'ready';
        persistDevSessionState();
        if (options.json) {
          context.stdout(`${JSON.stringify({
            event: 'database',
            status: 'ready',
            target: spec.targetAlias,
            composeFile: normalizePath(relative(projectDirectory, spec.composeFile)),
          })}\n`);
        } else {
          context.stdout(`Database auto-provision ready: ${spec.targetAlias}\n`);
        }
        reconcileManagedProcesses(currentProject, currentEnvironment);
      },
    });
    state.process = process;
    databaseProvisions.set(spec.key, state);
  };

  const startManagedProcess = (spec: ManagedProcessSpec): void => {
    if (spec.preflightPath && !context.runtime.exists(spec.preflightPath)) {
      reportManagedProcessFailure(spec.preflightError ?? `Missing required path: ${spec.preflightPath}`);
      return;
    }
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'service',
        status: 'starting',
        service: spec.kind,
        target: spec.targetAlias,
        url: spec.url,
      })}\n`);
    } else {
      context.stdout(`Starting ${spec.description}: ${spec.url}\n`);
    }
    if (options.debug && !options.json) {
      context.stdout(`command: ${spec.command} ${spec.args.join(' ')}\n`);
      context.stdout(`cwd: ${normalizePath(spec.cwd)}\n`);
    }

    const state: ManagedProcessState = {
      spec,
      restarting: false,
      process: context.runtime.spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        onStdoutLine(line) {
          writeManagedProcessLine(spec.kind, line, 'stdout');
        },
        onStderrLine(line) {
          writeManagedProcessLine(spec.kind, line, 'stderr');
        },
        onExit(code, signal) {
          if (closed || state.restarting) {
            return;
          }
          managedProcesses.delete(spec.key);
          const exitCode = code ?? (signal ? 1 : 0);
          if (options.json) {
            context.stdout(`${JSON.stringify({
              event: 'service',
              status: 'exited',
              service: spec.kind,
              target: spec.targetAlias,
              url: spec.url,
              code: exitCode,
              signal,
            })}\n`);
          } else {
            context.stderr(`${spec.description} exited with ${signal ?? exitCode}\n`);
          }
          if (exitCode !== 0) {
            process.exitCode = exitCode;
          }
          session.close();
        },
      }),
    };

    managedProcesses.set(spec.key, state);
    persistDevSessionState();
  };

  const restartManagedProcess = (key: string, reason: string) => {
    const existing = managedProcesses.get(key);
    if (!existing) {
      return;
    }
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'service',
        status: 'restarting',
        service: existing.spec.kind,
        target: existing.spec.targetAlias,
        reason,
      })}\n`);
    } else {
      context.stdout(`Restarting ${existing.spec.description}: ${reason}\n`);
    }
    managedProcesses.delete(key);
    stopManagedProcess(existing, 'SIGTERM');
    startManagedProcess(existing.spec);
    persistDevSessionState();
  };

  const dispatchDevSessionCommand = (command: DevSessionCommandArtifact) => {
    if (closed) {
      return;
    }
    if (command.command === 'rebuild') {
      const selectedAliases = command.targetAliases.length > 0
        ? new Set(command.targetAliases)
        : undefined;
      if (!options.json) {
        context.stdout(`Rebuild requested: ${selectedAliases ? Array.from(selectedAliases).join(', ') : 'all active targets'}\n`);
      }
      for (const [alias, targetSession] of targetSessions) {
        if (selectedAliases && !selectedAliases.has(alias)) {
          continue;
        }
        targetSession.session.rebuild('manual');
      }
      return;
    }

    const selectedServices = new Set(command.services);
    if (!options.json) {
      context.stdout(`Restart requested: ${Array.from(selectedServices).join(', ')}\n`);
    }
    for (const service of selectedServices) {
      restartManagedProcess(service, 'manual restart requested');
    }
  };

  const buildManagedProcessSpecs = (
    project: LojProjectConfig,
    environment: ProjectEnvironment,
  ): { specs: ManagedProcessSpec[]; summary: ProjectDevSummary } => {
    const specs: ManagedProcessSpec[] = [];
    const summary: ProjectDevSummary = {};
    const dev = project.dev;
    if (!dev) {
      return { specs, summary };
    }

    const server = dev.server;
    if (server) {
      const target = targetSessions.get(server.target);
      if (target) {
        const serverTargetConfig = project.targets.find((candidate) => candidate.alias === server.target);
        const serverBasePath = serverTargetConfig?.runtime?.basePath;
        if (serverTargetConfig?.database?.autoProvision && serverTargetConfig.database.mode === 'docker-compose') {
          const provision = databaseProvisions.get(databaseProvisionKey(server.target));
          if (!provision || provision.phase !== 'ready') {
            summary.backendUrl = appendBasePathToUrl(`http://${server.host}:${server.port}`, serverBasePath);
          } else {
            const serverUrl = appendBasePathToUrl(`http://${server.host}:${server.port}`, serverBasePath);
            const serverSpec = createBackendServerSpec(
              server,
              target,
              project,
              environment,
              context.env,
              serverUrl,
              options.debug,
            );
            specs.push(serverSpec);
            summary.backendUrl = serverUrl;
            if (options.debug) {
              const runtime = resolveBackendServerRuntime(target, project.projectDir);
              summary.debuggers = sortProjectDebuggers([
                ...(summary.debuggers ?? []),
                createProjectDebuggerSummary(runtime, server.target),
              ]);
            }
          }
        } else {
          const serverUrl = appendBasePathToUrl(`http://${server.host}:${server.port}`, serverBasePath);
          const serverSpec = createBackendServerSpec(
            server,
            target,
            project,
            environment,
            context.env,
            serverUrl,
            options.debug,
          );
          specs.push(serverSpec);
          summary.backendUrl = serverUrl;
          if (options.debug) {
            const runtime = resolveBackendServerRuntime(target, project.projectDir);
            summary.debuggers = sortProjectDebuggers([
              ...(summary.debuggers ?? []),
              createProjectDebuggerSummary(runtime, server.target),
            ]);
          }
        }
      }
    }

    const host = dev.host;
    if (host) {
      const target = targetSessions.get(host.target);
      if (target) {
        const hostDir = resolve(project.projectDir, host.dir);
        const generatedRoot = resolve(project.projectDir, target.outDir);
        const generatedDirFromHost = normalizePath(relative(hostDir, generatedRoot) || '.');
        const frontendTargetConfig = project.targets.find((candidate) => candidate.alias === host.target);
        const frontendBasePath = frontendTargetConfig?.runtime?.basePath;
        const proxyTargetConfig = host.proxyTarget
          ? project.targets.find((candidate) => candidate.alias === host.proxyTarget)
          : undefined;
        const proxyUrl = host.proxyTarget && dev.server && dev.server.target === host.proxyTarget
          ? appendBasePathToUrl(`http://${dev.server.host}:${dev.server.port}`, proxyTargetConfig?.runtime?.basePath)
          : undefined;
        specs.push({
          key: 'host',
          kind: 'host',
          signature: JSON.stringify({
            kind: 'host',
            target: host.target,
            dir: host.dir,
            outDir: target.outDir,
            host: host.host,
            port: host.port,
            previewPort: host.previewPort,
            apiBase: host.apiBase,
            proxyTarget: host.proxyTarget ?? null,
            proxyAuth: host.proxyAuth ?? null,
            proxyUrl: proxyUrl ?? null,
            basePath: frontendBasePath ?? null,
            env: environment.targets[host.target]?.effectiveValues ?? {},
          }),
          targetAlias: host.target,
          command: context.runtime.npmCommand(),
          args: ['--prefix', hostDir, 'run', 'dev'],
          cwd: project.projectDir,
          env: {
            ...createProcessEnvironmentOverlay(environment.targets[host.target]?.effectiveValues ?? {}, context.env),
            RDSL_GENERATED_DIR: generatedDirFromHost,
            VITE_RDSL_API_BASE: host.apiBase,
            VITE_RDSL_APP_BASE_PATH: frontendBasePath,
            RDSL_PROXY_API_TARGET: proxyUrl,
            RDSL_PROXY_API_AUTH: host.proxyAuth,
            HOST: host.host,
            PORT: String(host.port),
            PREVIEW_PORT: String(host.previewPort),
            LOJ_PROJECT_FILE: project.projectFile,
            LOJ_PROJECT_DIR: project.projectDir,
            LOJ_TARGET_ALIAS: host.target,
            LOJ_TARGET_TYPE: 'rdsl',
          },
          url: appendBasePathToUrl(`http://${host.host}:${host.port}`, frontendBasePath),
          description: 'frontend host',
          preflightPath: resolve(hostDir, 'node_modules', 'vite', 'package.json'),
          preflightError: `Host dependencies are missing for ${host.dir}. Run \`npm install --prefix ${host.dir}\` before \`loj dev\`.`,
        });
        summary.hostUrl = appendBasePathToUrl(`http://${host.host}:${host.port}`, frontendBasePath);
        summary.apiBase = host.apiBase;
        summary.proxyUrl = proxyUrl;
        summary.hostDir = host.dir;
      }
    }

    return { specs, summary };
  };

  const buildDatabaseProvisionSpecs = (
    project: LojProjectConfig,
    environment: ProjectEnvironment,
  ): DatabaseProvisionSpec[] => (
    project.targets
      .filter((target) => target.type === 'sdsl' && Boolean(target.database?.autoProvision) && target.database?.mode === 'docker-compose')
      .filter((target) => target.database && vendorSupportsComposeMode(target.database.vendor))
      .map((target) => ({
        key: databaseProvisionKey(target.alias),
        signature: JSON.stringify({
          target: target.alias,
          outDir: resolveTargetOutDir(target),
          database: serializeDatabaseConfig(target.database),
          env: environment.targets[target.alias]?.effectiveValues ?? {},
        }),
        targetAlias: target.alias,
        composeFile: resolve(project.projectDir, resolveTargetOutDir(target), 'docker-compose.database.yaml'),
        projectName: `${toDatabaseIdentifier(project.appName)}_${toDatabaseIdentifier(target.alias)}`,
        cwd: project.projectDir,
        env: {
          ...createProcessEnvironmentOverlay(environment.targets[target.alias]?.effectiveValues ?? {}, context.env),
          LOJ_PROJECT_FILE: project.projectFile,
          LOJ_PROJECT_DIR: project.projectDir,
          LOJ_TARGET_ALIAS: target.alias,
          LOJ_TARGET_TYPE: 'sdsl',
        },
      }))
  );

  const reconcileDatabaseProvisions = (project: LojProjectConfig, environment: ProjectEnvironment) => {
    const specs = buildDatabaseProvisionSpecs(project, environment);
    const desired = new Map(specs.map((spec) => [spec.key, spec]));

    for (const [key, state] of databaseProvisions) {
      const nextSpec = desired.get(key);
      if (!nextSpec || nextSpec.signature !== state.spec.signature) {
        databaseProvisions.delete(key);
        stopDatabaseProvision(state, false);
      }
    }

    for (const spec of specs) {
      const existing = databaseProvisions.get(spec.key);
      if (existing) {
        continue;
      }
      startDatabaseProvision(spec);
    }
  };

  const reconcileManagedProcesses = (project: LojProjectConfig, environment: ProjectEnvironment) => {
    const { specs, summary } = buildManagedProcessSpecs(project, environment);
    const desired = new Map(specs.map((spec) => [spec.key, spec]));

    for (const [key, state] of managedProcesses) {
      const nextSpec = desired.get(key);
      if (!nextSpec || nextSpec.signature !== state.spec.signature) {
        managedProcesses.delete(key);
        stopManagedProcess(state, 'SIGTERM');
      }
    }

    for (const spec of specs) {
      if (managedProcesses.has(spec.key)) {
        continue;
      }
      startManagedProcess(spec);
    }

    emitManagedProcessSummary(summary);
  };

  const handleTargetEvent = (target: LojTargetConfig, event: TargetDevEvent) => {
    const targetSession = targetSessions.get(target.alias);
    if (targetSession && typeof event.target === 'string' && event.target.length > 0) {
      targetSession.targetTriple = event.target;
    }
    if (event.event !== 'build' || event.status !== 'success') {
      return;
    }
    const outDir = targetSession?.outDir ?? resolveTargetOutDir(target);
    const applied = applyTargetDevProfiles(target, currentProject.projectDir, outDir, targetSession?.targetTriple ?? event.target);
    if ('error' in applied) {
      writeProjectDevFailure(options, applied.error, context);
      return;
    }
    reconcileDatabaseProvisions(currentProject, currentEnvironment);
    reconcileManagedProcesses(currentProject, currentEnvironment);
    if (!currentProject.dev?.server) {
      return;
    }
    if (target.alias !== currentProject.dev.server.target) {
      return;
    }
    if (event.trigger && event.trigger !== 'initial') {
      restartManagedProcess('server', `generated backend updated (${event.trigger})`);
    }
  };

  const reconcileTargets = (nextLoadedProject: LoadedProjectConfig): boolean => {
    const nextProject = nextLoadedProject.project;
    const nextEnvironment = nextLoadedProject.environment;
    const desiredTargets = new Map(nextProject.targets.map((target) => [target.alias, target]));

    for (const [alias, currentTargetSession] of targetSessions) {
      const nextTarget = desiredTargets.get(alias);
      const nextTargetEnv = nextTarget
        ? createProcessEnvironmentOverlay(nextEnvironment.targets[nextTarget.alias]?.effectiveValues ?? {}, context.env)
        : undefined;
      const nextEnvSignature = nextTargetEnv ? createEnvironmentSignature(nextTargetEnv) : undefined;
      if (
        !nextTarget
        || !sameTargetConfig(currentTargetSession.config, nextTarget)
        || currentTargetSession.envSignature !== nextEnvSignature
      ) {
        currentTargetSession.session.close();
        targetSessions.delete(alias);
      }
    }

    for (const target of nextProject.targets) {
      if (targetSessions.has(target.alias)) {
        continue;
      }
      const targetEnv = createProcessEnvironmentOverlay(nextEnvironment.targets[target.alias]?.effectiveValues ?? {}, context.env);
      const started = startTargetDevSession(target, targetEnv, nextProject, options, context, handleTargetEvent);
      if ('error' in started) {
        writeProjectDevFailure(options, started.error, context);
        return false;
      }
      targetSessions.set(target.alias, started.session);
    }

    currentProject = nextProject;
    currentEnvironment = nextEnvironment;
    watchedProjectFiles = collectProjectEnvironmentFileNames(nextProject.targets.map((target) => target.alias));
    watchedProjectFiles.add(projectFileName);
    reconcileDatabaseProvisions(nextProject, nextEnvironment);
    reconcileManagedProcesses(nextProject, nextEnvironment);
    return true;
  };

  const reloadProjectConfig = () => {
    const loaded = loadProject(options.projectFile, context.cwd, context.env);
    if ('error' in loaded) {
      writeProjectDevFailure(options, loaded.error, context);
      return;
    }
    const selectedTargets = selectProjectTargets(loaded.project, options.targetAliases);
    if ('error' in selectedTargets) {
      writeProjectDevFailure(options, selectedTargets.error, context);
      return;
    }
    const reloaded = reconcileTargets({
      project: selectedTargets.project,
      environment: loaded.environment,
    });
    if (!reloaded) {
      return;
    }
    if (options.json) {
      context.stdout(`${JSON.stringify({
        event: 'project',
        status: 'reloaded',
        projectFile: options.projectFile,
        app: { name: selectedTargets.project.appName },
        envFiles: loaded.environment.files,
        targets: selectedTargets.project.targets.map((target) => ({
          alias: target.alias,
          type: presentTargetType(target.type),
          entry: target.entry,
          outDir: resolveTargetOutDir(target),
        })),
      })}\n`);
    } else {
      context.stdout(`Project config reloaded: ${options.projectFile}\n`);
    }
  };

  const initialSummary = buildManagedProcessSpecs(initialLoadedProject.project, initialLoadedProject.environment).summary;
  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'ready',
      projectFile: options.projectFile,
      app: { name: initialLoadedProject.project.appName },
      envFiles: initialLoadedProject.environment.files,
      targets: initialLoadedProject.project.targets.map((target) => ({
        alias: target.alias,
        type: presentTargetType(target.type),
        entry: target.entry,
        outDir: resolveTargetOutDir(target),
      })),
      dev: {
        hostUrl: initialSummary.hostUrl ?? null,
        backendUrl: initialSummary.backendUrl ?? null,
        apiBase: initialSummary.apiBase ?? null,
        proxyUrl: initialSummary.proxyUrl ?? null,
        hostDir: initialSummary.hostDir ?? null,
      },
    })}\n`);
  } else {
    writeCliDevBanner(
      context.stdout,
      options.debug ? 'watch, run, inspect, debug' : 'watch, run, inspect',
    );
    context.stdout(`Loj dev: watching ${options.projectFile}\n`);
    writeCliSection(context.stdout, 'overview', [
      `app: ${initialLoadedProject.project.appName}`,
      `project: ${options.projectFile}`,
      `version: ${formatLojVersionLabel()}`,
      `env files: ${initialLoadedProject.environment.files.length}`,
      ...(options.debug ? ['debug: verbose orchestration enabled'] : []),
      ...(options.debug ? ['debugger: backend attach endpoint is enabled'] : []),
      ...(options.debug ? [`session state: ${normalizePath(sessionStateFile)}`] : []),
    ]);
    writeCliSection(
      context.stdout,
      'targets',
      initialLoadedProject.project.targets.map((target) => `${target.alias} (${presentTargetType(target.type)}) entry=${target.entry} out=${resolveTargetOutDir(target)}`),
    );
    emitManagedProcessSummary(initialSummary);
    writeCliSection(context.stdout, 'next', [
      `inspect runtime state: loj status ${options.projectFile}`,
      `stop managed services: loj stop ${options.projectFile}`,
    ]);
  }

  reconcileTargets(initialLoadedProject);
  persistDevSessionState();

  session = {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      process.off('SIGINT', handleProcessSignal);
      process.off('SIGTERM', handleProcessSignal);
      projectWatcher.close();
      sessionDirectoryWatcher.close();
      closeAllManagedProcesses();
      closeAllDatabaseProvisions();
      for (const targetSession of targetSessions.values()) {
        targetSession.session.close();
      }
      targetSessions.clear();
      activeDevSessions.delete(projectAbsoluteFile);
      deleteDevSessionStateFile(sessionStateFile);
      deleteDevSessionCommandFile(sessionCommandFile);
      if (options.json) {
        context.stdout(`${JSON.stringify({
          event: 'stopped',
          projectFile: options.projectFile,
        })}\n`);
      } else {
        writeCliDevBanner(context.stdout, 'session stopped');
        context.stdout(`Loj dev stopped: ${options.projectFile}\n`);
        writeCliSection(context.stdout, 'next', [
          `restart services: loj dev ${options.projectFile}`,
          `inspect generated state: loj doctor ${options.projectFile}`,
        ]);
      }
    },
    rebuild(trigger: 'manual' | 'change' = 'manual') {
      if (closed) {
        return;
      }
      for (const targetSession of targetSessions.values()) {
        targetSession.session.rebuild(trigger);
      }
    },
  };

  activeDevSessions.set(projectAbsoluteFile, {
    projectFile: projectAbsoluteFile,
    session,
    dispatchCommand: dispatchDevSessionCommand,
  });

  return session;
}

function databaseProvisionKey(targetAlias: string): string {
  return `database:${targetAlias}`;
}

function startTargetDevSession(
  target: LojTargetConfig,
  targetEnv: Record<string, string>,
  project: LojProjectConfig,
  options: DevCommandOptions,
  context: CommandContext,
  onEvent: (target: LojTargetConfig, event: TargetDevEvent) => void,
): { session: TargetDevSession } | { error: string } {
  const outDir = resolveTargetOutDir(target);
  let subSession: DevSession | undefined;
  let observedTargetTriple: string | undefined;
  const writers = createTargetOutputWriters(target, options, context, onEventWithMetadata);
  const args = ['dev', target.entry, '--out-dir', outDir, '--project-root', '.', '--json'];

  const exitCode = target.type === 'rdsl'
    ? runReactCli(args, {
      cwd: project.projectDir,
      env: targetEnv,
      runtime: context.runtime,
      stdout: writers.stdout,
      stderr: writers.stderr,
      onDevSession(session: DevSession) {
        subSession = session;
      },
    })
    : runSpringCli(args, {
      cwd: project.projectDir,
      env: targetEnv,
      runtime: context.runtime,
      stdout: writers.stdout,
      stderr: writers.stderr,
      onDevSession(session: DevSession) {
        subSession = session;
      },
    });

  if (exitCode !== 0 || !subSession) {
    return {
      error: `Failed to start ${target.alias} (${presentTargetType(target.type)}) dev session`,
    };
  }

  return {
    session: {
      config: target,
      outDir,
      envSignature: createEnvironmentSignature(targetEnv),
      targetTriple: observedTargetTriple,
      session: subSession,
    },
  };

  function onEventWithMetadata(nextTarget: LojTargetConfig, event: TargetDevEvent) {
    if (typeof event.target === 'string' && event.target.length > 0) {
      observedTargetTriple = event.target;
    }
    onEvent(nextTarget, event);
  }
}

function createBackendServerSpec(
  server: LojDevServerConfig,
  target: TargetDevSession,
  project: LojProjectConfig,
  environment: ProjectEnvironment,
  shellEnv: Record<string, string | undefined>,
  serverUrl: string,
  debug: boolean,
): ManagedProcessSpec {
  const generatedRoot = resolve(project.projectDir, target.outDir);
  const targetEnvironment = createProcessEnvironmentOverlay(
    environment.targets[server.target]?.effectiveValues ?? {},
    shellEnv,
  );
  const runtime = resolveBackendServerRuntime(target, project.projectDir);

  if (runtime === 'fastapi') {
    const pyprojectPath = resolve(generatedRoot, 'pyproject.toml');
    const venvPath = resolve(project.projectDir, '.loj-python', server.target);
    const runtimeConfig = target.config.runtime;
    const shutdown = runtimeConfig?.shutdown;
    return {
      key: 'server',
      kind: 'server',
      signature: JSON.stringify({
        kind: 'server',
        runtime,
        target: server.target,
        outDir: target.outDir,
        host: server.host,
        port: server.port,
        venvPath: normalizePath(relative(project.projectDir, venvPath)),
        shutdown: shutdown
          ? {
            mode: shutdown.mode,
            timeout: shutdown.timeout,
          }
          : null,
        basePath: runtimeConfig?.basePath ?? null,
        forwardedHeaders: runtimeConfig?.forwardedHeaders?.mode ?? null,
        debugger: debug ? createProjectDebuggerSummary(runtime, server.target) : null,
        trustedProxy: runtimeConfig?.trustedProxy
          ? {
            mode: runtimeConfig.trustedProxy.mode,
            cidrs: runtimeConfig.trustedProxy.cidrs ?? null,
          }
          : null,
        env: environment.targets[server.target]?.effectiveValues ?? {},
      }),
      targetAlias: server.target,
      command: process.execPath,
      args: [
        fastApiDevRunnerPath,
        '--generated-dir',
        generatedRoot,
        '--host',
        server.host,
        '--port',
        String(server.port),
        ...(debug
          ? [
            '--debugpy-host',
            localDebugHost,
            '--debugpy-port',
            String(fastApiDebugPort),
          ]
          : []),
        ...(shutdown
          ? [
            '--shutdown-mode',
            shutdown.mode,
            '--shutdown-timeout',
            String(shutdown.timeoutSeconds),
          ]
          : []),
        ...(runtimeConfig?.basePath
          ? [
            '--root-path',
            runtimeConfig.basePath,
          ]
          : []),
        ...(runtimeConfig?.forwardedHeaders
          ? [
            '--forwarded-headers-mode',
            runtimeConfig.forwardedHeaders.mode,
          ]
          : []),
        ...(runtimeConfig?.trustedProxy
          ? [
            '--trusted-proxy-mode',
            runtimeConfig.trustedProxy.mode,
            ...(runtimeConfig.trustedProxy.cidrs
              ? [
                '--trusted-proxy-cidrs',
                runtimeConfig.trustedProxy.cidrs.join(','),
              ]
              : []),
          ]
          : []),
      ],
      cwd: project.projectDir,
      env: {
        ...targetEnvironment,
        LOJ_FASTAPI_VENV_DIR: venvPath,
        LOJ_PROJECT_FILE: project.projectFile,
        LOJ_PROJECT_DIR: project.projectDir,
        LOJ_TARGET_ALIAS: server.target,
        LOJ_TARGET_TYPE: 'sdsl',
      },
      url: serverUrl,
      description: 'backend server',
      preflightPath: pyprojectPath,
      preflightError: `Generated backend is missing ${normalizePath(relative(project.projectDir, pyprojectPath))}. Wait for the sdsl build to complete.`,
    };
  }

  const pomPath = resolve(generatedRoot, 'pom.xml');
  return {
    key: 'server',
    kind: 'server',
    signature: JSON.stringify({
      kind: 'server',
      runtime,
      target: server.target,
      outDir: target.outDir,
      host: server.host,
      port: server.port,
      shutdown: target.config.runtime?.shutdown
        ? {
          mode: target.config.runtime.shutdown.mode,
          timeout: target.config.runtime.shutdown.timeout,
        }
        : null,
      basePath: target.config.runtime?.basePath ?? null,
      debugger: debug ? createProjectDebuggerSummary(runtime, server.target) : null,
      forwardedHeaders: target.config.runtime?.forwardedHeaders?.mode ?? null,
      trustedProxy: target.config.runtime?.trustedProxy
        ? {
          mode: target.config.runtime.trustedProxy.mode,
          cidrs: target.config.runtime.trustedProxy.cidrs ?? null,
        }
        : null,
      env: environment.targets[server.target]?.effectiveValues ?? {},
    }),
    targetAlias: server.target,
    command: 'mvn',
    args: [
      '-f',
      pomPath,
      ...(debug
        ? [
          '-Dspring-boot.run.fork=true',
          `-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${springDebugPort}`,
        ]
        : []),
      'spring-boot:run',
    ],
    cwd: project.projectDir,
    env: {
      ...targetEnvironment,
      SERVER_ADDRESS: server.host,
      SERVER_PORT: String(server.port),
      LOJ_PROJECT_FILE: project.projectFile,
      LOJ_PROJECT_DIR: project.projectDir,
      LOJ_TARGET_ALIAS: server.target,
      LOJ_TARGET_TYPE: 'sdsl',
    },
    url: serverUrl,
    description: 'backend server',
    preflightPath: pomPath,
    preflightError: `Generated backend is missing ${normalizePath(relative(project.projectDir, pomPath))}. Wait for the sdsl build to complete.`,
  };
}

function resolveBackendServerRuntime(
  target: TargetDevSession,
  projectDir: string,
): BackendServerRuntime {
  if (target.targetTriple?.startsWith('fastapi/')) {
    return 'fastapi';
  }
  if (target.targetTriple?.startsWith('spring-boot/')) {
    return 'spring-boot';
  }

  const generatedRoot = resolve(projectDir, target.outDir);
  if (existsSync(resolve(generatedRoot, 'pyproject.toml'))) {
    return 'fastapi';
  }
  return 'spring-boot';
}

function createTargetOutputWriters(
  target: LojTargetConfig,
  options: DevCommandOptions,
  context: CommandContext,
  onEvent: (target: LojTargetConfig, event: TargetDevEvent) => void,
): { stdout: (text: string) => void; stderr: (text: string) => void } {
  return {
    stdout: createTargetStdoutForwarder(target, options, context, onEvent),
    stderr: createTargetStderrForwarder(target, options, context),
  };
}

function createTargetStdoutForwarder(
  target: LojTargetConfig,
  options: DevCommandOptions,
  context: CommandContext,
  onEvent: (target: LojTargetConfig, event: TargetDevEvent) => void,
): (text: string) => void {
  let buffer = '';
  return (text: string) => {
    buffer += text;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      const parsed = parseJsonPayload(line);
      if (parsed) {
        const event = parsed as TargetDevEvent;
        onEvent(target, event);
        if (options.json) {
          context.stdout(`${JSON.stringify({
            alias: target.alias,
            targetType: target.type,
            stream: 'stdout',
            ...event,
          })}\n`);
        } else {
          writeHumanTargetEvent(target.alias, event, context.stdout, context.stderr);
        }
        continue;
      }
      if (options.json) {
        context.stdout(`${JSON.stringify({
          alias: target.alias,
          targetType: target.type,
          stream: 'stdout',
          event: 'log',
          text: line,
        })}\n`);
      } else {
        context.stdout(`[${target.alias}] ${line}\n`);
      }
    }
  };
}

function createTargetStderrForwarder(
  target: LojTargetConfig,
  options: DevCommandOptions,
  context: CommandContext,
): (text: string) => void {
  return createLineForwarder((line) => {
    if (options.json) {
      context.stdout(`${JSON.stringify({
        alias: target.alias,
        targetType: target.type,
        stream: 'stderr',
        event: 'log',
        text: line,
      })}\n`);
    } else {
      context.stderr(`[${target.alias}] ${line}\n`);
    }
  });
}

function writeHumanTargetEvent(
  alias: string,
  event: TargetDevEvent,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): void {
  const prefix = `[${alias}] `;
  switch (event.event) {
    case 'ready':
      stdout(`${prefix}Dev mode: watching ${event.sourceFile ?? '-'}\n`);
      if (event.outDir) {
        stdout(`${prefix}out dir: ${event.outDir}\n`);
      }
      break;
    case 'change':
      stdout(`${prefix}Change detected: ${event.sourceFile ?? '-'}\n`);
      break;
    case 'build':
      if (event.status === 'success') {
        stdout(`${prefix}Dev build complete (${event.trigger ?? 'manual'}): ${event.sourceFile ?? '-'}\n`);
        if (Array.isArray(event.files)) {
          stdout(`${prefix}files written: ${event.files.length}\n`);
        }
        if (Array.isArray(event.warnings) && event.warnings.length > 0) {
          stdout(`${prefix}warnings: ${event.warnings.length}\n`);
        }
      } else {
        stderr(`${prefix}Dev build failed (${event.trigger ?? 'manual'}): ${event.sourceFile ?? '-'}\n`);
        if (event.error) {
          stderr(`${prefix}${event.error}\n`);
        }
        if (Array.isArray(event.errors)) {
          for (const issue of event.errors) {
            const location = issue.file
              ? `${issue.file}${issue.line ? `:${issue.line}${issue.col ? `:${issue.col}` : ''}` : ''}`
              : undefined;
            stderr(`${prefix}- [${issue.phase ?? 'build'}] ${location ? `${location} ` : ''}${issue.message ?? 'Unknown error'}\n`);
          }
        }
      }
      break;
    case 'stopped':
      stdout(`${prefix}Dev mode stopped: ${event.sourceFile ?? '-'}\n`);
      break;
    default:
      stdout(`${prefix}${JSON.stringify(event)}\n`);
  }
}

function createLineForwarder(sink: (line: string) => void): (text: string) => void {
  let buffer = '';
  return (text: string) => {
    buffer += text;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      sink(line);
    }
  };
}

function attachLineEmitter(
  stream: { on(event: 'data', listener: (chunk: { toString(): string }) => void): void } | undefined,
  sink: ((line: string) => void) | undefined,
): void {
  if (!stream || !sink) {
    return;
  }
  const forward = createLineForwarder(sink);
  stream.on('data', (chunk) => {
    forward(chunk.toString());
  });
}

function parseJsonPayload(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sameTargetConfig(left: LojTargetConfig, right: LojTargetConfig): boolean {
  return left.alias === right.alias
    && left.type === right.type
    && left.entry === right.entry
    && resolveTargetOutDir(left) === resolveTargetOutDir(right)
    && sameDatabaseConfig(left.database, right.database)
    && sameRuntimeConfig(left.runtime, right.runtime);
}

function sameDatabaseConfig(
  left: LojTargetDatabaseConfig | undefined,
  right: LojTargetDatabaseConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.vendor === right.vendor
    && left.mode === right.mode
    && left.name === right.name
    && left.host === right.host
    && left.port === right.port
    && left.username === right.username
    && left.password === right.password
    && left.migrations === right.migrations
    && left.autoProvision === right.autoProvision;
}

function sameRuntimeConfig(
  left: LojTargetRuntimeConfig | undefined,
  right: LojTargetRuntimeConfig | undefined,
): boolean {
  if (!hasTargetRuntimeConfig(left) && !hasTargetRuntimeConfig(right)) {
    return true;
  }
  return left?.basePath === right?.basePath
    && sameRuntimeShutdownConfig(left?.shutdown, right?.shutdown)
    && sameRuntimeProbePath(left?.health, right?.health)
    && sameRuntimeProbePath(left?.readiness, right?.readiness)
    && sameRuntimeProbePath(left?.drain, right?.drain)
    && sameRuntimeCorsConfig(left?.cors, right?.cors)
    && sameRuntimeForwardedHeadersConfig(left?.forwardedHeaders, right?.forwardedHeaders)
    && sameRuntimeTrustedProxyConfig(left?.trustedProxy, right?.trustedProxy)
    && sameRuntimeRequestSizeLimitConfig(left?.requestSizeLimit, right?.requestSizeLimit);
}

function hasTargetRuntimeConfig(config: LojTargetRuntimeConfig | undefined): boolean {
  return Boolean(
    config?.basePath
      || config?.shutdown
      || config?.health
      || config?.readiness
      || config?.drain
      || config?.cors
      || config?.forwardedHeaders
      || config?.trustedProxy
      || config?.requestSizeLimit
  );
}

function sameRuntimeShutdownConfig(
  left: LojTargetRuntimeShutdownConfig | undefined,
  right: LojTargetRuntimeShutdownConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.mode === right.mode
    && left.timeout === right.timeout
    && left.timeoutSeconds === right.timeoutSeconds;
}

function sameRuntimeProbePath(
  left: LojTargetRuntimeProbeConfig | undefined,
  right: LojTargetRuntimeProbeConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.path === right.path;
}

function sameRuntimeCorsConfig(
  left: LojTargetRuntimeCorsConfig | undefined,
  right: LojTargetRuntimeCorsConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.credentials === right.credentials
    && sameStringArray(left.origins, right.origins)
    && sameStringArray(left.methods, right.methods)
    && sameStringArray(left.headers, right.headers);
}

function sameRuntimeForwardedHeadersConfig(
  left: LojTargetRuntimeForwardedHeadersConfig | undefined,
  right: LojTargetRuntimeForwardedHeadersConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.mode === right.mode;
}

function sameRuntimeTrustedProxyConfig(
  left: LojTargetRuntimeTrustedProxyConfig | undefined,
  right: LojTargetRuntimeTrustedProxyConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.mode === right.mode
    && sameStringArray(left.cidrs, right.cidrs);
}

function sameRuntimeRequestSizeLimitConfig(
  left: LojTargetRuntimeRequestSizeLimitConfig | undefined,
  right: LojTargetRuntimeRequestSizeLimitConfig | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.source === right.source && left.bytes === right.bytes;
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

function writeTargetFailure(result: TargetInvocationResult, stderr: (text: string) => void): void {
  if (isRecord(result.payload) && Array.isArray(result.payload.errors)) {
    for (const issue of result.payload.errors) {
      if (isRecord(issue) && typeof issue.message === 'string') {
        stderr(`  - ${issue.message}\n`);
      }
    }
    return;
  }

  if (result.stderr.trim().length > 0) {
    stderr(`${indentBlock(result.stderr, '  ')}\n`);
    return;
  }

  if (result.stdout.trim().length > 0) {
    stderr(`${indentBlock(result.stdout, '  ')}\n`);
  }
}

function writeProjectDevFailure(
  options: DevCommandOptions,
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    context.stdout(`${JSON.stringify({
      event: 'project',
      status: 'failure',
      projectFile: options.projectFile,
      error: message,
    })}\n`);
    return;
  }
  context.stderr(`Loj dev project update failed: ${options.projectFile}\n`);
  context.stderr(`${message}\n`);
}

function writeFailure(
  message: string,
  stderr: (text: string) => void,
  stdout: (text: string) => void,
  json: boolean,
): void {
  if (json) {
    stdout(`${JSON.stringify({ success: false, error: message }, null, 2)}\n`);
    return;
  }
  stderr(`${message}\n`);
}

function writeJsonArtifact(
  write: (text: string) => void,
  artifact: string,
  payload: Record<string, unknown>,
): void {
  write(`${JSON.stringify({
    artifact,
    schemaVersion: AGENT_JSON_SCHEMA_VERSION,
    ...payload,
  }, null, 2)}\n`);
}

function writeAgentFailure(
  options: AgentInstallCommandOptions | AgentAddCommandOptions | AgentExportCommandOptions,
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    const artifact = options.command === 'install'
      ? 'loj.agent.install.result'
      : options.command === 'add'
        ? 'loj.agent.add.result'
        : 'loj.agent.export.result';
    writeJsonArtifact(
      context.stdout,
      artifact,
      {
        success: false,
        agent: options.agent,
        skill: BUNDLED_SKILL_NAME,
        error: message,
      },
    );
    return;
  }
  context.stderr(`${message}\n`);
}

function writeRulesFailure(
  options: RulesValidateCommandOptions | RulesBuildCommandOptions,
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(
      context.stdout,
      options.command === 'validate' ? 'loj.rules.validate.result' : 'loj.rules.build.result',
      {
        success: false,
        file: options.file,
        error: message,
      },
    );
    return;
  }
  context.stderr(`${message}\n`);
}

function writeRulesCompileFailure(
  options: RulesValidateCommandOptions | RulesBuildCommandOptions,
  file: string,
  errors: Array<{ file?: string; line?: number; col?: number; message?: string }>,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(
      context.stdout,
      options.command === 'validate' ? 'loj.rules.validate.result' : 'loj.rules.build.result',
      {
        success: false,
        file,
        errors: errors.map((error) => ({
          file: error.file,
          line: error.line,
          col: error.col,
          message: error.message,
        })),
      },
    );
    return;
  }

  context.stderr(`Loj rules ${options.command} failed: ${file}\n`);
  for (const error of errors) {
    const location = error.line && error.col
      ? `${error.file ?? file}:${error.line}:${error.col}`
      : (error.file ?? file);
    context.stderr(`- ${location} ${error.message ?? 'Unknown error'}\n`);
  }
}

function writeFlowFailure(
  options: FlowValidateCommandOptions | FlowBuildCommandOptions,
  message: string,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(
      context.stdout,
      options.command === 'validate' ? 'loj.flow.validate.result' : 'loj.flow.build.result',
      {
        success: false,
        file: options.file,
        error: message,
      },
    );
    return;
  }
  context.stderr(`${message}\n`);
}

function writeFlowCompileFailure(
  options: FlowValidateCommandOptions | FlowBuildCommandOptions,
  file: string,
  errors: Array<{ file?: string; line?: number; col?: number; message?: string }>,
  context: CommandContext,
): void {
  if (options.json) {
    writeJsonArtifact(
      context.stdout,
      options.command === 'validate' ? 'loj.flow.validate.result' : 'loj.flow.build.result',
      {
        success: false,
        file,
        errors: errors.map((error) => ({
          file: error.file,
          line: error.line,
          col: error.col,
          message: error.message,
        })),
      },
    );
    return;
  }

  context.stderr(`Loj flow ${options.command} failed: ${file}\n`);
  for (const error of errors) {
    const location = error.line && error.col
      ? `${error.file ?? file}:${error.line}:${error.col}`
      : (error.file ?? file);
    context.stderr(`- ${location} ${error.message ?? 'Unknown error'}\n`);
  }
}

function resolveTargetOutDir(target: LojTargetConfig): string {
  return target.outDir ?? normalizePath(`generated/${target.alias}`);
}

function selectProjectTargets(
  project: LojProjectConfig,
  targetAliases: readonly string[],
): { project: LojProjectConfig; targets: LojTargetConfig[] } | { error: string } {
  if (targetAliases.length === 0) {
    return { project, targets: project.targets };
  }
  const uniqueAliases = [...new Set(targetAliases)];
  const selectedTargets = uniqueAliases.map((alias) => project.targets.find((target) => target.alias === alias));
  const missingAlias = uniqueAliases.find((_alias, index) => !selectedTargets[index]);
  if (missingAlias) {
    return { error: `Unknown target alias for --target: "${missingAlias}"` };
  }
  const filteredTargets = selectedTargets.filter((target): target is LojTargetConfig => Boolean(target));
  const selectedAliases = new Set(filteredTargets.map((target) => target.alias));
  const filteredDev: LojProjectDevConfig = {
    host: project.dev?.host && selectedAliases.has(project.dev.host.target)
      ? project.dev.host
      : undefined,
    server: project.dev?.server && selectedAliases.has(project.dev.server.target)
      ? project.dev.server
      : undefined,
  };
  return {
    project: {
      ...project,
      targets: filteredTargets,
      dev: filteredDev.host || filteredDev.server ? filteredDev : undefined,
    },
    targets: filteredTargets,
  };
}

function collectTargetConfigErrors(
  project: LojProjectConfig,
  results: readonly TargetInvocationResult[],
): string[] {
  const errors: string[] = [];
  for (const target of project.targets) {
    if (!target.database && !hasTargetRuntimeConfig(target.runtime)) {
      continue;
    }
    const result = results.find((entry) => entry.alias === target.alias);
    if (!result || !result.success) {
      continue;
    }
    const targetTriple = typeof result.payload?.target === 'string' ? result.payload.target : undefined;
    const error = validateDatabaseConfigForTargetRuntime(target, targetTriple);
    if (error) {
      errors.push(error);
    }
    const runtimeError = validateRuntimeConfigForTargetRuntime(target, targetTriple);
    if (runtimeError) {
      errors.push(runtimeError);
    }
  }
  return errors;
}

function serializeDatabaseConfig(config: LojTargetDatabaseConfig | undefined): Record<string, unknown> | undefined {
  if (!config) {
    return undefined;
  }
  return {
    vendor: config.vendor,
    mode: config.mode,
    name: config.name,
    host: config.host,
    port: config.port,
    username: config.username,
    migrations: config.migrations,
    autoProvision: config.autoProvision,
  };
}

function serializeRuntimeConfig(config: LojTargetRuntimeConfig | undefined): Record<string, unknown> | undefined {
  if (!hasTargetRuntimeConfig(config)) {
    return undefined;
  }
  const runtime = config!;
  return {
    basePath: runtime.basePath,
    shutdown: runtime.shutdown
      ? {
        mode: runtime.shutdown.mode,
        timeout: runtime.shutdown.timeout,
      }
      : undefined,
    health: runtime.health ? { path: runtime.health.path } : undefined,
    readiness: runtime.readiness ? { path: runtime.readiness.path } : undefined,
    drain: runtime.drain ? { path: runtime.drain.path } : undefined,
    cors: runtime.cors
      ? {
        origins: [...runtime.cors.origins],
        methods: runtime.cors.methods ? [...runtime.cors.methods] : undefined,
        headers: runtime.cors.headers ? [...runtime.cors.headers] : undefined,
        credentials: runtime.cors.credentials,
      }
      : undefined,
    forwardedHeaders: runtime.forwardedHeaders ? { mode: runtime.forwardedHeaders.mode } : undefined,
    trustedProxy: runtime.trustedProxy
      ? {
        mode: runtime.trustedProxy.mode,
        cidrs: runtime.trustedProxy.cidrs ? [...runtime.trustedProxy.cidrs] : undefined,
      }
      : undefined,
    requestSizeLimit: runtime.requestSizeLimit
      ? {
        source: runtime.requestSizeLimit.source,
      }
      : undefined,
  };
}

function applyTargetBuildProfiles(
  target: LojTargetConfig,
  result: TargetInvocationResult,
  projectDir: string,
): BuildPostProcessResult | { error: string } {
  if (target.type !== 'sdsl' || (!target.database && !hasTargetRuntimeConfig(target.runtime)) || !result.outDir) {
    return { addedFiles: [] };
  }
  const targetTriple = typeof result.payload?.target === 'string' ? result.payload.target : undefined;
  return applyTargetRuntimeArtifacts(target, projectDir, result.outDir, targetTriple);
}

function applyTargetDevProfiles(
  target: LojTargetConfig,
  projectDir: string,
  outDir: string,
  targetTriple: string | undefined,
): BuildPostProcessResult | { error: string } {
  if (target.type !== 'sdsl' || (!target.database && !hasTargetRuntimeConfig(target.runtime))) {
    return { addedFiles: [] };
  }
  return applyTargetRuntimeArtifacts(target, projectDir, outDir, targetTriple);
}

function applyTargetRuntimeArtifacts(
  target: LojTargetConfig,
  projectDir: string,
  outDir: string,
  targetTriple: string | undefined,
): BuildPostProcessResult | { error: string } {
  const databaseError = validateDatabaseConfigForTargetRuntime(target, targetTriple);
  if (databaseError) {
    return { error: databaseError };
  }
  const runtimeError = validateRuntimeConfigForTargetRuntime(target, targetTriple);
  if (runtimeError) {
    return { error: runtimeError };
  }
  const absoluteOutDir = resolve(projectDir, outDir);
  const addedFiles: string[] = [];
  const runtime = target.runtime!;
  if (hasTargetRuntimeConfig(runtime)) {
    const appliedRuntime = applyBackendShutdownProfile(absoluteOutDir, runtime, targetTriple);
    if ('error' in appliedRuntime) {
      return appliedRuntime;
    }
    addedFiles.push(...appliedRuntime.addedFiles);
  }
  if (!target.database) {
    return { addedFiles };
  }
  const compiled = compileBackendIrForTarget(target, projectDir);
  if ('error' in compiled) {
    return compiled;
  }
  if ((targetTriple ?? '').startsWith('spring-boot/')) {
    const appliedDatabase = applySpringDatabaseProfile(absoluteOutDir, target.database, compiled.ir);
    if ('error' in appliedDatabase) {
      return appliedDatabase;
    }
    return { addedFiles: [...addedFiles, ...appliedDatabase.addedFiles] };
  }
  if ((targetTriple ?? '').startsWith('fastapi/')) {
    const appliedDatabase = applyFastApiDatabaseProfile(absoluteOutDir, target.database, compiled.ir);
    if ('error' in appliedDatabase) {
      return appliedDatabase;
    }
    return { addedFiles: [...addedFiles, ...appliedDatabase.addedFiles] };
  }
  return { addedFiles };
}

function compileBackendIrForTarget(
  target: LojTargetConfig,
  projectDir: string,
): { ir: IRSdslProgram } | { error: string } {
  try {
    const compiled = compileBackendProject({
      entryFile: target.entry,
      projectRoot: '.',
      readFile(fileName: string) {
        return readFileSync(resolve(projectDir, fileName), 'utf8');
      },
      listFiles(directory: string) {
        const absoluteDirectory = resolve(projectDir, directory);
        return nodeFs.readdirSync(absoluteDirectory)
          .map((entry: string) => normalizePath(directory === '.' ? entry : `${directory}/${entry}`));
      },
    });
    if (!compiled.success || !compiled.ir) {
      const firstError = compiled.errors[0];
      return {
        error: `failed to compile backend IR for target "${target.alias}" while generating database artifacts${firstError ? `: ${firstError.message}` : ''}`,
      };
    }
    return { ir: compiled.ir };
  } catch (error) {
    return {
      error: `failed to compile backend IR for target "${target.alias}" while generating database artifacts: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function compileFrontendSemanticForTarget(
  target: LojTargetConfig,
  projectDir: string,
): { ir: Record<string, unknown>; files: Array<{ path: string }>; sourceFiles: string[]; moduleGraph?: Record<string, string[]> } | { error: string } {
  try {
    const compiled = compileFrontendProject({
      entryFile: target.entry,
      projectRoot: '.',
      readFile(fileName: string) {
        return readFileSync(resolve(projectDir, fileName), 'utf8');
      },
      listFiles(directory: string) {
        const absoluteDirectory = resolve(projectDir, directory);
        return nodeFs.readdirSync(absoluteDirectory)
          .map((entry: string) => normalizePath(directory === '.' ? entry : `${directory}/${entry}`));
      },
    });
    if (!compiled.success || !compiled.ir) {
      const firstError = compiled.errors[0];
      return {
        error: `failed to compile frontend graph for target "${target.alias}"${firstError ? `: ${firstError.message}` : ''}`,
      };
    }
    return {
      ir: compiled.ir as unknown as Record<string, unknown>,
      files: compiled.files.map((file) => ({ path: file.path })),
      sourceFiles: compiled.semanticManifest?.sourceFiles ?? [target.entry],
      moduleGraph: compiled.semanticManifest?.moduleGraph,
    };
  } catch (error) {
    return {
      error: `failed to compile frontend graph for target "${target.alias}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildProjectSourceGraphs(
  project: LojProjectConfig,
): { documents: GraphDocument[] } | { error: string } {
  const documents: GraphDocument[] = [];
  for (const target of project.targets) {
    if (target.type === 'rdsl') {
      const compiled = compileFrontendSemanticForTarget(target, project.projectDir);
      if ('error' in compiled) {
        return compiled;
      }
      documents.push({
        id: `${target.alias}.source`,
        title: `Source graph (${target.alias})`,
        mermaid: buildFrontendSourceMermaid(project, target, compiled.ir, compiled.sourceFiles, compiled.moduleGraph),
      });
      continue;
    }
    const compiled = compileBackendIrForTarget(target, project.projectDir);
    if ('error' in compiled) {
      return compiled;
    }
    documents.push({
      id: `${target.alias}.source`,
      title: `Source graph (${target.alias})`,
      mermaid: buildBackendSourceMermaid(project, target, compiled.ir),
    });
  }
  return { documents };
}

function buildFrontendGeneratedGraph(
  target: LojTargetConfig,
  projectDir: string,
): { document: GraphDocument } | { error: string } {
  const compiled = compileFrontendSemanticForTarget(target, projectDir);
  if ('error' in compiled) {
    return compiled;
  }
  return {
    document: {
      id: `${target.alias}.frontend`,
      title: `Generated frontend graph (${target.alias})`,
      mermaid: buildFrontendGeneratedMermaid(target, compiled.files),
    },
  };
}

function buildBackendGeneratedGraph(
  target: LojTargetConfig,
  projectDir: string,
): { document: GraphDocument } | { error: string } {
  const compiled = compileBackendProject({
    entryFile: target.entry,
    projectRoot: '.',
    readFile(fileName: string) {
      return readFileSync(resolve(projectDir, fileName), 'utf8');
    },
    listFiles(directory: string) {
      const absoluteDirectory = resolve(projectDir, directory);
      return nodeFs.readdirSync(absoluteDirectory)
        .map((entry: string) => normalizePath(directory === '.' ? entry : `${directory}/${entry}`));
    },
  });
  if (!compiled.success) {
    const firstError = compiled.errors[0];
    return {
      error: `failed to compile backend graph for target "${target.alias}"${firstError ? `: ${firstError.message}` : ''}`,
    };
  }
  return {
    document: {
      id: `${target.alias}.backend`,
      title: `Generated backend graph (${target.alias})`,
      mermaid: buildBackendGeneratedMermaid(target, compiled.files.map((file) => ({ path: file.path }))),
    },
  };
}

function buildFrontendSourceMermaid(
  project: LojProjectConfig,
  target: LojTargetConfig,
  ir: Record<string, unknown>,
  sourceFiles: string[],
  moduleGraph?: Record<string, string[]>,
): string {
  const lines = ['flowchart TD'];
  const appId = mermaidNodeId(`app.${target.alias}`);
  lines.push(`  ${appId}[${mermaidLabel(`${project.appName} / ${target.alias}`)}]`);
  const entryId = mermaidNodeId(`entry.${target.alias}`);
  lines.push(`  ${entryId}[${mermaidLabel(target.entry)}]`);
  lines.push(`  ${appId} --> ${entryId}`);

  const models = toNamedList(ir.models);
  const resources = toNamedList(ir.resources);
  const readModels = toNamedList(ir.readModels);
  const pages = toNamedList(ir.pages);

  for (const file of sourceFiles) {
    const fileId = mermaidNodeId(`sourceFile.${target.alias}.${file}`);
    lines.push(`  ${fileId}[${mermaidLabel(file)}]`);
    lines.push(`  ${entryId} -.imports.-> ${fileId}`);
  }
  if (moduleGraph) {
    for (const [from, imports] of Object.entries(moduleGraph)) {
      const fromId = mermaidNodeId(`sourceFile.${target.alias}.${from}`);
      for (const imported of imports) {
        const importedId = mermaidNodeId(`sourceFile.${target.alias}.${imported}`);
        lines.push(`  ${fromId} -.imports.-> ${importedId}`);
      }
    }
  }

  for (const model of models) {
    const modelId = mermaidNodeId(`model.${target.alias}.${model.name}`);
    lines.push(`  ${modelId}[${mermaidLabel(`model ${model.name}`)}]`);
    lines.push(`  ${appId} --> ${modelId}`);
  }
  for (const resource of resources) {
    const resourceId = mermaidNodeId(`resource.${target.alias}.${resource.name}`);
    lines.push(`  ${resourceId}[${mermaidLabel(`resource ${resource.name}`)}]`);
    lines.push(`  ${appId} --> ${resourceId}`);
    if (typeof resource.model === 'string') {
      lines.push(`  ${resourceId} --> ${mermaidNodeId(`model.${target.alias}.${resource.model}`)}`);
    }
    const workflow = resource.workflow;
    if (workflow && typeof workflow === 'object' && typeof (workflow as { resolvedPath?: unknown }).resolvedPath === 'string') {
      const workflowPath = (workflow as { resolvedPath: string }).resolvedPath;
      const workflowId = mermaidNodeId(`workflow.${target.alias}.${workflowPath}`);
      lines.push(`  ${workflowId}[${mermaidLabel(`workflow ${basename(workflowPath)}`)}]`);
      lines.push(`  ${resourceId} --> ${workflowId}`);
    }
  }
  for (const readModel of readModels) {
    const readModelId = mermaidNodeId(`readModel.${target.alias}.${readModel.name}`);
    lines.push(`  ${readModelId}[${mermaidLabel(`readModel ${readModel.name}`)}]`);
    lines.push(`  ${appId} --> ${readModelId}`);
    const rules = readModel.rules;
    if (rules && typeof rules === 'object' && typeof (rules as { resolvedPath?: unknown }).resolvedPath === 'string') {
      const rulesPath = (rules as { resolvedPath: string }).resolvedPath;
      const rulesId = mermaidNodeId(`rules.${target.alias}.${rulesPath}`);
      lines.push(`  ${rulesId}[${mermaidLabel(`rules ${basename(rulesPath)}`)}]`);
      lines.push(`  ${readModelId} --> ${rulesId}`);
    }
  }
  for (const page of pages) {
    const pageId = mermaidNodeId(`page.${target.alias}.${page.name}`);
    lines.push(`  ${pageId}[${mermaidLabel(`page ${page.name}`)}]`);
    lines.push(`  ${appId} --> ${pageId}`);
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || typeof (block as { id?: unknown }).id !== 'string') {
        continue;
      }
      const blockTitle = typeof (block as { title?: unknown }).title === 'string'
        ? (block as { title: string }).title
        : (block as { blockType?: unknown }).blockType === 'string'
          ? (block as { blockType: string }).blockType
          : 'block';
      const blockId = mermaidNodeId(`pageBlock.${target.alias}.${(block as { id: string }).id}`);
      lines.push(`  ${blockId}[${mermaidLabel(`block ${blockTitle}`)}]`);
      lines.push(`  ${pageId} --> ${blockId}`);
      const data = (block as { data?: unknown }).data;
      if (typeof data === 'string') {
        lines.push(`  ${blockId} --> ${mermaidNodeId(`readModel.${target.alias}.${data}`)}`);
      }
    }
  }
  return lines.join('\n');
}

function buildBackendSourceMermaid(
  project: LojProjectConfig,
  target: LojTargetConfig,
  ir: IRSdslProgram,
): string {
  const lines = ['flowchart TD'];
  const appId = mermaidNodeId(`app.${target.alias}`);
  lines.push(`  ${appId}[${mermaidLabel(`${project.appName} / ${target.alias}`)}]`);
  const entryId = mermaidNodeId(`entry.${target.alias}`);
  lines.push(`  ${entryId}[${mermaidLabel(target.entry)}]`);
  lines.push(`  ${appId} --> ${entryId}`);

  for (const sourceFile of ir.sourceFiles) {
    const sourceId = mermaidNodeId(`sourceFile.${target.alias}.${sourceFile}`);
    lines.push(`  ${sourceId}[${mermaidLabel(sourceFile)}]`);
    lines.push(`  ${entryId} -.imports.-> ${sourceId}`);
  }
  for (const [from, imports] of Object.entries(ir.moduleGraph)) {
    const fromId = mermaidNodeId(`sourceFile.${target.alias}.${from}`);
    for (const imported of imports) {
      const importedId = mermaidNodeId(`sourceFile.${target.alias}.${imported}`);
      lines.push(`  ${fromId} -.imports.-> ${importedId}`);
    }
  }

  for (const model of ir.models) {
    const modelId = mermaidNodeId(`model.${target.alias}.${model.name}`);
    lines.push(`  ${modelId}[${mermaidLabel(`model ${model.name}`)}]`);
    lines.push(`  ${appId} --> ${modelId}`);
  }
  for (const resource of ir.resources) {
    const resourceId = mermaidNodeId(`resource.${target.alias}.${resource.name}`);
    lines.push(`  ${resourceId}[${mermaidLabel(`resource ${resource.name}`)}]`);
    lines.push(`  ${appId} --> ${resourceId}`);
    lines.push(`  ${resourceId} --> ${mermaidNodeId(`model.${target.alias}.${resource.model}`)}`);
    if (resource.workflow) {
      const workflowId = mermaidNodeId(`workflow.${target.alias}.${resource.workflow.resolvedPath}`);
      lines.push(`  ${workflowId}[${mermaidLabel(`workflow ${basename(resource.workflow.resolvedPath)}`)}]`);
      lines.push(`  ${resourceId} --> ${workflowId}`);
    }
    if (resource.create?.rules) {
      const rulesId = mermaidNodeId(`createRules.${target.alias}.${resource.create.rules.resolvedPath}`);
      lines.push(`  ${rulesId}[${mermaidLabel(`create.rules ${basename(resource.create.rules.resolvedPath)}`)}]`);
      lines.push(`  ${resourceId} --> ${rulesId}`);
    }
  }
  for (const readModel of ir.readModels) {
    const readModelId = mermaidNodeId(`readModel.${target.alias}.${readModel.name}`);
    lines.push(`  ${readModelId}[${mermaidLabel(`readModel ${readModel.name}`)}]`);
    lines.push(`  ${appId} --> ${readModelId}`);
    const handlerId = mermaidNodeId(`handler.${target.alias}.${readModel.name}`);
    lines.push(`  ${handlerId}[${mermaidLabel(`${readModel.handler.source} ${basename(readModel.handler.resolvedPath)}`)}]`);
    lines.push(`  ${readModelId} --> ${handlerId}`);
    if (readModel.rules) {
      const rulesId = mermaidNodeId(`rules.${target.alias}.${readModel.rules.resolvedPath}`);
      lines.push(`  ${rulesId}[${mermaidLabel(`rules ${basename(readModel.rules.resolvedPath)}`)}]`);
      lines.push(`  ${readModelId} --> ${rulesId}`);
    }
  }
  return lines.join('\n');
}

function buildFrontendGeneratedMermaid(
  target: LojTargetConfig,
  files: ReadonlyArray<{ path: string }>,
): string {
  const lines = ['flowchart TD'];
  const appId = mermaidNodeId(`generated.frontend.${target.alias}`);
  lines.push(`  ${appId}[${mermaidLabel(`generated frontend ${target.alias}`)}]`);
  const groups = groupGeneratedFrontendFiles(files.map((file) => file.path));
  for (const [groupName, groupFiles] of groups) {
    const groupId = mermaidNodeId(`generated.frontend.${target.alias}.${groupName}`);
    lines.push(`  ${groupId}[${mermaidLabel(`${groupName} (${groupFiles.length})`)}]`);
    lines.push(`  ${appId} --> ${groupId}`);
    for (const file of groupFiles.slice(0, 8)) {
      const fileId = mermaidNodeId(`generated.frontend.file.${target.alias}.${file}`);
      lines.push(`  ${fileId}[${mermaidLabel(basename(file))}]`);
      lines.push(`  ${groupId} --> ${fileId}`);
    }
    if (groupFiles.length > 8) {
      const moreId = mermaidNodeId(`generated.frontend.more.${target.alias}.${groupName}`);
      lines.push(`  ${moreId}[${mermaidLabel(`… ${groupFiles.length - 8} more`)}]`);
      lines.push(`  ${groupId} --> ${moreId}`);
    }
  }
  return lines.join('\n');
}

function buildBackendGeneratedMermaid(
  target: LojTargetConfig,
  files: ReadonlyArray<{ path: string }>,
): string {
  const lines = ['flowchart TD'];
  const backendId = mermaidNodeId(`generated.backend.${target.alias}`);
  lines.push(`  ${backendId}[${mermaidLabel(`generated backend ${target.alias}`)}]`);
  const groups = groupGeneratedBackendFiles(files.map((file) => file.path));
  for (const [groupName, groupFiles] of groups) {
    const groupId = mermaidNodeId(`generated.backend.${target.alias}.${groupName}`);
    lines.push(`  ${groupId}[${mermaidLabel(`${groupName} (${groupFiles.length})`)}]`);
    lines.push(`  ${backendId} --> ${groupId}`);
    for (const file of groupFiles.slice(0, 8)) {
      const fileId = mermaidNodeId(`generated.backend.file.${target.alias}.${file}`);
      lines.push(`  ${fileId}[${mermaidLabel(basename(file))}]`);
      lines.push(`  ${groupId} --> ${fileId}`);
    }
    if (groupFiles.length > 8) {
      const moreId = mermaidNodeId(`generated.backend.more.${target.alias}.${groupName}`);
      lines.push(`  ${moreId}[${mermaidLabel(`… ${groupFiles.length - 8} more`)}]`);
      lines.push(`  ${groupId} --> ${moreId}`);
    }
  }
  return lines.join('\n');
}

function groupGeneratedFrontendFiles(files: ReadonlyArray<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files.slice().sort()) {
    const normalized = normalizePath(file);
    const group = normalized.startsWith('pages/')
      ? 'pages'
      : normalized.startsWith('models/')
        ? 'models'
        : normalized.startsWith('layout/')
          ? 'layout'
      : normalized.startsWith('views/')
        ? 'views'
        : normalized.startsWith('styles/')
          ? 'styles'
          : normalized.startsWith('frontend/')
            ? 'host-files'
            : normalized.startsWith('components/')
              ? 'components'
              : normalized === 'App.tsx' || normalized === 'router.tsx' || normalized === 'GENERATED.md'
                ? 'app-shell'
                : 'other';
    const entries = groups.get(group) ?? [];
    entries.push(normalized);
    groups.set(group, entries);
  }
  return groups;
}

function groupGeneratedBackendFiles(files: ReadonlyArray<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files.slice().sort()) {
    const normalized = normalizePath(file);
    const group = normalized.includes('/controller/') || normalized.startsWith('app/routes/') || normalized.startsWith('app/routers/')
      ? 'routes-controllers'
      : normalized.includes('/service/') || normalized.startsWith('app/services/')
        ? 'services'
        : normalized.includes('/model/') || normalized.includes('/entity/') || normalized.startsWith('app/models/')
          ? 'models'
          : normalized.includes('/dto/') || normalized.startsWith('app/dto/')
            ? 'dto'
            : normalized.includes('/workflow/') || normalized.startsWith('app/workflow/')
              ? 'workflow'
              : normalized.includes('/rules/') || normalized.startsWith('app/rules/') || normalized.startsWith('app/custom/rules/')
                ? 'rules'
                : normalized.startsWith('app/custom/read_models/') || normalized.includes('/readmodel/')
                  ? 'read-models'
                  : 'support';
    const entries = groups.get(group) ?? [];
    entries.push(normalized);
    groups.set(group, entries);
  }
  return groups;
}

function mermaidNodeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function mermaidLabel(value: string): string {
  return value.replace(/"/g, '#quot;');
}

function toNamedList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.name === 'string')
    : [];
}

function validateDatabaseConfigForTargetRuntime(
  target: LojTargetConfig,
  targetTriple: string | undefined,
): string | null {
  if (!target.database || !targetTriple) {
    return null;
  }
  if (targetTriple.startsWith('spring-boot/')) {
    if (target.database.vendor === 'sqlite') {
      return `target "${target.alias}" uses database.vendor "sqlite", which is not supported on spring-boot targets`;
    }
    return null;
  }
  if (targetTriple.startsWith('fastapi/')) {
    if (target.database.vendor === 'h2') {
      return `target "${target.alias}" uses database.vendor "h2", which is not supported on fastapi targets`;
    }
    if (target.database.migrations === 'flyway') {
      return `target "${target.alias}" sets database.migrations "flyway", which is only supported on spring-boot targets`;
    }
  }
  return null;
}

function validateRuntimeConfigForTargetRuntime(
  target: LojTargetConfig,
  targetTriple: string | undefined,
): string | null {
  if (!hasTargetRuntimeConfig(target.runtime) || !targetTriple) {
    return null;
  }
  if (targetTriple.startsWith('spring-boot/') || targetTriple.startsWith('fastapi/')) {
    return null;
  }
  return `target "${target.alias}" runtime config is not supported for target runtime "${targetTriple}"`;
}

function applyBackendShutdownProfile(
  outDir: string,
  runtime: LojTargetRuntimeConfig,
  targetTriple: string | undefined,
): BuildPostProcessResult | { error: string } {
  if ((targetTriple ?? '').startsWith('spring-boot/')) {
    const applicationPropertiesPath = resolve(outDir, 'src', 'main', 'resources', 'application.properties');
    if (!existsSync(applicationPropertiesPath)) {
      return { error: `spring-boot runtime shutdown profile expected generated application.properties under ${normalizePath(outDir)}` };
    }
    const source = readFileSync(applicationPropertiesPath, 'utf8');
    writeFileSync(applicationPropertiesPath, rewriteSpringApplicationPropertiesForRuntime(source, runtime), 'utf8');
    const addedFiles: string[] = [];
    if (runtime.health || runtime.readiness || runtime.drain) {
      const runtimeControllerPath = createSpringRuntimeController(outDir, runtime);
      if ('error' in runtimeControllerPath) {
        return runtimeControllerPath;
      }
      addedFiles.push(runtimeControllerPath.path);
    }
    if (runtime.cors || runtime.forwardedHeaders?.mode === 'standard') {
      const runtimeWebConfigPath = createSpringRuntimeWebConfig(outDir, runtime);
      if ('error' in runtimeWebConfigPath) {
        return runtimeWebConfigPath;
      }
      addedFiles.push(runtimeWebConfigPath.path);
    }
    return { addedFiles };
  }
  if ((targetTriple ?? '').startsWith('fastapi/')) {
    const mainPath = resolve(outDir, 'app', 'main.py');
    const readmePath = resolve(outDir, 'README.md');
    if (!existsSync(mainPath) || !existsSync(readmePath)) {
      return { error: `fastapi runtime shutdown profile expected generated app/main.py and README.md under ${normalizePath(outDir)}` };
    }
    const mainSource = readFileSync(mainPath, 'utf8');
    writeFileSync(mainPath, rewriteFastApiMainForRuntime(mainSource, runtime), 'utf8');
    const readmeSource = readFileSync(readmePath, 'utf8');
    writeFileSync(readmePath, rewriteFastApiReadmeForRuntime(readmeSource, runtime), 'utf8');
    return { addedFiles: [] };
  }
  return { addedFiles: [] };
}

function applySpringDatabaseProfile(
  outDir: string,
  database: LojTargetDatabaseConfig,
  ir: IRSdslProgram,
): BuildPostProcessResult | { error: string } {
  const pomPath = resolve(outDir, 'pom.xml');
  const applicationPropertiesPath = resolve(outDir, 'src', 'main', 'resources', 'application.properties');
  if (!existsSync(pomPath) || !existsSync(applicationPropertiesPath)) {
    return { error: `spring-boot database profile expected generated pom.xml and application.properties under ${normalizePath(outDir)}` };
  }

  let pom = readFileSync(pomPath, 'utf8');
  pom = rewriteSpringPomForDatabase(pom, database);
  writeFileSync(pomPath, pom, 'utf8');

  const applicationProperties = readFileSync(applicationPropertiesPath, 'utf8');
  writeFileSync(applicationPropertiesPath, rewriteSpringApplicationProperties(applicationProperties, database), 'utf8');

  const addedFiles: string[] = [];
  if (database.vendor !== 'h2') {
    const testPropertiesPath = resolve(outDir, 'src', 'test', 'resources', 'application.properties');
    mkdirSync(dirname(testPropertiesPath), { recursive: true });
    writeFileSync(testPropertiesPath, generateSpringTestApplicationProperties(), 'utf8');
    addedFiles.push(normalizePath(relative(outDir, testPropertiesPath)));
  }
  const schemaSql = generateNativeSqlSchema(ir, database.vendor);
  const schemaPath = resolve(outDir, 'db', 'schema.sql');
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, schemaSql, 'utf8');
  addedFiles.push(normalizePath(relative(outDir, schemaPath)));
  if (database.migrations === 'flyway') {
    const migrationPath = resolve(outDir, 'src', 'main', 'resources', 'db', 'migration', 'V1__baseline.sql');
    mkdirSync(dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, schemaSql, 'utf8');
    addedFiles.push(normalizePath(relative(outDir, migrationPath)));
  }
  if (database.migrations === 'native-sql') {
    const migrationPath = resolve(outDir, 'db', 'native-migrations', 'V1__baseline.sql');
    mkdirSync(dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, schemaSql, 'utf8');
    addedFiles.push(normalizePath(relative(outDir, migrationPath)));
  }

  const envExamplePath = resolve(outDir, '.env.database.example');
  writeFileSync(envExamplePath, generateDatabaseEnvExample(database, 'spring'), 'utf8');
  addedFiles.push(normalizePath(relative(outDir, envExamplePath)));

  if (database.mode === 'docker-compose' && vendorSupportsComposeMode(database.vendor)) {
    const composePath = resolve(outDir, 'docker-compose.database.yaml');
    writeFileSync(composePath, generateDatabaseDockerCompose(database), 'utf8');
    addedFiles.push(normalizePath(relative(outDir, composePath)));
  }

  return { addedFiles };
}

function applyFastApiDatabaseProfile(
  outDir: string,
  database: LojTargetDatabaseConfig,
  ir: IRSdslProgram,
): BuildPostProcessResult | { error: string } {
  const pyprojectPath = resolve(outDir, 'pyproject.toml');
  const configPath = resolve(outDir, 'app', 'config.py');
  const readmePath = resolve(outDir, 'README.md');
  if (!existsSync(pyprojectPath) || !existsSync(configPath) || !existsSync(readmePath)) {
    return { error: `fastapi database profile expected generated pyproject.toml, app/config.py, and README.md under ${normalizePath(outDir)}` };
  }

  let pyproject = readFileSync(pyprojectPath, 'utf8');
  pyproject = rewriteFastApiPyprojectForDatabase(pyproject, database);
  writeFileSync(pyprojectPath, pyproject, 'utf8');

  const configSource = readFileSync(configPath, 'utf8');
  writeFileSync(configPath, rewriteFastApiConfigForDatabase(configSource, database), 'utf8');

  const readme = readFileSync(readmePath, 'utf8');
  writeFileSync(readmePath, rewriteFastApiReadmeForDatabase(readme, database), 'utf8');

  const envExamplePath = resolve(outDir, '.env.database.example');
  writeFileSync(envExamplePath, generateDatabaseEnvExample(database, 'fastapi'), 'utf8');
  const addedFiles = [normalizePath(relative(outDir, envExamplePath))];

  const schemaSql = generateNativeSqlSchema(ir, database.vendor);
  const schemaPath = resolve(outDir, 'db', 'schema.sql');
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, schemaSql, 'utf8');
  addedFiles.push(normalizePath(relative(outDir, schemaPath)));
  if (database.migrations === 'native-sql') {
    const migrationPath = resolve(outDir, 'db', 'native-migrations', 'V1__baseline.sql');
    mkdirSync(dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, schemaSql, 'utf8');
    addedFiles.push(normalizePath(relative(outDir, migrationPath)));
  }

  if (database.mode === 'docker-compose' && vendorSupportsComposeMode(database.vendor)) {
    const composePath = resolve(outDir, 'docker-compose.database.yaml');
    writeFileSync(composePath, generateDatabaseDockerCompose(database), 'utf8');
    addedFiles.push(normalizePath(relative(outDir, composePath)));
  }

  return { addedFiles };
}

function countGeneratedFiles(payload: Record<string, unknown> | undefined): number {
  if (!payload) {
    return 0;
  }
  if (Array.isArray(payload.files)) {
    return payload.files.length;
  }
  return asNumber(payload.generatedFiles) ?? 0;
}

function countSourceFiles(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProjectDatabaseVendor(value: unknown): ProjectDatabaseVendor | null {
  return value === 'h2'
    || value === 'sqlite'
    || value === 'postgres'
    || value === 'mysql'
    || value === 'mariadb'
    || value === 'sqlserver'
    || value === 'oracle'
    ? value
    : null;
}

function normalizeProjectDatabaseMode(value: unknown): ProjectDatabaseMode | null {
  return value === 'embedded' || value === 'external' || value === 'docker-compose'
    ? value
    : null;
}

function normalizeProjectDatabaseMigrations(value: unknown): ProjectDatabaseMigrations | null {
  return value === 'none' || value === 'native-sql' || value === 'flyway' ? value : null;
}

function normalizeProjectRuntimeShutdownMode(value: unknown): ProjectRuntimeShutdownMode | null {
  return value === 'immediate' || value === 'graceful' ? value : null;
}

function normalizeProjectRuntimeForwardedHeadersMode(value: unknown): ProjectRuntimeForwardedHeadersMode | null {
  return value === 'none' || value === 'standard' ? value : null;
}

function normalizeProjectRuntimeTrustedProxyMode(value: unknown): ProjectRuntimeTrustedProxyMode | null {
  return value === 'local' || value === 'all' || value === 'cidrs' ? value : null;
}

function normalizeShutdownTimeout(
  value: unknown,
): { timeout: string; timeoutSeconds: number } | { error: string } {
  if (value === undefined) {
    return { timeout: '30s', timeoutSeconds: 30 };
  }
  if (typeof value !== 'string') {
    return { error: 'must be a duration string like "30s" or "2m"' };
  }
  const trimmed = value.trim();
  const match = /^([1-9][0-9]*)(s|m)$/.exec(trimmed);
  if (!match) {
    return { error: 'must be a duration string like "30s" or "2m"' };
  }
  const amount = Number(match[1]);
  return {
    timeout: trimmed,
    timeoutSeconds: match[2] === 'm' ? amount * 60 : amount,
  };
}

function normalizeOptionalPort(value: unknown): { port?: number } | { error: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { error: 'must be an integer when provided' };
  }
  if (value < 1 || value > 65_535) {
    return { error: 'must be between 1 and 65535' };
  }
  return { port: value };
}

function defaultDatabaseMode(vendor: ProjectDatabaseVendor): ProjectDatabaseMode {
  return vendor === 'h2' || vendor === 'sqlite' ? 'embedded' : 'external';
}

function defaultDatabasePort(vendor: ProjectDatabaseVendor): number | undefined {
  switch (vendor) {
    case 'postgres':
      return 5432;
    case 'mysql':
    case 'mariadb':
      return 3306;
    case 'sqlserver':
      return 1433;
    case 'oracle':
      return 1521;
    default:
      return undefined;
  }
}

function defaultDatabaseName(appName: string, vendor: ProjectDatabaseVendor): string {
  const normalized = toDatabaseIdentifier(appName);
  if (vendor === 'sqlite') {
    return `${normalized}.db`;
  }
  if (vendor === 'oracle') {
    return 'FREEPDB1';
  }
  return normalized;
}

function defaultDatabaseUsername(vendor: ProjectDatabaseVendor): string | undefined {
  switch (vendor) {
    case 'postgres':
      return 'loj';
    case 'mysql':
    case 'mariadb':
      return 'loj';
    case 'sqlserver':
      return 'sa';
    case 'oracle':
      return 'loj';
    case 'h2':
      return 'sa';
    default:
      return undefined;
  }
}

function defaultDatabasePassword(vendor: ProjectDatabaseVendor): string | undefined {
  switch (vendor) {
    case 'postgres':
      return 'loj';
    case 'mysql':
    case 'mariadb':
      return 'loj';
    case 'sqlserver':
    case 'oracle':
      return 'LojPassw0rd!';
    case 'h2':
      return '';
    default:
      return undefined;
  }
}

function vendorSupportsComposeMode(vendor: ProjectDatabaseVendor): boolean {
  return vendor === 'postgres' || vendor === 'mysql' || vendor === 'mariadb';
}

function toDatabaseIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'loj_app';
}

function rewriteSpringPomForDatabase(source: string, database: LojTargetDatabaseConfig): string {
  const h2DependencyPattern = /<dependency>\s*<groupId>com\.h2database<\/groupId>\s*<artifactId>h2<\/artifactId>\s*<scope>runtime<\/scope>\s*<\/dependency>/m;
  let rewritten = source;
  const replacementDependencies = database.vendor === 'h2'
    ? springDatabaseDependencyBlock(database.vendor, 'runtime')
    : `${springDatabaseDependencyBlock(database.vendor, 'runtime')}\n    ${springDatabaseDependencyBlock('h2', 'test')}`;
  rewritten = rewritten.replace(h2DependencyPattern, replacementDependencies);
  if (database.migrations === 'flyway' && !rewritten.includes('<artifactId>flyway-core</artifactId>')) {
    rewritten = rewritten.replace(
      /<dependency>\s*<groupId>org\.springframework\.boot<\/groupId>\s*<artifactId>spring-boot-test<\/artifactId>/m,
      `    <dependency>\n      <groupId>org.flywaydb</groupId>\n      <artifactId>flyway-core</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-test</artifactId>`,
    );
  }
  return rewritten;
}

function springDatabaseDependencyBlock(vendor: ProjectDatabaseVendor, scope: 'runtime' | 'test'): string {
  if (vendor === 'h2') {
    return `<dependency>\n      <groupId>com.h2database</groupId>\n      <artifactId>h2</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
  }
  if (vendor === 'postgres') {
    return `<dependency>\n      <groupId>org.postgresql</groupId>\n      <artifactId>postgresql</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
  }
  if (vendor === 'mysql') {
    return `<dependency>\n      <groupId>com.mysql</groupId>\n      <artifactId>mysql-connector-j</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
  }
  if (vendor === 'mariadb') {
    return `<dependency>\n      <groupId>org.mariadb.jdbc</groupId>\n      <artifactId>mariadb-java-client</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
  }
  if (vendor === 'sqlserver') {
    return `<dependency>\n      <groupId>com.microsoft.sqlserver</groupId>\n      <artifactId>mssql-jdbc</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
  }
  return `<dependency>\n      <groupId>com.oracle.database.jdbc</groupId>\n      <artifactId>ojdbc11</artifactId>\n      <scope>${scope}</scope>\n    </dependency>`;
}

function rewriteSpringApplicationProperties(source: string, database: LojTargetDatabaseConfig): string {
  const properties = new Map<string, string>();
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }

  if (database.vendor === 'h2') {
    properties.set('spring.datasource.url', `jdbc:h2:mem:${database.name};DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE`);
    properties.set('spring.datasource.driverClassName', 'org.h2.Driver');
    properties.set('spring.datasource.username', database.username ?? 'sa');
    properties.set('spring.datasource.password', database.password ?? '');
    properties.set('spring.h2.console.enabled', 'true');
    properties.set('spring.h2.console.path', '/h2-console');
  } else if (database.vendor === 'postgres') {
    properties.set('spring.datasource.url', `\${LOJ_DATABASE_URL:${createSpringJdbcUrl(database)}}`);
    properties.set('spring.datasource.driverClassName', 'org.postgresql.Driver');
    properties.set('spring.datasource.username', `\${LOJ_DATABASE_USERNAME:${database.username ?? 'loj'}}`);
    properties.set('spring.datasource.password', `\${LOJ_DATABASE_PASSWORD:${database.password ?? 'loj'}}`);
    properties.set('spring.jpa.database-platform', 'org.hibernate.dialect.PostgreSQLDialect');
    properties.set('spring.h2.console.enabled', 'false');
  } else if (database.vendor === 'mysql') {
    properties.set('spring.datasource.url', `\${LOJ_DATABASE_URL:${createSpringJdbcUrl(database)}}`);
    properties.set('spring.datasource.driverClassName', 'com.mysql.cj.jdbc.Driver');
    properties.set('spring.datasource.username', `\${LOJ_DATABASE_USERNAME:${database.username ?? 'loj'}}`);
    properties.set('spring.datasource.password', `\${LOJ_DATABASE_PASSWORD:${database.password ?? 'loj'}}`);
    properties.set('spring.jpa.database-platform', 'org.hibernate.dialect.MySQLDialect');
    properties.set('spring.h2.console.enabled', 'false');
  } else if (database.vendor === 'mariadb') {
    properties.set('spring.datasource.url', `\${LOJ_DATABASE_URL:${createSpringJdbcUrl(database)}}`);
    properties.set('spring.datasource.driverClassName', 'org.mariadb.jdbc.Driver');
    properties.set('spring.datasource.username', `\${LOJ_DATABASE_USERNAME:${database.username ?? 'loj'}}`);
    properties.set('spring.datasource.password', `\${LOJ_DATABASE_PASSWORD:${database.password ?? 'loj'}}`);
    properties.set('spring.jpa.database-platform', 'org.hibernate.dialect.MariaDBDialect');
    properties.set('spring.h2.console.enabled', 'false');
  } else if (database.vendor === 'sqlserver') {
    properties.set('spring.datasource.url', `\${LOJ_DATABASE_URL:${createSpringJdbcUrl(database)}}`);
    properties.set('spring.datasource.driverClassName', 'com.microsoft.sqlserver.jdbc.SQLServerDriver');
    properties.set('spring.datasource.username', `\${LOJ_DATABASE_USERNAME:${database.username ?? 'sa'}}`);
    properties.set('spring.datasource.password', `\${LOJ_DATABASE_PASSWORD:${database.password ?? 'LojPassw0rd!'}}`);
    properties.set('spring.jpa.database-platform', 'org.hibernate.dialect.SQLServerDialect');
    properties.set('spring.h2.console.enabled', 'false');
  } else if (database.vendor === 'oracle') {
    properties.set('spring.datasource.url', `\${LOJ_DATABASE_URL:${createSpringJdbcUrl(database)}}`);
    properties.set('spring.datasource.driverClassName', 'oracle.jdbc.OracleDriver');
    properties.set('spring.datasource.username', `\${LOJ_DATABASE_USERNAME:${database.username ?? 'loj'}}`);
    properties.set('spring.datasource.password', `\${LOJ_DATABASE_PASSWORD:${database.password ?? 'LojPassw0rd!'}}`);
    properties.set('spring.jpa.database-platform', 'org.hibernate.dialect.OracleDialect');
    properties.set('spring.h2.console.enabled', 'false');
  }
  properties.set('spring.jpa.hibernate.ddl-auto', 'update');
  properties.set('spring.jpa.open-in-view', 'false');
  properties.set('spring.jpa.show-sql', 'true');
  if (database.migrations === 'flyway') {
    properties.set('spring.flyway.enabled', 'true');
    properties.set('spring.flyway.locations', 'classpath:db/migration');
  }

  const lines = [
    `spring.application.name=${properties.get('spring.application.name') ?? 'loj-app'}`,
    `spring.datasource.url=${properties.get('spring.datasource.url')}`,
    `spring.datasource.driverClassName=${properties.get('spring.datasource.driverClassName')}`,
    `spring.datasource.username=${properties.get('spring.datasource.username')}`,
    `spring.datasource.password=${properties.get('spring.datasource.password')}`,
    `spring.jpa.hibernate.ddl-auto=${properties.get('spring.jpa.hibernate.ddl-auto')}`,
    `spring.jpa.open-in-view=${properties.get('spring.jpa.open-in-view')}`,
    `spring.jpa.show-sql=${properties.get('spring.jpa.show-sql')}`,
  ];
  if (properties.has('spring.jpa.database-platform')) {
    lines.push(`spring.jpa.database-platform=${properties.get('spring.jpa.database-platform')}`);
  }
  lines.push(`spring.h2.console.enabled=${properties.get('spring.h2.console.enabled') ?? 'false'}`);
  if (properties.has('spring.h2.console.path')) {
    lines.push(`spring.h2.console.path=${properties.get('spring.h2.console.path')}`);
  }
  if (database.migrations === 'flyway') {
    lines.push(`spring.flyway.enabled=${properties.get('spring.flyway.enabled')}`);
    lines.push(`spring.flyway.locations=${properties.get('spring.flyway.locations')}`);
  }
  return `${lines.join('\n')}\n`;
}

function rewriteSpringApplicationPropertiesForRuntime(
  source: string,
  runtime: LojTargetRuntimeConfig,
): string {
  const properties = new Map<string, string>();
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  if (runtime.shutdown?.mode === 'graceful') {
    properties.set('server.shutdown', 'graceful');
    properties.set('spring.lifecycle.timeout-per-shutdown-phase', runtime.shutdown.timeout);
  } else {
    properties.delete('server.shutdown');
    properties.delete('spring.lifecycle.timeout-per-shutdown-phase');
  }
  if (runtime.basePath && runtime.basePath !== '/') {
    properties.set('server.servlet.context-path', runtime.basePath);
  } else {
    properties.delete('server.servlet.context-path');
  }
  if (runtime.requestSizeLimit) {
    properties.set('spring.servlet.multipart.max-file-size', runtime.requestSizeLimit.source);
    properties.set('spring.servlet.multipart.max-request-size', runtime.requestSizeLimit.source);
  } else {
    properties.delete('spring.servlet.multipart.max-file-size');
    properties.delete('spring.servlet.multipart.max-request-size');
  }

  const lines = Array.from(properties.entries()).map(([key, value]) => `${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

function createSpringJdbcUrl(database: LojTargetDatabaseConfig): string {
  if (database.vendor === 'postgres') {
    return `jdbc:postgresql://${database.host ?? '127.0.0.1'}:${database.port ?? 5432}/${database.name}`;
  }
  if (database.vendor === 'mysql') {
    return `jdbc:mysql://${database.host ?? '127.0.0.1'}:${database.port ?? 3306}/${database.name}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC`;
  }
  if (database.vendor === 'mariadb') {
    return `jdbc:mariadb://${database.host ?? '127.0.0.1'}:${database.port ?? 3306}/${database.name}`;
  }
  if (database.vendor === 'sqlserver') {
    return `jdbc:sqlserver://${database.host ?? '127.0.0.1'}:${database.port ?? 1433};databaseName=${database.name};encrypt=true;trustServerCertificate=true`;
  }
  if (database.vendor === 'oracle') {
    return `jdbc:oracle:thin:@//${database.host ?? '127.0.0.1'}:${database.port ?? 1521}/${database.name}`;
  }
  return `jdbc:h2:mem:${database.name};DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE`;
}

function generateSpringTestApplicationProperties(): string {
  return [
    'spring.datasource.url=jdbc:h2:mem:lojtest;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE',
    'spring.datasource.driverClassName=org.h2.Driver',
    'spring.datasource.username=sa',
    'spring.datasource.password=',
    'spring.jpa.hibernate.ddl-auto=create-drop',
    'spring.jpa.open-in-view=false',
    'spring.jpa.show-sql=false',
    '',
  ].join('\n');
}

function rewriteFastApiPyprojectForDatabase(source: string, database: LojTargetDatabaseConfig): string {
  if (database.vendor === 'postgres' && !source.includes('"psycopg[binary]>=3.2,<4"')) {
    return source.replace('"pydantic[email]>=2.9,<3",', '"pydantic[email]>=2.9,<3",\n  "psycopg[binary]>=3.2,<4",');
  }
  if (database.vendor === 'mysql' && !source.includes('"pymysql>=1.1,<2"')) {
    return source.replace('"pydantic[email]>=2.9,<3",', '"pydantic[email]>=2.9,<3",\n  "pymysql>=1.1,<2",');
  }
  if (database.vendor === 'mariadb' && !source.includes('"mariadb>=1.1,<2"')) {
    return source.replace('"pydantic[email]>=2.9,<3",', '"pydantic[email]>=2.9,<3",\n  "mariadb>=1.1,<2",');
  }
  if (database.vendor === 'sqlserver' && !source.includes('"pyodbc>=5,<6"')) {
    return source.replace('"pydantic[email]>=2.9,<3",', '"pydantic[email]>=2.9,<3",\n  "pyodbc>=5,<6",');
  }
  if (database.vendor === 'oracle' && !source.includes('"oracledb>=2,<3"')) {
    return source.replace('"pydantic[email]>=2.9,<3",', '"pydantic[email]>=2.9,<3",\n  "oracledb>=2,<3",');
  }
  return source;
}

function rewriteFastApiConfigForDatabase(source: string, database: LojTargetDatabaseConfig): string {
  const nextUrl = createFastApiDatabaseUrl(database);
  return source.replace(
    /database_url=os\.getenv\("LOJ_DATABASE_URL", "[^"]+"\)/,
    `database_url=os.getenv("LOJ_DATABASE_URL", "${nextUrl}")`,
  );
}

function rewriteFastApiReadmeForDatabase(source: string, database: LojTargetDatabaseConfig): string {
  const lines = source.split('\n').map((line) => (
    line.startsWith('Default local database:')
      ? `Default local database: \`${createFastApiDatabaseUrl(database)}\``
      : line
  ));
  return lines.join('\n');
}

function rewriteFastApiMainForRuntime(
  source: string,
  runtime: LojTargetRuntimeConfig,
): string {
  let rewritten = source;
  const needsLifespan = runtime.shutdown?.mode === 'graceful';
  const needsRuntimeProbes = Boolean(runtime.health || runtime.readiness || runtime.drain);
  const needsCors = Boolean(runtime.cors);
  const needsForwardedHeaders = runtime.forwardedHeaders?.mode === 'standard';
  const needsRequestSizeLimit = Boolean(runtime.requestSizeLimit);
  if ((needsLifespan || needsRuntimeProbes) && !rewritten.includes('from contextlib import asynccontextmanager')) {
    rewritten = insertPythonImportAfterFutureAnnotation(rewritten, 'from contextlib import asynccontextmanager');
  }
  if (needsCors && !rewritten.includes('from fastapi.middleware.cors import CORSMiddleware')) {
    rewritten = insertPythonImportAfterFutureAnnotation(rewritten, 'from fastapi.middleware.cors import CORSMiddleware');
  }
  if (needsForwardedHeaders && !rewritten.includes('from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware')) {
    rewritten = insertPythonImportAfterFutureAnnotation(rewritten, 'from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware');
  }
  if (needsRequestSizeLimit && !rewritten.includes('from starlette.middleware.base import BaseHTTPMiddleware')) {
    rewritten = insertPythonImportAfterFutureAnnotation(rewritten, 'from starlette.middleware.base import BaseHTTPMiddleware');
  }
  if ((needsLifespan || needsRuntimeProbes) && !rewritten.includes('def loj_graceful_shutdown_lifespan(')) {
    const insertion = `\n\n@asynccontextmanager\nasync def loj_graceful_shutdown_lifespan(app: FastAPI):\n  app.state.loj_draining = False\n  try:\n    yield\n  finally:\n    # Generated shutdown hook placeholder for target-local cleanup when the process manager drains requests.\n    app.state.loj_draining = True\n`;
    rewritten = rewritten.replace('Base.metadata.create_all(bind=engine)\n', `Base.metadata.create_all(bind=engine)${insertion}\n`);
  }
  rewritten = rewritten.replace(
    /app = FastAPI\(title=SETTINGS\.app_name(?:, lifespan=loj_graceful_shutdown_lifespan)?(?:, root_path="[^"]+")?\)/,
    renderFastApiAppDeclaration(runtime, needsLifespan || needsRuntimeProbes),
  );
  if (needsForwardedHeaders && !rewritten.includes('app.add_middleware(ProxyHeadersMiddleware')) {
    rewritten = rewritten.replace(
      /app = FastAPI\(title=SETTINGS\.app_name(?:, lifespan=loj_graceful_shutdown_lifespan)?(?:, root_path="[^"]+")?\)\n/,
      (match) => `${match}app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=${renderFastApiTrustedHosts(runtime.trustedProxy)})\n`,
    );
  }
  if (needsCors && !rewritten.includes('app.add_middleware(CORSMiddleware')) {
    rewritten = rewritten.replace(
      /app = FastAPI\(title=SETTINGS\.app_name(?:, lifespan=loj_graceful_shutdown_lifespan)?(?:, root_path="[^"]+")?\)\n(?:app\.add_middleware\(ProxyHeadersMiddleware, trusted_hosts=.*\)\n)?/,
      (match) => `${match}${generateFastApiCorsMiddlewareBlock(runtime.cors!)}\n`,
    );
  }
  if (needsRequestSizeLimit && !rewritten.includes('class LojRequestSizeLimitMiddleware')) {
    rewritten = rewritten.replace(
      /app = FastAPI\(title=SETTINGS\.app_name(?:, lifespan=loj_graceful_shutdown_lifespan)?(?:, root_path="[^"]+")?\)\n(?:app\.add_middleware\(ProxyHeadersMiddleware, trusted_hosts=.*\)\n)?(?:app\.add_middleware\(\n  CORSMiddleware,[\s\S]*?\)\n)?/,
      (match) => `${generateFastApiRequestSizeLimitMiddlewareBlock(runtime.requestSizeLimit!)}\n\n${match}app.add_middleware(LojRequestSizeLimitMiddleware, max_bytes=${runtime.requestSizeLimit!.bytes})\n`,
    );
  }
  if (runtime.health || runtime.readiness || runtime.drain) {
    rewritten = rewritten.replace(
      `@app.get("/healthz")\nasync def healthz() -> dict[str, str]:\n  return {"status": "ok"}`,
      generateFastApiRuntimeProbeBlock(runtime),
    );
  }
  return rewritten;
}

function renderFastApiAppDeclaration(
  runtime: LojTargetRuntimeConfig,
  withLifespan: boolean,
): string {
  const args = ['title=SETTINGS.app_name'];
  if (withLifespan) {
    args.push('lifespan=loj_graceful_shutdown_lifespan');
  }
  if (runtime.basePath && runtime.basePath !== '/') {
    args.push(`root_path=${JSON.stringify(runtime.basePath)}`);
  }
  return `app = FastAPI(${args.join(', ')})`;
}

function insertPythonImportAfterFutureAnnotation(source: string, importLine: string): string {
  if (source.includes(importLine)) {
    return source;
  }
  const marker = 'from __future__ import annotations\n\n';
  if (source.includes(marker)) {
    return source.replace(marker, `${marker}${importLine}\n`);
  }
  return `${importLine}\n${source}`;
}

function rewriteFastApiReadmeForRuntime(
  source: string,
  runtime: LojTargetRuntimeConfig,
): string {
  const command = buildFastApiRunCommand(runtime);
  return source.replace(
    'uvicorn app.main:app --reload',
    command,
  );
}

function generateFastApiRuntimeProbeBlock(runtime: LojTargetRuntimeConfig): string {
  const lines = [
    `@app.get("${runtime.health?.path ?? '/healthz'}")`,
    'async def loj_healthz() -> dict[str, str]:',
    '  return {"status": "ok"}',
    '',
  ];
  if (runtime.readiness) {
    lines.push(
      `@app.get("${runtime.readiness.path}")`,
      'async def loj_readiness() -> JSONResponse:',
      '  draining = bool(getattr(app.state, "loj_draining", False))',
      '  if draining:',
      '    return JSONResponse(status_code=503, content={"status": "draining"})',
      '  return JSONResponse(status_code=200, content={"status": "ready"})',
      '',
    );
  }
  if (runtime.drain) {
    lines.push(
      `@app.post("${runtime.drain.path}")`,
      'async def loj_drain() -> JSONResponse:',
      '  app.state.loj_draining = True',
      '  return JSONResponse(status_code=202, content={"status": "draining"})',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

function buildFastApiRunCommand(runtime: LojTargetRuntimeConfig): string {
  const args = ['uvicorn app.main:app --reload'];
  if (runtime.basePath && runtime.basePath !== '/') {
    args.push(`--root-path ${runtime.basePath}`);
  }
  if (runtime.shutdown?.mode === 'graceful') {
    args.push(`--timeout-graceful-shutdown ${runtime.shutdown.timeoutSeconds}`);
  }
  if (runtime.forwardedHeaders?.mode === 'standard') {
    args.push('--proxy-headers');
    args.push(`--forwarded-allow-ips ${renderTrustedProxyForwardedAllowIps(runtime.trustedProxy)}`);
  }
  return args.join(' ');
}

function generateFastApiRequestSizeLimitMiddlewareBlock(
  requestSizeLimit: LojTargetRuntimeRequestSizeLimitConfig,
): string {
  return [
    'class LojRequestSizeLimitMiddleware(BaseHTTPMiddleware):',
    '  def __init__(self, app, max_bytes: int):',
    '    super().__init__(app)',
    '    self.max_bytes = max_bytes',
    '',
    '  async def dispatch(self, request: Request, call_next):',
    '    content_length = request.headers.get("content-length")',
    '    if content_length is not None:',
    '      try:',
    '        if int(content_length) > self.max_bytes:',
    `          return JSONResponse(status_code=413, content={"message": "Request exceeds generated limit of ${requestSizeLimit.source}"})`,
    '      except ValueError:',
    '        pass',
    '    return await call_next(request)',
  ].join('\n');
}

function renderFastApiTrustedHosts(trustedProxy: LojTargetRuntimeTrustedProxyConfig | undefined): string {
  if (trustedProxy?.mode === 'all') {
    return '"*"';
  }
  if (trustedProxy?.mode === 'cidrs' && trustedProxy.cidrs) {
    return renderPythonStringList(trustedProxy.cidrs);
  }
  return '["127.0.0.1", "::1"]';
}

function renderTrustedProxyForwardedAllowIps(trustedProxy: LojTargetRuntimeTrustedProxyConfig | undefined): string {
  if (trustedProxy?.mode === 'all') {
    return '*';
  }
  if (trustedProxy?.mode === 'cidrs' && trustedProxy.cidrs) {
    return trustedProxy.cidrs.join(',');
  }
  return '127.0.0.1,::1';
}

function generateFastApiCorsMiddlewareBlock(cors: LojTargetRuntimeCorsConfig): string {
  const methods = cors.methods && cors.methods.length > 0 ? cors.methods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const headers = cors.headers && cors.headers.length > 0 ? cors.headers : ['*'];
  return [
    'app.add_middleware(',
    '  CORSMiddleware,',
    `  allow_origins=${renderPythonStringList(cors.origins)},`,
    `  allow_methods=${renderPythonStringList(methods)},`,
    `  allow_headers=${renderPythonStringList(headers)},`,
    `  allow_credentials=${cors.credentials ? 'True' : 'False'},`,
    ')',
  ].join('\n');
}

function renderPythonStringList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function appendBasePathToUrl(url: string, basePath: string | undefined): string {
  if (!basePath || basePath === '/') {
    return url;
  }
  return `${url}${basePath}`;
}

function createSpringRuntimeController(
  outDir: string,
  runtime: LojTargetRuntimeConfig,
): { path: string } | { error: string } {
  const applicationFile = findSpringApplicationFile(outDir);
  if (!applicationFile) {
    return { error: `spring-boot runtime profile could not locate generated application source under ${normalizePath(outDir)}` };
  }
  const packageMatch = /^package\s+([a-zA-Z0-9_.]+);/m.exec(readFileSync(applicationFile, 'utf8'));
  if (!packageMatch) {
    return { error: `spring-boot runtime profile could not determine application package from ${normalizePath(applicationFile)}` };
  }
  const packageName = packageMatch[1];
  const packagePath = packageName.replace(/\./g, '/');
  const controllerPath = resolve(outDir, 'src', 'main', 'java', packagePath, 'runtime', 'LojRuntimeController.java');
  mkdirSync(dirname(controllerPath), { recursive: true });
  writeFileSync(controllerPath, generateSpringRuntimeControllerSource(packageName, runtime), 'utf8');
  return { path: normalizePath(relative(outDir, controllerPath)) };
}

function createSpringRuntimeWebConfig(
  outDir: string,
  runtime: LojTargetRuntimeConfig,
): { path: string } | { error: string } {
  const applicationFile = findSpringApplicationFile(outDir);
  if (!applicationFile) {
    return { error: `spring-boot runtime web profile could not locate generated application source under ${normalizePath(outDir)}` };
  }
  const packageMatch = /^package\s+([a-zA-Z0-9_.]+);/m.exec(readFileSync(applicationFile, 'utf8'));
  if (!packageMatch) {
    return { error: `spring-boot runtime web profile could not determine application package from ${normalizePath(applicationFile)}` };
  }
  const packageName = packageMatch[1];
  const packagePath = packageName.replace(/\./g, '/');
  const configPath = resolve(outDir, 'src', 'main', 'java', packagePath, 'runtime', 'LojRuntimeWebConfig.java');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, generateSpringRuntimeWebConfigSource(packageName, runtime), 'utf8');
  return { path: normalizePath(relative(outDir, configPath)) };
}

function findSpringApplicationFile(outDir: string): string | null {
  const root = resolve(outDir, 'src', 'main', 'java');
  if (!existsSync(root)) {
    return null;
  }
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entryName of nodeFs.readdirSync(directory)) {
      const fullPath = resolve(directory, entryName);
      if (isReadableDirectory(fullPath)) {
        stack.push(fullPath);
        continue;
      }
      if (entryName.endsWith('Application.java')) {
        return fullPath;
      }
    }
  }
  return null;
}

function isReadableDirectory(path: string): boolean {
  try {
    nodeFs.readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

function generateSpringRuntimeControllerSource(
  packageName: string,
  runtime: LojTargetRuntimeConfig,
): string {
  const lines = [
    `package ${packageName}.runtime;`,
    '',
    'import java.util.Map;',
    'import java.util.concurrent.atomic.AtomicBoolean;',
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.http.ResponseEntity;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.PostMapping;',
    'import org.springframework.web.bind.annotation.RestController;',
    '',
    '@RestController',
    'public class LojRuntimeController {',
    '  private final AtomicBoolean draining = new AtomicBoolean(false);',
    '',
    `  @GetMapping("${runtime.health?.path ?? '/healthz'}")`,
    '  public Map<String, String> health() {',
    '    return Map.of("status", "ok");',
    '  }',
    '',
  ];
  if (runtime.readiness) {
    lines.push(
      `  @GetMapping("${runtime.readiness.path}")`,
      '  public ResponseEntity<Map<String, String>> readiness() {',
      '    if (draining.get()) {',
      '      return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "draining"));',
      '    }',
      '    return ResponseEntity.ok(Map.of("status", "ready"));',
      '  }',
      '',
    );
  }
  if (runtime.drain) {
    lines.push(
      `  @PostMapping("${runtime.drain.path}")`,
      '  public ResponseEntity<Map<String, String>> drain() {',
      '    draining.set(true);',
      '    return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("status", "draining"));',
      '  }',
      '',
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function generateSpringRuntimeWebConfigSource(
  packageName: string,
  runtime: LojTargetRuntimeConfig,
): string {
  const needsCors = Boolean(runtime.cors);
  const needsForwardedHeaders = runtime.forwardedHeaders?.mode === 'standard';
  const lines = [
    `package ${packageName}.runtime;`,
    '',
    'import jakarta.servlet.FilterChain;',
    'import jakarta.servlet.ServletException;',
    'import jakarta.servlet.http.HttpServletRequest;',
    'import jakarta.servlet.http.HttpServletRequestWrapper;',
    'import jakarta.servlet.http.HttpServletResponse;',
    'import java.io.IOException;',
    'import java.net.InetAddress;',
    'import org.springframework.boot.web.servlet.FilterRegistrationBean;',
    'import org.springframework.context.annotation.Bean;',
    'import org.springframework.context.annotation.Configuration;',
    'import org.springframework.core.Ordered;',
    'import org.springframework.web.filter.OncePerRequestFilter;',
    'import org.springframework.web.servlet.config.annotation.CorsRegistry;',
    'import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;',
    '',
    '@Configuration',
    'public class LojRuntimeWebConfig implements WebMvcConfigurer {',
  ];
  if (needsCors) {
    lines.push(
      '  @Override',
      '  public void addCorsMappings(CorsRegistry registry) {',
      '    registry.addMapping("/**")',
      `      .allowedOrigins(${runtime.cors!.origins.map((origin) => `"${escapeJavaString(origin)}"`).join(', ')})`,
      `      .allowedMethods(${(runtime.cors?.methods && runtime.cors.methods.length > 0 ? runtime.cors.methods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).map((method) => `"${escapeJavaString(method)}"`).join(', ')})`,
      `      .allowedHeaders(${(runtime.cors?.headers && runtime.cors.headers.length > 0 ? runtime.cors.headers : ['*']).map((header) => `"${escapeJavaString(header)}"`).join(', ')})`,
      `      .allowCredentials(${runtime.cors!.credentials ? 'true' : 'false'});`,
      '  }',
      '',
    );
  }
  if (needsForwardedHeaders) {
    lines.push(
      '  @Bean',
      '  public FilterRegistrationBean<OncePerRequestFilter> lojForwardedHeaderFilter() {',
      '    FilterRegistrationBean<OncePerRequestFilter> registration = new FilterRegistrationBean<>();',
      '    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);',
      '    registration.setFilter(new OncePerRequestFilter() {',
      '      @Override',
      '      protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)',
      '          throws ServletException, IOException {',
      '        if (!isTrustedProxy(request.getRemoteAddr())) {',
      '          filterChain.doFilter(request, response);',
      '          return;',
      '        }',
      '        String forwardedProto = firstForwardedValue(request.getHeader("X-Forwarded-Proto"));',
      '        String forwardedHost = firstForwardedValue(request.getHeader("X-Forwarded-Host"));',
      '        String forwardedPort = firstForwardedValue(request.getHeader("X-Forwarded-Port"));',
      '        HttpServletRequestWrapper wrapper = new HttpServletRequestWrapper(request) {',
      '          @Override',
      '          public String getScheme() {',
      '            return forwardedProto != null ? forwardedProto : super.getScheme();',
      '          }',
      '          @Override',
      '          public boolean isSecure() {',
      '            return "https".equalsIgnoreCase(getScheme()) || super.isSecure();',
      '          }',
      '          @Override',
      '          public String getServerName() {',
      '            if (forwardedHost == null) {',
      '              return super.getServerName();',
      '            }',
      '            int separator = forwardedHost.indexOf(":");',
      '            return separator >= 0 ? forwardedHost.substring(0, separator) : forwardedHost;',
      '          }',
      '          @Override',
      '          public int getServerPort() {',
      '            if (forwardedPort != null) {',
      '              try {',
      '                return Integer.parseInt(forwardedPort);',
      '              } catch (NumberFormatException ignored) {',
      '                // Fall through to host/scheme defaults.',
      '              }',
      '            }',
      '            if (forwardedHost != null) {',
      '              int separator = forwardedHost.indexOf(":");',
      '              if (separator >= 0) {',
      '                try {',
      '                  return Integer.parseInt(forwardedHost.substring(separator + 1));',
      '                } catch (NumberFormatException ignored) {',
      '                  // Fall through to scheme defaults.',
      '                }',
      '              }',
      '            }',
      '            return "https".equalsIgnoreCase(getScheme()) ? 443 : 80;',
      '          }',
      '        };',
      '        filterChain.doFilter(wrapper, response);',
      '      }',
      '    });',
      '    return registration;',
      '  }',
      '',
      '  private boolean isTrustedProxy(String remoteAddr) {',
      generateSpringTrustedProxyCheckSource(runtime.trustedProxy),
      '  }',
      '',
      ...(runtime.trustedProxy?.mode === 'cidrs'
        ? [
          '  private boolean isWithinTrustedCidrs(InetAddress address) {',
          `    String[] cidrs = new String[] { ${runtime.trustedProxy.cidrs!.map((cidr) => `"${escapeJavaString(cidr)}"`).join(', ')} };`,
          '    for (String cidr : cidrs) {',
          '      if (matchesCidr(address, cidr)) {',
          '        return true;',
          '      }',
          '    }',
          '    return false;',
          '  }',
          '',
          '  private boolean matchesCidr(InetAddress address, String cidr) {',
          '    int separator = cidr.indexOf("/");',
          '    if (separator < 0) {',
          '      return false;',
          '    }',
          '    try {',
          '      InetAddress network = InetAddress.getByName(cidr.substring(0, separator));',
          '      int prefixLength = Integer.parseInt(cidr.substring(separator + 1));',
          '      byte[] addressBytes = address.getAddress();',
          '      byte[] networkBytes = network.getAddress();',
          '      if (addressBytes.length != networkBytes.length) {',
          '        return false;',
          '      }',
          '      int fullBytes = prefixLength / 8;',
          '      int remainingBits = prefixLength % 8;',
          '      for (int index = 0; index < fullBytes; index += 1) {',
          '        if (addressBytes[index] != networkBytes[index]) {',
          '          return false;',
          '        }',
          '      }',
          '      if (remainingBits == 0) {',
          '        return true;',
          '      }',
          '      int mask = ~((1 << (8 - remainingBits)) - 1) & 0xFF;',
          '      return (addressBytes[fullBytes] & mask) == (networkBytes[fullBytes] & mask);',
          '    } catch (Exception ignored) {',
          '      return false;',
          '    }',
          '  }',
          '',
        ]
        : []),
      '  private String firstForwardedValue(String value) {',
      '    if (value == null || value.isBlank()) {',
      '      return null;',
      '    }',
      '    int separator = value.indexOf(",");',
      '    return separator >= 0 ? value.substring(0, separator).trim() : value.trim();',
      '  }',
      '',
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function escapeJavaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function generateSpringTrustedProxyCheckSource(
  trustedProxy: LojTargetRuntimeTrustedProxyConfig | undefined,
): string {
  if (trustedProxy?.mode === 'all') {
    return '    return true;';
  }
  if (trustedProxy?.mode === 'cidrs') {
    return '    try {\n      InetAddress address = InetAddress.getByName(remoteAddr);\n      return isWithinTrustedCidrs(address);\n    } catch (Exception ignored) {\n      return false;\n    }';
  }
  return '    try {\n      InetAddress address = InetAddress.getByName(remoteAddr);\n      return address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isSiteLocalAddress();\n    } catch (Exception ignored) {\n      return false;\n    }';
}

function createFastApiDatabaseUrl(database: LojTargetDatabaseConfig): string {
  if (database.vendor === 'postgres') {
    return `postgresql+psycopg://${database.username ?? 'loj'}:${database.password ?? 'loj'}@${database.host ?? '127.0.0.1'}:${database.port ?? 5432}/${database.name}`;
  }
  if (database.vendor === 'mysql') {
    return `mysql+pymysql://${database.username ?? 'loj'}:${database.password ?? 'loj'}@${database.host ?? '127.0.0.1'}:${database.port ?? 3306}/${database.name}`;
  }
  if (database.vendor === 'mariadb') {
    return `mariadb+mariadbconnector://${database.username ?? 'loj'}:${database.password ?? 'loj'}@${database.host ?? '127.0.0.1'}:${database.port ?? 3306}/${database.name}`;
  }
  if (database.vendor === 'sqlserver') {
    return `mssql+pyodbc://${database.username ?? 'sa'}:${database.password ?? 'LojPassw0rd!'}@${database.host ?? '127.0.0.1'}:${database.port ?? 1433}/${database.name}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes`;
  }
  if (database.vendor === 'oracle') {
    return `oracle+oracledb://${database.username ?? 'loj'}:${database.password ?? 'LojPassw0rd!'}@${database.host ?? '127.0.0.1'}:${database.port ?? 1521}/?service_name=${database.name}`;
  }
  return `sqlite:///./${database.name}`;
}

function generateDatabaseEnvExample(database: LojTargetDatabaseConfig, runtime: 'spring' | 'fastapi'): string {
  if (runtime === 'spring') {
    return [
      `LOJ_DATABASE_URL=${createSpringJdbcUrl(database)}`,
      ...(database.username !== undefined ? [`LOJ_DATABASE_USERNAME=${database.username}`] : []),
      ...(database.password !== undefined ? [`LOJ_DATABASE_PASSWORD=${database.password}`] : []),
      '',
    ].join('\n');
  }
  return [
    `LOJ_DATABASE_URL=${createFastApiDatabaseUrl(database)}`,
    '',
  ].join('\n');
}

function generateDatabaseDockerCompose(database: LojTargetDatabaseConfig): string {
  if (database.vendor === 'postgres') {
    return [
      'services:',
      '  database:',
      '    image: postgres:16-alpine',
      '    restart: unless-stopped',
      `    ports:`,
      `      - "${database.port ?? 5432}:5432"`,
      '    environment:',
      `      POSTGRES_DB: ${database.name}`,
      `      POSTGRES_USER: ${database.username ?? 'loj'}`,
      `      POSTGRES_PASSWORD: ${database.password ?? 'loj'}`,
      '    volumes:',
      '      - loj-postgres-data:/var/lib/postgresql/data',
      '',
      'volumes:',
      '  loj-postgres-data:',
      '',
    ].join('\n');
  }
  if (database.vendor === 'mariadb') {
    return [
      'services:',
      '  database:',
      '    image: mariadb:11.4',
      '    restart: unless-stopped',
      `    ports:`,
      `      - "${database.port ?? 3306}:3306"`,
      '    environment:',
      `      MARIADB_DATABASE: ${database.name}`,
      `      MARIADB_USER: ${database.username ?? 'loj'}`,
      `      MARIADB_PASSWORD: ${database.password ?? 'loj'}`,
      `      MARIADB_ROOT_PASSWORD: ${database.password ?? 'loj'}`,
      '    volumes:',
      '      - loj-mariadb-data:/var/lib/mysql',
      '',
      'volumes:',
      '  loj-mariadb-data:',
      '',
    ].join('\n');
  }
  return [
    'services:',
    '  database:',
    '    image: mysql:8.4',
    '    restart: unless-stopped',
    '    command: --default-authentication-plugin=mysql_native_password',
    `    ports:`,
    `      - "${database.port ?? 3306}:3306"`,
    '    environment:',
    `      MYSQL_DATABASE: ${database.name}`,
    `      MYSQL_USER: ${database.username ?? 'loj'}`,
    `      MYSQL_PASSWORD: ${database.password ?? 'loj'}`,
    `      MYSQL_ROOT_PASSWORD: ${database.password ?? 'loj'}`,
    '    volumes:',
    '      - loj-mysql-data:/var/lib/mysql',
    '',
    'volumes:',
    '  loj-mysql-data:',
    '',
  ].join('\n');
}

function collectProjectTargetAliases(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.targets)) {
    return [];
  }
  return Object.keys(value.targets);
}

function normalizeAgentRuntime(value: string): AgentRuntime | null {
  return value === 'codex' || value === 'windsurf' || value === 'generic' ? value : null;
}

function resolveAgentInstallDestination(
  options: AgentInstallCommandOptions | AgentAddCommandOptions,
  context: CommandContext,
  skillName: string,
): string {
  if (options.skillsDir?.trim().length) {
    return normalizePath(resolve(context.cwd, options.skillsDir, skillName));
  }
  const userHome = context.env.HOME?.trim().length
    ? context.env.HOME
    : context.env.USERPROFILE?.trim().length
      ? context.env.USERPROFILE
      : process.env.HOME ?? process.env.USERPROFILE ?? resolve(context.cwd, '.loj-user-home');
  switch (options.agent) {
    case 'codex': {
      if (options.scope === 'project') {
        return normalizePath(resolve(context.cwd, '.loj', 'agents', 'codex', 'skills', skillName));
      }
      const codexHome = context.env.CODEX_HOME?.trim().length
        ? resolve(context.cwd, context.env.CODEX_HOME)
        : resolve(userHome, '.codex');
      return normalizePath(resolve(codexHome, 'skills', skillName));
    }
    case 'windsurf': {
      if (options.scope === 'project') {
        return normalizePath(resolve(context.cwd, '.windsurf', 'skills', skillName));
      }
      const windsurfHome = context.env.WINDSURF_HOME?.trim().length
        ? resolve(context.cwd, context.env.WINDSURF_HOME)
        : resolve(userHome, '.codeium', 'windsurf');
      return normalizePath(resolve(windsurfHome, 'skills', skillName));
    }
    case 'generic': {
      throw new Error('generic agent install destination requires --skills-dir');
    }
    default:
      throw new Error(`Unsupported agent runtime: ${(options as { agent: string }).agent}`);
  }
}

function resolveBundledSkillSourceDir(): { path: string } | { error: string } {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../agent-assets', BUNDLED_SKILL_NAME),
    resolve(moduleDir, '../../../skills', BUNDLED_SKILL_NAME),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'SKILL.md'))) {
      return { path: normalizePath(candidate) };
    }
  }

  return {
    error: `Bundled skill assets for ${BUNDLED_SKILL_NAME} are missing. Rebuild @loj-lang/cli or restore skills/${BUNDLED_SKILL_NAME}.`,
  };
}

function copyDirectoryRecursive(sourceDir: string, destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath, 'utf8'), 'utf8');
  }
}

function syncBundledSkill(sourceDir: string, destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const relativePath of BUNDLED_SKILL_FILES) {
    const sourcePath = resolve(sourceDir, relativePath);
    const targetPath = resolve(destinationDir, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath, 'utf8'), 'utf8');
  }
}

function findSkillBundleRoot(rootDir: string): string | null {
  if (existsSync(resolve(rootDir, 'SKILL.md'))) {
    return normalizePath(rootDir);
  }
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = resolve(rootDir, entry.name);
    if (existsSync(resolve(candidate, 'SKILL.md'))) {
      return normalizePath(candidate);
    }
  }
  return null;
}

function resolveAgentSkillSource(
  options: AgentInstallCommandOptions | AgentAddCommandOptions,
  context: CommandContext,
): { rootDir: string; skillName: string; cleanupDir?: string } | { error: string } {
  if (options.command === 'install') {
    const sourceDir = resolveBundledSkillSourceDir();
    if ('error' in sourceDir) {
      return sourceDir;
    }
    return {
      rootDir: sourceDir.path,
      skillName: BUNDLED_SKILL_NAME,
    };
  }

  const source = options.source.trim();
  if (/^https?:\/\//.test(source)) {
    if (!/(\.tar|\.tar\.gz|\.tgz)(\?.*)?$/.test(source)) {
      return { error: 'Remote agent add currently only supports .tar, .tar.gz, or .tgz sources.' };
    }
    const tempBase = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp';
    const mktempResult = (spawnSync as unknown as (...args: unknown[]) => {
      status: number | null;
      signal: string | null;
      error?: Error;
      stderr?: Uint8Array | string;
      stdout?: Uint8Array | string;
    })('mktemp', ['-d', resolve(tempBase, 'loj-agent-add-XXXXXX')], { stdio: 'pipe' });
    if (mktempResult.error) {
      return { error: `Failed to create a temporary directory for remote agent add: ${mktempResult.error.message}` };
    }
    if (mktempResult.status !== 0) {
      const stderr = typeof mktempResult.stderr === 'string'
        ? mktempResult.stderr
        : new TextDecoder().decode(mktempResult.stderr ?? new Uint8Array());
      return { error: `Failed to create a temporary directory for remote agent add: ${stderr.trim() || `mktemp exited with status ${mktempResult.status}`}` };
    }
    const tempRoot = normalizePath((typeof mktempResult.stdout === 'string'
      ? mktempResult.stdout
      : new TextDecoder().decode(mktempResult.stdout ?? new Uint8Array())).trim());
    const archiveFile = normalizePath(resolve(tempRoot, 'bundle.tar'));
    const extractDir = normalizePath(resolve(tempRoot, 'extracted'));
    mkdirSync(extractDir, { recursive: true });
    const curlResult = (spawnSync as unknown as (...args: unknown[]) => {
      status: number | null;
      signal: string | null;
      error?: Error;
      stderr?: Uint8Array | string;
      stdout?: Uint8Array | string;
    })('curl', ['-fsSL', source, '-o', archiveFile], { stdio: 'pipe' });
    if (curlResult.error) {
      return { error: `Failed to fetch remote skill source with curl: ${curlResult.error.message}` };
    }
    if (curlResult.status !== 0) {
      const stderr = typeof curlResult.stderr === 'string'
        ? curlResult.stderr
        : new TextDecoder().decode(curlResult.stderr ?? new Uint8Array());
      return { error: `Failed to fetch remote skill source: ${stderr.trim() || `curl exited with status ${curlResult.status}`}` };
    }
    const tarArgs = /\.tar(\?.*)?$/.test(source)
      ? ['-xf', archiveFile, '-C', extractDir]
      : ['-xzf', archiveFile, '-C', extractDir];
    const tarResult = (spawnSync as unknown as (...args: unknown[]) => {
      status: number | null;
      signal: string | null;
      error?: Error;
      stderr?: Uint8Array | string;
      stdout?: Uint8Array | string;
    })('tar', tarArgs, { stdio: 'pipe' });
    if (tarResult.error) {
      return { error: `Failed to extract remote skill source with tar: ${tarResult.error.message}` };
    }
    if (tarResult.status !== 0) {
      const stderr = typeof tarResult.stderr === 'string'
        ? tarResult.stderr
        : new TextDecoder().decode(tarResult.stderr ?? new Uint8Array());
      return { error: `Failed to extract remote skill source: ${stderr.trim() || `tar exited with status ${tarResult.status}`}` };
    }
    const bundleRoot = findSkillBundleRoot(extractDir);
    if (!bundleRoot) {
      return { error: 'Remote agent source did not contain a skill bundle with SKILL.md.' };
    }
    return {
      rootDir: bundleRoot,
      skillName: basename(bundleRoot),
      cleanupDir: tempRoot,
    };
  }

  let localPath = source;
  if (source.startsWith('file://')) {
    try {
      localPath = fileURLToPath(source);
    } catch (error) {
      return { error: `Invalid file:// agent source: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const absolutePath = resolve(context.cwd, localPath);
  if (!existsSync(absolutePath)) {
    return { error: `Agent source does not exist: ${normalizePath(absolutePath)}` };
  }
  const skillRoot = findSkillBundleRoot(absolutePath);
  if (!skillRoot) {
    return { error: `Agent source does not contain a skill bundle with SKILL.md: ${normalizePath(absolutePath)}` };
  }
  return {
    rootDir: skillRoot,
    skillName: basename(skillRoot),
  };
}

function normalizePath(fileName: string): string {
  return fileName.replace(/\\/g, '/');
}

function isRelativeProjectPath(fileName: string): boolean {
  if (fileName.startsWith('/')) {
    return false;
  }
  return !/^[A-Za-z]:[\\/]/.test(fileName);
}

function indentBlock(text: string, prefix: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function writeCliBanner(
  write: (text: string) => void,
  title: string,
  subtitle?: string,
): void {
  const lines = [title, ...(subtitle ? [subtitle] : [])];
  const innerWidth = Math.max(...lines.map((line) => line.length), 12);
  const border = `+${'-'.repeat(innerWidth + 2)}+\n`;
  write(border);
  for (const line of lines) {
    write(`| ${line.padEnd(innerWidth)} |\n`);
  }
  write(border);
}

function writeCliDevBanner(
  write: (text: string) => void,
  subtitle?: string,
): void {
  write('██\n');
  write('██\n');
  write('██\n');
  write('██████  LOJ DEV\n');
  if (subtitle) {
    write(`         ${subtitle}\n`);
  }
}

function writeCliSection(
  write: (text: string) => void,
  title: string,
  lines: string[],
): void {
  if (lines.length === 0) {
    return;
  }
  write(`\n${title}:\n`);
  for (const line of lines) {
    write(`  ${line}\n`);
  }
}

function summarizeDoctorChecks(
  checks: Array<{ severity: 'error' | 'warning' | 'info' }>,
): { errors: number; warnings: number; info: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const check of checks) {
    if (check.severity === 'error') {
      errors += 1;
    } else if (check.severity === 'warning') {
      warnings += 1;
    } else {
      info += 1;
    }
  }
  return { errors, warnings, info };
}

function writeUsage(write: (text: string) => void): void {
  write([
    'Usage:',
    '  loj version',
    '  loj validate <loj.project.yaml> [--json]',
    '  loj build <loj.project.yaml> [--json]',
    '  loj dev <loj.project.yaml> [--target <alias>] [--debug] [--json]',
    '  loj graph <loj.project.yaml> [--surface source|frontend|backend|all] [--target <alias>] [--out-dir <dir>] [--json]',
    '  loj rebuild <loj.project.yaml> [--target <alias>] [--json]',
    '  loj restart <loj.project.yaml> [--service host|server|all] [--json]',
    '  loj status <loj.project.yaml> [--target <alias>] [--json]',
    '  loj stop <loj.project.yaml> [--json]',
    '  loj doctor <loj.project.yaml> [--target <alias>] [--json]',
    '  loj rules validate <file.rules.loj> [--json]',
    '  loj rules build <file.rules.loj> [--out-dir <dir>] [--json]',
    '  loj flow validate <file.flow.loj> [--json]',
    '  loj flow build <file.flow.loj> [--out-dir <dir>] [--json]',
    '  loj agent install <codex|windsurf|generic> [--scope user|project] [--skills-dir <dir>] [--json]',
    '  loj agent add <codex|windsurf|generic> --from <source> [--scope user|project] [--skills-dir <dir>] [--json]',
    '  loj agent export <codex|windsurf|generic> --out-dir <dir> [--json]',
    '',
    'Common project-shell loop:',
    '  loj doctor <loj.project.yaml>   # validate dependencies, generated outputs, and linked artifacts',
    '  loj dev <loj.project.yaml>      # watch the project and run managed host/backend services',
    '  loj graph <loj.project.yaml>    # emit mermaid architecture views for source and generated targets',
    '  loj rebuild <loj.project.yaml>  # rebuild selected targets without restarting the whole loop',
    '  loj restart <loj.project.yaml>  # restart host/server processes inside the active loop',
    '  loj status <loj.project.yaml>   # inspect current URLs, probes, services, and debugger endpoints',
    '  loj stop <loj.project.yaml>     # stop the active managed session',
    '',
    `Version: ${formatLojVersionLabel()}`,
    '',
  ].join('\n'));
}

function writeRulesUsage(write: (text: string) => void): void {
  write([
    'Usage:',
    '  loj rules validate <file.rules.loj> [--json]',
    '  loj rules build <file.rules.loj> [--out-dir <dir>] [--json]',
    '',
    'Notes:',
    '  build writes a standalone semantic manifest for the current rules/policy slice.',
    '  .api.loj now links this narrowly through resource auth.policy, resource create.rules, and readModel rules.',
    '',
  ].join('\n'));
}

function writeFlowUsage(write: (text: string) => void): void {
  write([
    'Usage:',
    '  loj flow validate <file.flow.loj> [--json]',
    '  loj flow build <file.flow.loj> [--out-dir <dir>] [--json]',
    '',
    'Notes:',
    '  build writes a standalone semantic manifest for the first workflow/wizard proof slice.',
    '  this first slice stabilizes states, transitions, and wizard steps before broader .api.loj linkage.',
    '',
  ].join('\n'));
}

function writeAgentUsage(write: (text: string) => void): void {
  write([
    'Usage:',
    '  loj agent install <codex|windsurf|generic> [--scope user|project] [--skills-dir <dir>] [--json]',
    '  loj agent add <codex|windsurf|generic> --from <source> [--scope user|project] [--skills-dir <dir>] [--json]',
    '  loj agent export <codex|windsurf|generic> --out-dir <dir> [--json]',
    '',
    'Notes:',
    '  codex user scope installs into CODEX_HOME/skills or ~/.codex/skills by default.',
    '  windsurf user scope installs into WINDSURF_HOME/skills or ~/.codeium/windsurf/skills by default.',
    '  codex project scope vendors a pinned copy under ./.loj/agents/codex/skills.',
    '  windsurf project scope installs under ./.windsurf/skills.',
    '  generic requires --skills-dir and does not assume an autodiscovery path.',
    '  add accepts a local skill bundle directory, file:// bundle directory, or http(s) .tar/.tar.gz/.tgz source.',
    '  export writes a self-contained copy to <out-dir>/loj-authoring.',
    '',
  ].join('\n'));
}

function realpathCompat(path: string): string {
  return (nodeFs as typeof nodeFs & { realpathSync(path: string): string }).realpathSync(path);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedCliPath = process.argv[1];
let isDirectCliEntry = false;
if (invokedCliPath) {
  try {
    isDirectCliEntry = realpathCompat(invokedCliPath) === realpathCompat(currentModulePath);
  } catch {
    isDirectCliEntry = import.meta.url === new URL(invokedCliPath, 'file:').href;
  }
}
if (isDirectCliEntry) {
  process.exitCode = runCli(process.argv.slice(2));
}
