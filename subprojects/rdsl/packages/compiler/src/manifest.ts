import type {
  IRApp,
  IRNode,
  IRListView,
  IREditView,
  IRCreateView,
  IRReadView,
  IRReadModel,
  IRReadModelListView,
  IRPageAction,
  SourceSpan,
} from './ir.js';
import type { GeneratedFile } from './codegen.js';
import { createStableSignature } from './cache-signature.js';
import {
  createDependencyRootSignature,
  buildDependencyGraph,
} from './dependency-graph.js';
import type { DependencyGraphSnapshot } from './dependency-graph.js';
import {
  collectHostFileSegments,
  listHostFilesForNode as listNodeHostFiles,
  mergeHostFileSegments,
} from './host-files.js';
import type { HostFileEntry } from './host-files.js';

const COMPILER_VERSION = '0.1.1';
const SOURCE_NODE_REGEX = /@source-node\s+([A-Za-z0-9._-]+)/;
const MANIFEST_CACHE_VERSION = '0.1.2';

export interface SemanticManifest {
  artifact: 'rdsl.semantic-manifest';
  schemaVersion: IRApp['schemaVersion'];
  compilerVersion: string;
  entryFile: string;
  sourceFiles: string[];
  moduleGraph?: Record<string, string[]>;
  hostFiles?: HostFileEntry[];
  ir: IRApp;
}

export interface TraceSourceFileEntry {
  path: string;
}

export interface TraceGeneratedFileEntry {
  path: string;
  rootNodeId: string;
}

export interface TraceNodeEntry {
  id: string;
  kind: string;
  sourceSpan?: SourceSpan;
  parentId?: string;
}

export interface TraceRegionEntry {
  generatedFile: string;
  range: SourceSpan;
  nodeId: string;
  role: string;
}

export interface TraceManifest {
  artifact: 'rdsl.trace-manifest';
  schemaVersion: IRApp['schemaVersion'];
  compilerVersion: string;
  entryFile: string;
  semanticManifest: string;
  sourceFiles: TraceSourceFileEntry[];
  generatedFiles: TraceGeneratedFileEntry[];
  nodes: TraceNodeEntry[];
  regions: TraceRegionEntry[];
}

export interface TraceLocationMatch {
  node?: TraceNodeEntry;
  region: TraceRegionEntry;
}

export interface TraceLookupResult {
  kind: 'match' | 'ambiguous';
  matches: TraceLocationMatch[];
}

export interface ManifestCacheEntry<T> {
  signature: string;
  entries: T[];
}

export interface ManifestValueCacheEntry<T> {
  signature: string;
  value: T;
}

export interface FileTraceCacheEntry {
  signature: string;
  nodes: TraceNodeEntry[];
  regions: TraceRegionEntry[];
}

export interface ManifestCacheSnapshot {
  version: string;
  hostFileRoots: Record<string, ManifestCacheEntry<HostFileEntry>>;
  traceNodeRoots: Record<string, ManifestCacheEntry<TraceNodeEntry>>;
  fileTrace: Record<string, FileTraceCacheEntry>;
  sourceFilePaths?: ManifestValueCacheEntry<string[]>;
  traceSourceFiles?: ManifestValueCacheEntry<TraceSourceFileEntry[]>;
  moduleGraph?: ManifestValueCacheEntry<Record<string, string[]> | undefined>;
  hostFiles?: ManifestValueCacheEntry<HostFileEntry[]>;
  generatedFileEntries: Record<string, ManifestValueCacheEntry<TraceGeneratedFileEntry>>;
  generatedFiles?: ManifestValueCacheEntry<TraceGeneratedFileEntry[]>;
  baseNodes?: ManifestValueCacheEntry<TraceNodeEntry[]>;
  traceNodes?: ManifestValueCacheEntry<TraceNodeEntry[]>;
  traceRegions?: ManifestValueCacheEntry<TraceRegionEntry[]>;
  semanticManifest?: ManifestValueCacheEntry<SemanticManifest>;
  traceManifest?: ManifestValueCacheEntry<TraceManifest>;
  manifestJson?: ManifestValueCacheEntry<string>;
}

export interface ManifestBuildOptions {
  cache?: ManifestCacheSnapshot;
  dependencyGraph?: DependencyGraphSnapshot;
  affectedRootIds?: ReadonlySet<string>;
  semanticManifestPath?: string;
  readHostFile?: (path: string) => string | undefined;
}

export interface ManifestArtifacts {
  semanticManifest: SemanticManifest;
  traceManifest: TraceManifest;
  manifestJson: string;
  cacheSnapshot: ManifestCacheSnapshot;
}

interface SourceMarker {
  nodeId: string;
  line: number;
}

export function buildSemanticManifest(
  ir: IRApp,
  entryFile: string,
  sourceFiles: string[] = [entryFile],
  moduleGraph?: Record<string, string[]>,
  options: ManifestBuildOptions = {},
): SemanticManifest {
  return buildManifestArtifacts(ir, [], entryFile, sourceFiles, moduleGraph, options).semanticManifest;
}

export function buildTraceManifest(
  ir: IRApp,
  files: GeneratedFile[],
  entryFile: string,
  sourceFiles: string[] = [entryFile],
  semanticManifestPath: string = '.rdsl/semantic-manifest.json',
  options: ManifestBuildOptions = {},
): TraceManifest {
  return buildManifestArtifacts(ir, files, entryFile, sourceFiles, undefined, {
    ...options,
    semanticManifestPath,
  }).traceManifest;
}

export function buildManifestArtifacts(
  ir: IRApp,
  files: GeneratedFile[],
  entryFile: string,
  sourceFiles: string[] = [entryFile],
  moduleGraph?: Record<string, string[]>,
  options: ManifestBuildOptions = {},
): ManifestArtifacts {
  const dependencyGraph = options.dependencyGraph ?? buildDependencyGraph(ir);
  const previousCache = options.cache?.version === MANIFEST_CACHE_VERSION
    ? options.cache
    : undefined;
  const affectedRootIds = options.affectedRootIds;

  const hostFileSegments = collectHostFileSegments(ir, {
    readFile: options.readHostFile,
  });
  const traceNodeSegments = collectTraceNodeSegments(ir);
  const nextHostFileRoots: Record<string, ManifestCacheEntry<HostFileEntry>> = {};
  const nextTraceNodeRoots: Record<string, ManifestCacheEntry<TraceNodeEntry>> = {};
  const hostFilesByRoot: Record<string, HostFileEntry[]> = {};
  const traceNodesByRoot: Record<string, TraceNodeEntry[]> = {};

  for (const rootId of dependencyGraph.roots) {
    const rootSignature = createDependencyRootSignature(dependencyGraph, rootId);
    const shouldReuseRoot = previousCache &&
      !affectedRootIds?.has(rootId);
    const hostFileSignature = createStableSignature(hostFileSegments[rootId] ?? []);

    const hostFileEntry = resolveManifestRootEntry(
      hostFileSignature,
      previousCache?.hostFileRoots[rootId],
      previousCache !== undefined,
      () => hostFileSegments[rootId] ?? [],
    );
    nextHostFileRoots[rootId] = hostFileEntry.cacheEntry;
    hostFilesByRoot[rootId] = hostFileEntry.entries;

    const traceNodeEntry = resolveManifestRootEntry(
      rootSignature,
      previousCache?.traceNodeRoots[rootId],
      shouldReuseRoot,
      () => traceNodeSegments[rootId] ?? [],
    );
    nextTraceNodeRoots[rootId] = traceNodeEntry.cacheEntry;
    traceNodesByRoot[rootId] = traceNodeEntry.entries;
  }

  const sourceFilePathsEntry = resolveManifestValue(
    createStableSignature(sourceFiles),
    previousCache?.sourceFilePaths,
    () => [...sourceFiles],
  );
  const traceSourceFilesEntry = resolveManifestValue(
    sourceFilePathsEntry.cacheEntry.signature,
    previousCache?.traceSourceFiles,
    () => sourceFilePathsEntry.value.map((path) => ({ path })),
  );
  const moduleGraphEntry = resolveManifestValue(
    createStableSignature(normalizeOptionalModuleGraph(moduleGraph)),
    previousCache?.moduleGraph,
    () => cloneOptionalModuleGraph(moduleGraph),
  );
  const hostFilesEntry = resolveManifestValue(
    createStableSignature(createRootSignatureList(nextHostFileRoots)),
    previousCache?.hostFiles,
    () => mergeHostFileSegments(hostFilesByRoot),
  );
  const baseNodesEntry = resolveManifestValue(
    createStableSignature(createRootSignatureList(nextTraceNodeRoots)),
    previousCache?.baseNodes,
    () => Object.values(traceNodesByRoot).flat(),
  );
  const baseNodeMap = new Map(baseNodesEntry.value.map((node) => [node.id, node]));
  const nextFileTrace: Record<string, FileTraceCacheEntry> = {};
  const nextGeneratedFileEntries: Record<string, ManifestValueCacheEntry<TraceGeneratedFileEntry>> = {};

  for (const file of files) {
    const signature = createStableSignature({
      path: file.path,
      sourceNode: file.sourceNode,
      content: file.content,
    });
    const previousFileTrace = previousCache?.fileTrace[file.path];
    const resolved = previousFileTrace && previousFileTrace.signature === signature
      ? previousFileTrace
      : buildFileTraceEntry(file, baseNodeMap);

    nextFileTrace[file.path] = resolved;
    const generatedFileEntry = resolveManifestValue(
      createStableSignature({
        path: file.path,
        rootNodeId: file.sourceNode,
      }),
      previousCache?.generatedFileEntries[file.path],
      () => ({
        path: file.path,
        rootNodeId: file.sourceNode,
      }),
    );
    nextGeneratedFileEntries[file.path] = generatedFileEntry.cacheEntry;
  }

  const generatedFilesEntry = resolveManifestValue(
    createStableSignature(files.map((file) => [
      file.path,
      nextGeneratedFileEntries[file.path]?.signature,
    ])),
    previousCache?.generatedFiles,
    () => files.map((file) => nextGeneratedFileEntries[file.path].value),
  );
  const traceNodesEntry = resolveManifestValue(
    createStableSignature({
      base: baseNodesEntry.cacheEntry.signature,
      files: files.map((file) => [file.path, nextFileTrace[file.path]?.signature]),
    }),
    previousCache?.traceNodes,
    () => mergeTraceNodes(baseNodesEntry.value, files, nextFileTrace),
  );
  const traceRegionsEntry = resolveManifestValue(
    createStableSignature(files.map((file) => [file.path, nextFileTrace[file.path]?.signature])),
    previousCache?.traceRegions,
    () => files.flatMap((file) => nextFileTrace[file.path]?.regions ?? []),
  );

  const semanticManifestSignature = createStableSignature({
    entryFile,
    sourceFiles: sourceFilePathsEntry.cacheEntry.signature,
    moduleGraph: moduleGraphEntry.cacheEntry.signature,
    hostFiles: hostFilesEntry.cacheEntry.signature,
  });
  const semanticManifest = previousCache?.semanticManifest &&
    previousCache.semanticManifest.signature === semanticManifestSignature &&
    previousCache.semanticManifest.value.ir === ir
    ? previousCache.semanticManifest.value
    : createSemanticManifest(
      ir,
      entryFile,
      sourceFilePathsEntry.value,
      moduleGraphEntry.value,
      hostFilesEntry.value,
    );
  const semanticManifestEntry: ManifestValueCacheEntry<SemanticManifest> = {
    signature: semanticManifestSignature,
    value: semanticManifest,
  };

  const traceManifestSignature = createStableSignature({
    entryFile,
    semanticManifestPath: options.semanticManifestPath ?? '.rdsl/semantic-manifest.json',
    sourceFiles: traceSourceFilesEntry.cacheEntry.signature,
    generatedFiles: generatedFilesEntry.cacheEntry.signature,
    nodes: traceNodesEntry.cacheEntry.signature,
    regions: traceRegionsEntry.cacheEntry.signature,
  });
  const traceManifest = previousCache?.traceManifest &&
    previousCache.traceManifest.signature === traceManifestSignature
    ? previousCache.traceManifest.value
    : createTraceManifestObject(
      ir,
      entryFile,
      options.semanticManifestPath ?? '.rdsl/semantic-manifest.json',
      traceSourceFilesEntry.value,
      generatedFilesEntry.value,
      traceNodesEntry.value,
      traceRegionsEntry.value,
    );
  const traceManifestEntry: ManifestValueCacheEntry<TraceManifest> = {
    signature: traceManifestSignature,
    value: traceManifest,
  };

  const manifestJson = previousCache?.manifestJson &&
    previousCache.manifestJson.signature === semanticManifestSignature &&
    previousCache.semanticManifest?.value === semanticManifest
    ? previousCache.manifestJson.value
    : JSON.stringify(semanticManifest, null, 2);
  const manifestJsonEntry: ManifestValueCacheEntry<string> = {
    signature: semanticManifestSignature,
    value: manifestJson,
  };

  return {
    semanticManifest,
    traceManifest,
    manifestJson,
    cacheSnapshot: {
      version: MANIFEST_CACHE_VERSION,
      hostFileRoots: nextHostFileRoots,
      traceNodeRoots: nextTraceNodeRoots,
      fileTrace: nextFileTrace,
      sourceFilePaths: sourceFilePathsEntry.cacheEntry,
      traceSourceFiles: traceSourceFilesEntry.cacheEntry,
      moduleGraph: moduleGraphEntry.cacheEntry,
      hostFiles: hostFilesEntry.cacheEntry,
      generatedFileEntries: nextGeneratedFileEntries,
      generatedFiles: generatedFilesEntry.cacheEntry,
      baseNodes: baseNodesEntry.cacheEntry,
      traceNodes: traceNodesEntry.cacheEntry,
      traceRegions: traceRegionsEntry.cacheEntry,
      semanticManifest: semanticManifestEntry,
      traceManifest: traceManifestEntry,
      manifestJson: manifestJsonEntry,
    },
  };
}

function createSemanticManifest(
  ir: IRApp,
  entryFile: string,
  sourceFiles: string[],
  moduleGraph: Record<string, string[]> | undefined,
  hostFiles: HostFileEntry[],
): SemanticManifest {
  const semanticManifest: SemanticManifest = {
    artifact: 'rdsl.semantic-manifest',
    schemaVersion: ir.schemaVersion,
    compilerVersion: COMPILER_VERSION,
    entryFile,
    sourceFiles,
    ir,
  };
  if (moduleGraph && Object.keys(moduleGraph).length > 0) {
    semanticManifest.moduleGraph = moduleGraph;
  }
  if (hostFiles.length > 0) {
    semanticManifest.hostFiles = hostFiles;
  }
  return semanticManifest;
}

function createTraceManifestObject(
  ir: IRApp,
  entryFile: string,
  semanticManifestPath: string,
  sourceFiles: TraceSourceFileEntry[],
  generatedFiles: TraceGeneratedFileEntry[],
  nodes: TraceNodeEntry[],
  regions: TraceRegionEntry[],
): TraceManifest {
  return {
    artifact: 'rdsl.trace-manifest',
    schemaVersion: ir.schemaVersion,
    compilerVersion: COMPILER_VERSION,
    entryFile,
    semanticManifest: semanticManifestPath,
    sourceFiles,
    generatedFiles,
    nodes,
    regions,
  };
}

export function findTraceNode(traceManifest: TraceManifest, nodeId: string): TraceNodeEntry | undefined {
  return traceManifest.nodes.find((node) => node.id === nodeId);
}

export function listTraceRegionsForNode(traceManifest: TraceManifest, nodeId: string): TraceRegionEntry[] {
  return traceManifest.regions.filter((region) => region.nodeId === nodeId);
}

export function listManifestHostFilesForNode(
  semanticManifest: SemanticManifest,
  nodeId: string,
): HostFileEntry[] {
  return listNodeHostFiles(semanticManifest.hostFiles ?? [], nodeId);
}

export function resolveTraceLocation(
  traceManifest: TraceManifest,
  generatedFile: string,
  line: number,
  col: number = 1,
): TraceLookupResult | null {
  const normalizedFile = normalizePath(generatedFile);
  const candidates = traceManifest.regions
    .filter((region) => normalizePath(region.generatedFile) === normalizedFile && containsLocation(region.range, line, col))
    .map((region) => ({ region, node: findTraceNode(traceManifest, region.nodeId) }));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => compareRangeSpecificity(left.region.range, right.region.range));
  const bestScore = rangeSpecificity(candidates[0].region.range);
  const bestMatches = candidates.filter((candidate) => rangeSpecificity(candidate.region.range) === bestScore);

  return {
    kind: bestMatches.length > 1 ? 'ambiguous' : 'match',
    matches: bestMatches,
  };
}

function collectTraceNodes(ir: IRApp): TraceNodeEntry[] {
  const nodes: TraceNodeEntry[] = [];

  const visit = (node: IRNode, parentId?: string): void => {
    nodes.push({
      id: node.id,
      kind: node.kind,
      sourceSpan: node.sourceSpan,
      parentId,
    });
  };

  visit(ir);

  for (const group of ir.navigation) {
    visit(group, ir.id);
    for (const item of group.items) {
      visit(item, group.id);
    }
  }

  for (const model of ir.models) {
    visit(model, ir.id);
    for (const field of model.fields) {
      visit(field, model.id);
    }
  }

  for (const resource of ir.resources) {
    visit(resource, ir.id);
    visitResourceViewNodes(resource.views.list, resource.id, visit);
    visitResourceViewNodes(resource.views.edit, resource.id, visit);
    visitResourceViewNodes(resource.views.create, resource.id, visit);
    visitResourceViewNodes(resource.views.read, resource.id, visit);
  }

  for (const page of ir.pages) {
    visit(page, ir.id);
    for (const action of page.actions) {
      visit(action, page.id);
    }
    for (const block of page.blocks) {
      visit(block, page.id);
    }
  }

  return nodes;
}

function collectTraceNodeSegments(ir: IRApp): Record<string, TraceNodeEntry[]> {
  const segments: Record<string, TraceNodeEntry[]> = {};

  const addNode = (rootId: string, node: IRNode, parentId?: string) => {
    const entries = segments[rootId] ?? [];
    entries.push({
      id: node.id,
      kind: node.kind,
      sourceSpan: node.sourceSpan,
      parentId,
    });
    segments[rootId] = entries;
  };

  addNode(ir.id, ir);

  for (const group of ir.navigation) {
    addNode(ir.id, group, ir.id);
    for (const item of group.items) {
      addNode(ir.id, item, group.id);
    }
  }

  for (const model of ir.models) {
    addNode(model.id, model, ir.id);
    for (const field of model.fields) {
      addNode(model.id, field, model.id);
    }
  }

  for (const resource of ir.resources) {
    addNode(resource.id, resource, ir.id);
    visitResourceViewNodes(resource.views.list, resource.id, (node, parentId) => addNode(resource.id, node, parentId));
    visitResourceViewNodes(resource.views.edit, resource.id, (node, parentId) => addNode(resource.id, node, parentId));
    visitResourceViewNodes(resource.views.create, resource.id, (node, parentId) => addNode(resource.id, node, parentId));
    visitResourceViewNodes(resource.views.read, resource.id, (node, parentId) => addNode(resource.id, node, parentId));
  }

  for (const readModel of ir.readModels) {
    addNode(readModel.id, readModel, ir.id);
    if (readModel.rules) {
      addNode(readModel.id, readModel.rules, readModel.id);
    }
    for (const field of [...readModel.inputs, ...readModel.result]) {
      addNode(readModel.id, field, readModel.id);
    }
    if (readModel.list) {
      addNode(readModel.id, readModel.list, readModel.id);
      for (const column of readModel.list.columns) {
        addNode(readModel.id, column, readModel.list.id);
      }
    }
  }

  for (const page of ir.pages) {
    addNode(page.id, page, ir.id);
    for (const action of page.actions) {
      addNode(page.id, action, page.id);
    }
    for (const block of page.blocks) {
      addNode(page.id, block, page.id);
      for (const action of block.rowActions) {
        addNode(page.id, action, block.id);
      }
    }
  }

  return segments;
}

function visitResourceViewNodes(
  view: IRListView | IREditView | IRCreateView | IRReadView | undefined,
  parentId: string,
  visit: (node: IRNode, parentId?: string) => void,
): void {
  if (!view) return;

  visit(view, parentId);

  if ('filters' in view) {
    for (const filter of view.filters) {
      visit(filter, view.id);
    }
  }

  if ('columns' in view) {
    for (const column of view.columns) {
      visit(column, view.id);
    }
  }

  if ('actions' in view) {
    for (const action of view.actions) {
      visit(action, view.id);
    }
  }

  if ('fields' in view) {
    for (const field of view.fields) {
      visit(field, view.id);
    }
  }

  if ('includes' in view) {
    for (const include of view.includes) {
      visit(include, view.id);
      for (const field of include.fields) {
        visit(field, include.id);
      }
    }
  }

  if ('related' in view) {
    for (const panel of view.related) {
      visit(panel, view.id);
    }
  }
}

function extractSourceMarkers(content: string): SourceMarker[] {
  const lines = content.split('\n');
  const markers: SourceMarker[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(SOURCE_NODE_REGEX);
    if (match) {
      markers.push({
        nodeId: match[1],
        line: index + 1,
      });
    }
  }

  return markers;
}

function buildFileTraceEntry(
  file: GeneratedFile,
  baseNodeMap: Map<string, TraceNodeEntry>,
): FileTraceCacheEntry {
  const nodeMap = new Map(baseNodeMap);
  const syntheticNodes: TraceNodeEntry[] = [];

  for (const marker of extractSourceMarkers(file.content)) {
    if (!nodeMap.has(marker.nodeId)) {
      const syntheticNode = synthesizeTraceNode(marker.nodeId, nodeMap);
      nodeMap.set(syntheticNode.id, syntheticNode);
      syntheticNodes.push(syntheticNode);
    }
  }

  const regions: TraceRegionEntry[] = [{
    generatedFile: file.path,
    range: generatedFileRange(file.path, file.content),
    nodeId: file.sourceNode,
    role: 'file.root',
  }, ...buildMarkerRegions(file, nodeMap)];

  return {
    signature: createStableSignature({
      path: file.path,
      sourceNode: file.sourceNode,
      content: file.content,
    }),
    nodes: syntheticNodes,
    regions,
  };
}

function synthesizeTraceNode(nodeId: string, nodeMap: Map<string, TraceNodeEntry>): TraceNodeEntry {
  const parentId = deriveSyntheticParentId(nodeId, nodeMap);
  return {
    id: nodeId,
    kind: deriveSyntheticKind(nodeId),
    parentId,
    sourceSpan: parentId ? nodeMap.get(parentId)?.sourceSpan : undefined,
  };
}

function deriveSyntheticParentId(nodeId: string, nodeMap: Map<string, TraceNodeEntry>): string | undefined {
  if (nodeId === 'app.main.router' && nodeMap.has('app.main')) {
    return 'app.main';
  }

  const ruleParentMatch = nodeId.match(/^(.*)\.rules\.(visibleIf|enabledIf|allowIf|enforce)$/);
  if (ruleParentMatch && nodeMap.has(ruleParentMatch[1])) {
    return ruleParentMatch[1];
  }

  let candidate = nodeId;
  while (candidate.includes('.')) {
    candidate = candidate.substring(0, candidate.lastIndexOf('.'));
    if (nodeMap.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function deriveSyntheticKind(nodeId: string): string {
  if (nodeId === 'app.main.router') return 'router';

  const ruleMatch = nodeId.match(/\.rules\.(visibleIf|enabledIf|allowIf|enforce)$/);
  if (ruleMatch) {
    return `rule.${ruleMatch[1]}`;
  }

  if (nodeId.endsWith('.columns')) return 'columns';
  if (nodeId.endsWith('.filters')) return 'filters';
  if (nodeId.endsWith('.schema')) return 'schema';

  return 'synthetic';
}

function buildMarkerRegions(file: GeneratedFile, nodeMap: Map<string, TraceNodeEntry>): TraceRegionEntry[] {
  const markers = extractSourceMarkers(file.content).filter((marker) => nodeMap.has(marker.nodeId));
  if (markers.length === 0) return [];

  const lines = file.content.split('\n');
  const regions: TraceRegionEntry[] = [];
  const stack: SourceMarker[] = [];

  for (const marker of markers) {
    while (stack.length > 0 && !isStrictAncestor(stack[stack.length - 1].nodeId, marker.nodeId, nodeMap)) {
      const openMarker = stack.pop()!;
      regions.push({
        generatedFile: file.path,
        range: buildLineRange(file.path, lines, openMarker.line, marker.line - 1),
        nodeId: openMarker.nodeId,
        role: roleForNode(file.path, nodeMap.get(openMarker.nodeId)!),
      });
    }

    stack.push(marker);
  }

  while (stack.length > 0) {
    const openMarker = stack.pop()!;
    regions.push({
      generatedFile: file.path,
      range: buildLineRange(file.path, lines, openMarker.line, lines.length),
      nodeId: openMarker.nodeId,
      role: roleForNode(file.path, nodeMap.get(openMarker.nodeId)!),
    });
  }

  return regions;
}

function isStrictAncestor(
  possibleAncestorId: string,
  nodeId: string,
  nodeMap: Map<string, TraceNodeEntry>,
): boolean {
  if (possibleAncestorId === nodeId) return false;

  let current = nodeMap.get(nodeId);
  while (current?.parentId) {
    if (current.parentId === possibleAncestorId) {
      return true;
    }
    current = nodeMap.get(current.parentId);
  }

  return false;
}

function roleForNode(filePath: string, node: TraceNodeEntry): string {
  const normalizedFile = normalizePath(filePath);

  if (normalizedFile === 'router.tsx' && (node.kind.startsWith('view.') || node.kind === 'page')) {
    return 'router.route';
  }
  if (normalizedFile === 'layout/AdminLayout.tsx' && node.kind === 'navGroup') {
    return 'nav.group';
  }
  if (normalizedFile === 'layout/AdminLayout.tsx' && node.kind === 'navItem') {
    return 'nav.item';
  }

  switch (node.kind) {
    case 'app':
      return 'app.root';
    case 'resource':
      return 'resource.root';
    case 'model':
      return 'model.root';
    case 'field':
      return 'field.definition';
    case 'filter':
      return 'filter.definition';
    case 'column':
      return 'column.definition';
    case 'action':
      return 'action.definition';
    case 'formField':
      return 'field.definition';
    case 'view.list':
    case 'view.edit':
    case 'view.create':
    case 'view.read':
      return 'component.root';
    case 'relatedPanel':
      return 'panel.definition';
    case 'page':
      return 'page.root';
    case 'pageAction':
      return 'action.definition';
    case 'dashboardBlock':
      return 'block.definition';
    case 'router':
      return 'router.root';
    case 'columns':
      return 'columns.group';
    case 'filters':
      return 'filters.group';
    case 'rule.visibleIf':
      return 'rule.visibleIf';
    case 'rule.enabledIf':
      return 'rule.enabledIf';
    case 'rule.allowIf':
      return 'rule.allowIf';
    case 'rule.enforce':
      return 'rule.enforce';
    case 'navGroup':
      return 'nav.group';
    case 'navItem':
      return 'nav.item';
    default:
      return `${node.kind}.region`;
  }
}

function containsLocation(range: SourceSpan, line: number, col: number): boolean {
  if (line < range.startLine || line > range.endLine) return false;
  if (line === range.startLine && col < range.startCol) return false;
  if (line === range.endLine && col >= range.endCol) return false;
  return true;
}

function compareRangeSpecificity(left: SourceSpan, right: SourceSpan): number {
  return rangeSpecificity(left) - rangeSpecificity(right);
}

function rangeSpecificity(range: SourceSpan): number {
  const lineSpan = Math.max(range.endLine - range.startLine, 0);
  const colSpan = Math.max(range.endCol - range.startCol, 0);
  return lineSpan * 100000 + colSpan;
}

function buildLineRange(path: string, lines: string[], startLine: number, endLine: number): SourceSpan {
  const safeStartLine = Math.max(1, Math.min(startLine, lines.length));
  const safeEndLine = Math.max(safeStartLine, Math.min(endLine, lines.length));
  const endCol = (lines[safeEndLine - 1] ?? '').length + 1;

  return {
    file: path,
    startLine: safeStartLine,
    startCol: 1,
    endLine: safeEndLine,
    endCol,
  };
}

function generatedFileRange(path: string, content: string): SourceSpan {
  const lines = content.length > 0 ? content.split('\n') : [''];
  const lastLine = lines.length;
  const lastCol = (lines[lastLine - 1] ?? '').length + 1;

  return {
    file: path,
    startLine: 1,
    startCol: 1,
    endLine: lastLine,
    endCol: lastCol,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function resolveManifestRootEntry<T>(
  signature: string,
  previous: ManifestCacheEntry<T> | undefined,
  shouldReuse: boolean | undefined,
  emit: () => T[],
): { entries: T[]; cacheEntry: ManifestCacheEntry<T> } {
  if (previous && shouldReuse && previous.signature === signature) {
    return {
      entries: previous.entries,
      cacheEntry: previous,
    };
  }

  const entries = emit();
  return {
    entries,
    cacheEntry: {
      signature,
      entries,
    },
  };
}

function resolveManifestValue<T>(
  signature: string,
  previous: ManifestValueCacheEntry<T> | undefined,
  emit: () => T,
): { value: T; cacheEntry: ManifestValueCacheEntry<T> } {
  if (previous && previous.signature === signature) {
    return {
      value: previous.value,
      cacheEntry: previous,
    };
  }

  const value = emit();
  return {
    value,
    cacheEntry: {
      signature,
      value,
    },
  };
}

function createRootSignatureList<T>(
  entries: Record<string, ManifestCacheEntry<T>>,
): Array<[string, string]> {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rootId, entry]) => [rootId, entry.signature]);
}

function normalizeOptionalModuleGraph(
  moduleGraph?: Record<string, string[]>,
): Record<string, string[]> | null {
  if (!moduleGraph || !Object.values(moduleGraph).some((imports) => imports.length > 0)) {
    return null;
  }
  return moduleGraph;
}

function cloneOptionalModuleGraph(
  moduleGraph?: Record<string, string[]>,
): Record<string, string[]> | undefined {
  if (!moduleGraph || !Object.values(moduleGraph).some((imports) => imports.length > 0)) {
    return undefined;
  }

  const clone: Record<string, string[]> = {};
  for (const [fileName, imports] of Object.entries(moduleGraph)) {
    clone[fileName] = [...imports];
  }
  return clone;
}

function mergeTraceNodes(
  baseNodes: TraceNodeEntry[],
  files: GeneratedFile[],
  fileTrace: Record<string, FileTraceCacheEntry>,
): TraceNodeEntry[] {
  const merged = [...baseNodes];
  const seen = new Set(baseNodes.map((node) => node.id));

  for (const file of files) {
    for (const node of fileTrace[file.path]?.nodes ?? []) {
      if (seen.has(node.id)) {
        continue;
      }
      seen.add(node.id);
      merged.push(node);
    }
  }

  return merged;
}
