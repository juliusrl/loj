import { generate } from './codegen.js';
import { normalize } from './normalize.js';
import { parse } from './parser.js';
import { validate } from './validator.js';
import {
  dirnameProjectPath,
  normalizeProjectPath,
  resolveProjectPath,
} from './project-paths.js';
import {
  CANONICAL_SDSL_SOURCE_SUFFIX,
  describeSdslSourceSuffixes,
  isSdslImportPath,
  isSdslSourceFile,
  LEGACY_SDSL_SOURCE_SUFFIX,
  SDSL_SOURCE_SUFFIXES,
  stripSdslSourceSuffix,
} from './source-files.js';
import {
  BACKEND_TARGET_DESCRIPTORS,
  DEFAULT_BACKEND_TARGET,
  composeBackendTargetKey,
  describeBackendTargetDescriptor,
  formatBackendTargetTriple,
  getBackendTargetDescriptor,
  listImplementedBackendTargetTriples,
  listKnownBackendTargetTriples,
  listKnownBackendTargets,
  resolveBackendCompilerInput,
} from './targets.js';
import type { GeneratedFile } from './codegen.js';
import type { NormalizeError } from './normalize.js';
import type { IRSdslProgram } from './ir.js';
import type { ParseError, RawAST } from './parser.js';
import type { ValidationIssue } from './validator.js';

export type { IRSdslProgram } from './ir.js';
export type {
  ParseError,
  ParseResult,
  RawAST,
  RawApp,
  RawCompiler,
  RawDecorator,
  RawModel,
  RawModelField,
  RawReadModel,
  RawResource,
  RawResourceAuth,
  RawResourceOperations,
} from './parser.js';
export type { GeneratedFile } from './codegen.js';
export type { NormalizeError, NormalizeOptions, NormalizeResult } from './normalize.js';
export type { ValidateResult, ValidationIssue } from './validator.js';
export type {
  BackendCompilerInput,
  BackendLanguage,
  BackendProfile,
  BackendTarget,
  BackendTargetDescriptor,
  BackendTargetKey,
  ResolvedBackendCompilerInput,
} from './targets.js';
export { generate } from './codegen.js';
export { normalize } from './normalize.js';
export { parse, parseDecorators } from './parser.js';
export {
  buildRulesManifestFileName,
  countRulesEntries,
  compileRulesSource,
  isRulesSourceFile,
} from './rules-proof.js';
export {
  buildFlowManifestFileName,
  compileFlowSource,
  isFlowSourceFile,
} from './flow-proof.js';
export {
  BACKEND_TARGET_DESCRIPTORS,
  DEFAULT_BACKEND_TARGET,
  composeBackendTargetKey,
  describeBackendTargetDescriptor,
  formatBackendTargetTriple,
  getBackendTargetDescriptor,
  listImplementedBackendTargetTriples,
  listKnownBackendTargetTriples,
  listKnownBackendTargets,
  resolveBackendCompilerInput,
} from './targets.js';
export { validate } from './validator.js';
export {
  CANONICAL_SDSL_SOURCE_SUFFIX,
  LEGACY_SDSL_SOURCE_SUFFIX,
  SDSL_SOURCE_SUFFIXES,
  describeSdslSourceSuffixes,
  isSdslImportPath,
  isSdslSourceFile,
  stripSdslSourceSuffix,
} from './source-files.js';
export type {
  FlowCompileError,
  FlowCompileResult,
  FlowManifest,
  FlowProgram,
} from './flow-proof.js';
export type {
  RulesCompileError,
  RulesCompileResult,
  RulesDerivationEntry,
  RulesEligibilityEntry,
  RulesEntry,
  RulesManifest,
  RulesMessage,
  RulesMessageDescriptor,
  RulesProgram,
  RulesValidationEntry,
} from './rules-proof.js';

export interface CompileError {
  phase: 'parse' | 'normalize' | 'validate' | 'codegen';
  message: string;
  file?: string;
  line?: number;
  col?: number;
  nodeId?: string;
}

export interface CompileProjectOptions {
  entryFile: string;
  projectRoot?: string;
  readFile: (fileName: string) => string;
  listFiles?: (directory: string) => string[];
}

export interface CompileResult {
  success: boolean;
  ast?: RawAST;
  ir?: IRSdslProgram;
  files: GeneratedFile[];
  errors: CompileError[];
  warnings: CompileError[];
  sourceFiles: string[];
  moduleGraph: Record<string, string[]>;
  hostFiles: string[];
}

interface LoadedProject {
  ast?: RawAST;
  sourceFiles: string[];
  moduleGraph: Record<string, string[]>;
  errors: CompileError[];
}

export function compile(source: string, fileName: string = `app${CANONICAL_SDSL_SOURCE_SUFFIX}`): CompileResult {
  const entryFile = normalizeProjectPath(fileName);
  return compileProject({
    entryFile,
    readFile(requestedFile) {
      if (normalizeProjectPath(requestedFile) !== entryFile) {
        throw new Error(`Imported file not available in single-file compile: ${requestedFile}`);
      }
      return source;
    },
  });
}

export function compileProject(options: CompileProjectOptions): CompileResult {
  const loaded = loadProject(options);
  if (loaded.errors.length > 0 || !loaded.ast) {
    return {
      success: false,
      files: [],
      errors: loaded.errors,
      warnings: [],
      sourceFiles: loaded.sourceFiles,
      moduleGraph: loaded.moduleGraph,
      hostFiles: [],
    };
  }

  const normalized = normalize(loaded.ast, {
    entryFile: normalizeProjectPath(options.entryFile),
    sourceFiles: loaded.sourceFiles,
    moduleGraph: loaded.moduleGraph,
    projectRoot: options.projectRoot
      ? normalizeProjectPath(options.projectRoot)
      : dirnameProjectPath(normalizeProjectPath(options.entryFile)),
    readFile(fileName) {
      try {
        return options.readFile(fileName);
      } catch {
        return undefined;
      }
    },
  });
  if (normalized.errors.length > 0 || !normalized.ir) {
    return {
      success: false,
      ast: loaded.ast,
      files: [],
      errors: normalized.errors.map(normalizeErrorToCompileError),
      warnings: [],
      sourceFiles: loaded.sourceFiles,
      moduleGraph: loaded.moduleGraph,
      hostFiles: [],
    };
  }

  const validation = validate(normalized.ir);
  const hostFiles = collectBackendHostFiles(normalized.ir);
  const validationErrors = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map(validationIssueToCompileError);
  const validationWarnings = validation.issues
    .filter((issue) => issue.severity === 'warning')
    .map(validationIssueToCompileError);
  if (validationErrors.length > 0) {
    return {
      success: false,
      ast: loaded.ast,
      ir: normalized.ir,
      files: [],
      errors: validationErrors,
      warnings: validationWarnings,
      sourceFiles: loaded.sourceFiles,
      moduleGraph: loaded.moduleGraph,
      hostFiles,
    };
  }

  try {
    const codegen = generate(normalized.ir, {
      readFile(fileName) {
        return options.readFile(fileName);
      },
    });
    return {
      success: true,
      ast: loaded.ast,
      ir: normalized.ir,
      files: codegen.files,
      errors: [],
      warnings: validationWarnings,
      sourceFiles: loaded.sourceFiles,
      moduleGraph: loaded.moduleGraph,
      hostFiles,
    };
  } catch (error) {
    return {
      success: false,
      ast: loaded.ast,
      ir: normalized.ir,
      files: [],
      errors: [{
        phase: 'codegen',
        message: error instanceof Error ? error.message : String(error),
      }],
      warnings: validationWarnings,
      sourceFiles: loaded.sourceFiles,
      moduleGraph: loaded.moduleGraph,
      hostFiles,
    };
  }
}

function normalizeErrorToCompileError(error: NormalizeError): CompileError {
  return {
    phase: 'normalize',
    message: error.message,
    nodeId: error.nodeId,
  };
}

function validationIssueToCompileError(issue: ValidationIssue): CompileError {
  return {
    phase: 'validate',
    message: issue.message,
    nodeId: issue.nodeId,
  };
}

function parseErrorsToCompileErrors(errors: ParseError[]): CompileError[] {
  return errors.map((error) => ({
    phase: 'parse',
    message: error.message,
    file: error.file,
    line: error.line,
    col: error.col,
  }));
}

function collectBackendHostFiles(ir: IRSdslProgram): string[] {
  return Array.from(new Set([
    ...ir.resources
      .map((resource) => resource.auth.policy?.resolvedPath)
      .filter((value): value is string => Boolean(value)),
    ...ir.resources
      .map((resource) => resource.create?.rules?.resolvedPath)
      .filter((value): value is string => Boolean(value)),
    ...ir.resources
      .map((resource) => resource.workflow?.resolvedPath)
      .filter((value): value is string => Boolean(value)),
    ...ir.readModels.map((readModel) => readModel.handler.resolvedPath),
    ...ir.readModels
      .map((readModel) => readModel.rules?.resolvedPath)
      .filter((value): value is string => Boolean(value)),
  ])).sort((left, right) => left.localeCompare(right));
}

function loadProject(options: CompileProjectOptions): LoadedProject {
  const entryFile = normalizeProjectPath(options.entryFile);
  const sourceUnits = new Map<string, RawAST>();
  const sourceFiles: string[] = [];
  const moduleGraph: Record<string, string[]> = {};
  const errors: CompileError[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  visitFile(entryFile, true, options, sourceUnits, sourceFiles, moduleGraph, errors, visiting, visited);
  if (errors.length > 0) {
    return {
      sourceFiles,
      moduleGraph,
      errors,
    };
  }

  const entryAst = sourceUnits.get(entryFile);
  if (!entryAst) {
    return {
      sourceFiles,
      moduleGraph,
      errors: [{
        phase: 'parse',
        message: `Entry file did not produce an AST: ${entryFile}`,
        file: entryFile,
      }],
    };
  }

  return {
    ast: mergeSourceUnits(entryFile, sourceFiles, sourceUnits),
    sourceFiles,
    moduleGraph,
    errors,
  };
}

function visitFile(
  fileName: string,
  isEntry: boolean,
  options: CompileProjectOptions,
  sourceUnits: Map<string, RawAST>,
  sourceFiles: string[],
  moduleGraph: Record<string, string[]>,
  errors: CompileError[],
  visiting: string[],
  visited: Set<string>,
): void {
  if (visited.has(fileName)) {
    return;
  }
  const cycleIndex = visiting.indexOf(fileName);
  if (cycleIndex >= 0) {
    const importChain = [...visiting.slice(cycleIndex), fileName].join(' -> ');
    errors.push({
      phase: 'parse',
      message: `Import cycle detected: ${importChain}`,
      file: fileName,
    });
    return;
  }

  visiting.push(fileName);
  sourceFiles.push(fileName);

  let source: string;
  try {
    source = options.readFile(fileName);
  } catch (error) {
    errors.push({
      phase: 'parse',
      message: `Failed to read source file: ${error instanceof Error ? error.message : String(error)}`,
      file: fileName,
    });
    visiting.pop();
    return;
  }

  const parsed = parse(source, fileName);
  if (parsed.errors.length > 0) {
    errors.push(...parseErrorsToCompileErrors(parsed.errors));
    visiting.pop();
    return;
  }
  if (!isEntry && (parsed.ast.app || parsed.ast.compiler)) {
    errors.push({
      phase: 'parse',
      message: `Imported ${describeSdslSourceSuffixes()} modules may not define app or compiler blocks`,
      file: fileName,
    });
    visiting.pop();
    return;
  }

  sourceUnits.set(fileName, parsed.ast);
  const resolvedImports = resolveImports(fileName, parsed.ast.imports, options, errors);
  moduleGraph[fileName] = resolvedImports;
  if (errors.length > 0) {
    visiting.pop();
    return;
  }

  for (const importedFile of resolvedImports) {
    visitFile(importedFile, false, options, sourceUnits, sourceFiles, moduleGraph, errors, visiting, visited);
  }

  visiting.pop();
  visited.add(fileName);
}

function resolveImports(
  fromFile: string,
  imports: string[],
  options: CompileProjectOptions,
  errors: CompileError[],
): string[] {
  const resolved: string[] = [];
  const fromDir = dirnameProjectPath(fromFile);
  for (const importPath of imports) {
    if (importPath.endsWith('/')) {
      const directory = resolveProjectPath(fromDir, importPath);
      if (!options.listFiles) {
        errors.push({
          phase: 'parse',
          message: `Directory imports require listFiles(): ${importPath}`,
          file: fromFile,
        });
        continue;
      }
      const childFiles = options.listFiles(directory)
        .map((fileName) => normalizeProjectPath(fileName))
        .filter((fileName) => isDirectChild(directory, fileName) && isSdslSourceFile(fileName))
        .sort((left, right) => left.localeCompare(right));
      resolved.push(...childFiles);
      continue;
    }
    if (!isSdslImportPath(importPath)) {
      errors.push({
        phase: 'parse',
        message: `Import path "${importPath}" must reference a ${describeSdslSourceSuffixes()} file or a directory ending with /`,
        file: fromFile,
      });
      continue;
    }
    resolved.push(resolveProjectPath(fromDir, importPath));
  }
  return resolved;
}

function isDirectChild(directory: string, fileName: string): boolean {
  const normalizedDirectory = normalizeProjectPath(directory).replace(/\/+$/, '');
  if (!fileName.startsWith(`${normalizedDirectory}/`)) {
    return false;
  }
  const remainder = fileName.slice(normalizedDirectory.length + 1);
  return !remainder.includes('/');
}

function mergeSourceUnits(
  entryFile: string,
  sourceFiles: string[],
  sourceUnits: Map<string, RawAST>,
): RawAST {
  const entryAst = sourceUnits.get(entryFile)!;
  const merged: RawAST = {
    app: entryAst.app,
    compiler: entryAst.compiler,
    imports: [...entryAst.imports],
    models: [],
    resources: [],
    readModels: [],
  };

  for (const fileName of sourceFiles) {
    const ast = sourceUnits.get(fileName);
    if (!ast) continue;
    merged.models.push(...ast.models);
    merged.resources.push(...ast.resources);
    merged.readModels.push(...ast.readModels);
  }

  return merged;
}
