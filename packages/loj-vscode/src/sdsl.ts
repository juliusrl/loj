import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  compileProject,
  parse,
  isSdslImportPath,
  isSdslSourceFile,
} from '@loj-lang/sdsl-compiler';
import type { CompileResult, RawAST } from '@loj-lang/sdsl-compiler';
import type {
  IRAppConfig,
  IRCompilerConfig,
  IRFieldType,
  IRModel,
  IRModelField,
  IRNode,
  IRResource,
  IRResourceAuth,
  IRResourceOperations,
  IRSdslProgram,
  SourceSpan,
} from '@loj-lang/sdsl-compiler/ir';
import {
  listDirectoryEntries,
  normalizeFsPath,
  type CompileIssueLike,
  type DocumentSnapshot,
  type ProjectDiagnostic,
} from './core.js';

export type SdslSemanticNode =
  | IRSdslProgram
  | IRAppConfig
  | IRCompilerConfig
  | IRModel
  | IRModelField
  | IRResource
  | IRResourceAuth
  | IRResourceOperations;

export type SdslSemanticAssistResult = CompileResult & {
  success: true;
  ir: NonNullable<CompileResult['ir']>;
};

export interface SdslSemanticAssistSelection {
  result: CompileResult;
  usingFallback: boolean;
}

export function containsSdslAppBlock(source: string): boolean {
  return /^\s*app\s*:/m.test(source);
}

export function compileSdslProjectState(
  entryFile: string,
  snapshots: Map<string, string>,
): CompileResult {
  return compileProject({
    entryFile: normalizeFsPath(entryFile),
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

export function canUseSdslSemanticAssistResult(result: CompileResult | undefined): result is SdslSemanticAssistResult {
  return Boolean(result?.success && result.ir);
}

export function selectSdslSemanticAssistResult(
  currentResult: CompileResult,
  lastSuccessfulResult?: CompileResult,
): SdslSemanticAssistSelection {
  if (canUseSdslSemanticAssistResult(currentResult)) {
    return { result: currentResult, usingFallback: false };
  }
  if (canUseSdslSemanticAssistResult(lastSuccessfulResult)) {
    return { result: lastSuccessfulResult, usingFallback: true };
  }
  return { result: currentResult, usingFallback: false };
}

export function findSdslProjectEntry(
  fileName: string,
  candidateEntries: string[],
  readText: (fileName: string) => string | null,
  listFiles?: (directory: string) => string[],
): string | null {
  const normalizedFile = normalizeFsPath(fileName);
  const currentSource = readText(normalizedFile);
  if (currentSource && containsSdslAppBlock(currentSource)) {
    return normalizedFile;
  }

  const uniqueCandidates = Array.from(new Set(candidateEntries.map(normalizeFsPath)))
    .filter((candidate) => candidate !== normalizedFile)
    .sort((left, right) => compareCandidatePriority(left, right, normalizedFile));

  for (const candidate of uniqueCandidates) {
    const candidateSource = readText(candidate);
    if (!candidateSource || !containsSdslAppBlock(candidateSource)) {
      continue;
    }

    const parsed = parse(candidateSource, candidate);
    if (!parsed.ast.app) {
      continue;
    }

    if (canReachImportedFile(candidate, normalizedFile, readText, listFiles)) {
      return candidate;
    }
  }

  return null;
}

export function collectSdslCompileDiagnostics(
  result: CompileResult,
  fallbackFile: string,
): Map<string, ProjectDiagnostic[]> {
  const diagnostics = new Map<string, ProjectDiagnostic[]>();
  const nodeSpans = mergeNodeSpanIndexes(
    indexSdslNodeSpans(result.ir),
    indexSdslAstNodeSpans(result.ast),
  );
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
    for (const diagnostic of buildDiagnostics(error, 'error', fallbackFile, nodeSpans, nodeSpanUsage)) {
      addDiagnostic(diagnostic);
    }
  }
  for (const warning of result.warnings) {
    for (const diagnostic of buildDiagnostics(warning, 'warning', fallbackFile, nodeSpans, nodeSpanUsage)) {
      addDiagnostic(diagnostic);
    }
  }

  return diagnostics;
}

export function findMostSpecificSdslNode(
  ir: IRSdslProgram,
  fileName: string,
  line: number,
  col: number,
): SdslSemanticNode | undefined {
  const normalizedFile = normalizeFsPath(fileName);
  return listSdslNodes(ir)
    .filter((node) => node.sourceSpan && node.sourceSpan.file === normalizedFile && containsPosition(node.sourceSpan, line, col))
    .sort((left, right) => spanSpecificity(left.sourceSpan!) - spanSpecificity(right.sourceSpan!))[0];
}

export function sdslNodeInspectionToLines(node: SdslSemanticNode): string[] {
  switch (node.kind) {
    case 'program':
      return [
        `schema version: ${node.schemaVersion}`,
        `entry file: ${node.entryFile}`,
        `source files: ${node.sourceFiles.length}`,
        `models: ${node.models.length}`,
        `resources: ${node.resources.length}`,
      ];
    case 'app':
      return [
        `name: ${node.name}`,
        `package: ${node.packageName}`,
      ];
    case 'compiler':
      return [
        `target: ${node.target}`,
        `language: ${node.language}`,
        `profile: ${node.profile}`,
      ];
    case 'model':
      return [
        `name: ${node.name}`,
        `fields: ${node.fields.length}`,
      ];
    case 'field':
      return [
        `name: ${node.name}`,
        `type: ${formatFieldType(node.fieldType)}`,
        `decorators: ${node.decorators.length > 0 ? node.decorators.map((decorator) => `@${decorator.name}${decorator.args ? `(${decorator.args.join(', ')})` : ''}`).join(', ') : 'none'}`,
      ];
    case 'resource':
      return [
        `name: ${node.name}`,
        `model: ${node.model}`,
        `api: ${node.api}`,
      ];
    case 'resource.auth':
      return [
        `mode: ${node.mode}`,
        `roles: ${node.roles.length > 0 ? node.roles.join(', ') : 'none'}`,
      ];
    case 'resource.operations': {
      const enabled = [
        node.list ? 'list' : undefined,
        node.get ? 'get' : undefined,
        node.create ? 'create' : undefined,
        node.update ? 'update' : undefined,
        node.delete ? 'delete' : undefined,
      ].filter((value): value is string => Boolean(value));
      return [
        `enabled: ${enabled.length > 0 ? enabled.join(', ') : 'none'}`,
      ];
    }
  }

  return [];
}

export function createSdslSnapshotMap(documents: Iterable<DocumentSnapshot>): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const document of documents) {
    snapshots.set(normalizeFsPath(document.fileName), document.text);
  }
  return snapshots;
}

function formatFieldType(fieldType: IRFieldType): string {
  if (fieldType.type === 'scalar') {
    return fieldType.name;
  }
  if (fieldType.type === 'enum') {
    return `enum(${fieldType.values.join(', ')})`;
  }
  return fieldType.kind === 'hasMany'
    ? `hasMany(${fieldType.target}, by: ${fieldType.by})`
    : `belongsTo(${fieldType.target})`;
}

function listSdslNodes(ir: IRSdslProgram): SdslSemanticNode[] {
  const nodes: SdslSemanticNode[] = [
    ir,
    ir.app,
    ir.compiler,
  ];

  for (const model of ir.models) {
    nodes.push(model);
    nodes.push(...model.fields);
  }

  for (const resource of ir.resources) {
    nodes.push(resource);
    nodes.push(resource.auth);
    nodes.push(resource.operations);
  }

  return nodes;
}

function indexSdslNodeSpans(ir: IRSdslProgram | undefined): Map<string, SourceSpan[]> {
  const spans = new Map<string, SourceSpan[]>();
  if (!ir) {
    return spans;
  }

  for (const node of listSdslNodes(ir)) {
    if (!node.sourceSpan) {
      continue;
    }
    const existing = spans.get(node.id);
    if (existing) {
      existing.push(node.sourceSpan);
    } else {
      spans.set(node.id, [node.sourceSpan]);
    }
  }

  return spans;
}

function indexSdslAstNodeSpans(ast: RawAST | undefined): Map<string, SourceSpan[]> {
  const spans = new Map<string, SourceSpan[]>();
  if (!ast) {
    return spans;
  }

  if (ast.app?.sourceSpan) {
    spans.set('app', [ast.app.sourceSpan]);
  }
  if (ast.compiler?.sourceSpan) {
    spans.set('compiler', [ast.compiler.sourceSpan]);
  }

  for (const model of ast.models) {
    if (model.sourceSpan) {
      addNodeSpan(spans, `model.${model.name}`, model.sourceSpan);
    }
    for (const field of model.fields) {
      if (field.sourceSpan) {
        addNodeSpan(spans, `model.${model.name}.field.${field.name}`, field.sourceSpan);
      }
    }
  }

  for (const resource of ast.resources) {
    if (resource.sourceSpan) {
      addNodeSpan(spans, `resource.${resource.name}`, resource.sourceSpan);
    }
    if (resource.auth?.sourceSpan) {
      addNodeSpan(spans, `resource.${resource.name}.auth`, resource.auth.sourceSpan);
    }
    if (resource.operations?.sourceSpan) {
      addNodeSpan(spans, `resource.${resource.name}.operations`, resource.operations.sourceSpan);
    }
  }

  return spans;
}

function mergeNodeSpanIndexes(...indexes: Array<Map<string, SourceSpan[]>>): Map<string, SourceSpan[]> {
  const merged = new Map<string, SourceSpan[]>();
  for (const index of indexes) {
    for (const [nodeId, spans] of index.entries()) {
      const bucket = merged.get(nodeId);
      if (bucket) {
        bucket.push(...spans);
      } else {
        merged.set(nodeId, [...spans]);
      }
    }
  }
  return merged;
}

function addNodeSpan(index: Map<string, SourceSpan[]>, nodeId: string, sourceSpan: SourceSpan): void {
  const existing = index.get(nodeId);
  if (existing) {
    existing.push(sourceSpan);
  } else {
    index.set(nodeId, [sourceSpan]);
  }
}

function buildDiagnostics(
  error: CompileIssueLike,
  severity: ProjectDiagnostic['severity'],
  fallbackFile: string,
  nodeSpans: Map<string, SourceSpan[]>,
  nodeSpanUsage: Map<string, number>,
): ProjectDiagnostic[] {
  const explicitRange = error.line
    ? {
        file: normalizeFsPath(error.file ?? fallbackFile),
        startLine: error.line,
        startCol: error.col ?? 1,
        endLine: error.line,
        endCol: (error.col ?? 1) + 1,
      }
    : undefined;
  if (explicitRange) {
    return [{
      file: explicitRange.file,
      severity,
      message: `[${error.phase}] ${error.message}`,
      phase: error.phase,
      nodeId: error.nodeId,
      range: explicitRange,
    }];
  }

  const spans = error.nodeId ? nodeSpans.get(error.nodeId) ?? [] : [];
  if (!error.file && spans.length > 1) {
    return spans.map((sourceSpan) => ({
      file: normalizeFsPath(sourceSpan.file),
      severity,
      message: `[${error.phase}] ${error.message}`,
      phase: error.phase,
      nodeId: error.nodeId,
      range: {
        ...sourceSpan,
        file: normalizeFsPath(sourceSpan.file),
      },
    }));
  }

  const nodeSpan = error.nodeId ? takeNextNodeSpan(error.nodeId, nodeSpans, nodeSpanUsage) : undefined;
  const file = normalizeFsPath(error.file ?? nodeSpan?.file ?? fallbackFile);
  const range = nodeSpan
    ? { ...nodeSpan, file }
    : {
        file,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 2,
      };

  return [{
    file,
    severity,
    message: `[${error.phase}] ${error.message}`,
    phase: error.phase,
    nodeId: error.nodeId,
    range,
  }];
}

function takeNextNodeSpan(
  nodeId: string,
  nodeSpans: Map<string, SourceSpan[]>,
  nodeSpanUsage: Map<string, number>,
): SourceSpan | undefined {
  const spans = nodeSpans.get(nodeId);
  if (!spans || spans.length === 0) {
    return undefined;
  }
  const usage = nodeSpanUsage.get(nodeId) ?? 0;
  nodeSpanUsage.set(nodeId, usage + 1);
  return spans[Math.min(usage, spans.length - 1)];
}

function containsPosition(span: SourceSpan, line: number, col: number): boolean {
  if (line < span.startLine || line > span.endLine) {
    return false;
  }
  if (line === span.startLine && col < span.startCol) {
    return false;
  }
  if (line === span.endLine && col > span.endCol) {
    return false;
  }
  return true;
}

function spanSpecificity(span: SourceSpan): number {
  return ((span.endLine - span.startLine) * 10_000) + (span.endCol - span.startCol);
}

function compareCandidatePriority(left: string, right: string, targetFile: string): number {
  const leftDistance = pathDistance(dirname(left), targetFile);
  const rightDistance = pathDistance(dirname(right), targetFile);
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  return left.localeCompare(right);
}

function pathDistance(baseDir: string, targetFile: string): number {
  const normalizedBase = normalizeFsPath(baseDir).replace(/\/+$/, '');
  const normalizedTarget = normalizeFsPath(targetFile);
  if (!normalizedTarget.startsWith(`${normalizedBase}/`)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return normalizedTarget.slice(normalizedBase.length + 1).split('/').length;
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
        .filter((entry) => normalizeFsPath(dirname(entry)) === directory && isSdslSourceFile(entry))
        .sort((left, right) => left.localeCompare(right));
      resolvedImports.push(...directoryEntries);
      continue;
    }

    if (isSdslImportPath(rawImport) && !rawImport.endsWith('/')) {
      resolvedImports.push(normalizeFsPath(join(dirname(fileName), rawImport)));
    }
  }

  return Array.from(new Set(resolvedImports));
}
