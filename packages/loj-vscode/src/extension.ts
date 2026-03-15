import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import * as vscode from 'vscode';
import { runCli as runProjectCli } from '@loj-lang/cli';
import {
  CANONICAL_RDSL_SOURCE_SUFFIX,
  createProjectCache,
  isRdslSourceFile,
  inspectSemanticNode,
  listManifestHostFilesForNode,
  listTraceRegionsForNode,
  resolveTraceLocation,
  semanticNodeInspectionToLines,
} from '@loj-lang/rdsl-compiler';
import type {
  CompileResult as RdslCompileResult,
  ProjectCache,
  SemanticManifest,
  TraceManifest,
} from '@loj-lang/rdsl-compiler';
import {
  buildCurrentIssueQuickPickItems,
  buildProjectOverviewQuickPickItems,
  canUseSemanticAssistResult,
  collectToastCompletionSuggestions,
  collectToastQuickFixes,
  collectCompileDiagnostics,
  compileProjectState,
  containsAppBlock,
  createSnapshotMap,
  findLinkedArtifactReferenceAtPosition,
  findLikelyGeneratedOutputTarget,
  type ProjectDiagnostic,
  type DocumentSnapshot,
  findContainingBuildRoot,
  findNearestAncestorProjectFile,
  findNearestProjectFile,
  findMostSpecificTraceNode,
  findProjectEntry,
  formatSemanticAssistDetail,
  formatSemanticAssistIssueSummary,
  formatSemanticAssistPrimaryIssue,
  formatSemanticAssistStatus,
  formatSemanticAssistStatusBarText,
  formatSemanticAssistStatusBarTooltip,
  formatSourceSpan,
  listProjectDiagnostics,
  listDirectoryEntries,
  normalizeFsPath,
  selectSemanticAssistResult,
  shouldShowCurrentIssuesCommand,
  toGeneratedFilePath,
} from './core.js';
import {
  canUseSdslSemanticAssistResult,
  collectSdslCompileDiagnostics,
  compileSdslProjectState,
  containsSdslAppBlock,
  findMostSpecificSdslNode,
  findSdslProjectEntry,
  sdslNodeInspectionToLines,
  selectSdslSemanticAssistResult,
} from './sdsl.js';
import {
  CANONICAL_SDSL_SOURCE_SUFFIX,
  isSdslSourceFile,
} from '@loj-lang/sdsl-compiler';
import type { CompileResult as SdslCompileResult } from '@loj-lang/sdsl-compiler';

interface CachedRdslProjectState {
  kind: 'rdsl';
  entryFile: string;
  result: RdslCompileResult;
  semanticResult: RdslCompileResult;
  usingFallbackSemanticResult: boolean;
}

interface CachedSdslProjectState {
  kind: 'sdsl';
  entryFile: string;
  result: SdslCompileResult;
  semanticResult: SdslCompileResult;
  usingFallbackSemanticResult: boolean;
}

type CachedProjectState = CachedRdslProjectState | CachedSdslProjectState;

const diagnosticsByProject = new Map<string, Set<string>>();
const rdslProjectCaches = new Map<string, ProjectCache>();
const lastSuccessfulRdslResults = new Map<string, RdslCompileResult>();
const lastSuccessfulSdslResults = new Map<string, SdslCompileResult>();
const validationTimers = new Map<string, unknown>();

interface SidebarProjectStatusPayload {
  running: boolean;
  app?: { name?: string };
  targets?: Array<{ alias: string; type: string; entry: string; outDir: string }>;
  dev?: { hostUrl?: string; backendUrl?: string; apiBase?: string; proxyUrl?: string; hostDir?: string };
  debuggers?: Array<{ targetAlias: string; runtime: 'spring-boot' | 'fastapi'; attachKind: 'java' | 'debugpy'; host: string; port: number }>;
  services?: Array<{ kind: string; targetAlias: string; url: string }>;
  databases?: Array<{ targetAlias: string; phase: string; composeFile: string }>;
  probes?: Array<{ targetAlias: string; kind: 'health' | 'readiness' | 'drain'; url: string }>;
  warnings?: string[];
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
}

class SidebarCommandItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string | undefined,
    detail: string | undefined,
    commandId: string,
    iconId: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = detail ?? description ?? label;
    this.command = {
      command: commandId,
      title: label,
    };
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

class SidebarInfoItem extends vscode.TreeItem {
  constructor(label: string, description?: string, detail?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = detail ?? description ?? label;
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class SidebarSeparatorItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = '';
    this.tooltip = label;
  }
}

class LojSidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly resolveProjectFile: () => Promise<string | null>,
    private readonly readProjectStatus: (projectFile: string) => Promise<SidebarProjectStatusPayload | undefined>,
  ) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const projectFile = await this.resolveProjectFile();
    if (!projectFile) {
      return [
        new SidebarInfoItem(
          'No loj.project.yaml nearby',
          undefined,
          'Open a file inside a Loj project to use sidebar controls.',
        ),
      ];
    }
    const payload = await this.readProjectStatus(projectFile);
    const items: vscode.TreeItem[] = [
      new SidebarInfoItem(
        payload?.app?.name ?? basename(projectFile),
        payload?.running ? 'running' : 'stopped',
        projectFile,
      ),
      new SidebarCommandItem('Start Dev', 'Run loj dev', 'Start the managed project-shell loop.', 'loj.startProjectDev', 'play'),
      new SidebarCommandItem('Debug Dev', 'Run loj dev --debug', 'Start the managed project-shell loop with backend debugger attach endpoints.', 'loj.debugProjectDev', 'debug-alt-small'),
      new SidebarCommandItem('Stop Dev', 'Run loj stop', 'Stop the current managed project-shell loop.', 'loj.stopProjectDev', 'stop-circle'),
      new SidebarCommandItem('Overview', 'Show project overview', 'Open the shared project overview summary.', 'loj.showProjectOverview', 'list-tree'),
      new SidebarCommandItem('Status', 'Show session status', 'Inspect current managed services, URLs, and probes.', 'loj.showProjectStatus', 'pulse'),
      new SidebarCommandItem('Doctor', 'Run readiness checks', 'Run project-shell doctor checks for the active project.', 'loj.runProjectDoctor', 'heart'),
      new SidebarCommandItem('Preview', 'Open frontend/backend URLs', 'Open the current frontend host, backend server, or generated probe URLs.', 'loj.openProjectPreview', 'link-external'),
      new SidebarCommandItem('Rebuild Target', 'Queue target rebuild', 'Queue a rebuild for all or selected active targets.', 'loj.rebuildProjectTarget', 'refresh'),
      new SidebarCommandItem('Restart Service', 'Restart host/server', 'Restart the managed frontend host or backend server without tearing down the whole session.', 'loj.restartProjectService', 'debug-restart'),
    ];
    if ((payload?.debuggers?.length ?? 0) > 0) {
      items.push(new SidebarCommandItem('Attach Debugger', 'Attach to backend debugger', 'Attach VSCode to the active backend debugger endpoint.', 'loj.attachProjectDebugger', 'debug-connect'));
    }
    if (payload?.dev?.hostUrl || payload?.dev?.backendUrl) {
      items.push(new SidebarInfoItem('URLs', payload.dev.hostUrl ?? payload.dev.backendUrl, payload.dev.backendUrl ?? payload.dev.hostUrl));
    }
    items.push(
      new SidebarSeparatorItem('Skill'),
      new SidebarCommandItem('Install Skill to Codex', 'User scope', 'Install the bundled loj-authoring skill into the default Codex skills directory.', 'loj.installSkillCodex', 'cloud-download'),
      new SidebarCommandItem('Install Skill to Windsurf', 'User scope', 'Install the bundled loj-authoring skill into the default Windsurf skills directory.', 'loj.installSkillWindsurf', 'cloud-download'),
      new SidebarCommandItem('Export Skill Bundle', 'Choose output directory', 'Export the bundled loj-authoring skill bundle to a directory.', 'loj.exportSkillBundle', 'export'),
      new SidebarCommandItem('Open Public SKILL.md', 'loj-authoring', 'Open the public loj-authoring SKILL.md in the editor.', 'loj.openPublicSkill', 'book'),
    );
    return items;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('loj');
  const output = vscode.window.createOutputChannel('Loj');
  const devOutput = vscode.window.createOutputChannel('Loj Dev');
  const semanticStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  semanticStatus.name = 'Loj Semantic State';
  semanticStatus.command = 'loj.inspectCurrentNode';
  semanticStatus.hide();
  const devStartStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  devStartStatus.name = 'Loj Start Dev';
  devStartStatus.text = 'Loj Dev';
  devStartStatus.command = 'loj.startProjectDev';
  devStartStatus.hide();
  const devDebugStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  devDebugStatus.name = 'Loj Start Debug Dev';
  devDebugStatus.text = 'Loj Debug';
  devDebugStatus.command = 'loj.debugProjectDev';
  devDebugStatus.hide();
  const devStopStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  devStopStatus.name = 'Loj Stop Dev';
  devStopStatus.text = 'Loj Stop';
  devStopStatus.command = 'loj.stopProjectDev';
  devStopStatus.hide();

  function writeOutputText(channel: vscode.OutputChannel, text: string): void {
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (line.length === 0) {
        continue;
      }
      channel.appendLine(line);
    }
  }

  function writeOutputBanner(channel: vscode.OutputChannel, title: string, subtitle?: string): void {
    const lines = [title, ...(subtitle ? [subtitle] : [])];
    const innerWidth = Math.max(...lines.map((line) => line.length), 12);
    const border = `+${'-'.repeat(innerWidth + 2)}+`;
    channel.appendLine(border);
    for (const line of lines) {
      channel.appendLine(`| ${line.padEnd(innerWidth)} |`);
    }
    channel.appendLine(border);
  }

  function writeOutputSection(channel: vscode.OutputChannel, title: string, lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    channel.appendLine('');
    channel.appendLine(`${title}:`);
    for (const line of lines) {
      channel.appendLine(`  ${line}`);
    }
  }

  async function resolveProjectFileForDocument(document: vscode.TextDocument | undefined): Promise<string | null> {
    const currentFile = document?.uri.scheme === 'file' ? normalizeFsPath(document.fileName) : undefined;
    if (currentFile) {
      const ancestor = findNearestAncestorProjectFile(currentFile, (fileName) => {
        try {
          return Boolean(readFileSync(fileName, 'utf8'));
        } catch {
          return false;
        }
      });
      if (ancestor) {
        return ancestor;
      }
    }
    const projectUris = await vscode.workspace.findFiles(
      '**/loj.project.yaml',
      '{**/node_modules/**,**/dist/**,**/generated/**}',
    );
    return findNearestProjectFile(currentFile, projectUris.map((uri) => normalizeFsPath(uri.fsPath)));
  }

  function formatJsonPayload<T>(chunks: string[]): T | undefined {
    const text = chunks.join('').trim();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  async function updateProjectCommandStatus(document: vscode.TextDocument | undefined): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(document);
    if (!projectFile) {
      devStartStatus.hide();
      devDebugStatus.hide();
      devStopStatus.hide();
      sidebarProvider.refresh();
      return;
    }
    devStartStatus.show();
    devDebugStatus.show();
    devStopStatus.show();
    sidebarProvider.refresh();
  }

  async function runProjectStatus(projectFile: string): Promise<SidebarProjectStatusPayload | undefined> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(['status', basename(projectFile), '--json'], {
      cwd: dirname(projectFile),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    if (exitCode !== 0) {
      writeOutputText(devOutput, stderr.join(''));
      return undefined;
    }
    return formatJsonPayload(stdout);
  }

  const sidebarProvider = new LojSidebarProvider(
    async () => resolveProjectFileForDocument(vscode.window.activeTextEditor?.document),
    runProjectStatus,
  );

  async function runProjectControl(
    projectFile: string,
    args: string[],
    bannerTitle: string,
    bannerSubtitle: string,
    nextLines: string[],
  ): Promise<boolean> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(args, {
      cwd: dirname(projectFile),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    devOutput.clear();
    writeOutputBanner(devOutput, bannerTitle, bannerSubtitle);
    writeOutputText(devOutput, stdout.join(''));
    writeOutputText(devOutput, stderr.join(''));
    writeOutputSection(devOutput, 'next', nextLines);
    devOutput.show(true);
    return exitCode === 0;
  }

  async function startProjectDev(debug = false): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const currentStatus = await runProjectStatus(projectFile);
    if (currentStatus?.running) {
      await vscode.window.showInformationMessage('Loj dev is already running for this project.');
      return;
    }
    devOutput.show(true);
    devOutput.clear();
    writeOutputBanner(devOutput, 'loj dev', debug ? 'launch managed services + debugger' : 'launch managed services');
    writeOutputSection(devOutput, 'overview', [
      `project: ${projectFile}`,
      ...(debug ? ['debugger: backend attach will be enabled if supported'] : []),
    ]);
    writeOutputSection(devOutput, 'next', [
      `status: loj status ${basename(projectFile)}`,
      `stop: loj stop ${basename(projectFile)}`,
    ]);
    const exitCode = runProjectCli(['dev', basename(projectFile), ...(debug ? ['--debug'] : [])], {
      cwd: dirname(projectFile),
      stdout: (text) => writeOutputText(devOutput, text),
      stderr: (text) => writeOutputText(devOutput, text),
    });
    if (exitCode !== 0) {
      await vscode.window.showWarningMessage(`Failed to start loj dev for ${basename(projectFile)}.`);
      return;
    }
    await updateProjectCommandStatus(vscode.window.activeTextEditor?.document);
    sidebarProvider.refresh();
  }

  async function stopProjectDev(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(['stop', basename(projectFile), '--json'], {
      cwd: dirname(projectFile),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    if (exitCode !== 0) {
      writeOutputText(devOutput, stderr.join(''));
      await vscode.window.showWarningMessage(`Failed to stop loj dev for ${basename(projectFile)}.`);
      return;
    }
    const payload = formatJsonPayload<{ stopped?: boolean; stale?: boolean }>(stdout);
    devOutput.clear();
    if (payload?.stopped) {
      writeOutputBanner(devOutput, 'loj stop', 'managed session stopped');
      devOutput.appendLine(`Stopped loj dev: ${projectFile}`);
      writeOutputSection(devOutput, 'next', [
        `restart: loj dev ${basename(projectFile)}`,
        `inspect: loj status ${basename(projectFile)}`,
      ]);
    } else {
      writeOutputBanner(devOutput, 'loj stop', 'no active managed session found');
      devOutput.appendLine(`No active loj dev session: ${projectFile}${payload?.stale ? ' (cleared stale state)' : ''}`);
      writeOutputSection(devOutput, 'next', [
        `start: loj dev ${basename(projectFile)}`,
        `inspect: loj doctor ${basename(projectFile)}`,
      ]);
    }
    await updateProjectCommandStatus(vscode.window.activeTextEditor?.document);
    sidebarProvider.refresh();
  }

  async function rebuildProjectTarget(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload?.running) {
      await vscode.window.showInformationMessage('No active loj dev session is running for this project.');
      return;
    }
    const targets = payload.targets ?? [];
    if (targets.length === 0) {
      await vscode.window.showInformationMessage('No project targets are available to rebuild.');
      return;
    }
    const selection = await vscode.window.showQuickPick(
      [
        {
          label: 'Rebuild all active targets',
          description: basename(projectFile),
          detail: 'Queue a manual rebuild for every active target in the current loj dev session.',
          targetAliases: [] as string[],
        },
        ...targets.map((target) => ({
          label: `Rebuild ${target.alias}`,
          description: `${target.type} target`,
          detail: `${target.entry} -> ${target.outDir}`,
          targetAliases: [target.alias],
        })),
      ],
      {
        title: `Rebuild target: ${payload.app?.name ?? basename(projectFile)}`,
        placeHolder: 'Select the target to rebuild inside the current loj dev session.',
      },
    );
    if (!selection) {
      return;
    }
    const ok = await runProjectControl(
      projectFile,
      ['rebuild', basename(projectFile), ...selection.targetAliases.flatMap((alias) => ['--target', alias])],
      'loj rebuild',
      'queue a manual target rebuild',
      [
        `status: loj status ${basename(projectFile)}`,
        `doctor: loj doctor ${basename(projectFile)}`,
      ],
    );
    if (!ok) {
      await vscode.window.showWarningMessage(`Failed to queue loj rebuild for ${basename(projectFile)}.`);
    }
    sidebarProvider.refresh();
  }

  async function restartProjectService(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload?.running) {
      await vscode.window.showInformationMessage('No active loj dev session is running for this project.');
      return;
    }
    const services = new Set((payload.services ?? []).map((service) => service.kind));
    const items: Array<{ label: string; description?: string; detail?: string; service: 'host' | 'server' | 'all' }> = [];
    if (services.has('host') && services.has('server')) {
      items.push({
        label: 'Restart all managed services',
        description: basename(projectFile),
        detail: 'Restart both the frontend host and backend server inside the current loj dev session.',
        service: 'all',
      });
    }
    if (services.has('host')) {
      items.push({
        label: 'Restart host service',
        description: payload.dev?.hostUrl,
        detail: 'Restart only the managed frontend host process.',
        service: 'host',
      });
    }
    if (services.has('server')) {
      items.push({
        label: 'Restart backend server',
        description: payload.dev?.backendUrl,
        detail: 'Restart only the managed backend server process.',
        service: 'server',
      });
    }
    if (items.length === 0) {
      await vscode.window.showInformationMessage('No managed host/server services are available to restart.');
      return;
    }
    const selection = await vscode.window.showQuickPick(items, {
      title: `Restart service: ${payload.app?.name ?? basename(projectFile)}`,
      placeHolder: 'Select the managed service to restart inside the current loj dev session.',
    });
    if (!selection) {
      return;
    }
    const ok = await runProjectControl(
      projectFile,
      ['restart', basename(projectFile), '--service', selection.service],
      'loj restart',
      'queue a managed service restart',
      [
        `status: loj status ${basename(projectFile)}`,
        `preview: loj status ${basename(projectFile)}`,
      ],
    );
    if (!ok) {
      await vscode.window.showWarningMessage(`Failed to queue loj restart for ${basename(projectFile)}.`);
    }
    sidebarProvider.refresh();
  }

  async function showProjectStatus(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload) {
      await vscode.window.showWarningMessage(`Failed to read loj status for ${basename(projectFile)}.`);
      return;
    }
    devOutput.clear();
    writeOutputBanner(devOutput, 'loj status', 'inspect current project-shell session');
    devOutput.appendLine(`Project status: ${projectFile}`);
    writeOutputSection(devOutput, 'overview', [
      `project: ${projectFile}`,
      `running: ${payload.running ? 'yes' : 'no'}`,
      ...(payload.app?.name ? [`app: ${payload.app.name}`] : []),
    ]);
    writeOutputSection(devOutput, 'targets', (payload.targets ?? []).map((target) => `${target.alias} (${target.type}) entry=${target.entry} out=${target.outDir}`));
    writeOutputSection(devOutput, 'urls', [
      ...(payload.dev?.hostUrl ? [`host: ${payload.dev.hostUrl}`] : []),
      ...(payload.dev?.backendUrl ? [`backend: ${payload.dev.backendUrl}`] : []),
    ]);
    writeOutputSection(devOutput, 'services', (payload.services ?? []).map((service) => `${service.kind} ${service.targetAlias} ${service.url}`));
    writeOutputSection(devOutput, 'databases', (payload.databases ?? []).map((database) => `${database.targetAlias} (${database.phase}) ${database.composeFile}`));
    writeOutputSection(devOutput, 'debuggers', (payload.debuggers ?? []).map((debuggerEntry) => `${debuggerEntry.targetAlias} ${debuggerEntry.attachKind} ${debuggerEntry.host}:${debuggerEntry.port}`));
    writeOutputSection(devOutput, 'probes', (payload.probes ?? []).map((probe) => `${probe.targetAlias} ${probe.kind} ${probe.url}`));
    for (const warning of payload.warnings ?? []) {
      devOutput.appendLine(`warning: ${warning}`);
    }
    writeOutputSection(devOutput, 'next', [
      payload.running
        ? `stop: loj stop ${basename(projectFile)}`
        : `start: loj dev ${basename(projectFile)}`,
      `doctor: loj doctor ${basename(projectFile)}`,
    ]);
    devOutput.show(true);
  }

  async function showProjectDoctor(overviewOnly = false): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(['doctor', basename(projectFile), '--json'], {
      cwd: dirname(projectFile),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    const payload = formatJsonPayload<{
      success: boolean;
      running: boolean;
      app: { name: string };
      targets: Array<{ alias: string; type: string; entry: string; outDir: string; validated: boolean }>;
      surfaceCounts: { resources: number; readModels: number; workflows: number; rules: number };
      checks: Array<{ severity: string; target?: string; message: string }>;
      dev?: { hostUrl?: string; backendUrl?: string };
      services?: Array<{ kind: string; targetAlias: string; url: string }>;
      databases?: Array<{ targetAlias: string; phase: string; composeFile: string }>;
    }>(stdout);
    if (exitCode !== 0 && !payload) {
      writeOutputText(devOutput, stderr.join(''));
      await vscode.window.showWarningMessage(`Loj doctor failed for ${basename(projectFile)}.`);
      return;
    }
    devOutput.clear();
    writeOutputBanner(devOutput, overviewOnly ? 'project overview' : 'loj doctor', overviewOnly ? 'shared project-shell summary' : 'validate project-shell readiness');
    devOutput.appendLine(`${overviewOnly ? 'Project overview' : 'Loj doctor'}: ${projectFile}`);
    if (payload) {
      const errors = payload.checks.filter((check) => check.severity === 'error').length;
      const warnings = payload.checks.filter((check) => check.severity === 'warning').length;
      const info = payload.checks.filter((check) => check.severity === 'info').length;
      writeOutputSection(devOutput, 'overview', [
        `project: ${projectFile}`,
        `app: ${payload.app.name}`,
        `running: ${payload.running ? 'yes' : 'no'}`,
        `surfaces: resources=${payload.surfaceCounts.resources} readModels=${payload.surfaceCounts.readModels} workflows=${payload.surfaceCounts.workflows} rules=${payload.surfaceCounts.rules}`,
        `checks: errors=${errors} warnings=${warnings} info=${info}`,
      ]);
      writeOutputSection(devOutput, 'targets', payload.targets.map((target) => `${target.alias} (${target.type}) validated=${target.validated ? 'yes' : 'no'} out=${target.outDir}`));
      if (!overviewOnly) {
        const errorLines = payload.checks
          .filter((check) => check.severity === 'error')
          .map((check) => `[error] ${check.target ? `${check.target}: ` : ''}${check.message}`);
        const warningLines = payload.checks
          .filter((check) => check.severity === 'warning')
          .map((check) => `[warning] ${check.target ? `${check.target}: ` : ''}${check.message}`);
        const infoLines = payload.checks
          .filter((check) => check.severity === 'info')
          .map((check) => `[info] ${check.target ? `${check.target}: ` : ''}${check.message}`);
        writeOutputSection(devOutput, 'errors', errorLines);
        writeOutputSection(devOutput, 'warnings', warningLines);
        writeOutputSection(devOutput, 'info', infoLines);
        if (errorLines.length === 0 && warningLines.length === 0 && infoLines.length === 0) {
          writeOutputSection(devOutput, 'checks', ['No doctor checks were reported.']);
        }
      }
      writeOutputSection(devOutput, 'urls', [
        ...(payload.dev?.hostUrl ? [`host: ${payload.dev.hostUrl}`] : []),
        ...(payload.dev?.backendUrl ? [`backend: ${payload.dev.backendUrl}`] : []),
      ]);
      writeOutputSection(devOutput, 'services', (payload.services ?? []).map((service) => `${service.kind} ${service.targetAlias} ${service.url}`));
      writeOutputSection(devOutput, 'databases', (payload.databases ?? []).map((database) => `${database.targetAlias} (${database.phase}) ${database.composeFile}`));
      writeOutputSection(devOutput, 'next', payload.success
        ? [
            `start: loj dev ${basename(projectFile)}`,
            `status: loj status ${basename(projectFile)}`,
          ]
        : [
            `rebuild when needed: loj build ${basename(projectFile)}`,
            `rerun checks: loj doctor ${basename(projectFile)}`,
          ]);
    }
    writeOutputText(devOutput, stderr.join(''));
    devOutput.show(true);

    if (overviewOnly && payload) {
      const items = buildProjectOverviewQuickPickItems(projectFile, payload);
      await vscode.window.showQuickPick(items, {
        title: `Project overview: ${payload.app.name}`,
        placeHolder: 'Select an overview entry. Full details stay in the Loj Dev output channel.',
      });
    }
  }

  async function openNearestProjectFile(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(projectFile));
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  async function openLinkedArtifact(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isDslDocument(editor.document)) {
      await vscode.window.showWarningMessage(`Open a ${CANONICAL_RDSL_SOURCE_SUFFIX}/.rdsl or ${CANONICAL_SDSL_SOURCE_SUFFIX}/.sdsl source file to open a linked artifact.`);
      return;
    }

    const reference = findLinkedArtifactReferenceAtPosition(
      editor.document.getText(),
      editor.document.fileName,
      editor.selection.active.line + 1,
      editor.selection.active.character + 1,
    );
    if (!reference) {
      await vscode.window.showInformationMessage('No linked @fn(...), @custom(...), @rules(...), @flow(...), @sql(...), @style(...), or @asset(...) reference found at the current cursor position.');
      return;
    }

    const targetPath = reference.resolvedCandidates.find((candidate) => {
      try {
        return Boolean(readFileSync(candidate, 'utf8'));
      } catch {
        return false;
      }
    });
    if (!targetPath) {
      await vscode.window.showWarningMessage(`Could not resolve linked @${reference.kind}(...) target: ${reference.rawPath}`);
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  async function provideLinkedArtifactDefinition(
    document: vscode.TextDocument,
    line: number,
    character: number,
  ): Promise<vscode.Location | undefined> {
    const reference = findLinkedArtifactReferenceAtPosition(
      document.getText(),
      document.fileName,
      line,
      character,
    );
    if (!reference) {
      return undefined;
    }
    const targetPath = reference.resolvedCandidates.find((candidate) => {
      try {
        return Boolean(readFileSync(candidate, 'utf8'));
      } catch {
        return false;
      }
    });
    if (!targetPath) {
      return undefined;
    }
    return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Range(0, 0, 0, 0));
  }

  async function openGeneratedOutputRoot(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const projectFile = await resolveProjectFileForDocument(editor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload?.targets || payload.targets.length === 0) {
      await vscode.window.showWarningMessage(`Could not read generated output targets from ${basename(projectFile)}.`);
      return;
    }

    let target = editor?.document.fileName
      ? findLikelyGeneratedOutputTarget(editor.document.fileName, projectFile, payload.targets)
      : null;

    if (!target && payload.targets.length === 1) {
      target = payload.targets[0] ?? null;
    }
    if (!target) {
      const selection = await vscode.window.showQuickPick(
        payload.targets.map((candidate) => ({
          label: `${candidate.alias} (${candidate.type})`,
          description: candidate.outDir,
          detail: candidate.entry,
          target: candidate,
        })),
        {
          title: `Generated output: ${basename(projectFile)}`,
          placeHolder: 'Select the target output root to reveal in the explorer.',
        },
      );
      target = selection?.target ?? null;
    }
    if (!target) {
      return;
    }

    const generatedRoot = normalizeFsPath(resolve(dirname(projectFile), target.outDir));
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(generatedRoot));
    devOutput.appendLine(`Generated output root: ${generatedRoot}`);
    devOutput.show(true);
  }

  async function openProjectPreview(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload) {
      await vscode.window.showWarningMessage(`Failed to read loj status for ${basename(projectFile)}.`);
      return;
    }

    const items: Array<{ label: string; description?: string; detail?: string; url: string }> = [];
    if (payload.dev?.hostUrl) {
      items.push({
        label: 'Open frontend host',
        description: payload.dev.hostUrl,
        detail: 'Open the current frontend dev host URL.',
        url: payload.dev.hostUrl,
      });
    }
    if (payload.dev?.backendUrl) {
      items.push({
        label: 'Open backend server',
        description: payload.dev.backendUrl,
        detail: 'Open the current backend dev server URL.',
        url: payload.dev.backendUrl,
      });
    }
    for (const probe of payload.probes ?? []) {
      items.push({
        label: `Open ${probe.targetAlias} ${probe.kind} probe`,
        description: probe.url,
        detail: 'Open a generated backend probe endpoint.',
        url: probe.url,
      });
    }

    if (items.length === 0) {
      await vscode.window.showInformationMessage('No preview URLs are available yet. Start loj dev first or add runtime probes.');
      return;
    }

    const selection = await vscode.window.showQuickPick(items, {
      title: `Preview: ${payload.app?.name ?? basename(projectFile)}`,
      placeHolder: 'Select a frontend, backend, or probe URL to open.',
    });
    if (!selection) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(selection.url));
  }

  async function attachProjectDebugger(): Promise<void> {
    const projectFile = await resolveProjectFileForDocument(vscode.window.activeTextEditor?.document);
    if (!projectFile) {
      await vscode.window.showWarningMessage('Could not find loj.project.yaml for the current file.');
      return;
    }
    const payload = await runProjectStatus(projectFile);
    if (!payload) {
      await vscode.window.showWarningMessage(`Failed to read loj status for ${basename(projectFile)}.`);
      return;
    }
    const debuggers = payload.debuggers ?? [];
    if (debuggers.length === 0) {
      await vscode.window.showInformationMessage('No debugger endpoint is available. Start `loj dev --debug` first.');
      return;
    }

    let selected = debuggers[0];
    if (debuggers.length > 1) {
      const selection = await vscode.window.showQuickPick(
        debuggers.map((entry) => ({
          label: `Attach ${entry.targetAlias} debugger`,
          description: `${entry.host}:${entry.port}`,
          detail: `${entry.runtime} debugger`,
          debuggerEntry: entry,
        })),
        {
          title: `Attach debugger: ${payload.app?.name ?? basename(projectFile)}`,
          placeHolder: 'Select the generated backend debugger endpoint to attach.',
        },
      );
      selected = selection?.debuggerEntry ?? selected;
    }

    const started = await vscode.debug.startDebugging(undefined, selected.attachKind === 'java'
      ? {
        type: 'java',
        request: 'attach',
        name: `Loj Attach (${selected.targetAlias})`,
        hostName: selected.host,
        port: selected.port,
      }
      : {
        type: 'debugpy',
        request: 'attach',
        name: `Loj Attach (${selected.targetAlias})`,
        connect: {
          host: selected.host,
          port: selected.port,
        },
        justMyCode: false,
      });
    if (!started) {
      await vscode.window.showWarningMessage(`Failed to start debugger attach for ${selected.targetAlias}.`);
    }
  }

  async function installBundledSkill(agent: 'codex' | 'windsurf'): Promise<void> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(['agent', 'install', agent], {
      cwd: getWorkspaceRoot(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    devOutput.clear();
    writeOutputBanner(devOutput, 'loj agent install', `install bundled loj-authoring to ${agent}`);
    writeOutputText(devOutput, stdout.join(''));
    writeOutputText(devOutput, stderr.join(''));
    writeOutputSection(devOutput, 'next', ['open: skills/loj-authoring/SKILL.md', 'manage: loj agent export codex --out-dir ./tooling/skills']);
    devOutput.show(true);
    if (exitCode !== 0) {
      await vscode.window.showWarningMessage(`Failed to install loj-authoring into ${agent}.`);
      return;
    }
    await vscode.window.showInformationMessage(`Installed loj-authoring into ${agent}.`);
  }

  async function exportBundledSkill(): Promise<void> {
    const destination = await vscode.window.showInputBox({
      title: 'Export loj-authoring skill bundle',
      prompt: 'Directory to write the exported skill bundle into',
      value: './tooling/skills',
    });
    if (!destination) {
      return;
    }
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runProjectCli(['agent', 'export', 'codex', '--out-dir', destination], {
      cwd: getWorkspaceRoot(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    devOutput.clear();
    writeOutputBanner(devOutput, 'loj agent export', 'export bundled loj-authoring skill');
    writeOutputText(devOutput, stdout.join(''));
    writeOutputText(devOutput, stderr.join(''));
    writeOutputSection(devOutput, 'next', [`inspect: ${destination}`]);
    devOutput.show(true);
    if (exitCode !== 0) {
      await vscode.window.showWarningMessage('Failed to export loj-authoring skill bundle.');
      return;
    }
    await vscode.window.showInformationMessage(`Exported loj-authoring into ${destination}.`);
  }

  async function openPublicSkill(): Promise<void> {
    const skillUri = vscode.Uri.file(normalizeFsPath(resolve(getWorkspaceRoot(), 'skills', 'loj-authoring', 'SKILL.md')));
    const document = await vscode.workspace.openTextDocument(skillUri);
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  context.subscriptions.push(
    diagnostics,
    output,
    devOutput,
    semanticStatus,
    devStartStatus,
    devDebugStatus,
    devStopStatus,
    vscode.window.createTreeView('lojSidebar.overview', {
      treeDataProvider: sidebarProvider,
      showCollapseAll: false,
    }),
    vscode.languages.registerHoverProvider({ language: 'rdsl', scheme: 'file' }, {
      provideHover(document, position) {
        return provideNodeHover(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerHoverProvider({ language: 'sdsl', scheme: 'file' }, {
      provideHover(document, position) {
        return provideNodeHover(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerDefinitionProvider({ language: 'rdsl', scheme: 'file' }, {
      provideDefinition(document, position) {
        return provideLinkedArtifactDefinition(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerDefinitionProvider({ language: 'sdsl', scheme: 'file' }, {
      provideDefinition(document, position) {
        return provideLinkedArtifactDefinition(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerDefinitionProvider({ language: 'loj-rules', scheme: 'file' }, {
      provideDefinition(document, position) {
        return provideLinkedArtifactDefinition(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerDefinitionProvider({ language: 'loj-flow', scheme: 'file' }, {
      provideDefinition(document, position) {
        return provideLinkedArtifactDefinition(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerDefinitionProvider({ language: 'loj-style', scheme: 'file' }, {
      provideDefinition(document, position) {
        return provideLinkedArtifactDefinition(document, position.line + 1, position.character + 1);
      },
    }),
    vscode.languages.registerCompletionItemProvider({ language: 'rdsl', scheme: 'file' }, {
      async provideCompletionItems(document, position) {
        return provideCompletions(document, position.line + 1, position.character + 1);
      },
    }, ':', '.'),
    vscode.languages.registerCodeActionsProvider({ language: 'rdsl', scheme: 'file' }, {
      provideCodeActions(document, range, context) {
        return provideQuickFixes(document, range, context);
      },
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void scheduleValidation(document, diagnostics);
      void updateProjectCommandStatus(document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void scheduleValidation(event.document, diagnostics);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void validateDocument(document, diagnostics);
      void updateProjectCommandStatus(document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void updateSemanticStatus(editor?.document);
      void updateProjectCommandStatus(editor?.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isDslDocument(document)) {
        diagnostics.delete(document.uri);
        if (isRdslDocument(document)) {
          rdslProjectCaches.clear();
          lastSuccessfulRdslResults.clear();
        } else if (isSdslDocument(document)) {
          lastSuccessfulSdslResults.clear();
        }
        if (vscode.window.activeTextEditor?.document.fileName === document.fileName) {
          semanticStatus.hide();
        }
      }
      const timer = validationTimers.get(document.fileName);
      if (timer) {
        clearTimeout(timer);
        validationTimers.delete(document.fileName);
      }
    }),
    vscode.commands.registerCommand('loj.startProjectDev', async () => {
      await startProjectDev(false);
    }),
    vscode.commands.registerCommand('loj.debugProjectDev', async () => {
      await startProjectDev(true);
    }),
    vscode.commands.registerCommand('loj.stopProjectDev', async () => {
      await stopProjectDev();
    }),
    vscode.commands.registerCommand('loj.rebuildProjectTarget', async () => {
      await rebuildProjectTarget();
    }),
    vscode.commands.registerCommand('loj.restartProjectService', async () => {
      await restartProjectService();
    }),
    vscode.commands.registerCommand('loj.showProjectStatus', async () => {
      await showProjectStatus();
    }),
    vscode.commands.registerCommand('loj.runProjectDoctor', async () => {
      await showProjectDoctor(false);
    }),
    vscode.commands.registerCommand('loj.showProjectOverview', async () => {
      await showProjectDoctor(true);
    }),
    vscode.commands.registerCommand('loj.openNearestProjectFile', async () => {
      await openNearestProjectFile();
    }),
    vscode.commands.registerCommand('loj.openLinkedArtifact', async () => {
      await openLinkedArtifact();
    }),
    vscode.commands.registerCommand('loj.openGeneratedOutputRoot', async () => {
      await openGeneratedOutputRoot();
    }),
    vscode.commands.registerCommand('loj.openProjectPreview', async () => {
      await openProjectPreview();
    }),
    vscode.commands.registerCommand('loj.attachProjectDebugger', async () => {
      await attachProjectDebugger();
    }),
    vscode.commands.registerCommand('loj.installSkillCodex', async () => {
      await installBundledSkill('codex');
    }),
    vscode.commands.registerCommand('loj.installSkillWindsurf', async () => {
      await installBundledSkill('windsurf');
    }),
    vscode.commands.registerCommand('loj.exportSkillBundle', async () => {
      await exportBundledSkill();
    }),
    vscode.commands.registerCommand('loj.openPublicSkill', async () => {
      await openPublicSkill();
    }),
    vscode.commands.registerCommand('loj.inspectCurrentNode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDslDocument(editor.document)) {
        await vscode.window.showWarningMessage(`Open a ${CANONICAL_RDSL_SOURCE_SUFFIX}/.rdsl or ${CANONICAL_SDSL_SOURCE_SUFFIX}/.sdsl source file to inspect the current semantic node.`);
        return;
      }

      const state = await getProjectState(editor.document.fileName, [editor.document.fileName]);
      if (!state || !canUseCurrentSemanticAssistResult(state)) {
        await vscode.window.showWarningMessage('Current DSL project does not compile cleanly enough to inspect nodes.');
        return;
      }

      if (state.kind === 'rdsl') {
        const node = findMostSpecificTraceNode(
          state.semanticResult.traceManifest!,
          editor.document.fileName,
          editor.selection.active.line + 1,
          editor.selection.active.character + 1,
        );
        if (!node) {
          await vscode.window.showInformationMessage('No semantic node found at the current cursor position.');
          return;
        }

        const hostFiles = listManifestHostFilesForNode(state.semanticResult.semanticManifest!, node.id);
        const regions = listTraceRegionsForNode(state.semanticResult.traceManifest!, node.id);
        const semantic = inspectSemanticNode(state.semanticResult.semanticManifest!.ir, node.id);

        output.clear();
        output.appendLine(`node: ${node.id}`);
        output.appendLine(`kind: ${node.kind}`);
        output.appendLine(`semantic state: ${formatSemanticAssistStatus(state.usingFallbackSemanticResult)}`);
        if (state.usingFallbackSemanticResult) {
          const currentIssueSummary = formatSemanticAssistIssueSummary(state.result.errors.length, state.result.warnings.length);
          const currentPrimaryIssue = formatSemanticAssistPrimaryIssue(state.result.errors, state.result.warnings);
          if (currentIssueSummary) {
            output.appendLine(`current issues: ${currentIssueSummary}`);
          }
          if (currentPrimaryIssue) {
            output.appendLine(`first issue: ${currentPrimaryIssue}`);
          }
        }
        output.appendLine(`source: ${formatSourceSpan(node.sourceSpan)}`);
        if (semantic) {
          output.appendLine('details:');
          for (const line of semanticNodeInspectionToLines(semantic)) {
            output.appendLine(`- ${line}`);
          }
        }
        output.appendLine('host files:');
        if (hostFiles.length === 0) {
          output.appendLine('- none');
        } else {
          for (const hostFile of hostFiles) {
            output.appendLine(`- ${hostFile.path} (${hostFile.references.map((reference) => reference.role).join(', ')})`);
          }
        }
        output.appendLine('regions:');
        for (const region of regions) {
          output.appendLine(`- ${region.generatedFile}:${region.range.startLine}:${region.range.startCol}-${region.range.endLine}:${region.range.endCol} (${region.role})`);
        }
        output.show(true);
        return;
      }

      const node = findMostSpecificSdslNode(
        state.semanticResult.ir!,
        editor.document.fileName,
        editor.selection.active.line + 1,
        editor.selection.active.character + 1,
      );
      if (!node) {
        await vscode.window.showInformationMessage('No semantic node found at the current cursor position.');
        return;
      }

      output.clear();
      output.appendLine(`node: ${node.id}`);
      output.appendLine(`kind: ${node.kind}`);
      output.appendLine(`semantic state: ${formatSemanticAssistStatus(state.usingFallbackSemanticResult)}`);
      if (state.usingFallbackSemanticResult) {
        const currentIssueSummary = formatSemanticAssistIssueSummary(state.result.errors.length, state.result.warnings.length);
        const currentPrimaryIssue = formatSemanticAssistPrimaryIssue(state.result.errors, state.result.warnings);
        if (currentIssueSummary) {
          output.appendLine(`current issues: ${currentIssueSummary}`);
        }
        if (currentPrimaryIssue) {
          output.appendLine(`first issue: ${currentPrimaryIssue}`);
        }
      }
      output.appendLine(`source: ${formatSourceSpan(node.sourceSpan)}`);
      output.appendLine('details:');
      for (const line of sdslNodeInspectionToLines(node)) {
        output.appendLine(`- ${line}`);
      }
      output.show(true);
    }),
    vscode.commands.registerCommand('reactdsl.inspectCurrentNode', async () => vscode.commands.executeCommand('loj.inspectCurrentNode')),
    vscode.commands.registerCommand('loj.showCurrentIssues', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDslDocument(editor.document)) {
        await vscode.window.showWarningMessage(`Open a ${CANONICAL_RDSL_SOURCE_SUFFIX}/.rdsl or ${CANONICAL_SDSL_SOURCE_SUFFIX}/.sdsl source file to inspect current compile issues.`);
        return;
      }

      const state = await getProjectState(editor.document.fileName, [editor.document.fileName]);
      if (!state) {
        await vscode.window.showWarningMessage('Could not find a DSL project for the current file.');
        return;
      }

      const currentDiagnostics = listProjectDiagnostics(
        state.kind === 'rdsl'
          ? collectCompileDiagnostics(state.result, state.entryFile)
          : collectSdslCompileDiagnostics(state.result, state.entryFile),
      );
      const issueSummary = formatSemanticAssistIssueSummary(state.result.errors.length, state.result.warnings.length);
      if (!issueSummary) {
        await vscode.window.showInformationMessage('Current compile has no errors or warnings.');
        return;
      }

      const items = buildCurrentIssueQuickPickItems(currentDiagnostics);
      const selection = await vscode.window.showQuickPick(items, {
        title: `Current DSL issues (${issueSummary})`,
        placeHolder: 'Select a current compile issue to open its source location.',
      });
      if (!selection) {
        return;
      }

      await openProjectDiagnostic(selection.diagnostic);
    }),
    vscode.commands.registerCommand('reactdsl.showCurrentIssues', async () => vscode.commands.executeCommand('loj.showCurrentIssues')),
    vscode.commands.registerCommand('loj.traceCurrentGeneratedLocation', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        await vscode.window.showWarningMessage('Open a generated file to trace it back to DSL source.');
        return;
      }

      const buildRoot = findContainingBuildRoot(editor.document.fileName);
      if (!buildRoot) {
        await vscode.window.showWarningMessage('Could not find .rdsl build sidecars for the current file.');
        return;
      }

      const manifests = readBuildManifests(buildRoot);
      if (!manifests) {
        await vscode.window.showWarningMessage('Could not load build manifests from the current build directory.');
        return;
      }

      const generatedFile = toGeneratedFilePath(buildRoot, editor.document.fileName);
      const lookup = resolveTraceLocation(
        manifests.traceManifest,
        generatedFile,
        editor.selection.active.line + 1,
        editor.selection.active.character + 1,
      );
      if (!lookup) {
        await vscode.window.showInformationMessage('No trace match found for the current generated location.');
        return;
      }

      output.clear();
      output.appendLine(`generated: ${generatedFile}:${editor.selection.active.line + 1}:${editor.selection.active.character + 1}`);
      output.appendLine(`result: ${lookup.kind}`);
      for (const match of lookup.matches) {
        output.appendLine(`node: ${match.region.nodeId}`);
        output.appendLine(`kind: ${match.node?.kind ?? '-'}`);
        output.appendLine(`role: ${match.region.role}`);
        output.appendLine(`source: ${formatSourceSpan(match.node?.sourceSpan)}`);
        output.appendLine('');
      }
      output.show(true);
    }),
    vscode.commands.registerCommand('reactdsl.traceCurrentGeneratedLocation', async () => vscode.commands.executeCommand('loj.traceCurrentGeneratedLocation')),
  );

  for (const document of vscode.workspace.textDocuments) {
    void scheduleValidation(document, diagnostics);
  }
  void updateSemanticStatus(vscode.window.activeTextEditor?.document);

  async function provideNodeHover(
    document: vscode.TextDocument,
    line: number,
    col: number,
  ): Promise<vscode.Hover | undefined> {
    const state = await getProjectState(document.fileName, [document.fileName]);
    if (!state || !canUseCurrentSemanticAssistResult(state)) {
      return undefined;
    }

    if (state.kind === 'rdsl') {
      const node = findMostSpecificTraceNode(state.semanticResult.traceManifest!, document.fileName, line, col);
      if (!node) return undefined;

      const hostFiles = listManifestHostFilesForNode(state.semanticResult.semanticManifest!, node.id);
      const semantic = inspectSemanticNode(state.semanticResult.semanticManifest!.ir, node.id);
      const content = [
        `**${node.id}**`,
        '',
        `kind: \`${node.kind}\``,
        `semantic state: \`${formatSemanticAssistStatus(state.usingFallbackSemanticResult)}\``,
        `source: \`${formatSourceSpan(node.sourceSpan)}\``,
        ...(semantic
          ? ['', 'details:', ...semanticNodeInspectionToLines(semantic).map((value) => `- ${value}`)]
          : []),
        ...(hostFiles.length > 0
          ? ['', 'host files:', ...hostFiles.map((hostFile) => `- \`${hostFile.path}\` (${hostFile.references.map((reference) => reference.role).join(', ')})`)]
          : []),
      ].join('\n');
      return new vscode.Hover(new vscode.MarkdownString(content));
    }

    const node = findMostSpecificSdslNode(state.semanticResult.ir!, document.fileName, line, col);
    if (!node) {
      return undefined;
    }

    const content = [
      `**${node.id}**`,
      '',
      `kind: \`${node.kind}\``,
      `semantic state: \`${formatSemanticAssistStatus(state.usingFallbackSemanticResult)}\``,
      `source: \`${formatSourceSpan(node.sourceSpan)}\``,
      '',
      'details:',
      ...sdslNodeInspectionToLines(node).map((value) => `- ${value}`),
    ].join('\n');
    return new vscode.Hover(new vscode.MarkdownString(content));
  }

  async function provideCompletions(
    document: vscode.TextDocument,
    line: number,
    col: number,
  ): Promise<vscode.CompletionItem[] | undefined> {
    if (!isRdslDocument(document)) {
      return undefined;
    }

    const state = await getProjectState(document.fileName, [document.fileName]);
    const semanticIr = state?.kind === 'rdsl' ? state.semanticResult.ir : undefined;
    const suggestions = collectToastCompletionSuggestions(
      document.getText(),
      document.fileName,
      line,
      col,
      semanticIr,
    );

    if (suggestions.length === 0) {
      return undefined;
    }

    return suggestions.map((suggestion) => {
      const item = new vscode.CompletionItem(
        suggestion.label,
        suggestion.kind === 'property' ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Value,
      );
      item.detail = formatSemanticAssistDetail(suggestion.detail, state?.usingFallbackSemanticResult ?? false);
      item.insertText = suggestion.snippet
        ? new vscode.SnippetString(suggestion.insertText)
        : suggestion.insertText;
      item.sortText = suggestion.sortText;
      return item;
    });
  }

  function provideQuickFixes(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] | undefined {
    if (!isRdslDocument(document)) {
      return undefined;
    }

    const diagnostics = context.diagnostics.map((diagnostic) => toProjectDiagnostic(document, diagnostic));
    const fixes = collectToastQuickFixes(
      document.getText(),
      diagnostics,
      range.start.line + 1,
      range.start.character + 1,
    );

    const actions = fixes.map((fix) => {
      const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(
          fix.range.startLine - 1,
          fix.range.startCol - 1,
          fix.range.endLine - 1,
          fix.range.endCol - 1,
        ),
        fix.replacement,
      );
      action.edit = edit;
      action.diagnostics = [...context.diagnostics];
      return action;
    });

    if (context.diagnostics.some((diagnostic) => diagnostic.source === 'loj')) {
      const action = new vscode.CodeAction('Loj: Show Current Issues', vscode.CodeActionKind.QuickFix);
      action.command = {
        title: 'Loj: Show Current Issues',
        command: 'loj.showCurrentIssues',
      };
      action.diagnostics = [...context.diagnostics];
      actions.push(action);
    }

    if (actions.length === 0) {
      return undefined;
    }

    return actions;
  }

  void updateProjectCommandStatus(vscode.window.activeTextEditor?.document);

  async function scheduleValidation(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection,
  ): Promise<void> {
    if (!isDslDocument(document)) return;

    const existingTimer = validationTimers.get(document.fileName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      validationTimers.delete(document.fileName);
      void validateDocument(document, collection);
    }, 250);
    validationTimers.set(document.fileName, timer);
  }

  async function validateDocument(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection,
  ): Promise<void> {
    if (!isDslDocument(document)) return;

    const state = await getProjectState(document.fileName, [document.fileName]);
    if (!state) {
      collection.delete(document.uri);
      return;
    }

    applyDiagnostics(state, collection);
    if (vscode.window.activeTextEditor?.document.fileName === document.fileName) {
      updateSemanticStatusFromState(document, state);
    }
  }

  async function getProjectState(
    fileName: string,
    changedFiles?: Iterable<string>,
  ): Promise<CachedProjectState | null> {
    const snapshots = createSnapshotMap(getOpenSnapshots());
    const projectKind = getFileKind(fileName);
    if (!projectKind) {
      return null;
    }

    if (projectKind === 'rdsl') {
      const candidateEntries = await findCandidateEntries('rdsl', snapshots);
      const entryFile = findProjectEntry(
        fileName,
        candidateEntries,
        (requestedFile) => readSource(requestedFile, snapshots),
        (directory) => listDirectoryEntries(directory, snapshots),
      );
      if (!entryFile) {
        return null;
      }

      const cache = rdslProjectCaches.get(entryFile) ?? createProjectCache();
      rdslProjectCaches.set(entryFile, cache);

      const result = compileProjectState(entryFile, snapshots, cache, changedFiles);
      if (canUseSemanticAssistResult(result)) {
        lastSuccessfulRdslResults.set(entryFile, result);
      }
      const semanticSelection = selectSemanticAssistResult(result, lastSuccessfulRdslResults.get(entryFile));
      return {
        kind: 'rdsl',
        entryFile,
        result,
        semanticResult: semanticSelection.result,
        usingFallbackSemanticResult: semanticSelection.usingFallback,
      };
    }

    const candidateEntries = await findCandidateEntries('sdsl', snapshots);
    const entryFile = findSdslProjectEntry(
      fileName,
      candidateEntries,
      (requestedFile) => readSource(requestedFile, snapshots),
      (directory) => listDirectoryEntries(directory, snapshots),
    );
    if (!entryFile) {
      return null;
    }

    const result = compileSdslProjectState(entryFile, snapshots);
    if (canUseSdslSemanticAssistResult(result)) {
      lastSuccessfulSdslResults.set(entryFile, result);
    }
    const semanticSelection = selectSdslSemanticAssistResult(result, lastSuccessfulSdslResults.get(entryFile));
    return {
      kind: 'sdsl',
      entryFile,
      result,
      semanticResult: semanticSelection.result,
      usingFallbackSemanticResult: semanticSelection.usingFallback,
    };
  }

  async function updateSemanticStatus(document: vscode.TextDocument | undefined): Promise<void> {
    if (!document || !isDslDocument(document)) {
      semanticStatus.hide();
      return;
    }

    const state = await getProjectState(document.fileName, [document.fileName]);
    if (!state) {
      semanticStatus.text = 'Loj: no project';
      semanticStatus.tooltip = 'No DSL project entry with app: was found for the current file.';
      semanticStatus.command = undefined;
      semanticStatus.show();
      return;
    }

    updateSemanticStatusFromState(document, state);
  }

  function updateSemanticStatusFromState(
    document: vscode.TextDocument,
    state: CachedProjectState,
  ): void {
    if (vscode.window.activeTextEditor?.document.fileName !== document.fileName) {
      return;
    }

    semanticStatus.text = formatSemanticAssistStatusBarText(state.usingFallbackSemanticResult);
    semanticStatus.tooltip = formatSemanticAssistStatusBarTooltip(
      state.usingFallbackSemanticResult,
      state.result.errors.length,
      state.result.warnings.length,
      formatSemanticAssistPrimaryIssue(state.result.errors, state.result.warnings),
    );
    semanticStatus.command = shouldShowCurrentIssuesCommand(
      state.usingFallbackSemanticResult,
      state.result.errors.length,
      state.result.warnings.length,
    )
      ? 'loj.showCurrentIssues'
      : 'loj.inspectCurrentNode';
    semanticStatus.show();
  }

  function applyDiagnostics(
    state: CachedProjectState,
    collection: vscode.DiagnosticCollection,
  ): void {
    const byFile = state.kind === 'rdsl'
      ? collectCompileDiagnostics(state.result, state.entryFile)
      : collectSdslCompileDiagnostics(state.result, state.entryFile);
    const nextFiles = new Set<string>([
      ...(state.kind === 'rdsl' ? state.result.semanticManifest?.sourceFiles ?? [] : state.result.sourceFiles),
      ...Array.from(byFile.keys()),
    ]);
    const previousFiles = diagnosticsByProject.get(state.entryFile) ?? new Set<string>();

    for (const file of previousFiles) {
      if (!nextFiles.has(file)) {
        collection.delete(vscode.Uri.file(file));
      }
    }

    for (const file of nextFiles) {
      const fileDiagnostics = byFile.get(file) ?? [];
      collection.set(
        vscode.Uri.file(file),
        fileDiagnostics.map((diagnostic) => {
          const startLine = Math.max(diagnostic.range.startLine - 1, 0);
          const startCol = Math.max(diagnostic.range.startCol - 1, 0);
          const endLine = Math.max(diagnostic.range.endLine - 1, startLine);
          const endCol = Math.max(diagnostic.range.endCol - 1, startCol + 1);
          const severity = diagnostic.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Error;
          const issue = new vscode.Diagnostic(
            new vscode.Range(startLine, startCol, endLine, endCol),
            diagnostic.message,
            severity,
          );
          issue.source = 'loj';
          return issue;
        }),
      );
    }

    diagnosticsByProject.set(state.entryFile, nextFiles);
  }

  async function findCandidateEntries(
    projectKind: 'rdsl' | 'sdsl',
    snapshots: Map<string, string>,
  ): Promise<string[]> {
    const entries = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (projectKind === 'rdsl' && isRdslDocument(document) && containsAppBlock(document.getText())) {
        entries.add(normalizeFsPath(document.fileName));
      }
      if (projectKind === 'sdsl' && isSdslDocument(document) && containsSdslAppBlock(document.getText())) {
        entries.add(normalizeFsPath(document.fileName));
      }
    }

    const workspaceFiles = await vscode.workspace.findFiles(
      projectKind === 'rdsl' ? '{**/*.rdsl,**/*.web.loj}' : '{**/*.sdsl,**/*.api.loj}',
      '{**/node_modules/**,**/dist/**,**/.rdsl-dev/**,**/generated/**}',
    );
    for (const file of workspaceFiles) {
      const fileName = normalizeFsPath(file.fsPath);
      const source = readSource(fileName, snapshots);
      if (source && projectKind === 'rdsl' && containsAppBlock(source)) {
        entries.add(fileName);
      }
      if (source && projectKind === 'sdsl' && containsSdslAppBlock(source)) {
        entries.add(fileName);
      }
    }

    return Array.from(entries);
  }

  function getOpenSnapshots(): DocumentSnapshot[] {
    return vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === 'file')
      .map((document) => ({
        fileName: document.fileName,
        text: document.getText(),
      }));
  }
}

export function deactivate(): void {}

function canUseCurrentSemanticAssistResult(state: CachedProjectState): boolean {
  return state.kind === 'rdsl'
    ? canUseSemanticAssistResult(state.semanticResult)
    : canUseSdslSemanticAssistResult(state.semanticResult);
}

function isDslDocument(document: vscode.TextDocument): boolean {
  return isRdslDocument(document) || isSdslDocument(document);
}

function isRdslDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file' && (document.languageId === 'rdsl' || isRdslSourceFile(document.fileName));
}

function isSdslDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file' && (document.languageId === 'sdsl' || isSdslSourceFile(document.fileName));
}

function getFileKind(fileName: string): 'rdsl' | 'sdsl' | undefined {
  if (isRdslSourceFile(fileName)) {
    return 'rdsl';
  }
  if (isSdslSourceFile(fileName)) {
    return 'sdsl';
  }
  return undefined;
}

function readSource(fileName: string, snapshots: Map<string, string>): string | null {
  const normalizedFile = normalizeFsPath(fileName);
  const snapshot = snapshots.get(normalizedFile);
  if (snapshot !== undefined) {
    return snapshot;
  }

  try {
    return readFileSync(normalizedFile, 'utf8');
  } catch {
    return null;
  }
}

function readBuildManifests(buildRoot: string): { semanticManifest: SemanticManifest; traceManifest: TraceManifest } | null {
  try {
    const semanticManifest = JSON.parse(
      readFileSync(normalizeFsPath(`${buildRoot}/.rdsl/semantic-manifest.json`), 'utf8'),
    ) as SemanticManifest;
    const traceManifest = JSON.parse(
      readFileSync(normalizeFsPath(`${buildRoot}/.rdsl/trace-manifest.json`), 'utf8'),
    ) as TraceManifest;
    return { semanticManifest, traceManifest };
  } catch {
    return null;
  }
}

function toProjectDiagnostic(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
): ProjectDiagnostic {
  return {
    file: normalizeFsPath(document.fileName),
    severity: diagnostic.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'error',
    message: diagnostic.message,
    phase: 'validate',
    range: {
      file: normalizeFsPath(document.fileName),
      startLine: diagnostic.range.start.line + 1,
      startCol: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endCol: diagnostic.range.end.character + 1,
    },
  };
}

async function openProjectDiagnostic(diagnostic: ProjectDiagnostic): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(diagnostic.file));
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(
      Math.max(diagnostic.range.startLine - 1, 0),
      Math.max(diagnostic.range.startCol - 1, 0),
      Math.max(diagnostic.range.endLine - 1, diagnostic.range.startLine - 1),
      Math.max(diagnostic.range.endCol - 1, diagnostic.range.startCol),
    ),
  });
}
