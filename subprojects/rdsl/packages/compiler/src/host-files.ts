import type {
  IRApp,
  IRDashboardBlock,
  IRColumn,
  IRFormField,
  IRModel,
  IRNode,
  IRReadModel,
  IRRelatedPanel,
  IRResource,
  IRRules,
  RuleValue,
} from './ir.js';
import { analyzePageTableBlockData } from './page-table-block.js';
import {
  dirnameProjectPath,
  resolveProjectPath,
  toProjectRelativePath,
} from './project-paths.js';

export interface HostFileReferenceEntry {
  nodeId: string;
  role: string;
  sourceFile?: string;
  logicalPath?: string;
  lockIn?: 'neutral' | 'explicit';
}

export interface HostFileDependencyEntry {
  path: string;
  kind: 'script' | 'style';
  importers: string[];
}

export interface HostFileEntry {
  path: string;
  references: HostFileReferenceEntry[];
  dependencies?: HostFileDependencyEntry[];
}

export interface HostFileCollectionOptions {
  readFile?: (filePath: string) => string | undefined;
}

export function collectHostFileSegments(
  ir: IRApp | undefined,
  options: HostFileCollectionOptions = {},
): Record<string, HostFileEntry[]> {
  if (!ir) return {};

  const segments = new Map<string, Map<string, HostFileEntry>>();
  const dependencyCache = new Map<string, HostFileDependencyEntry[]>();
  const addReference = (
    rootId: string,
    path: string | undefined,
    owner: IRNode,
    role: string,
    metadata: Pick<HostFileReferenceEntry, 'logicalPath' | 'lockIn'> = {},
  ) => {
    if (!path) return;

    const segment = segments.get(rootId) ?? new Map<string, HostFileEntry>();
    const existing = segment.get(path) ?? { path, references: [] };
    if (!existing.references.some((reference) => (
      reference.nodeId === owner.id &&
      reference.role === role &&
      reference.logicalPath === metadata.logicalPath &&
      reference.lockIn === metadata.lockIn
    ))) {
      existing.references.push({
        nodeId: owner.id,
        role,
        sourceFile: owner.sourceSpan?.file,
        logicalPath: metadata.logicalPath,
        lockIn: metadata.lockIn,
      });
    }
    segment.set(path, existing);
    segments.set(rootId, segment);
  };
  const addRuleReference = (rootId: string, rule: RuleValue | undefined, owner: IRNode, role: string) => {
    if (rule?.source === 'escape-fn') {
      addReference(rootId, rule.escape.path, owner, role, {
        logicalPath: rule.escape.logicalPath,
        lockIn: rule.escape.lockIn,
      });
    }
  };

  for (const group of ir.navigation) {
    addRuleReference(ir.id, group.visibleIf, group, 'nav.visibleIf');
  }

  addReference(ir.id, ir.style?.resolvedPath, ir, 'app.style', {
    logicalPath: ir.style?.logicalPath,
    lockIn: ir.style?.lockIn,
  });
  addReference(ir.id, ir.seo?.defaultImage?.resolvedPath, ir, 'app.seo.defaultImage', {
    logicalPath: ir.seo?.defaultImage?.logicalPath,
    lockIn: ir.seo?.defaultImage?.lockIn,
  });
  addReference(ir.id, ir.seo?.favicon?.resolvedPath, ir, 'app.seo.favicon', {
    logicalPath: ir.seo?.favicon?.logicalPath,
    lockIn: ir.seo?.favicon?.lockIn,
  });

  for (const resource of ir.resources) {
    addReference(resource.id, resource.workflow?.resolvedPath, resource, 'resource.workflow', {
      logicalPath: resource.workflow?.logicalPath,
      lockIn: resource.workflow?.lockIn,
    });
    for (const view of [resource.views.list, resource.views.edit, resource.views.create, resource.views.read]) {
      if (!view) continue;

      if ('rulesLink' in view) {
        addReference(resource.id, view.rulesLink?.resolvedPath, view, `${view.kind}.rules`, {
          logicalPath: view.rulesLink?.logicalPath,
          lockIn: view.rulesLink?.lockIn,
        });
      }
      if ('includes' in view) {
        for (const include of view.includes) {
          addReference(resource.id, include.rulesLink?.resolvedPath, include, `${view.kind}.includes.${include.field}.rules`, {
            logicalPath: include.rulesLink?.logicalPath,
            lockIn: include.rulesLink?.lockIn,
          });
        }
      }

      if ('rules' in view) {
        collectRuleFiles(resource.id, view.rules, view, addRuleReference);
      }

      if ('columns' in view) {
        for (const column of view.columns) {
          collectColumnFiles(resource.id, column, addReference);
        }
      }

      if ('fields' in view && view.kind !== 'view.read') {
        for (const field of view.fields) {
          collectFormFieldFiles(resource.id, field, addReference, addRuleReference);
        }
        if ('includes' in view) {
          for (const include of view.includes) {
            for (const field of include.fields) {
              collectFormFieldFiles(resource.id, field, addReference, addRuleReference);
            }
          }
        }
      }
      if ('fields' in view && view.kind === 'view.read') {
        for (const field of view.fields) {
          collectColumnFiles(resource.id, field, addReference);
        }
        collectReadRelatedPanelFiles(resource.id, resource.model, view.related, ir.resources, ir.models, addReference);
      }
    }
  }

  for (const readModel of ir.readModels) {
    addReference(readModel.id, readModel.rules?.resolvedPath, readModel, 'readModel.rules', {
      logicalPath: readModel.rules?.logicalPath,
      lockIn: readModel.rules?.lockIn,
    });
  }

  for (const page of ir.pages) {
    addReference(page.id, page.seo?.image?.resolvedPath, page, 'page.seo.image', {
      logicalPath: page.seo?.image?.logicalPath,
      lockIn: page.seo?.image?.lockIn,
    });
    for (const block of page.blocks) {
      collectDashboardBlockFiles(page.id, block, ir.resources, ir.models, ir.readModels, addReference);
    }
  }

  return Object.fromEntries(Array.from(segments.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rootId, entries]) => [
      rootId,
      Array.from(entries.values())
        .map((entry) => ({
          path: entry.path,
          references: [...entry.references].sort(compareHostFileReference),
          dependencies: getHostDependencies(entry.path, options.readFile, dependencyCache),
        }))
        .map((entry) => entry.dependencies && entry.dependencies.length > 0 ? entry : {
          path: entry.path,
          references: entry.references,
        })
        .sort((left, right) => left.path.localeCompare(right.path)),
    ]));
}

export function collectHostFiles(
  ir: IRApp | undefined,
  options: HostFileCollectionOptions = {},
): HostFileEntry[] {
  return mergeHostFileSegments(collectHostFileSegments(ir, options));
}

export function listHostFilesForNode(hostFiles: HostFileEntry[], nodeId: string): HostFileEntry[] {
  return hostFiles
    .map((entry) => ({
      path: entry.path,
      references: entry.references.filter((reference) => reference.nodeId === nodeId),
      dependencies: entry.dependencies ? [...entry.dependencies] : undefined,
    }))
    .filter((entry) => entry.references.length > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function listMaterializedHostFiles(hostFiles: HostFileEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of hostFiles) {
    paths.add(entry.path);
    for (const dependency of entry.dependencies ?? []) {
      paths.add(dependency.path);
    }
  }
  return Array.from(paths).sort((left, right) => left.localeCompare(right));
}

function collectRuleFiles(
  rootId: string,
  rules: IRRules | undefined,
  owner: IRNode,
  addRuleReference: (rootId: string, rule: RuleValue | undefined, owner: IRNode, role: string) => void,
): void {
  if (!rules) return;
  addRuleReference(rootId, rules.visibleIf, owner, 'rule.visibleIf');
  addRuleReference(rootId, rules.enabledIf, owner, 'rule.enabledIf');
  addRuleReference(rootId, rules.allowIf, owner, 'rule.allowIf');
  addRuleReference(rootId, rules.enforce, owner, 'rule.enforce');
}

function collectColumnFiles(
  rootId: string,
  column: IRColumn,
  addReference: (
    rootId: string,
    path: string | undefined,
    owner: IRNode,
    role: string,
    metadata?: Pick<HostFileReferenceEntry, 'logicalPath' | 'lockIn'>,
  ) => void,
): void {
  addReference(rootId, column.displayFn?.path, column, 'column.displayFn', {
    logicalPath: column.displayFn?.logicalPath,
    lockIn: column.displayFn?.lockIn,
  });
  addReference(rootId, column.customRenderer, column, 'column.customRenderer');
}

function collectFormFieldFiles(
  rootId: string,
  field: IRFormField,
  addReference: (
    rootId: string,
    path: string | undefined,
    owner: IRNode,
    role: string,
    metadata?: Pick<HostFileReferenceEntry, 'logicalPath' | 'lockIn'>,
  ) => void,
  addRuleReference: (rootId: string, rule: RuleValue | undefined, owner: IRNode, role: string) => void,
): void {
  addRuleReference(rootId, field.visibleWhen, field, 'field.visibleWhen');
  addRuleReference(rootId, field.enabledWhen, field, 'field.enabledWhen');
  addReference(rootId, field.validateFn?.path, field, 'field.validateFn', {
    logicalPath: field.validateFn?.logicalPath,
    lockIn: field.validateFn?.lockIn,
  });
  addReference(rootId, field.customField, field, 'field.customField');
}

function collectDashboardBlockFiles(
  rootId: string,
  block: IRDashboardBlock,
  resources: IRResource[],
  models: IRModel[],
  readModels: IRReadModel[],
  addReference: (
    rootId: string,
    path: string | undefined,
    owner: IRNode,
    role: string,
    metadata?: Pick<HostFileReferenceEntry, 'logicalPath' | 'lockIn'>,
  ) => void,
): void {
  addReference(rootId, block.customBlock, block, 'block.customBlock');

  const analysis = analyzePageTableBlockData(block, resources, models, readModels);
  if (analysis.kind !== 'resourceList' && analysis.kind !== 'recordRelationList') {
    return;
  }
  if (!analysis.listView) {
    return;
  }

  for (const column of analysis.listView.columns) {
    addReference(rootId, column.displayFn?.path, block, 'block.table.column.displayFn', {
      logicalPath: column.displayFn?.logicalPath,
      lockIn: column.displayFn?.lockIn,
    });
    addReference(rootId, column.customRenderer, block, 'block.table.column.customRenderer');
  }
}

function collectReadRelatedPanelFiles(
  rootId: string,
  modelName: string,
  related: IRRelatedPanel[],
  resources: IRResource[],
  models: IRModel[],
  addReference: (
    rootId: string,
    path: string | undefined,
    owner: IRNode,
    role: string,
    metadata?: Pick<HostFileReferenceEntry, 'logicalPath' | 'lockIn'>,
  ) => void,
): void {
  const model = models.find((candidate) => candidate.name === modelName);
  if (!model) {
    return;
  }

  for (const panel of related) {
    const modelField = model.fields.find((candidate): candidate is IRModel['fields'][number] & {
      fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
    } => (
      candidate.name === panel.field
      && candidate.fieldType.type === 'relation'
      && candidate.fieldType.kind === 'hasMany'
    ));
    if (!modelField) {
      continue;
    }

    const targetResource = resources.find((candidate) => candidate.model === modelField.fieldType.target);
    const listView = targetResource?.views.list;
    if (!listView || listView.columns.length === 0) {
      continue;
    }

    for (const column of listView.columns) {
      addReference(rootId, column.displayFn?.path, panel, 'read.related.column.displayFn', {
        logicalPath: column.displayFn?.logicalPath,
        lockIn: column.displayFn?.lockIn,
      });
      addReference(rootId, column.customRenderer, panel, 'read.related.column.customRenderer');
    }
  }
}

function compareHostFileReference(left: HostFileReferenceEntry, right: HostFileReferenceEntry): number {
  if (left.nodeId !== right.nodeId) {
    return left.nodeId.localeCompare(right.nodeId);
  }
  if (left.role !== right.role) {
    return left.role.localeCompare(right.role);
  }
  if ((left.logicalPath ?? '') !== (right.logicalPath ?? '')) {
    return (left.logicalPath ?? '').localeCompare(right.logicalPath ?? '');
  }
  if ((left.lockIn ?? '') !== (right.lockIn ?? '')) {
    return (left.lockIn ?? '').localeCompare(right.lockIn ?? '');
  }
  return (left.sourceFile ?? '').localeCompare(right.sourceFile ?? '');
}

export function mergeHostFileSegments(
  segments: Record<string, HostFileEntry[]>,
): HostFileEntry[] {
  const merged = new Map<string, HostFileEntry>();

  for (const entries of Object.values(segments)) {
    for (const entry of entries) {
      const target = merged.get(entry.path) ?? { path: entry.path, references: [] };
      if (!target.dependencies) {
        target.dependencies = [];
      }
      for (const reference of entry.references) {
        if (!target.references.some((existing) => (
          existing.nodeId === reference.nodeId &&
          existing.role === reference.role &&
          existing.sourceFile === reference.sourceFile &&
          existing.logicalPath === reference.logicalPath &&
          existing.lockIn === reference.lockIn
        ))) {
          target.references.push(reference);
        }
      }
      for (const dependency of entry.dependencies ?? []) {
        const existingDependency = target.dependencies?.find((candidate) => (
          candidate.path === dependency.path &&
          candidate.kind === dependency.kind
        ));
        if (existingDependency) {
          for (const importer of dependency.importers) {
            if (!existingDependency.importers.includes(importer)) {
              existingDependency.importers.push(importer);
            }
          }
        } else {
          target.dependencies?.push({
            path: dependency.path,
            kind: dependency.kind,
            importers: [...dependency.importers],
          });
        }
      }
      merged.set(entry.path, target);
    }
  }

  return Array.from(merged.values())
    .map((entry) => ({
      path: entry.path,
      references: [...entry.references].sort(compareHostFileReference),
      dependencies: normalizeDependencies(entry.dependencies),
    }))
    .map((entry) => entry.dependencies && entry.dependencies.length > 0 ? entry : {
      path: entry.path,
      references: entry.references,
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeDependencies(
  dependencies: HostFileDependencyEntry[] | undefined,
): HostFileDependencyEntry[] | undefined {
  if (!dependencies || dependencies.length === 0) {
    return undefined;
  }

  return [...dependencies]
    .map((dependency) => ({
      path: dependency.path,
      kind: dependency.kind,
      importers: [...dependency.importers].sort((left, right) => left.localeCompare(right)),
    }))
    .sort(compareHostFileDependency);
}

function compareHostFileDependency(left: HostFileDependencyEntry, right: HostFileDependencyEntry): number {
  if (left.path !== right.path) {
    return left.path.localeCompare(right.path);
  }
  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }
  return left.importers.join(',').localeCompare(right.importers.join(','));
}

function getHostDependencies(
  hostFilePath: string,
  readFile: HostFileCollectionOptions['readFile'],
  cache: Map<string, HostFileDependencyEntry[]>,
): HostFileDependencyEntry[] | undefined {
  if (!readFile) {
    return undefined;
  }

  const cached = cache.get(hostFilePath);
  if (cached) {
    return cached;
  }

  const dependencies = scanHostDependencies(hostFilePath, readFile);
  cache.set(hostFilePath, dependencies);
  return dependencies.length > 0 ? dependencies : undefined;
}

function scanHostDependencies(
  rootHostFilePath: string,
  readFile: (filePath: string) => string | undefined,
): HostFileDependencyEntry[] {
  const dependencies = new Map<string, HostFileDependencyEntry>();
  const visitedScripts = new Set<string>();
  const pendingScripts = [rootHostFilePath];

  while (pendingScripts.length > 0) {
    const currentFile = pendingScripts.pop();
    if (!currentFile || visitedScripts.has(currentFile)) {
      continue;
    }
    visitedScripts.add(currentFile);

    let sourceText: string;
    try {
      const nextSourceText = readFile(currentFile);
      if (nextSourceText === undefined) {
        continue;
      }
      sourceText = nextSourceText;
    } catch {
      continue;
    }

    for (const specifier of extractStaticRelativeImports(sourceText)) {
      const resolved = resolveHostDependencyPath(currentFile, specifier, readFile);
      if (!resolved || resolved.path === rootHostFilePath) {
        continue;
      }

      const existing = dependencies.get(resolved.path) ?? {
        path: resolved.path,
        kind: resolved.kind,
        importers: [],
      };
      if (!existing.importers.includes(currentFile)) {
        existing.importers.push(currentFile);
      }
      dependencies.set(resolved.path, existing);

      if (resolved.kind === 'script') {
        pendingScripts.push(resolved.path);
      }
    }
  }

  return Array.from(dependencies.values())
    .map((dependency) => ({
      path: dependency.path,
      kind: dependency.kind,
      importers: [...dependency.importers].sort((left, right) => left.localeCompare(right)),
    }))
    .sort(compareHostFileDependency);
}

function extractStaticRelativeImports(sourceText: string): string[] {
  const specifiers = new Set<string>();
  const importPattern = /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null = importPattern.exec(sourceText);
  while (match) {
    const specifier = match[1];
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      specifiers.add(specifier);
    }
    match = importPattern.exec(sourceText);
  }
  return Array.from(specifiers).sort((left, right) => left.localeCompare(right));
}

function classifyHostDependency(path: string): HostFileDependencyEntry['kind'] | undefined {
  const normalizedPath = path.toLowerCase();
  if (normalizedPath.endsWith('.css')) {
    return 'style';
  }
  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.jsx') ||
    normalizedPath.endsWith('.mjs')
  ) {
    return 'script';
  }
  return undefined;
}

function resolveHostDependencyPath(
  fromFile: string,
  specifier: string,
  readFile: (filePath: string) => string | undefined,
): { path: string; kind: HostFileDependencyEntry['kind'] } | undefined {
  const baseCandidate = toProjectRelativePath(
    '.',
    resolveProjectPath(dirnameProjectPath(fromFile), specifier),
  );
  if (!baseCandidate) {
    return undefined;
  }

  const directKind = classifyHostDependency(baseCandidate);
  if (directKind) {
    return {
      path: baseCandidate,
      kind: directKind,
    };
  }

  for (const candidate of buildScriptResolutionCandidates(baseCandidate)) {
    if (!isReadableHostDependency(candidate, readFile)) {
      continue;
    }
    return {
      path: candidate,
      kind: 'script',
    };
  }

  return undefined;
}

function buildScriptResolutionCandidates(basePath: string): string[] {
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
    `${basePath}/index.mjs`,
  ];
}

function isReadableHostDependency(
  filePath: string,
  readFile: (filePath: string) => string | undefined,
): boolean {
  try {
    return readFile(filePath) !== undefined;
  } catch {
    return false;
  }
}
