/**
 * ReactDSL Compiler — Main Entry Point
 *
 * Pipeline: Source → Parse → Normalize → Validate → Generate → Manifest
 */

import { parse } from './parser.js';
import { normalize } from './normalize.js';
import { validate } from './validator.js';
import { generate } from './codegen.js';
import { buildDependencyGraph, diffDependencyGraphs } from './dependency-graph.js';
import { buildManifestArtifacts, buildSemanticManifest, buildTraceManifest } from './manifest.js';
import type { IRApp } from './ir.js';
import type { CodegenCacheSnapshot, GeneratedFile } from './codegen.js';
import type { DependencyGraphSnapshot } from './dependency-graph.js';
import type { ManifestCacheSnapshot, SemanticManifest, TraceManifest } from './manifest.js';
import type {
  RawAST,
  RawModel,
  RawPage,
  RawReadModel,
  RawResource,
} from './parser.js';
import type { NormalizeCacheSnapshot } from './normalize.js';
import type { ValidationCacheSnapshot } from './validator.js';
import {
  dirnameProjectPath,
  normalizeProjectPath,
  resolveProjectPath,
} from './project-paths.js';
import {
  CANONICAL_RDSL_SOURCE_SUFFIX,
  describeRdslSourceSuffixes,
  isRdslImportPath,
  isRdslSourceFile,
  LEGACY_RDSL_SOURCE_SUFFIX,
  RDSL_SOURCE_SUFFIXES,
  stripRdslSourceSuffix,
} from './source-files.js';

export {
  CANONICAL_RDSL_SOURCE_SUFFIX,
  LEGACY_RDSL_SOURCE_SUFFIX,
  RDSL_SOURCE_SUFFIXES,
  describeRdslSourceSuffixes,
  isRdslImportPath,
  isRdslSourceFile,
  stripRdslSourceSuffix,
} from './source-files.js';

export interface CompileResult {
  success: boolean;
  ir?: IRApp;
  files: GeneratedFile[];
  errors: CompileError[];
  warnings: CompileError[];
  /** Structured semantic manifest for agent handoff */
  semanticManifest?: SemanticManifest;
  /** Structured trace manifest for generated-file lookup */
  traceManifest?: TraceManifest;
  /** JSON-serialized semantic manifest */
  manifest?: string;
}

export interface CompileError {
  phase: 'parse' | 'normalize' | 'validate' | 'codegen';
  message: string;
  nodeId?: string;
  file?: string;
  line?: number;
  col?: number;
}

export interface CompileProjectOptions {
  entryFile: string;
  projectRoot?: string;
  readFile: (fileName: string) => string;
  listFiles?: (directory: string) => string[];
  cache?: ProjectCache;
  changedFiles?: Iterable<string>;
}

interface LoadedProject {
  ast: RawAST;
  entryFile: string;
  sourceFiles: string[];
  scanDirectories: string[];
  moduleGraph: Record<string, string[]>;
  errors: CompileError[];
  sourceUnits: Map<string, RawAST>;
}

interface CachedProjectUnit {
  ast: RawAST | null;
  errors: CompileError[];
  sourceText: string;
}

export interface ProjectGraphSnapshot {
  entryFile: string;
  sourceFiles: string[];
  scanDirectories: string[];
  moduleGraph: Record<string, string[]>;
  hasErrors: boolean;
}

interface CachedProjectGraph extends ProjectGraphSnapshot {
  ast: RawAST;
  errors: CompileError[];
  sourceUnits: Map<string, RawAST>;
}

interface CachedCompileSnapshot {
  signature: string;
  result: CompileResult;
}

interface ProjectCacheInternals {
  entries: Map<string, CachedProjectGraph>;
  results: Map<string, CachedCompileSnapshot>;
  dependency: Map<string, DependencyGraphSnapshot>;
  normalize: Map<string, NormalizeCacheSnapshot>;
  validate: Map<string, ValidationCacheSnapshot>;
  codegen: Map<string, CodegenCacheSnapshot>;
  manifest: Map<string, ManifestCacheSnapshot>;
  coldEntries: Set<string>;
}

export interface ProjectCache {
  files: Map<string, CachedProjectUnit>;
  graphs: Map<string, ProjectGraphSnapshot>;
  invalidatedFiles: Set<string>;
}

export interface ProjectCacheFileUnitSnapshot {
  ast: RawAST | null;
  errors: CompileError[];
  sourceText: string;
}

export interface ProjectCacheGraphEntrySnapshot {
  entryFile: string;
  sourceFiles: string[];
  scanDirectories: string[];
  moduleGraph: Record<string, string[]>;
  hasErrors: boolean;
  ast: RawAST;
  errors: CompileError[];
  sourceUnits: Record<string, RawAST>;
}

export interface ProjectCacheResultSnapshot {
  signature: string;
  result: CompileResult;
}

export interface ProjectCacheSnapshot {
  version: string;
  files: Record<string, ProjectCacheFileUnitSnapshot>;
  graphs: Record<string, ProjectGraphSnapshot>;
  invalidatedFiles: string[];
  internals: {
    entries: Record<string, ProjectCacheGraphEntrySnapshot>;
    results: Record<string, ProjectCacheResultSnapshot>;
    dependency: Record<string, DependencyGraphSnapshot>;
    normalize: Record<string, NormalizeCacheSnapshot>;
    validate: Record<string, ValidationCacheSnapshot>;
    codegen: Record<string, CodegenCacheSnapshot>;
    manifest: Record<string, ManifestCacheSnapshot>;
  };
}

export interface RestoreProjectCacheOptions {
  revalidateSources?: boolean;
}

const projectCacheInternals = new WeakMap<ProjectCache, ProjectCacheInternals>();
const PROJECT_CACHE_SNAPSHOT_VERSION = '0.1.1';
const COMPILE_RESULT_SIGNATURE_VERSION = '0.1.1';

export function compile(source: string, fileName: string = `app${CANONICAL_RDSL_SOURCE_SUFFIX}`): CompileResult {
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

export {
  buildRulesManifestFileName,
  countRulesEntries,
  compileRulesSource,
  isRulesSourceFile,
} from './rules-proof.js';
export {
  buildStyleManifestFileName,
  compileStyleSource,
  emitReactStyleCss,
  isStyleSourceFile,
} from './style-proof.js';
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
export type {
  ResolvedStyleDefinition,
  StyleAlignItems,
  StyleCompileError,
  StyleCompileResult,
  StyleDefinition,
  StyleDisplay,
  StyleJustifyContent,
  StyleManifest,
  StyleProgram,
  StyleTokenOrNumber,
  StyleTokens,
  StyleTypographyToken,
} from './style-proof.js';

export function compileProject(options: CompileProjectOptions): CompileResult {
  if (options.cache && options.changedFiles) {
    invalidateProjectCache(options.cache, options.changedFiles);
  }

  const loaded = loadProject(options);
  if (loaded.errors.length > 0) {
    return {
      success: false,
      files: [],
      errors: loaded.errors,
      warnings: [],
    };
  }

  const signature = options.cache
    ? createProjectSignature(options.cache, loaded)
    : null;
  const hasExternalInvalidations = options.cache
    ? hasNonDslInvalidations(options.cache, loaded)
    : false;
  const cachedResult = signature && options.cache
    && !hasExternalInvalidations
    ? getCachedCompileResult(options.cache, loaded.entryFile, signature)
    : undefined;
  if (cachedResult) {
    clearResolvedInvalidations(options.cache, loaded);
    return cachedResult;
  }

  const cachedCodegen = options.cache
    && !hasExternalInvalidations
    ? getCodegenCacheSnapshot(options.cache, loaded.entryFile)
    : undefined;
  const cachedDependencyGraph = options.cache
    && !hasExternalInvalidations
    ? getDependencyGraphSnapshot(options.cache, loaded.entryFile)
    : undefined;
  const cachedManifest = options.cache
    && !hasExternalInvalidations
    ? getManifestCacheSnapshot(options.cache, loaded.entryFile)
    : undefined;
  const cachedNormalize = options.cache
    && !hasExternalInvalidations
    ? getNormalizeCacheSnapshot(options.cache, loaded.entryFile)
    : undefined;
  const cachedValidate = options.cache
    && !hasExternalInvalidations
    ? getValidateCacheSnapshot(options.cache, loaded.entryFile)
    : undefined;
  const compiled = compileAst(
    loaded.ast,
    loaded.entryFile,
    options.projectRoot ? normalizeProjectPath(options.projectRoot) : dirnameProjectPath(loaded.entryFile),
    loaded.sourceFiles,
    loaded.moduleGraph,
    options.readFile,
    cachedNormalize,
    cachedValidate,
    cachedCodegen,
    cachedDependencyGraph,
    cachedManifest,
  );
  cacheDependencyGraphSnapshot(options.cache, loaded.entryFile, compiled.dependencyGraphSnapshot);
  cacheNormalizeSnapshot(options.cache, loaded.entryFile, compiled.normalizeCacheSnapshot);
  cacheValidateSnapshot(options.cache, loaded.entryFile, compiled.validationCacheSnapshot);
  cacheCodegenSnapshot(options.cache, loaded.entryFile, compiled.codegenCacheSnapshot);
  cacheManifestSnapshot(options.cache, loaded.entryFile, compiled.manifestCacheSnapshot);
  cacheCompileResult(options.cache, loaded.entryFile, signature, compiled.result);
  clearResolvedInvalidations(options.cache, loaded);
  return compiled.result;
}

function compileAst(
  ast: RawAST,
  entryFile: string,
  projectRoot: string,
  sourceFiles: string[],
  moduleGraph: Record<string, string[]>,
  readFile: CompileProjectOptions['readFile'],
  normalizeCache?: NormalizeCacheSnapshot,
  validationCache?: ValidationCacheSnapshot,
  codegenCache?: CodegenCacheSnapshot,
  dependencyGraphCache?: DependencyGraphSnapshot,
  manifestCache?: ManifestCacheSnapshot,
): {
  result: CompileResult;
  dependencyGraphSnapshot?: DependencyGraphSnapshot;
  normalizeCacheSnapshot?: NormalizeCacheSnapshot;
  validationCacheSnapshot?: ValidationCacheSnapshot;
  codegenCacheSnapshot?: CodegenCacheSnapshot;
  manifestCacheSnapshot?: ManifestCacheSnapshot;
} {
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];

  // Phase 1: Normalize (Raw AST → IR)
  const {
    ir,
    errors: normalizeErrors,
    cacheSnapshot: nextNormalizeCache,
  } = normalize(ast, {
    cache: normalizeCache,
    projectRoot,
    readFile(fileName) {
      try {
        return readFile(fileName);
      } catch {
        return undefined;
      }
    },
  });
  for (const err of normalizeErrors) {
    errors.push({ phase: 'normalize', message: err.message, nodeId: err.nodeId });
  }
  const dependencyGraph = buildDependencyGraph(ir);
  const dependencyDiff = diffDependencyGraphs(dependencyGraphCache, dependencyGraph);

  // Phase 2: Validate (semantic checks)
  const {
    errors: validationErrors,
    cacheSnapshot: nextValidationCache,
  } = validate(ir, {
    cache: validationCache,
    affectedNodeIds: dependencyDiff.affectedNodeIds,
  });
  for (const err of validationErrors) {
    if (err.severity === 'error') {
      errors.push({ phase: 'validate', message: err.message, nodeId: err.nodeId });
    } else {
      warnings.push({ phase: 'validate', message: err.message, nodeId: err.nodeId });
    }
  }
  if (errors.length > 0) {
    return {
      result: { success: false, ir, files: [], errors, warnings },
      dependencyGraphSnapshot: dependencyGraph,
      normalizeCacheSnapshot: nextNormalizeCache,
      validationCacheSnapshot: nextValidationCache,
    };
  }

  // Phase 3: Code Generation
  const { files, cacheSnapshot } = generate(ir, {
    cache: codegenCache,
    affectedNodeIds: dependencyDiff.affectedNodeIds,
  });

  const manifests = buildManifestArtifacts(
    ir,
    files,
    entryFile,
    sourceFiles,
    moduleGraph,
    {
      cache: manifestCache,
      dependencyGraph,
      affectedRootIds: dependencyDiff.affectedRootIds,
      readHostFile(path) {
        try {
          return readFile(path);
        } catch {
          try {
            return readFile(resolveProjectPath(dirnameProjectPath(entryFile), path));
          } catch {
            return undefined;
          }
        }
      },
    },
  );
  const semanticManifest = manifests.semanticManifest;
  const traceManifest = manifests.traceManifest;
  const manifest = manifests.manifestJson;

  return {
    result: {
      success: true,
      ir,
      files,
      errors,
      warnings,
      semanticManifest,
      traceManifest,
      manifest,
    },
    dependencyGraphSnapshot: dependencyGraph,
    normalizeCacheSnapshot: nextNormalizeCache,
    validationCacheSnapshot: nextValidationCache,
    codegenCacheSnapshot: cacheSnapshot,
    manifestCacheSnapshot: manifests.cacheSnapshot,
  };
}

export function createProjectCache(): ProjectCache {
  const cache: ProjectCache = {
    files: new Map(),
    graphs: new Map(),
    invalidatedFiles: new Set(),
  };
  projectCacheInternals.set(cache, {
    entries: new Map(),
    results: new Map(),
    dependency: new Map(),
    normalize: new Map(),
    validate: new Map(),
    codegen: new Map(),
    manifest: new Map(),
    coldEntries: new Set(),
  });
  return cache;
}

export function serializeProjectCache(cache: ProjectCache): ProjectCacheSnapshot {
  const internals = getProjectCacheInternals(cache);
  return {
    version: PROJECT_CACHE_SNAPSHOT_VERSION,
    files: Object.fromEntries(cache.files.entries()),
    graphs: Object.fromEntries(cache.graphs.entries()),
    invalidatedFiles: Array.from(cache.invalidatedFiles),
    internals: {
      entries: Object.fromEntries(Array.from(internals.entries.entries()).map(([entryFile, graph]) => [
        entryFile,
        serializeCachedProjectGraph(graph),
      ])),
      results: Object.fromEntries(internals.results.entries()),
      dependency: Object.fromEntries(internals.dependency.entries()),
      normalize: Object.fromEntries(internals.normalize.entries()),
      validate: Object.fromEntries(internals.validate.entries()),
      codegen: Object.fromEntries(internals.codegen.entries()),
      manifest: Object.fromEntries(internals.manifest.entries()),
    },
  };
}

export function restoreProjectCache(
  snapshot: ProjectCacheSnapshot,
  options: RestoreProjectCacheOptions = {},
): ProjectCache {
  const cache = createProjectCache();
  if (snapshot.version !== PROJECT_CACHE_SNAPSHOT_VERSION) {
    return cache;
  }

  const revalidateSources = options.revalidateSources !== false;
  const internals = getProjectCacheInternals(cache);
  const fileEntries = Object.entries(snapshot.files);

  cache.files = new Map(fileEntries.map(([fileName, unit]) => [normalizeProjectPath(fileName), unit]));
  cache.graphs = new Map(Object.entries(snapshot.graphs).map(([entryFile, graph]) => [normalizeProjectPath(entryFile), graph]));
  cache.invalidatedFiles = new Set(
    revalidateSources
      ? fileEntries.map(([fileName]) => normalizeProjectPath(fileName))
      : snapshot.invalidatedFiles.map((fileName) => normalizeProjectPath(fileName)),
  );

  internals.entries = new Map(Object.entries(snapshot.internals.entries).map(([entryFile, graph]) => [
    normalizeProjectPath(entryFile),
    deserializeCachedProjectGraph(graph),
  ]));
  internals.results = new Map(Object.entries(snapshot.internals.results).map(([entryFile, result]) => [
    normalizeProjectPath(entryFile),
    result,
  ]));
  internals.dependency = new Map(Object.entries(snapshot.internals.dependency).map(([entryFile, dependency]) => [
    normalizeProjectPath(entryFile),
    dependency,
  ]));
  internals.normalize = new Map(Object.entries(snapshot.internals.normalize).map(([entryFile, normalizeCache]) => [
    normalizeProjectPath(entryFile),
    normalizeCache,
  ]));
  internals.validate = new Map(Object.entries(snapshot.internals.validate).map(([entryFile, validateCache]) => [
    normalizeProjectPath(entryFile),
    validateCache,
  ]));
  internals.codegen = new Map(Object.entries(snapshot.internals.codegen).map(([entryFile, codegenCache]) => [
    normalizeProjectPath(entryFile),
    codegenCache,
  ]));
  internals.manifest = new Map(Object.entries(snapshot.internals.manifest).map(([entryFile, manifestCache]) => [
    normalizeProjectPath(entryFile),
    manifestCache,
  ]));
  internals.coldEntries = new Set(
    revalidateSources
      ? Object.keys(snapshot.internals.entries).map((entryFile) => normalizeProjectPath(entryFile))
      : [],
  );

  return cache;
}

export function invalidateProjectCache(
  cache: ProjectCache,
  fileNames?: Iterable<string>,
): void {
  if (!fileNames) {
    cache.files.clear();
    cache.graphs.clear();
    cache.invalidatedFiles.clear();
    const internals = getProjectCacheInternals(cache);
    internals.entries.clear();
    internals.results.clear();
    internals.dependency.clear();
    internals.normalize.clear();
    internals.validate.clear();
    internals.codegen.clear();
    internals.manifest.clear();
    internals.coldEntries.clear();
    return;
  }

  for (const fileName of fileNames) {
    cache.invalidatedFiles.add(normalizeProjectPath(fileName));
  }
}

function loadProject(options: CompileProjectOptions): LoadedProject {
  const entryFile = normalizeProjectPath(options.entryFile);
  const cachedGraph = options.cache ? getCachedProjectGraph(options.cache, entryFile) : undefined;
  if (cachedGraph) {
    const cachedLoad = loadProjectFromGraphCache(cachedGraph, options);
    if (cachedLoad) {
      return cachedLoad;
    }
  }

  const loaded = loadProjectFresh(entryFile, options, cachedGraph);
  cacheLoadedProject(options.cache, loaded);
  return loaded;
}

function loadProjectFresh(
  entryFile: string,
  options: CompileProjectOptions,
  previousGraph?: CachedProjectGraph,
): LoadedProject {
  const errors: CompileError[] = [];
  const moduleGraph: Record<string, string[]> = {};
  const sourceUnits = new Map<string, RawAST>();
  const sourceFiles: string[] = [];
  const scanDirectories = new Set<string>();
  const discovered = new Set<string>();
  const visiting: string[] = [];
  const visited = new Set<string>();

  visitProjectFile(
    entryFile,
    entryFile,
    options,
    errors,
    sourceUnits,
    moduleGraph,
    sourceFiles,
    scanDirectories,
    discovered,
    visiting,
    visited,
  );

  return finalizeLoadedProject(
    entryFile,
    sourceFiles,
    Array.from(scanDirectories).sort((left, right) => left.localeCompare(right)),
    moduleGraph,
    sourceUnits,
    errors,
    previousGraph,
  );
}

function loadProjectFromGraphCache(
  cachedGraph: CachedProjectGraph,
  options: CompileProjectOptions,
): LoadedProject | null {
  const cache = options.cache;
  if (!cache) {
    return null;
  }

  if (getProjectCacheInternals(cache).coldEntries.has(cachedGraph.entryFile)) {
    return null;
  }

  if (cache.invalidatedFiles.has(cachedGraph.entryFile)) {
    return null;
  }

  const changedScannedFiles = Array.from(cache.invalidatedFiles).filter((fileName) => (
    !cachedGraph.sourceFiles.includes(fileName) &&
    isPathWithinScanDirectories(fileName, cachedGraph.scanDirectories)
  ));

  if (changedScannedFiles.length > 0) {
    const loaded = loadProjectFresh(cachedGraph.entryFile, options, cachedGraph);
    cacheLoadedProject(cache, loaded);
    return loaded;
  }

  const changedProjectFiles = cachedGraph.sourceFiles.filter((fileName) =>
    cache.invalidatedFiles.has(fileName)
  );

  if (changedProjectFiles.length === 0) {
    return materializeLoadedProject(cachedGraph);
  }

  const errors: CompileError[] = [];
  const sourceUnits = new Map(cachedGraph.sourceUnits);
  for (const fileName of changedProjectFiles) {
    const ast = readAndParseFile(
      fileName,
      options.readFile,
      errors,
      cache,
      findImportChain(cachedGraph.moduleGraph, cachedGraph.entryFile, fileName),
    );
    if (!ast) {
      sourceUnits.delete(fileName);
      continue;
    }

    if (fileName !== cachedGraph.entryFile) {
      validateModuleAst(
        fileName,
        ast,
        errors,
        findImportChain(cachedGraph.moduleGraph, cachedGraph.entryFile, fileName),
      );
    }
    sourceUnits.set(fileName, ast);
  }

  const importsChanged = errors.length === 0 && changedProjectFiles.some((fileName) => (
    didFileImportsChange(
      fileName,
      sourceUnits.get(fileName) ?? null,
      cachedGraph,
      options.listFiles,
      errors,
    )
  ));

  if (errors.length === 0 && (cachedGraph.hasErrors || importsChanged)) {
    const loaded = loadProjectFresh(cachedGraph.entryFile, options, cachedGraph);
    cacheLoadedProject(cache, loaded);
    return loaded;
  }

  if (
    errors.length === 0 &&
    !cachedGraph.hasErrors &&
    changedProjectFiles.every((fileName) => sourceUnits.get(fileName) === cachedGraph.sourceUnits.get(fileName))
  ) {
    return materializeLoadedProject(cachedGraph);
  }

  const loaded = finalizeLoadedProject(
    cachedGraph.entryFile,
    cachedGraph.sourceFiles,
    cachedGraph.scanDirectories,
    cachedGraph.moduleGraph,
    sourceUnits,
    errors,
    cachedGraph,
  );
  cacheLoadedProject(cache, loaded);
  return loaded;
}

function finalizeLoadedProject(
  entryFile: string,
  sourceFiles: string[],
  scanDirectories: string[],
  moduleGraph: Record<string, string[]>,
  sourceUnits: Map<string, RawAST>,
  errors: CompileError[],
  previousGraph?: CachedProjectGraph,
): LoadedProject {
  const normalizedSourceFiles = [...sourceFiles];
  const normalizedScanDirectories = [...scanDirectories];
  const normalizedModuleGraph = cloneModuleGraph(moduleGraph);
  const clonedErrors = errors.map(cloneCompileError);

  return {
    ast: clonedErrors.length > 0
      ? createEmptyAst()
      : mergeRawAsts(entryFile, normalizedSourceFiles, sourceUnits, previousGraph),
    entryFile,
    sourceFiles: normalizedSourceFiles,
    scanDirectories: normalizedScanDirectories,
    moduleGraph: normalizedModuleGraph,
    errors: clonedErrors,
    sourceUnits: new Map(sourceUnits),
  };
}

function materializeLoadedProject(cachedGraph: CachedProjectGraph): LoadedProject {
  return {
    ast: cachedGraph.ast,
    entryFile: cachedGraph.entryFile,
    sourceFiles: [...cachedGraph.sourceFiles],
    scanDirectories: [...cachedGraph.scanDirectories],
    moduleGraph: cloneModuleGraph(cachedGraph.moduleGraph),
    errors: cachedGraph.errors.map(cloneCompileError),
    sourceUnits: new Map(cachedGraph.sourceUnits),
  };
}

function cacheLoadedProject(cache: ProjectCache | undefined, loaded: LoadedProject): void {
  if (!cache) return;

  const cachedGraph: CachedProjectGraph = {
    entryFile: loaded.entryFile,
    sourceFiles: [...loaded.sourceFiles],
    scanDirectories: [...loaded.scanDirectories],
    moduleGraph: cloneModuleGraph(loaded.moduleGraph),
    hasErrors: loaded.errors.length > 0,
    ast: loaded.ast,
    errors: loaded.errors.map(cloneCompileError),
    sourceUnits: new Map(loaded.sourceUnits),
  };

  getProjectCacheInternals(cache).entries.set(loaded.entryFile, cachedGraph);
  getProjectCacheInternals(cache).coldEntries.delete(loaded.entryFile);
  cache.graphs.set(loaded.entryFile, {
    entryFile: cachedGraph.entryFile,
    sourceFiles: [...cachedGraph.sourceFiles],
    scanDirectories: [...cachedGraph.scanDirectories],
    moduleGraph: cloneModuleGraph(cachedGraph.moduleGraph),
    hasErrors: cachedGraph.hasErrors,
  });
}

function getCachedProjectGraph(
  cache: ProjectCache,
  entryFile: string,
): CachedProjectGraph | undefined {
  return getProjectCacheInternals(cache).entries.get(entryFile);
}

function getProjectCacheInternals(cache: ProjectCache): ProjectCacheInternals {
  let internals = projectCacheInternals.get(cache);
  if (!internals) {
    internals = {
      entries: new Map(),
      results: new Map(),
      dependency: new Map(),
      normalize: new Map(),
      validate: new Map(),
      codegen: new Map(),
      manifest: new Map(),
      coldEntries: new Set(),
    };
    projectCacheInternals.set(cache, internals);
  }
  return internals;
}

function getCachedCompileResult(
  cache: ProjectCache,
  entryFile: string,
  signature: string,
): CompileResult | undefined {
  const snapshot = getProjectCacheInternals(cache).results.get(entryFile);
  if (!snapshot || snapshot.signature !== signature) {
    return undefined;
  }
  return snapshot.result;
}

function cacheCompileResult(
  cache: ProjectCache | undefined,
  entryFile: string,
  signature: string | null,
  result: CompileResult,
): void {
  if (!cache || !signature) return;
  getProjectCacheInternals(cache).results.set(entryFile, {
    signature,
    result,
  });
}

function getNormalizeCacheSnapshot(
  cache: ProjectCache,
  entryFile: string,
): NormalizeCacheSnapshot | undefined {
  return getProjectCacheInternals(cache).normalize.get(entryFile);
}

function getDependencyGraphSnapshot(
  cache: ProjectCache,
  entryFile: string,
): DependencyGraphSnapshot | undefined {
  return getProjectCacheInternals(cache).dependency.get(entryFile);
}

function cacheDependencyGraphSnapshot(
  cache: ProjectCache | undefined,
  entryFile: string,
  snapshot: DependencyGraphSnapshot | undefined,
): void {
  if (!cache || !snapshot) return;
  getProjectCacheInternals(cache).dependency.set(entryFile, snapshot);
}

function cacheNormalizeSnapshot(
  cache: ProjectCache | undefined,
  entryFile: string,
  snapshot: NormalizeCacheSnapshot | undefined,
): void {
  if (!cache || !snapshot) return;
  getProjectCacheInternals(cache).normalize.set(entryFile, snapshot);
}

function getValidateCacheSnapshot(
  cache: ProjectCache,
  entryFile: string,
): ValidationCacheSnapshot | undefined {
  return getProjectCacheInternals(cache).validate.get(entryFile);
}

function cacheValidateSnapshot(
  cache: ProjectCache | undefined,
  entryFile: string,
  snapshot: ValidationCacheSnapshot | undefined,
): void {
  if (!cache || !snapshot) return;
  getProjectCacheInternals(cache).validate.set(entryFile, snapshot);
}

function getCodegenCacheSnapshot(
  cache: ProjectCache,
  entryFile: string,
): CodegenCacheSnapshot | undefined {
  return getProjectCacheInternals(cache).codegen.get(entryFile);
}

function cacheCodegenSnapshot(
  cache: ProjectCache | undefined,
  entryFile: string,
  snapshot: CodegenCacheSnapshot | undefined,
): void {
  if (!cache || !snapshot) return;
  getProjectCacheInternals(cache).codegen.set(entryFile, snapshot);
}

function getManifestCacheSnapshot(
  cache: ProjectCache,
  entryFile: string,
): ManifestCacheSnapshot | undefined {
  return getProjectCacheInternals(cache).manifest.get(entryFile);
}

function cacheManifestSnapshot(
  cache: ProjectCache | undefined,
  entryFile: string,
  snapshot: ManifestCacheSnapshot | undefined,
): void {
  if (!cache || !snapshot) return;
  getProjectCacheInternals(cache).manifest.set(entryFile, snapshot);
}

function createProjectSignature(
  cache: ProjectCache,
  loaded: LoadedProject,
): string | null {
  const parts: string[] = [COMPILE_RESULT_SIGNATURE_VERSION, loaded.entryFile];

  for (const fileName of loaded.sourceFiles) {
    const unit = cache.files.get(fileName);
    if (!unit) {
      return null;
    }
    parts.push(fileName, hashSourceText(unit.sourceText));
  }

  for (const directory of loaded.scanDirectories) {
    parts.push(`dir:${directory}`);
  }

  const graphEntries = Object.entries(loaded.moduleGraph)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, imports]) => `${fileName}->${imports.join(',')}`);
  parts.push(...graphEntries);

  return parts.join('|');
}

function hasNonDslInvalidations(
  cache: ProjectCache,
  loaded: LoadedProject,
): boolean {
  return Array.from(cache.invalidatedFiles).some((fileName) => (
    !loaded.sourceFiles.includes(fileName) &&
    !isPathWithinScanDirectories(fileName, loaded.scanDirectories)
  ));
}

function clearResolvedInvalidations(
  cache: ProjectCache | undefined,
  loaded: LoadedProject,
): void {
  if (!cache) {
    return;
  }

  for (const fileName of Array.from(cache.invalidatedFiles)) {
    if (
      loaded.sourceFiles.includes(fileName) ||
      isPathWithinScanDirectories(fileName, loaded.scanDirectories)
    ) {
      continue;
    }
    cache.invalidatedFiles.delete(fileName);
  }
}

function hashSourceText(sourceText: string): string {
  let hash = 2166136261;
  for (let index = 0; index < sourceText.length; index += 1) {
    hash ^= sourceText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${sourceText.length}:${hash >>> 0}`;
}

function cloneModuleGraph(
  moduleGraph: Record<string, string[]>,
): Record<string, string[]> {
  const clone: Record<string, string[]> = {};
  for (const [fileName, imports] of Object.entries(moduleGraph)) {
    clone[fileName] = [...imports];
  }
  return clone;
}

function cloneCompileError(error: CompileError): CompileError {
  return { ...error };
}

function serializeCachedProjectGraph(graph: CachedProjectGraph): ProjectCacheGraphEntrySnapshot {
  return {
    entryFile: graph.entryFile,
    sourceFiles: [...graph.sourceFiles],
    scanDirectories: [...graph.scanDirectories],
    moduleGraph: cloneModuleGraph(graph.moduleGraph),
    hasErrors: graph.hasErrors,
    ast: graph.ast,
    errors: graph.errors.map(cloneCompileError),
    sourceUnits: Object.fromEntries(graph.sourceUnits.entries()),
  };
}

function deserializeCachedProjectGraph(graph: ProjectCacheGraphEntrySnapshot): CachedProjectGraph {
  return {
    entryFile: normalizeProjectPath(graph.entryFile),
    sourceFiles: graph.sourceFiles.map((fileName) => normalizeProjectPath(fileName)),
    scanDirectories: graph.scanDirectories.map((directory) => normalizeProjectPath(directory)),
    moduleGraph: cloneModuleGraph(graph.moduleGraph),
    hasErrors: graph.hasErrors,
    ast: graph.ast,
    errors: graph.errors.map(cloneCompileError),
    sourceUnits: new Map(Object.entries(graph.sourceUnits).map(([fileName, ast]) => [normalizeProjectPath(fileName), ast])),
  };
}

function readAndParseFile(
  fileName: string,
  readFile: CompileProjectOptions['readFile'],
  errors: CompileError[],
  cache?: ProjectCache,
  importChain?: readonly string[],
): RawAST | null {
  const normalizedFile = normalizeProjectPath(fileName);
  const previous = cache?.files.get(normalizedFile);
  const cached = cache && !cache.invalidatedFiles.has(normalizedFile)
    ? cache.files.get(normalizedFile)
    : undefined;

  if (cached) {
    for (const error of cached.errors) {
      errors.push({ ...error });
    }
    return cached.ast;
  }

  let source: string;
  try {
    source = readFile(normalizedFile);
  } catch (error) {
    const unit: CachedProjectUnit = {
      ast: null,
      errors: [{
        phase: 'parse',
        message: appendImportChain(
          `Failed to read ${normalizedFile}: ${error instanceof Error ? error.message : String(error)}`,
          importChain,
        ),
        file: normalizedFile,
      }],
      sourceText: '',
    };
    if (cache) {
      cache.files.set(normalizedFile, unit);
      cache.invalidatedFiles.delete(normalizedFile);
    }
    for (const issue of unit.errors) {
      errors.push({ ...issue });
    }
    return unit.ast;
  }

  if (previous && previous.sourceText === source) {
    if (cache) {
      cache.invalidatedFiles.delete(normalizedFile);
    }
    for (const error of previous.errors) {
      errors.push({ ...error });
    }
    return previous.ast;
  }

  const unit = parseProjectUnit(normalizedFile, source, importChain);
  if (cache) {
    cache.files.set(normalizedFile, unit);
    cache.invalidatedFiles.delete(normalizedFile);
  }
  for (const error of unit.errors) {
    errors.push({ ...error });
  }
  return unit.ast;
}

function parseProjectUnit(
  fileName: string,
  source: string,
  importChain?: readonly string[],
): CachedProjectUnit {
  const { ast, errors: parseErrors } = parse(source, fileName);
  const unitErrors: CompileError[] = [];
  for (const err of parseErrors) {
    unitErrors.push({
      phase: 'parse',
      message: appendImportChain(err.message, importChain),
      file: fileName,
      line: err.line,
      col: err.col,
    });
  }

  return {
    ast: parseErrors.length === 0 ? ast : null,
    errors: unitErrors,
    sourceText: source,
  };
}

function validateModuleAst(
  fileName: string,
  ast: RawAST,
  errors: CompileError[],
  importChain?: readonly string[],
): void {
  if (ast.app) {
    errors.push({
      phase: 'validate',
      message: appendImportChain(`Module file must not contain app: ${fileName}`, importChain),
      file: fileName,
      line: ast.app.sourceSpan?.startLine,
      col: ast.app.sourceSpan?.startCol,
    });
  }

  if (ast.compiler) {
    errors.push({
      phase: 'validate',
      message: appendImportChain(`Module file must not contain compiler: ${fileName}`, importChain),
      file: fileName,
      line: ast.compiler.sourceSpan?.startLine,
      col: ast.compiler.sourceSpan?.startCol,
    });
  }
}

interface ResolvedImports {
  files: string[];
  scanDirectories: string[];
}

function resolveImports(
  fileName: string,
  imports: string[],
  listFiles: CompileProjectOptions['listFiles'],
  errors: CompileError[],
  importChain?: readonly string[],
): ResolvedImports {
  const seen = new Set<string>();
  const resolvedImports: string[] = [];
  const scanDirectories = new Set<string>();

  for (const rawImport of imports) {
    if (!rawImport.startsWith('./') && !rawImport.startsWith('../')) {
      errors.push({
        phase: 'parse',
        message: appendImportChain(
          `Import path "${rawImport}" must be relative (starting with ./ or ../)`,
          importChain,
        ),
        file: fileName,
      });
      continue;
    }

    if (!isRdslImportPath(rawImport)) {
      errors.push({
        phase: 'parse',
        message: appendImportChain(
          `Import path "${rawImport}" must reference a ${describeRdslSourceSuffixes()} file or a directory ending with /`,
          importChain,
        ),
        file: fileName,
      });
      continue;
    }

    if (rawImport.endsWith('/')) {
      const directory = resolveImportPath(fileName, rawImport);
      const expandedFiles = expandDirectoryImport(
        fileName,
        rawImport,
        directory,
        listFiles,
        errors,
        importChain,
      );
      scanDirectories.add(directory);
      for (const resolved of expandedFiles) {
        if (resolved === fileName) {
          errors.push({
            phase: 'validate',
            message: appendImportChain(`File cannot import itself through directory "${rawImport}"`, importChain),
            file: fileName,
          });
          continue;
        }
        if (seen.has(resolved)) {
          errors.push({
            phase: 'validate',
            message: appendImportChain(
              `Duplicate imported path "${rawImport}" resolves to "${resolved}"`,
              importChain,
            ),
            file: fileName,
          });
          continue;
        }
        seen.add(resolved);
        resolvedImports.push(resolved);
      }
      continue;
    }

    const resolved = resolveImportPath(fileName, rawImport);
    if (resolved === fileName) {
      errors.push({
        phase: 'validate',
        message: appendImportChain(`File cannot import itself: ${rawImport}`, importChain),
        file: fileName,
      });
      continue;
    }

    if (seen.has(resolved)) {
      errors.push({
        phase: 'validate',
        message: appendImportChain(
          `Duplicate imported path "${rawImport}" resolves to "${resolved}"`,
          importChain,
        ),
        file: fileName,
      });
      continue;
    }

    seen.add(resolved);
    resolvedImports.push(resolved);
  }

  return {
    files: resolvedImports,
    scanDirectories: Array.from(scanDirectories).sort((left, right) => left.localeCompare(right)),
  };
}

function expandDirectoryImport(
  fileName: string,
  rawImport: string,
  directory: string,
  listFiles: CompileProjectOptions['listFiles'],
  errors: CompileError[],
  importChain?: readonly string[],
): string[] {
  if (!listFiles) {
    errors.push({
      phase: 'parse',
      message: appendImportChain(
        `Directory import "${rawImport}" requires listFiles support in the project loader`,
        importChain,
      ),
      file: fileName,
    });
    return [];
  }

  try {
    return listFiles(directory)
      .map((entry) => normalizeProjectPath(entry))
      .filter((entry) => dirnameProjectPath(entry) === directory && isRdslSourceFile(entry))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    errors.push({
      phase: 'parse',
      message: appendImportChain(
        `Failed to read import directory "${rawImport}": ${error instanceof Error ? error.message : String(error)}`,
        importChain,
      ),
      file: fileName,
    });
    return [];
  }
}

function visitProjectFile(
  fileName: string,
  entryFile: string,
  options: CompileProjectOptions,
  errors: CompileError[],
  sourceUnits: Map<string, RawAST>,
  moduleGraph: Record<string, string[]>,
  sourceFiles: string[],
  scanDirectories: Set<string>,
  discovered: Set<string>,
  visiting: string[],
  visited: Set<string>,
): void {
  const normalizedFile = normalizeProjectPath(fileName);
  if (!discovered.has(normalizedFile)) {
    discovered.add(normalizedFile);
    sourceFiles.push(normalizedFile);
  }

  if (visited.has(normalizedFile)) {
    return;
  }

  visiting.push(normalizedFile);
  const importChain = [...visiting];
  const ast = readAndParseFile(normalizedFile, options.readFile, errors, options.cache, importChain);
  if (!ast) {
    moduleGraph[normalizedFile] ??= [];
    visiting.pop();
    return;
  }

  if (normalizedFile !== entryFile) {
    validateModuleAst(normalizedFile, ast, errors, importChain);
  }

  sourceUnits.set(normalizedFile, ast);
  const resolvedImports = resolveImports(normalizedFile, ast.imports, options.listFiles, errors, importChain);
  for (const directory of resolvedImports.scanDirectories) {
    scanDirectories.add(directory);
  }
  moduleGraph[normalizedFile] = resolvedImports.files;

  for (const importedFile of resolvedImports.files) {
    const cycleIndex = visiting.indexOf(importedFile);
    if (cycleIndex >= 0) {
      errors.push({
        phase: 'validate',
        message: `Import cycle detected: ${formatImportChain([
          ...visiting.slice(0, cycleIndex),
          ...visiting.slice(cycleIndex),
          importedFile,
        ])}`,
        file: normalizedFile,
      });
      continue;
    }

    visitProjectFile(
      importedFile,
      entryFile,
      options,
      errors,
      sourceUnits,
      moduleGraph,
      sourceFiles,
      scanDirectories,
      discovered,
      visiting,
      visited,
    );
  }

  visiting.pop();
  visited.add(normalizedFile);
}

function didFileImportsChange(
  fileName: string,
  ast: RawAST | null,
  cachedGraph: CachedProjectGraph,
  listFiles: CompileProjectOptions['listFiles'],
  errors: CompileError[],
): boolean {
  if (!ast) {
    return false;
  }

  const previousImports = cachedGraph.moduleGraph[fileName] ?? [];
  if (ast.imports.length === 0 && previousImports.length === 0) {
    return false;
  }

  const errorCount = errors.length;
  const nextImports = resolveImports(
    fileName,
    ast.imports,
    listFiles,
    errors,
    findImportChain(cachedGraph.moduleGraph, cachedGraph.entryFile, fileName),
  );
  if (errors.length > errorCount) {
    return false;
  }

  if (previousImports.length !== nextImports.files.length) {
    return true;
  }

  return previousImports.some((importPath, index) => importPath !== nextImports.files[index]);
}

function findImportChain(
  moduleGraph: Record<string, string[]>,
  entryFile: string,
  targetFile: string,
): string[] {
  if (entryFile === targetFile) {
    return [entryFile];
  }

  const queue: string[] = [entryFile];
  const parents = new Map<string, string | null>([[entryFile, null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const imported of moduleGraph[current] ?? []) {
      if (parents.has(imported)) {
        continue;
      }
      parents.set(imported, current);
      if (imported === targetFile) {
        return materializeImportChain(parents, targetFile);
      }
      queue.push(imported);
    }
  }

  return [targetFile];
}

function materializeImportChain(
  parents: Map<string, string | null>,
  targetFile: string,
): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = targetFile;
  while (current) {
    chain.push(current);
    current = parents.get(current);
  }
  return chain.reverse();
}

function appendImportChain(message: string, importChain?: readonly string[]): string {
  if (!importChain || importChain.length <= 1) {
    return message;
  }
  return `${message} (import chain: ${formatImportChain(importChain)})`;
}

function formatImportChain(importChain: readonly string[]): string {
  return importChain.join(' -> ');
}

function isPathWithinScanDirectories(
  fileName: string,
  scanDirectories: readonly string[],
): boolean {
  const normalizedFile = normalizeProjectPath(fileName);
  return scanDirectories.some((directory) => (
    normalizedFile.startsWith(`${directory}/`) &&
    isRdslSourceFile(normalizedFile)
  ));
}

function mergeRawAsts(
  entryFile: string,
  sourceFiles: string[],
  sourceUnits: Map<string, RawAST>,
  previousGraph?: CachedProjectGraph,
): RawAST {
  const entryAst = sourceUnits.get(entryFile) ?? createEmptyAst();
  const reusableGraph = previousGraph && !previousGraph.hasErrors ? previousGraph : undefined;
  const previousAst = reusableGraph?.ast;
  const previousEntryAst = reusableGraph?.sourceUnits.get(entryFile);

  const app = previousAst && previousEntryAst?.app === entryAst.app
    ? previousAst.app
    : entryAst.app;
  const compiler = previousAst && previousEntryAst?.compiler === entryAst.compiler
    ? previousAst.compiler
    : entryAst.compiler;
  const imports = previousAst && previousEntryAst?.imports === entryAst.imports
    ? previousAst.imports
    : [...entryAst.imports];
  const models = previousAst && canReuseMergedRawAstCategory(
    sourceFiles,
    reusableGraph.sourceFiles,
    sourceUnits,
    reusableGraph.sourceUnits,
    'models',
  )
    ? previousAst.models
    : mergeRawAstCategory(sourceFiles, sourceUnits, 'models');
  const resources = previousAst && canReuseMergedRawAstCategory(
    sourceFiles,
    reusableGraph.sourceFiles,
    sourceUnits,
    reusableGraph.sourceUnits,
    'resources',
  )
    ? previousAst.resources
    : mergeRawAstCategory(sourceFiles, sourceUnits, 'resources');
  const readModels = previousAst && canReuseMergedRawAstCategory(
    sourceFiles,
    reusableGraph.sourceFiles,
    sourceUnits,
    reusableGraph.sourceUnits,
    'readModels',
  )
    ? previousAst.readModels
    : mergeRawAstCategory(sourceFiles, sourceUnits, 'readModels');
  const pages = previousAst && canReuseMergedRawAstCategory(
    sourceFiles,
    reusableGraph.sourceFiles,
    sourceUnits,
    reusableGraph.sourceUnits,
    'pages',
  )
    ? previousAst.pages
    : mergeRawAstCategory(sourceFiles, sourceUnits, 'pages');

  if (
    previousAst &&
    previousAst.app === app &&
    previousAst.compiler === compiler &&
    previousAst.imports === imports &&
    previousAst.models === models &&
    previousAst.resources === resources &&
    previousAst.readModels === readModels &&
    previousAst.pages === pages
  ) {
    return previousAst;
  }

  return {
    app,
    compiler,
    imports,
    models,
    resources,
    readModels,
    pages,
  };
}

function createEmptyAst(): RawAST {
  return {
    imports: [],
    models: [],
    resources: [],
    readModels: [],
    pages: [],
  };
}

function resolveImportPath(fromFile: string, rawImport: string): string {
  const baseDir = dirnameProjectPath(fromFile);
  return resolveProjectPath(baseDir, rawImport);
}

type RawAstCollectionKey = 'models' | 'resources' | 'readModels' | 'pages';
type RawAstCollectionMap = {
  models: RawModel[];
  resources: RawResource[];
  readModels: RawAST['readModels'];
  pages: RawPage[];
};

function canReuseMergedRawAstCategory(
  sourceFiles: string[],
  previousSourceFiles: string[],
  sourceUnits: Map<string, RawAST>,
  previousSourceUnits: Map<string, RawAST>,
  key: RawAstCollectionKey,
): boolean {
  const currentContributors = getRawAstContributors(sourceFiles, sourceUnits, key);
  const previousContributors = getRawAstContributors(previousSourceFiles, previousSourceUnits, key);

  if (currentContributors.length !== previousContributors.length) {
    return false;
  }

  return currentContributors.every((fileName, index) => (
    fileName === previousContributors[index] &&
    getRawAstCollection(sourceUnits.get(fileName), key) === getRawAstCollection(previousSourceUnits.get(fileName), key)
  ));
}

function getRawAstContributors(
  sourceFiles: string[],
  sourceUnits: Map<string, RawAST>,
  key: RawAstCollectionKey,
): string[] {
  return sourceFiles.filter((fileName) => (getRawAstCollection(sourceUnits.get(fileName), key)?.length ?? 0) > 0);
}

function mergeRawAstCategory<K extends RawAstCollectionKey>(
  sourceFiles: string[],
  sourceUnits: Map<string, RawAST>,
  key: K,
): RawAstCollectionMap[K] {
  const merged: Array<RawModel | RawResource | RawReadModel | RawPage> = [];
  for (const fileName of sourceFiles) {
    const entries = getRawAstCollection(sourceUnits.get(fileName), key);
    if (!entries || entries.length === 0) continue;
    merged.push(...entries);
  }
  return merged as RawAstCollectionMap[K];
}

function getRawAstCollection<K extends RawAstCollectionKey>(
  ast: RawAST | undefined,
  key: K,
): RawAstCollectionMap[K] {
  if (!ast) {
    return [] as RawAstCollectionMap[K];
  }
  return ast[key] as RawAstCollectionMap[K];
}

// Re-exports for direct usage
export { parse } from './parser.js';
export { normalize } from './normalize.js';
export { validate } from './validator.js';
export { generate } from './codegen.js';
export { parseExpr } from './expr.js';
export {
  buildSemanticManifest,
  buildTraceManifest,
  findTraceNode,
  listManifestHostFilesForNode,
  listTraceRegionsForNode,
  resolveTraceLocation,
} from './manifest.js';
export { collectHostFiles, listHostFilesForNode, listMaterializedHostFiles } from './host-files.js';
export { inspectSemanticNode, semanticNodeInspectionToLines } from './node-inspect.js';
export type { IRApp, IRResource, IRModel } from './ir.js';
export type { GeneratedFile } from './codegen.js';
export type {
  SemanticManifest,
  TraceManifest,
  TraceNodeEntry,
  TraceRegionEntry,
  TraceLocationMatch,
  TraceLookupResult,
} from './manifest.js';
export type { HostFileDependencyEntry, HostFileEntry, HostFileReferenceEntry } from './host-files.js';
export type { SemanticNodeInspection, SemanticEffectInspection } from './node-inspect.js';
