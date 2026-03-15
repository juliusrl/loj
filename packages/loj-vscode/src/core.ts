import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  compileProject,
  parse,
  isRdslImportPath,
  isRdslSourceFile,
} from '@loj-lang/rdsl-compiler';
import type {
  CompileResult,
  ProjectCache,
  TraceManifest,
  TraceNodeEntry,
} from '@loj-lang/rdsl-compiler';
import type {
  IRApp,
  IRModel,
  IRNode,
  IRResource,
  IRListView,
  IREditView,
  IRCreateView,
  SourceSpan,
} from '@loj-lang/rdsl-compiler/ir';

export interface ToastCompletionSuggestion {
  label: string;
  insertText: string;
  detail: string;
  kind: 'property' | 'value';
  snippet?: boolean;
  sortText?: string;
}

export interface ToastQuickFix {
  title: string;
  replacement: string;
  range: SourceSpan;
}

interface ToastSnippetSeed {
  messageText: string;
  valueName: string;
  ref: string;
}

export interface DocumentSnapshot {
  fileName: string;
  text: string;
}

export interface ProjectDiagnostic {
  file: string;
  severity: 'error' | 'warning';
  message: string;
  phase: CompilePhase;
  nodeId?: string;
  range: SourceSpan;
}

export interface CurrentIssueQuickPickItem {
  label: string;
  description: string;
  detail: string;
  diagnostic: ProjectDiagnostic;
}

export interface ProjectOverviewPayloadLike {
  app?: { name?: string };
  running?: boolean;
  targets?: Array<{ alias: string; type: string; validated?: boolean }>;
  surfaceCounts?: { resources: number; readModels: number; workflows: number; rules: number };
  dev?: { hostUrl?: string; backendUrl?: string };
  services?: Array<{ kind: string; targetAlias: string; url: string }>;
  databases?: Array<{ targetAlias: string; phase: string; composeFile: string }>;
  checks?: Array<{ severity: string; target?: string; message: string }>;
}

export interface ProjectOverviewQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  kind: 'summary' | 'target' | 'url' | 'service' | 'database' | 'checks' | 'output';
}

export interface ProjectTargetSummaryLike {
  alias: string;
  type: string;
  entry: string;
  outDir: string;
}

export interface LinkedArtifactNavigationReference {
  kind: 'rules' | 'flow' | 'sql' | 'fn' | 'custom' | 'style' | 'asset';
  rawPath: string;
  sourceFile: string;
  resolvedCandidates: string[];
}

export interface SemanticAssistSelection {
  result: CompileResult;
  usingFallback: boolean;
}

export type SemanticAssistResult = CompileResult & {
  success: true;
  ir: NonNullable<CompileResult['ir']>;
  semanticManifest: NonNullable<CompileResult['semanticManifest']>;
  traceManifest: NonNullable<CompileResult['traceManifest']>;
};

export type CompilePhase = 'parse' | 'normalize' | 'validate' | 'codegen';

export interface CompileIssueLike {
  phase: CompilePhase;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  nodeId?: string;
}

export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function findNearestProjectFile(
  fileName: string | undefined,
  projectFiles: string[],
): string | null {
  const normalizedCandidates = Array.from(new Set(projectFiles.map(normalizeFsPath)));
  if (normalizedCandidates.length === 0) {
    return null;
  }
  if (!fileName) {
    return normalizedCandidates.sort()[0] ?? null;
  }
  const normalizedFile = normalizeFsPath(fileName);
  const ranked = normalizedCandidates
    .map((candidate) => ({
      candidate,
      distance: pathDistanceToFile(normalizedFile, candidate),
    }))
    .filter((entry): entry is { candidate: string; distance: number } => entry.distance !== null)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.candidate.localeCompare(right.candidate);
    });
  return ranked[0]?.candidate ?? normalizedCandidates.sort()[0] ?? null;
}

export function findNearestAncestorProjectFile(
  fileName: string,
  exists: (path: string) => boolean,
): string | null {
  let current = dirname(normalizeFsPath(fileName));
  while (true) {
    const candidate = normalizeFsPath(resolve(current, 'loj.project.yaml'));
    if (exists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function pathDistanceToFile(fileName: string, projectFile: string): number | null {
  const projectDir = dirname(projectFile);
  const relativePath = normalizeFsPath(relative(projectDir, fileName));
  if (relativePath === '' || relativePath === basename(fileName)) {
    return 0;
  }
  if (relativePath.startsWith('..')) {
    return null;
  }
  return relativePath.split('/').length;
}

export function createSnapshotMap(documents: Iterable<DocumentSnapshot>): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const document of documents) {
    snapshots.set(normalizeFsPath(document.fileName), document.text);
  }
  return snapshots;
}

export function containsAppBlock(source: string): boolean {
  return /^\s*app\s*:/m.test(source);
}

export function findProjectEntry(
  fileName: string,
  candidateEntries: string[],
  readText: (fileName: string) => string | null,
  listFiles?: (directory: string) => string[],
): string | null {
  const normalizedFile = normalizeFsPath(fileName);
  const currentSource = readText(normalizedFile);
  if (currentSource && containsAppBlock(currentSource)) {
    return normalizedFile;
  }

  const uniqueCandidates = Array.from(new Set(candidateEntries.map(normalizeFsPath)))
    .filter((candidate) => candidate !== normalizedFile)
    .sort((left, right) => compareCandidatePriority(left, right, normalizedFile));

  for (const candidate of uniqueCandidates) {
    const candidateSource = readText(candidate);
    if (!candidateSource || !containsAppBlock(candidateSource)) continue;

    const parsed = parse(candidateSource, candidate);
    if (!parsed.ast.app) continue;

    if (canReachImportedFile(candidate, normalizedFile, readText, listFiles)) {
      return candidate;
    }
  }

  return null;
}

export function compileProjectState(
  entryFile: string,
  snapshots: Map<string, string>,
  cache?: ProjectCache,
  changedFiles?: Iterable<string>,
): CompileResult {
  return compileProject({
    entryFile: normalizeFsPath(entryFile),
    cache,
    changedFiles,
    readFile(fileName) {
      const normalizedFile = normalizeFsPath(fileName);
      const snapshot = snapshots.get(normalizedFile);
      if (snapshot !== undefined) {
        return snapshot;
      }
      return readFileSync(normalizedFile, 'utf8');
    },
    listFiles(directory) {
      return listDirectoryEntries(directory, snapshots);
    },
  });
}

export function collectCompileDiagnostics(
  result: CompileResult,
  fallbackFile: string,
): Map<string, ProjectDiagnostic[]> {
  const diagnostics = new Map<string, ProjectDiagnostic[]>();
  const nodeSpans = indexIrNodeSpans(result.ir);
  const nodeSpanUsage = new Map<string, number>();
  const addDiagnostic = (issue: ProjectDiagnostic) => {
    const bucket = diagnostics.get(issue.file);
    if (bucket) {
      bucket.push(issue);
    } else {
      diagnostics.set(issue.file, [issue]);
    }
  };

  for (const error of result.errors) {
    addDiagnostic(buildDiagnostic(error, 'error', fallbackFile, nodeSpans, nodeSpanUsage));
  }
  for (const warning of result.warnings) {
    addDiagnostic(buildDiagnostic(warning, 'warning', fallbackFile, nodeSpans, nodeSpanUsage));
  }

  return diagnostics;
}

export function canUseSemanticAssistResult(result: CompileResult | undefined): result is SemanticAssistResult {
  return Boolean(result?.success && result.ir && result.semanticManifest && result.traceManifest);
}

export function selectSemanticAssistResult(
  currentResult: CompileResult,
  lastSuccessfulResult?: CompileResult,
): SemanticAssistSelection {
  if (canUseSemanticAssistResult(currentResult)) {
    return { result: currentResult, usingFallback: false };
  }
  if (canUseSemanticAssistResult(lastSuccessfulResult)) {
    return { result: lastSuccessfulResult, usingFallback: true };
  }
  return { result: currentResult, usingFallback: false };
}

export function formatSemanticAssistStatus(usingFallback: boolean): string {
  return usingFallback ? 'last successful compile (fallback)' : 'current compile';
}

export function formatSemanticAssistDetail(detail: string, usingFallback: boolean): string {
  if (!usingFallback) {
    return detail;
  }
  return `${detail} [semantic: ${formatSemanticAssistStatus(true)}]`;
}

export function formatSemanticAssistStatusBarText(usingFallback: boolean): string {
  return usingFallback ? 'Loj: semantic fallback' : 'Loj: semantic current';
}

export function formatSemanticAssistIssueSummary(errorCount: number, warningCount: number): string | undefined {
  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(' and ');
}

export function formatSemanticAssistPrimaryIssue(
  errors: ReadonlyArray<Pick<CompileIssueLike, 'phase' | 'message'>>,
  warnings: ReadonlyArray<Pick<CompileIssueLike, 'phase' | 'message'>>,
): string | undefined {
  const primary = errors[0] ?? warnings[0];
  if (!primary) {
    return undefined;
  }

  const normalizedMessage = primary.message.replace(/\s+/g, ' ').trim();
  const summary = `${primary.phase}: ${normalizedMessage}`;
  return summary.length > 140 ? `${summary.slice(0, 137)}...` : summary;
}

export function formatSemanticAssistStatusBarTooltip(
  usingFallback: boolean,
  errorCount = 0,
  warningCount = 0,
  primaryIssue?: string,
): string {
  if (usingFallback) {
    const issueSummary = formatSemanticAssistIssueSummary(errorCount, warningCount);
    if (issueSummary) {
      if (primaryIssue) {
        return `Hover and completion are using the last successful compile. Current source has ${issueSummary}. First issue: ${primaryIssue}. Click to inspect the current semantic node.`;
      }
      return `Hover and completion are using the last successful compile. Current source has ${issueSummary}. Click to inspect the current semantic node.`;
    }
    return 'Hover and completion are using the last successful compile. Diagnostics still reflect the current source. Click to inspect the current semantic node.';
  }
  return 'Hover and completion are using the current compile. Click to inspect the current semantic node.';
}

export function shouldShowCurrentIssuesCommand(
  usingFallback: boolean,
  errorCount: number,
  warningCount: number,
): boolean {
  return usingFallback && (errorCount > 0 || warningCount > 0);
}

export function formatCurrentCompileIssueLine(issue: Pick<CompileIssueLike, 'phase' | 'message' | 'file' | 'line' | 'col'>): string {
  const location = issue.file
    ? `${normalizeFsPath(issue.file)}:${issue.line ?? 1}:${issue.col ?? 1}`
    : '-';
  const message = issue.message.replace(/\s+/g, ' ').trim();
  return `- [${issue.phase}] ${location} ${message}`;
}

export function listProjectDiagnostics(
  diagnosticsByFile: Map<string, ProjectDiagnostic[]>,
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  for (const fileDiagnostics of diagnosticsByFile.values()) {
    diagnostics.push(...fileDiagnostics);
  }

  return diagnostics.sort(compareProjectDiagnostics);
}

export function formatProjectDiagnosticLocation(
  diagnostic: Pick<ProjectDiagnostic, 'file' | 'range'>,
): string {
  return `${normalizeFsPath(diagnostic.file)}:${diagnostic.range.startLine}:${diagnostic.range.startCol}`;
}

export function buildCurrentIssueQuickPickItems(
  diagnostics: ReadonlyArray<ProjectDiagnostic>,
): CurrentIssueQuickPickItem[] {
  return diagnostics.map((diagnostic) => ({
    label: `${diagnostic.severity}: ${normalizeIssueMessage(diagnostic.message)}`,
    description: formatProjectDiagnosticLocation(diagnostic),
    detail: diagnostic.nodeId
      ? `phase: ${diagnostic.phase}, node: ${diagnostic.nodeId}`
      : `phase: ${diagnostic.phase}`,
    diagnostic,
  }));
}

export function buildProjectOverviewQuickPickItems(
  projectFile: string,
  payload: ProjectOverviewPayloadLike,
): ProjectOverviewQuickPickItem[] {
  const items: ProjectOverviewQuickPickItem[] = [];
  items.push({
    kind: 'summary',
    label: payload.app?.name ? `App: ${payload.app.name}` : 'App overview',
    description: payload.running ? 'running' : 'stopped',
    detail: normalizeFsPath(projectFile),
  });

  if (payload.surfaceCounts) {
    items.push({
      kind: 'summary',
      label: `Surfaces: ${payload.surfaceCounts.resources} resources, ${payload.surfaceCounts.readModels} readModels`,
      description: `${payload.surfaceCounts.workflows} workflows, ${payload.surfaceCounts.rules} rules`,
      detail: 'Current project semantic surface count.',
    });
  }

  for (const target of payload.targets ?? []) {
    items.push({
      kind: 'target',
      label: `Target: ${target.alias} (${target.type})`,
      description: typeof target.validated === 'boolean'
        ? `validated=${target.validated ? 'yes' : 'no'}`
        : undefined,
      detail: 'Declared project target.',
    });
  }

  if (payload.dev?.hostUrl) {
    items.push({
      kind: 'url',
      label: 'Open frontend host',
      description: payload.dev.hostUrl,
      detail: 'Current frontend dev host URL from the shared loj project-shell payload.',
    });
  }
  if (payload.dev?.backendUrl) {
    items.push({
      kind: 'url',
      label: 'Open backend server',
      description: payload.dev.backendUrl,
      detail: 'Current backend dev server URL from the shared loj project-shell payload.',
    });
  }

  for (const service of payload.services ?? []) {
    items.push({
      kind: 'service',
      label: `Inspect service: ${service.kind} (${service.targetAlias})`,
      description: service.url,
      detail: 'Running managed service from loj dev.',
    });
  }

  for (const database of payload.databases ?? []) {
    items.push({
      kind: 'database',
      label: `Inspect database: ${database.targetAlias} (${database.phase})`,
      description: database.composeFile,
      detail: 'Auto-provisioned database summary from loj dev.',
    });
  }

  const warningCount = (payload.checks ?? []).filter((check) => check.severity === 'warning').length;
  const errorCount = (payload.checks ?? []).filter((check) => check.severity === 'error').length;
  if ((payload.checks?.length ?? 0) > 0) {
    items.push({
      kind: 'checks',
      label: `Checks: ${payload.checks?.length ?? 0} items`,
      description: `${errorCount} errors, ${warningCount} warnings`,
      detail: 'Open the output channel for the full doctor/overview details.',
    });
  }

  items.push({
    kind: 'output',
    label: 'Open full overview in output',
    description: 'Show the complete project overview in the Loj Dev output channel.',
    detail: normalizeFsPath(projectFile),
  });

  return items;
}

export function findLinkedArtifactReferenceAtPosition(
  source: string,
  fileName: string,
  line: number,
  col: number,
): LinkedArtifactNavigationReference | null {
  const offset = positionToOffset(source, line, col);
  const normalizedFile = normalizeFsPath(fileName);
  const patterns: Array<{ kind: LinkedArtifactNavigationReference['kind']; expression: RegExp }> = [
    { kind: 'fn', expression: /@fn\((['"])(.+?)\1\)/g },
    { kind: 'custom', expression: /@custom\((['"])(.+?)\1\)/g },
    { kind: 'rules', expression: /@rules\((['"])(.+?)\1\)/g },
    { kind: 'flow', expression: /@flow\((['"])(.+?)\1\)/g },
    { kind: 'sql', expression: /@sql\((['"])(.+?)\1\)/g },
    { kind: 'style', expression: /@style\((['"])(.+?)\1\)/g },
    { kind: 'asset', expression: /@asset\((['"])(.+?)\1\)/g },
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.expression)) {
      const matchIndex = match.index ?? -1;
      if (matchIndex < 0) {
        continue;
      }
      const matchEnd = matchIndex + match[0].length;
      if (offset < matchIndex || offset > matchEnd) {
        continue;
      }
      const rawPath = match[2]?.trim();
      if (!rawPath) {
        continue;
      }
      return {
        kind: pattern.kind,
        rawPath,
        sourceFile: normalizedFile,
        resolvedCandidates: resolveLinkedArtifactNavigationCandidates(normalizedFile, pattern.kind, rawPath),
      };
    }
  }

  return null;
}

export function resolveLinkedArtifactNavigationCandidates(
  sourceFile: string,
  kind: LinkedArtifactNavigationReference['kind'],
  rawPath: string,
): string[] {
  const resolvedBase = normalizeFsPath(resolve(dirname(sourceFile), rawPath));
  const candidates = new Set<string>([resolvedBase]);
  if ((kind === 'fn' || kind === 'custom') && !/\.[A-Za-z0-9]+$/.test(resolvedBase)) {
    candidates.add(`${resolvedBase}.ts`);
    candidates.add(`${resolvedBase}.tsx`);
    candidates.add(`${resolvedBase}.js`);
    candidates.add(`${resolvedBase}.jsx`);
  }
  if (kind === 'rules' && !resolvedBase.endsWith('.rules.loj')) {
    candidates.add(`${resolvedBase}.rules.loj`);
  }
  if (kind === 'flow' && !resolvedBase.endsWith('.flow.loj')) {
    candidates.add(`${resolvedBase}.flow.loj`);
  }
  if (kind === 'sql' && !resolvedBase.endsWith('.sql')) {
    candidates.add(`${resolvedBase}.sql`);
  }
  if (kind === 'style' && !resolvedBase.endsWith('.style.loj')) {
    candidates.add(`${resolvedBase}.style.loj`);
  }
  if (kind === 'asset' && !/\.[A-Za-z0-9]+$/.test(resolvedBase)) {
    candidates.add(`${resolvedBase}.svg`);
    candidates.add(`${resolvedBase}.png`);
    candidates.add(`${resolvedBase}.jpg`);
    candidates.add(`${resolvedBase}.jpeg`);
    candidates.add(`${resolvedBase}.webp`);
    candidates.add(`${resolvedBase}.ico`);
  }
  return [...candidates];
}

export function findLikelyGeneratedOutputTarget(
  currentFile: string,
  projectFile: string,
  targets: ReadonlyArray<ProjectTargetSummaryLike>,
): ProjectTargetSummaryLike | null {
  const normalizedCurrentFile = normalizeFsPath(currentFile);
  const projectDir = dirname(normalizeFsPath(projectFile));
  const ranked = targets
    .map((target) => {
      const targetEntry = normalizeFsPath(resolve(projectDir, target.entry));
      const targetRoot = dirname(targetEntry);
      const distance = pathDistanceToFile(normalizedCurrentFile, targetEntry);
      if (distance !== null) {
        return { target, score: distance };
      }
      const relativePath = normalizeFsPath(relative(targetRoot, normalizedCurrentFile));
      if (!relativePath.startsWith('..')) {
        return { target, score: relativePath.split('/').length + 1 };
      }
      return null;
    })
    .filter((entry): entry is { target: ProjectTargetSummaryLike; score: number } => Boolean(entry))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.target.alias.localeCompare(right.target.alias);
    });

  return ranked[0]?.target ?? null;
}

function positionToOffset(source: string, line: number, col: number): number {
  if (line <= 1) {
    return Math.max(col - 1, 0);
  }
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    const nextLineBreak = source.indexOf('\n', offset);
    if (nextLineBreak < 0) {
      return source.length;
    }
    offset = nextLineBreak + 1;
    currentLine += 1;
  }
  return Math.min(offset + Math.max(col - 1, 0), source.length);
}

export function findMostSpecificTraceNode(
  traceManifest: TraceManifest,
  fileName: string,
  line: number,
  col: number,
): TraceNodeEntry | undefined {
  const normalizedFile = normalizeFsPath(fileName);
  const candidates = traceManifest.nodes
    .filter((node) => node.sourceSpan && node.sourceSpan.file === normalizedFile && containsPosition(node.sourceSpan, line, col))
    .sort((left, right) => spanSpecificity(left.sourceSpan!) - spanSpecificity(right.sourceSpan!));

  return candidates[0];
}

export function findContainingBuildRoot(fileName: string): string | null {
  let current = dirname(normalizeFsPath(fileName));

  while (true) {
    const semanticManifest = join(current, '.rdsl', 'semantic-manifest.json');
    const traceManifest = join(current, '.rdsl', 'trace-manifest.json');
    if (existsSync(semanticManifest) && existsSync(traceManifest)) {
      return normalizeFsPath(current);
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function toGeneratedFilePath(buildRoot: string, fileName: string): string {
  return normalizeFsPath(relative(buildRoot, fileName));
}

export function formatSourceSpan(sourceSpan: SourceSpan | undefined): string {
  if (!sourceSpan) return '-';
  return `${sourceSpan.file}:${sourceSpan.startLine}:${sourceSpan.startCol}-${sourceSpan.endLine}:${sourceSpan.endCol}`;
}

export function collectToastCompletionSuggestions(
  source: string,
  fileName: string,
  line: number,
  col: number,
  ir?: IRApp,
): ToastCompletionSuggestion[] {
  const context = inferToastCompletionContext(source, line, col);
  if (!context) {
    return [];
  }

  switch (context.kind) {
    case 'toast-anchor':
      return [
        {
          label: 'toast descriptor',
          insertText: buildToastDescriptorSnippet(context.indent, inferToastSnippetSeed(source, ir, fileName, line, col)),
          detail: 'Expand toast: into a descriptor object',
          kind: 'value',
          snippet: true,
          sortText: '00-toast-descriptor',
        },
      ];
    case 'toast-values-entry':
      return [
        {
          label: 'value entry',
          insertText: buildToastValueEntrySnippet(context.indent, inferToastSnippetSeed(source, ir, fileName, line, col)),
          detail: 'Insert a descriptor values entry',
          kind: 'value',
          snippet: true,
          sortText: '05-value-entry',
        },
      ];
    case 'toast-body':
      return [
        {
          label: 'key',
          insertText: 'key: ${1:messages.key}',
          detail: 'Descriptor message key',
          kind: 'property',
          snippet: true,
          sortText: '10-key',
        },
        {
          label: 'defaultMessage',
          insertText: 'defaultMessage: "${1:Saved}"',
          detail: 'Fallback message text',
          kind: 'property',
          snippet: true,
          sortText: '20-defaultMessage',
        },
        {
          label: 'values',
          insertText: 'values:',
          detail: 'Start descriptor values mapping',
          kind: 'property',
          sortText: '30-values',
        },
      ];
    case 'toast-value-object':
      return [
        {
          label: 'ref',
          insertText: 'ref: ${1:form.name}',
          detail: 'Reference a validated runtime value',
          kind: 'property',
          snippet: true,
          sortText: '10-ref',
        },
      ];
    case 'toast-ref':
      return collectToastRefSuggestions(ir, fileName, line, col);
  }
}

export function collectToastQuickFixes(
  source: string,
  diagnostics: Iterable<ProjectDiagnostic>,
  line: number,
  col: number,
): ToastQuickFix[] {
  const fixes: ToastQuickFix[] = [];
  for (const diagnostic of diagnostics) {
    if (!containsPosition(diagnostic.range, line, col)) {
      continue;
    }

    const match = diagnostic.message.match(/toast\.values\.[^ ]+ ref "([^"]+)" .* use ([A-Za-z0-9_.]+) instead/);
    if (!match || match[2].includes('<')) {
      continue;
    }

    const replacementRange = findTextRangeInSpan(source, diagnostic.range, match[1]);
    if (!replacementRange) {
      continue;
    }

    fixes.push({
      title: `Replace ${match[1]} with ${match[2]}`,
      replacement: match[2],
      range: replacementRange,
    });
  }

  return fixes;
}

function compareCandidatePriority(left: string, right: string, targetFile: string): number {
  const leftDistance = pathDistance(dirname(left), targetFile);
  const rightDistance = pathDistance(dirname(right), targetFile);
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  return left.localeCompare(right);
}

function collectToastRefSuggestions(
  ir: IRApp | undefined,
  fileName: string,
  line: number,
  col: number,
): ToastCompletionSuggestion[] {
  const viewContext = ir ? findViewContextAtPosition(ir, fileName, line, col) : undefined;
  if (!viewContext) {
    return [
      { label: 'form.name', insertText: 'form.name', detail: 'Form field value', kind: 'value', sortText: '10-form.name' },
      { label: 'user.name', insertText: 'user.name', detail: 'Current user value', kind: 'value', sortText: '20-user.name' },
    ];
  }

  const suggestions: ToastCompletionSuggestion[] = [];

  if (viewContext.viewName === 'edit') {
    suggestions.push({
      label: 'params.id',
      insertText: 'params.id',
      detail: 'Edit route param',
      kind: 'value',
      sortText: '10-params.id',
    });
  }

  for (const field of viewContext.model?.fields ?? []) {
    const formLabel = `form.${field.name}`;
    suggestions.push({
      label: formLabel,
      insertText: formLabel,
      detail: `${viewContext.resource.name}.${viewContext.viewName} form field`,
      kind: 'value',
      sortText: viewContext.viewName === 'edit' ? `30-${formLabel}` : `10-${formLabel}`,
    });
  }

  if (viewContext.viewName === 'edit') {
    for (const field of viewContext.model?.fields ?? []) {
      const recordLabel = `record.${field.name}`;
      suggestions.push({
        label: recordLabel,
        insertText: recordLabel,
        detail: `${viewContext.resource.name}.edit existing record field`,
        kind: 'value',
        sortText: `20-${recordLabel}`,
      });
    }
  }

  suggestions.push(
    { label: 'user.id', insertText: 'user.id', detail: 'Current user field', kind: 'value', sortText: '40-user.id' },
    { label: 'user.name', insertText: 'user.name', detail: 'Current user field', kind: 'value', sortText: '40-user.name' },
    { label: 'user.email', insertText: 'user.email', detail: 'Current user field', kind: 'value', sortText: '40-user.email' },
    { label: 'user.role', insertText: 'user.role', detail: 'Current user field', kind: 'value', sortText: '40-user.role' },
  );

  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (seen.has(suggestion.label)) {
      return false;
    }
    seen.add(suggestion.label);
    return true;
  }).sort((left, right) => {
    const leftSort = left.sortText ?? left.label;
    const rightSort = right.sortText ?? right.label;
    if (leftSort !== rightSort) {
      return leftSort.localeCompare(rightSort);
    }
    return left.label.localeCompare(right.label);
  });
}

function findViewContextAtPosition(
  ir: IRApp,
  fileName: string,
  line: number,
  col: number,
): { viewName: 'edit' | 'create'; resource: IRResource; model?: IRModel } | undefined {
  const normalizedFile = normalizeFsPath(fileName);
  let matched:
    | {
        viewName: 'edit' | 'create';
        resource: IRResource;
        model?: IRModel;
        sourceSpan: SourceSpan;
      }
    | undefined;

  for (const resource of ir.resources) {
    const model = ir.models.find((entry) => entry.name === resource.model);
    const candidates: Array<{ viewName: 'edit' | 'create'; view: IREditView | IRCreateView | undefined }> = [
      { viewName: 'edit', view: resource.views.edit },
      { viewName: 'create', view: resource.views.create },
    ];

    for (const candidate of candidates) {
      const sourceSpan = candidate.view?.sourceSpan;
      if (!sourceSpan || sourceSpan.file !== normalizedFile || !containsEditingPosition(sourceSpan, line, col)) {
        continue;
      }

      if (!matched || spanSpecificity(sourceSpan) < spanSpecificity(matched.sourceSpan)) {
        matched = {
          viewName: candidate.viewName,
          resource,
          model,
          sourceSpan,
        };
      }
    }
  }

  if (!matched) {
    return undefined;
  }

  return {
    viewName: matched.viewName,
    resource: matched.resource,
    model: matched.model,
  };
}

function inferToastCompletionContext(
  source: string,
  line: number,
  col: number,
): { kind: 'toast-anchor'; indent: number }
  | { kind: 'toast-values-entry'; indent: number }
  | { kind: 'toast-body' | 'toast-value-object' | 'toast-ref' }
  | undefined {
  void col;
  const lines = source.split(/\r?\n/);
  const currentLine = lines[line - 1] ?? '';
  const currentTrimmed = currentLine.trim();
  const currentIndent = leadingSpaceCount(currentLine);
  if (/^- toast:\s*$/.test(currentTrimmed)) {
    return { kind: 'toast-anchor', indent: currentIndent };
  }
  const toastAnchor = findNearestToastAnchor(lines, line - 1, currentIndent);
  if (!toastAnchor) {
    return undefined;
  }

  if (/^ref:\s*/.test(currentTrimmed)) {
    return { kind: 'toast-ref' };
  }

  const valuesLine = findNearestValuesLine(lines, toastAnchor.index, line - 1);
  if (valuesLine && currentIndent > valuesLine.indent) {
    const previousNonEmpty = findPreviousNonEmptyLine(lines, line - 1);
    const valueEntryIndent = valuesLine.indent + 2;
    if (
      currentTrimmed === ''
      && previousNonEmpty
      && currentIndent === valueEntryIndent
      && previousNonEmpty.index >= valuesLine.index
    ) {
      return { kind: 'toast-values-entry', indent: currentIndent };
    }
    if (
      currentTrimmed === ''
      && previousNonEmpty
      && previousNonEmpty.index > valuesLine.index
      && previousNonEmpty.indent > valuesLine.indent
      && /^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(previousNonEmpty.trimmed)
    ) {
      return { kind: 'toast-value-object' };
    }
  }

  if (
    currentTrimmed === ''
    || /^(key|defaultMessage|values):/.test(currentTrimmed)
    || currentIndent > toastAnchor.indent
  ) {
    return { kind: 'toast-body' };
  }

  return undefined;
}

function buildToastDescriptorSnippet(anchorIndent: number, seed: ToastSnippetSeed): string {
  const propertyIndent = ' '.repeat(anchorIndent + 4);
  const valueIndent = ' '.repeat(anchorIndent + 6);
  const refIndent = ' '.repeat(anchorIndent + 8);
  return `\n${propertyIndent}key: \${1:messages.saved}\n${propertyIndent}defaultMessage: "\${2:${escapeSnippetText(seed.messageText)}}"\n${propertyIndent}values:\n${valueIndent}\${3:${escapeSnippetText(seed.valueName)}}:\n${refIndent}ref: \${4:${escapeSnippetText(seed.ref)}}`;
}

function buildToastValueEntrySnippet(currentIndent: number, seed: ToastSnippetSeed): string {
  const refIndent = ' '.repeat(currentIndent + 2);
  return `\${1:${escapeSnippetText(seed.valueName)}}:\n${refIndent}ref: \${2:${escapeSnippetText(seed.ref)}}`;
}

function inferToastSnippetSeed(
  source: string,
  ir: IRApp | undefined,
  fileName: string,
  line: number,
  col: number,
): ToastSnippetSeed {
  let viewContext = ir ? findViewContextAtPosition(ir, fileName, line, col) : undefined;
  if (!viewContext && ir) {
    const fallbackLine = findPreviousSemanticLine(source, line);
    if (fallbackLine) {
      viewContext = findViewContextAtPosition(ir, fileName, fallbackLine, Number.MAX_SAFE_INTEGER);
    }
  }
  if (!viewContext && ir) {
    viewContext = findNearestViewContextBeforeLine(ir, fileName, line);
  }
  const firstField = viewContext?.model?.fields[0]?.name;
  if (firstField) {
    return {
      messageText: viewContext?.viewName === 'create' ? `Created {${firstField}}` : `Saved {${firstField}}`,
      valueName: firstField,
      ref: `form.${firstField}`,
    };
  }

  if (viewContext?.viewName === 'edit') {
    return {
      messageText: 'Saved {id}',
      valueName: 'id',
      ref: 'params.id',
    };
  }

  return {
    messageText: 'Saved {actor}',
    valueName: 'actor',
    ref: 'user.name',
  };
}

function findPreviousSemanticLine(source: string, line: number): number | undefined {
  const lines = source.split(/\r?\n/);
  for (let index = Math.min(line - 2, lines.length - 1); index >= 0; index -= 1) {
    if ((lines[index] ?? '').trim()) {
      return index + 1;
    }
  }
  return undefined;
}

function findNearestViewContextBeforeLine(
  ir: IRApp,
  fileName: string,
  line: number,
): { viewName: 'edit' | 'create'; resource: IRResource; model?: IRModel } | undefined {
  const normalizedFile = normalizeFsPath(fileName);
  let matched:
    | {
        viewName: 'edit' | 'create';
        resource: IRResource;
        model?: IRModel;
        sourceSpan: SourceSpan;
        distance: number;
      }
    | undefined;

  for (const resource of ir.resources) {
    const model = ir.models.find((entry) => entry.name === resource.model);
    const candidates: Array<{ viewName: 'edit' | 'create'; view: IREditView | IRCreateView | undefined }> = [
      { viewName: 'edit', view: resource.views.edit },
      { viewName: 'create', view: resource.views.create },
    ];

    for (const candidate of candidates) {
      const sourceSpan = candidate.view?.sourceSpan;
      if (!sourceSpan || sourceSpan.file !== normalizedFile || sourceSpan.startLine > line) {
        continue;
      }

      const distance = Math.max(line - sourceSpan.endLine, 0);
      if (
        !matched
        || distance < matched.distance
        || (distance === matched.distance && spanSpecificity(sourceSpan) < spanSpecificity(matched.sourceSpan))
      ) {
        matched = {
          viewName: candidate.viewName,
          resource,
          model,
          sourceSpan,
          distance,
        };
      }
    }
  }

  if (!matched) {
    return undefined;
  }

  return {
    viewName: matched.viewName,
    resource: matched.resource,
    model: matched.model,
  };
}

function escapeSnippetText(value: string): string {
  return value.replace(/([$}\\])/g, '\\$1');
}

function findNearestToastAnchor(
  lines: string[],
  startIndex: number,
  currentIndent: number,
): { index: number; indent: number } | undefined {
  for (let index = startIndex; index >= 0; index -= 1) {
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    if (/^- toast:\s*$/.test(trimmed)) {
      return { index, indent: leadingSpaceCount(raw) };
    }

    const indent = leadingSpaceCount(raw);
    if (index !== startIndex && indent < currentIndent && /^-\s+[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) {
      return undefined;
    }
  }

  return undefined;
}

function findNearestValuesLine(
  lines: string[],
  toastIndex: number,
  currentIndex: number,
): { index: number; indent: number } | undefined {
  for (let index = currentIndex; index > toastIndex; index -= 1) {
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === 'values:' || trimmed.startsWith('values: ')) {
      return { index, indent: leadingSpaceCount(raw) };
    }
  }
  return undefined;
}

function findPreviousNonEmptyLine(
  lines: string[],
  startIndex: number,
): { index: number; trimmed: string; indent: number } | undefined {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    return { index, trimmed, indent: leadingSpaceCount(raw) };
  }
  return undefined;
}

function leadingSpaceCount(value: string): number {
  const match = value.match(/^\s*/);
  return match ? match[0].length : 0;
}

function findTextRangeInSpan(
  source: string,
  span: SourceSpan,
  needle: string,
): SourceSpan | undefined {
  const lines = source.split(/\r?\n/);
  for (let lineIndex = span.startLine - 1; lineIndex <= span.endLine - 1; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? '';
    const searchStart = lineIndex === span.startLine - 1 ? Math.max(span.startCol - 1, 0) : 0;
    const searchEnd = lineIndex === span.endLine - 1 ? Math.max(span.endCol - 1, searchStart) : rawLine.length;
    const haystack = rawLine.slice(searchStart, searchEnd);
    const foundAt = haystack.indexOf(needle);
    if (foundAt < 0) {
      continue;
    }
    const startCol = searchStart + foundAt + 1;
    return {
      file: span.file,
      startLine: lineIndex + 1,
      startCol,
      endLine: lineIndex + 1,
      endCol: startCol + needle.length,
    };
  }
  return undefined;
}

function canReachImportedFile(
  entryFile: string,
  targetFile: string,
  readText: (fileName: string) => string | null,
  listFiles?: (directory: string) => string[],
): boolean {
  const stack = [entryFile];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const currentSource = readText(current);
    if (!currentSource) {
      continue;
    }

    const parsed = parse(currentSource, current);
    const imports = resolveImportedFiles(current, parsed.ast.imports, listFiles);
    if (imports.includes(targetFile)) {
      return true;
    }

    for (const imported of imports) {
      if (!visited.has(imported)) {
        stack.push(imported);
      }
    }
  }

  return false;
}

function resolveImportedFiles(
  fileName: string,
  imports: string[],
  listFiles?: (directory: string) => string[],
): string[] {
  const resolvedImports: string[] = [];

  for (const rawImport of imports) {
    if (rawImport.endsWith('/')) {
      if (!listFiles) {
        continue;
      }
      const directory = normalizeFsPath(join(dirname(fileName), rawImport)).replace(/\/+$/, '') || '.';
      const directoryEntries = listFiles(directory)
        .map((entry) => normalizeFsPath(entry))
        .filter((entry) => normalizeFsPath(dirname(entry)) === directory && isRdslSourceFile(entry))
        .sort((left, right) => left.localeCompare(right));
      resolvedImports.push(...directoryEntries);
      continue;
    }

    if (isRdslImportPath(rawImport) && !rawImport.endsWith('/')) {
      resolvedImports.push(normalizeFsPath(join(dirname(fileName), rawImport)));
    }
  }

  return Array.from(new Set(resolvedImports));
}

export function listDirectoryEntries(
  directory: string,
  snapshots: Map<string, string>,
): string[] {
  const normalizedDirectory = normalizeFsPath(directory);
  const entries = new Set<string>();

  for (const fileName of snapshots.keys()) {
    if (normalizeFsPath(dirname(fileName)) === normalizedDirectory) {
      entries.add(normalizeFsPath(fileName));
    }
  }

  if (existsSync(normalizedDirectory)) {
    for (const entry of readdirSync(normalizedDirectory)) {
      entries.add(normalizeFsPath(join(normalizedDirectory, entry)));
    }
  }

  return Array.from(entries).sort((left, right) => left.localeCompare(right));
}

function pathDistance(baseDir: string, targetFile: string): number {
  const normalizedBase = normalizeFsPath(baseDir).replace(/\/+$/, '');
  const normalizedTarget = normalizeFsPath(targetFile);
  if (!normalizedTarget.startsWith(`${normalizedBase}/`)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return normalizedTarget.slice(normalizedBase.length + 1).split('/').length;
}

function buildDiagnostic(
  error: CompileIssueLike,
  severity: ProjectDiagnostic['severity'],
  fallbackFile: string,
  nodeSpans: Map<string, SourceSpan[]>,
  nodeSpanUsage: Map<string, number>,
): ProjectDiagnostic {
  const nodeSpan = error.nodeId ? takeNextNodeSpan(error.nodeId, nodeSpans, nodeSpanUsage) : undefined;
  const file = normalizeFsPath(error.file ?? nodeSpan?.file ?? fallbackFile);
  const range = error.line
    ? {
        file,
        startLine: error.line,
        startCol: error.col ?? 1,
        endLine: error.line,
        endCol: (error.col ?? 1) + 1,
      }
    : nodeSpan
      ? { ...nodeSpan, file }
      : {
          file,
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 2,
        };

  return {
    file,
    severity,
    message: `[${error.phase}] ${error.message}`,
    phase: error.phase,
    nodeId: error.nodeId,
    range,
  };
}

function compareProjectDiagnostics(left: ProjectDiagnostic, right: ProjectDiagnostic): number {
  return compareSeverity(left.severity, right.severity)
    || left.file.localeCompare(right.file)
    || left.range.startLine - right.range.startLine
    || left.range.startCol - right.range.startCol
    || left.message.localeCompare(right.message);
}

function compareSeverity(
  left: ProjectDiagnostic['severity'],
  right: ProjectDiagnostic['severity'],
): number {
  const severityRank = (value: ProjectDiagnostic['severity']) => value === 'error' ? 0 : 1;
  return severityRank(left) - severityRank(right);
}

function normalizeIssueMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function indexIrNodeSpans(ir: IRApp | undefined): Map<string, SourceSpan[]> {
  const spans = new Map<string, SourceSpan[]>();
  if (!ir) return spans;

  const visit = (node: IRNode) => {
    if (node.sourceSpan) {
      const existing = spans.get(node.id);
      if (existing) {
        existing.push(node.sourceSpan);
      } else {
        spans.set(node.id, [node.sourceSpan]);
      }
    }
  };

  visit(ir);

  for (const group of ir.navigation) {
    visit(group);
    for (const item of group.items) {
      visit(item);
    }
  }

  for (const model of ir.models) {
    visit(model);
    for (const field of model.fields) {
      visit(field);
    }
  }

  for (const resource of ir.resources) {
    visit(resource);
    visitResourceView(resource.views.list, visit);
    visitResourceView(resource.views.edit, visit);
    visitResourceView(resource.views.create, visit);
  }

  for (const page of ir.pages) {
    visit(page);
    for (const block of page.blocks) {
      visit(block);
    }
  }

  return spans;
}

function takeNextNodeSpan(
  nodeId: string,
  nodeSpans: Map<string, SourceSpan[]>,
  nodeSpanUsage: Map<string, number>,
): SourceSpan | undefined {
  const spans = nodeSpans.get(nodeId);
  if (!spans || spans.length === 0) return undefined;

  const index = nodeSpanUsage.get(nodeId) ?? 0;
  nodeSpanUsage.set(nodeId, index + 1);
  return spans[Math.min(index, spans.length - 1)];
}

function visitResourceView(
  view: IRListView | IREditView | IRCreateView | undefined,
  visit: (node: IRNode) => void,
): void {
  if (!view) return;

  visit(view);

  if ('filters' in view) {
    for (const filter of view.filters) {
      visit(filter);
    }
  }
  if ('columns' in view) {
    for (const column of view.columns) {
      visit(column);
    }
  }
  if ('actions' in view) {
    for (const action of view.actions) {
      visit(action);
    }
  }
  if ('fields' in view) {
    for (const field of view.fields) {
      visit(field);
    }
  }
}

function containsPosition(span: SourceSpan, line: number, col: number): boolean {
  if (line < span.startLine || line > span.endLine) return false;
  if (line === span.startLine && col < span.startCol) return false;
  if (line === span.endLine && col >= span.endCol) return false;
  return true;
}

function containsEditingPosition(span: SourceSpan, line: number, col: number): boolean {
  if (containsPosition(span, line, col)) {
    return true;
  }
  if (line !== span.endLine || line < span.startLine || line > span.endLine) {
    return false;
  }
  if (line === span.startLine && col < span.startCol) {
    return false;
  }
  return true;
}

function spanSpecificity(span: SourceSpan): number {
  const lineSpan = Math.max(span.endLine - span.startLine, 0);
  const colSpan = Math.max(span.endCol - span.startCol, 0);
  return lineSpan * 100000 + colSpan;
}
