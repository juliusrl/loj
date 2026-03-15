/**
 * ReactDSL Normalizer
 *
 * Transforms a RawAST into the versioned IR (Intermediate Representation).
 * - Assigns stable node IDs
 * - Expands shorthands
 * - Parses expressions into ExprNode ASTs
 * - Parses effects into EffectNode ASTs
 * - Resolves decorator arguments
 */

import type {
  IRApp, IRModel, IRModelField, IRFieldType, IRFieldDecorator,
  IRResource, IRListView, IREditView, IRCreateView, IRCreateInclude, IRReadView, IRRelatedPanel,
  IRColumn, IRColumnDecorator, IRFilter, IRFormField, IRAction, IRReadModel, IRReadModelField, IRReadModelListView,
  IRRules, IRNavGroup, IRNavItem, IRPage, IRDashboardBlock, IRDashboardRowAction, IRPageAction,
  ExprNode, EffectNode, RuleValue, DynamicValue, ToastMessageDescriptorNode, MessageLikeNode, MessageValueNode,
  EscapeExpr, EscapeFn, EscapeHatchStats, IRFlowLink, IRRulesLink,
} from './ir.js';
import type {
  RawAST, RawModel, RawField, RawResource, RawListView,
  RawEditView, RawCreateView, RawCreateInclude, RawReadView, RawColumnEntry, RawAction, RawFormFieldEntry,
  RawEffect, RawRules, RawDecorator, RawNavGroup, RawPage, RawDashboardBlock, RawToastMessageDescriptor, RawReadModel, RawReadModelListView, RawMessageLike,
  RawDashboardRowAction, RawDashboardRowSeedValue, RawPageAction, RawPageActionSeedValue,
} from './parser.js';
import { parseColumnEntry } from './parser.js';
import { parseExpr } from './expr.js';
import { compileFlowSource, isFlowSourceFile } from './flow-proof.js';
import { compileRulesSource, isRulesSourceFile } from './rules-proof.js';
import { compileStyleSource, isStyleSourceFile } from './style-proof.js';
import {
  dirnameProjectPath,
  resolveProjectPath,
  toProjectRelativePath,
} from './project-paths.js';

// ─── Error Collection ────────────────────────────────────────────

export interface NormalizeError {
  message: string;
  nodeId?: string;
}

export interface NormalizeResult {
  ir: IRApp;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeCacheSnapshot;
}

export interface NormalizeCacheEntry<T> {
  signature: string;
  value: T;
  errors: NormalizeError[];
}

export interface NormalizeResourceCacheSnapshot {
  resource?: NormalizeCacheEntry<IRResource>;
  list?: NormalizeListViewCacheSnapshot;
  edit?: NormalizeFormViewCacheSnapshot<IREditView>;
  create?: NormalizeFormViewCacheSnapshot<IRCreateView>;
  read?: NormalizeReadViewCacheSnapshot;
}

export interface NormalizePageCacheSnapshot {
  page?: NormalizeCacheEntry<IRPage>;
  blocks: Record<string, NormalizeCacheEntry<IRDashboardBlock>>;
}

export interface NormalizeNavGroupCacheSnapshot {
  group?: NormalizeCacheEntry<IRNavGroup>;
  items: Record<string, NormalizeCacheEntry<IRNavItem>>;
}

export interface NormalizeModelCacheSnapshot {
  model?: NormalizeCacheEntry<IRModel>;
  fields: Record<string, NormalizeCacheEntry<IRModelField>>;
}

export interface NormalizeReadModelListCacheSnapshot {
  view?: NormalizeCacheEntry<IRReadModelListView>;
  columns: Record<string, NormalizeCacheEntry<IRColumn>>;
}

export interface NormalizeReadModelCacheSnapshot {
  readModel?: NormalizeCacheEntry<IRReadModel>;
  inputs: Record<string, NormalizeCacheEntry<IRReadModelField>>;
  result: Record<string, NormalizeCacheEntry<IRReadModelField>>;
  list?: NormalizeReadModelListCacheSnapshot;
}

export interface NormalizeListViewCacheSnapshot {
  view?: NormalizeCacheEntry<IRListView>;
  filters: Record<string, NormalizeCacheEntry<IRFilter>>;
  columns: Record<string, NormalizeCacheEntry<IRColumn>>;
  actions: Record<string, NormalizeCacheEntry<IRAction>>;
}

export interface NormalizeFormViewCacheSnapshot<TView extends IREditView | IRCreateView> {
  view?: NormalizeCacheEntry<TView>;
  fields: Record<string, NormalizeCacheEntry<IRFormField>>;
  includes: Record<string, NormalizeCreateIncludeCacheSnapshot>;
}

export interface NormalizeCreateIncludeCacheSnapshot {
  include?: NormalizeCacheEntry<IRCreateInclude>;
  fields: Record<string, NormalizeCacheEntry<IRFormField>>;
}

export interface NormalizeReadViewCacheSnapshot {
  view?: NormalizeCacheEntry<IRReadView>;
  fields: Record<string, NormalizeCacheEntry<IRColumn>>;
  related: Record<string, NormalizeCacheEntry<IRRelatedPanel>>;
}

export interface NormalizeCacheSnapshot {
  version: string;
  app?: NormalizeCacheEntry<NormalizedAppShellSegment>;
  navigationGroups: Record<string, NormalizeNavGroupCacheSnapshot>;
  models: Record<string, NormalizeModelCacheSnapshot>;
  resources: Record<string, NormalizeResourceCacheSnapshot>;
  readModels: Record<string, NormalizeReadModelCacheSnapshot>;
  pages: Record<string, NormalizePageCacheSnapshot>;
}

export interface NormalizeOptions {
  cache?: NormalizeCacheSnapshot;
  projectRoot?: string;
  readFile?: (fileName: string) => string | undefined;
}

interface NormalizedAppShellSegment {
  name: string;
  compiler: IRApp['compiler'];
  theme: IRApp['theme'];
  auth: IRApp['auth'];
  style?: IRApp['style'];
  seo?: IRApp['seo'];
  sourceSpan?: IRApp['sourceSpan'];
}

const NORMALIZE_CACHE_VERSION = '0.1.7';
const FLOW_LINK_REGEX = /^@flow\(["'](.+?)["']\)$/;
const RULES_LINK_REGEX = /^@rules\(["'](.+?)["']\)$/;
const STYLE_LINK_REGEX = /^@style\(["'](.+?)["']\)$/;
const ASSET_LINK_REGEX = /^@asset\(["'](.+?)["']\)$/;

// ─── Main Entry Point ────────────────────────────────────────────

export function normalize(ast: RawAST, options: NormalizeOptions = {}): NormalizeResult {
  const previousCache = options.cache?.version === NORMALIZE_CACHE_VERSION
    ? options.cache
    : undefined;
  const appSegment = resolveNormalizedSegment(
    createNormalizeSignature({
      app: ast.app
        ? {
          name: ast.app.name,
          theme: ast.app.theme,
          auth: ast.app.auth,
          style: ast.app.style,
          seo: ast.app.seo,
        }
        : undefined,
      compiler: ast.compiler,
    }),
    previousCache?.app,
    () => normalizeAppShell(ast, options.projectRoot, options.readFile),
  );
  const navigationGroups = (ast.app?.navigation ?? []).map((group, index) =>
    resolveNormalizedNavGroup(
      group,
      `app.nav.${index}`,
      previousCache?.navigationGroups[`app.nav.${index}`],
      options.projectRoot,
      appSegment.value.compiler.language,
      options.readFile,
    )
  );
  const models = ast.models.map((model) =>
    resolveNormalizedModel(
      model,
      previousCache?.models[model.name],
      options.projectRoot,
    )
  );
  const resources = ast.resources.map((resource) =>
    resolveNormalizedResource(
      resource,
      previousCache?.resources[resource.name],
      options.projectRoot,
      appSegment.value.style,
      appSegment.value.compiler.language,
      options.readFile,
    )
  );
  const readModels = ast.readModels.map((readModel) =>
    resolveNormalizedReadModel(
      readModel,
      previousCache?.readModels[readModel.name],
      options.projectRoot,
      options.readFile,
    )
  );
  const pages = ast.pages.map((page) =>
    resolveNormalizedPage(page, previousCache?.pages[page.name], options.projectRoot, appSegment.value.style, options.readFile)
  );

  const ir: IRApp = {
    id: 'app.main',
    kind: 'app',
    schemaVersion: '0.1.0',
    name: appSegment.value.name,
    compiler: appSegment.value.compiler,
    theme: appSegment.value.theme,
    auth: appSegment.value.auth,
    style: appSegment.value.style,
    seo: appSegment.value.seo,
    navigation: navigationGroups.map((entry) => entry.value),
    models: models.map((entry) => entry.value),
    resources: resources.map((entry) => entry.value),
    readModels: readModels.map((entry) => entry.value),
    pages: pages.map((entry) => entry.value),
    sourceSpan: appSegment.value.sourceSpan,
  };

  ir.escapeStats = computeEscapeStats(ir);

  return {
    ir,
    errors: [
      ...appSegment.errors,
      ...navigationGroups.flatMap((entry) => entry.errors),
      ...models.flatMap((entry) => entry.errors),
      ...resources.flatMap((entry) => entry.errors),
      ...readModels.flatMap((entry) => entry.errors),
      ...pages.flatMap((entry) => entry.errors),
    ],
    cacheSnapshot: {
      version: NORMALIZE_CACHE_VERSION,
      app: appSegment.cacheEntry,
      navigationGroups: Object.fromEntries(
        navigationGroups.map((entry) => [entry.value.id, entry.cacheSnapshot])
      ),
      models: Object.fromEntries(ast.models.map((model, index) => [model.name, models[index].cacheSnapshot])),
      resources: Object.fromEntries(ast.resources.map((resource, index) => [resource.name, resources[index].cacheSnapshot])),
      readModels: Object.fromEntries(ast.readModels.map((readModel, index) => [readModel.name, readModels[index].cacheSnapshot])),
      pages: Object.fromEntries(ast.pages.map((page, index) => [page.name, pages[index].cacheSnapshot])),
    },
  };
}

function resolveNormalizedSegment<T>(
  signature: string,
  previous: NormalizeCacheEntry<T> | undefined,
  emit: () => { value: T; errors: NormalizeError[] },
): {
  value: T;
  errors: NormalizeError[];
  cacheEntry: NormalizeCacheEntry<T>;
} {
  if (previous && previous.signature === signature) {
    return {
      value: previous.value,
      errors: previous.errors,
      cacheEntry: previous,
    };
  }

  const emitted = emit();
  const cacheEntry: NormalizeCacheEntry<T> = {
    signature,
    value: emitted.value,
    errors: emitted.errors,
  };
  return {
    value: emitted.value,
    errors: emitted.errors,
    cacheEntry,
  };
}

function createNormalizeSignature(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return current;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current)) {
      if (key === 'sourceSpan') {
        continue;
      }
      normalized[key] = entry;
    }
    return normalized;
  });
}

function resolveNormalizedResource(
  raw: RawResource,
  previous: NormalizeResourceCacheSnapshot | undefined,
  projectRoot?: string,
  appStyle?: IRApp['style'],
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): {
  value: IRResource;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeResourceCacheSnapshot;
} {
  const resourceSignature = createNormalizeSignature(raw);
  if (previous?.resource?.signature === resourceSignature) {
    return {
      value: previous.resource.value,
      errors: previous.resource.errors,
      cacheSnapshot: previous,
    };
  }

  const id = `resource.${raw.name}`;
  const list = raw.list
    ? resolveNormalizedListView(
      raw.list,
      `${id}.view.list`,
      previous?.list,
      projectRoot,
      appStyle,
      compilerLanguage,
      readFile,
    )
    : undefined;
  const edit = raw.edit
    ? resolveNormalizedFormView(
      raw.edit,
      `${id}.view.edit`,
      previous?.edit,
      projectRoot,
      appStyle,
      compilerLanguage,
      readFile,
      normalizeEditView,
    )
    : undefined;
  const create = raw.create
    ? resolveNormalizedFormView(
      raw.create,
      `${id}.view.create`,
      previous?.create,
      projectRoot,
      appStyle,
      compilerLanguage,
      readFile,
      normalizeCreateView,
    )
    : undefined;
  const read = raw.read
    ? resolveNormalizedReadView(
      raw.read,
      `${id}.view.read`,
      previous?.read,
      projectRoot,
      appStyle,
      compilerLanguage,
      readFile,
    )
    : undefined;

  const errors = [
    ...(list?.errors ?? []),
    ...(edit?.errors ?? []),
    ...(create?.errors ?? []),
    ...(read?.errors ?? []),
  ];
  const value: IRResource = {
    id,
    kind: 'resource',
    name: raw.name,
    model: raw.model,
    api: raw.api,
    workflow: raw.workflow
      ? normalizeFlowLink(raw.workflow, raw.workflowSourceSpan?.file ?? raw.sourceSpan?.file, projectRoot, readFile, errors, id, 'resource workflow')
      : undefined,
    workflowStyle: raw.workflowStyle
      ? normalizeStyleReference(raw.workflowStyle, appStyle, `${id}.workflow.style`, errors, 'resource workflow style')
      : undefined,
    views: {
      list: list?.value,
      edit: edit?.value,
      create: create?.value,
      read: read?.value,
    },
    sourceSpan: raw.sourceSpan,
  };

  return {
    value,
    errors,
    cacheSnapshot: {
      resource: {
        signature: resourceSignature,
        value,
        errors,
      },
      list: list?.cacheSnapshot,
      edit: edit?.cacheSnapshot,
      create: create?.cacheSnapshot,
      read: read?.cacheSnapshot,
    },
  };
}

function resolveNormalizedNavGroup(
  raw: RawNavGroup,
  id: string,
  previous: NormalizeNavGroupCacheSnapshot | undefined,
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): {
  value: IRNavGroup;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeNavGroupCacheSnapshot;
} {
  const groupSignature = createNormalizeSignature(raw);
  if (previous?.group?.signature === groupSignature) {
    return {
      value: previous.group.value,
      errors: previous.group.errors,
      cacheSnapshot: previous,
    };
  }

  const items = raw.items.map((item, index) => {
    const itemId = `${id}.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(item),
      previous?.items[itemId],
      () => ({
        value: normalizeNavItem(item, itemId),
        errors: [],
      }),
    );
  });
  const errors: NormalizeError[] = [];
  const value: IRNavGroup = {
    id,
    kind: 'navGroup',
    group: normalizeMessageLike(raw.group, `${id}.group`, errors, 'navigation group label'),
    visibleIf: raw.visibleIf
      ? tryParseRuleValue(
        raw.visibleIf,
        id,
        errors,
        raw.sourceSpan?.file,
        projectRoot,
        compilerLanguage,
        readFile,
        'navigation rule',
      )
      : undefined,
    items: items.map((entry) => entry.value),
    sourceSpan: raw.sourceSpan,
  };
  const combinedErrors = [
    ...errors,
    ...items.flatMap((entry) => entry.errors),
  ];

  return {
    value,
    errors: combinedErrors,
    cacheSnapshot: {
      group: {
        signature: groupSignature,
        value,
        errors: combinedErrors,
      },
      items: Object.fromEntries(items.map((entry, index) => [`${id}.${index}`, entry.cacheEntry])),
    },
  };
}

function resolveNormalizedModel(
  raw: RawModel,
  previous: NormalizeModelCacheSnapshot | undefined,
  _projectRoot?: string,
): {
  value: IRModel;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeModelCacheSnapshot;
} {
  const modelSignature = createNormalizeSignature(raw);
  if (previous?.model?.signature === modelSignature) {
    return {
      value: previous.model.value,
      errors: previous.model.errors,
      cacheSnapshot: previous,
    };
  }

  const id = `model.${raw.name}`;
  const fields = raw.fields.map((field, index) => {
    const fieldKey = `${id}.field.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.fields[fieldKey],
      () => normalizeModelField(field, `${id}.field.${field.name}`),
    );
  });
  const value: IRModel = {
    id,
    kind: 'model',
    name: raw.name,
    fields: fields.map((entry) => entry.value),
    sourceSpan: raw.sourceSpan,
  };

  return {
    value,
    errors: [],
    cacheSnapshot: {
      model: {
        signature: modelSignature,
        value,
        errors: [],
      },
      fields: Object.fromEntries(fields.map((entry, index) => [`${id}.field.${index}`, entry.cacheEntry])),
    },
  };
}

function resolveNormalizedReadModel(
  raw: RawReadModel,
  previous: NormalizeReadModelCacheSnapshot | undefined,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): {
  value: IRReadModel;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeReadModelCacheSnapshot;
} {
  const readModelSignature = createNormalizeSignature(raw);
  if (previous?.readModel?.signature === readModelSignature) {
    return {
      value: previous.readModel.value,
      errors: previous.readModel.errors,
      cacheSnapshot: previous,
    };
  }

  const id = `readModel.${raw.name}`;
  const inputs = raw.inputs.map((field, index) => {
    const fieldKey = `${id}.inputs.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.inputs[fieldKey],
      () => normalizeReadModelField(field, `${id}.inputs.${field.name}`, 'inputs'),
    );
  });
  const result = raw.result.map((field, index) => {
    const fieldKey = `${id}.result.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.result[fieldKey],
      () => normalizeReadModelField(field, `${id}.result.${field.name}`, 'result'),
    );
  });
  const list = raw.list
    ? resolveNormalizedReadModelListView(raw.list, `${id}.list`, previous?.list)
    : undefined;
  const combinedErrors = [
    ...inputs.flatMap((entry) => entry.errors),
    ...result.flatMap((entry) => entry.errors),
    ...(list?.errors ?? []),
  ];
  const value: IRReadModel = {
    id,
    kind: 'readModel',
    name: raw.name,
    api: raw.api || '',
    rules: raw.rules
      ? normalizeRulesLink(raw.rules, raw.sourceSpan?.file, projectRoot, readFile, combinedErrors, id, 'readModel rules')
      : undefined,
    inputs: inputs.map((entry) => entry.value),
    result: result.map((entry) => entry.value),
    list: list?.value,
    sourceSpan: raw.sourceSpan,
  };

  return {
    value,
    errors: combinedErrors,
    cacheSnapshot: {
      readModel: {
        signature: readModelSignature,
        value,
        errors: combinedErrors,
      },
      inputs: Object.fromEntries(inputs.map((entry, index) => [`${id}.inputs.${index}`, entry.cacheEntry])),
      result: Object.fromEntries(result.map((entry, index) => [`${id}.result.${index}`, entry.cacheEntry])),
      list: list?.cacheSnapshot,
    },
  };
}

function resolveNormalizedReadModelListView(
  raw: RawReadModelListView,
  id: string,
  previous: NormalizeReadModelListCacheSnapshot | undefined,
): {
  value: IRReadModelListView;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeReadModelListCacheSnapshot;
} {
  const viewSignature = createNormalizeSignature(raw);
  if (previous?.view?.signature === viewSignature) {
    return {
      value: previous.view.value,
      errors: previous.view.errors,
      cacheSnapshot: previous,
    };
  }

  const columns = (raw.columns || []).map((column, index) => {
    const columnKey = `${id}.column.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(column),
      previous?.columns[columnKey],
      () => {
        const errors: NormalizeError[] = [];
        return {
          value: normalizeColumn(column, `${id}.column.${column.field}`, errors),
          errors,
        };
      },
    );
  });
  const combinedErrors = columns.flatMap((entry) => entry.errors);
  const value: IRReadModelListView = {
    id,
    kind: 'readModel.list',
    columns: columns.map((entry) => entry.value),
    groupBy: raw.groupBy ?? [],
    pivotBy: raw.pivotBy,
    pagination: raw.pagination ? {
      size: raw.pagination.size || 20,
      style: (raw.pagination.style as 'numbered' | 'infinite' | 'loadMore') || 'numbered',
    } : undefined,
    sourceSpan: raw.sourceSpan,
  };

  return {
    value,
    errors: combinedErrors,
    cacheSnapshot: {
      view: {
        signature: viewSignature,
        value,
        errors: combinedErrors,
      },
      columns: Object.fromEntries(columns.map((entry, index) => [`${id}.column.${index}`, entry.cacheEntry])),
    },
  };
}

function resolveNormalizedListView(
  raw: RawListView,
  id: string,
  previous: NormalizeListViewCacheSnapshot | undefined,
  projectRoot?: string,
  appStyle?: IRApp['style'],
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): {
  value: IRListView;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeListViewCacheSnapshot;
} {
  const viewSignature = createNormalizeSignature(raw);
  if (previous?.view?.signature === viewSignature) {
    return {
      value: previous.view.value,
      errors: previous.view.errors,
      cacheSnapshot: previous,
    };
  }

  const filters = (raw.filters || []).map((filter, index) => {
    const filterKey = `${id}.filter.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(filter),
      previous?.filters[filterKey],
      () => ({
        value: {
          id: `${id}.filter.${filter}`,
          kind: 'filter' as const,
          field: filter,
          sourceSpan: undefined,
        },
        errors: [],
      }),
    );
  });
  const columns = (raw.columns || []).map((column, index) => {
    const columnKey = `${id}.column.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(column),
      previous?.columns[columnKey],
      () => {
        const errors: NormalizeError[] = [];
        return {
          value: normalizeColumn(
            column,
            `${id}.column.${column.field}`,
            errors,
            projectRoot,
            compilerLanguage,
            readFile,
          ),
          errors,
        };
      },
    );
  });
  const actions = (raw.actions || []).map((action, index) => {
    const actionKey = `${id}.action.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(action),
      previous?.actions[actionKey],
      () => ({
        value: normalizeAction(action, `${id}.action.${action.name}`),
        errors: [],
      }),
    );
  });
  const errors: NormalizeError[] = [];
  const value: IRListView = {
    id,
    kind: 'view.list',
    title: normalizeMessageLike(raw.title, `${id}.title`, errors, 'list title'),
    style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'list style') : undefined,
    filters: filters.map((entry) => entry.value),
    columns: columns.map((entry) => entry.value),
    actions: actions.map((entry) => entry.value),
    pagination: raw.pagination ? {
      size: raw.pagination.size || 20,
      style: (raw.pagination.style as 'numbered' | 'infinite' | 'loadMore') || 'numbered',
    } : undefined,
    rules: raw.rules
      ? normalizeRules(raw.rules, id, errors, raw.sourceSpan?.file, projectRoot, compilerLanguage, readFile)
      : undefined,
    sourceSpan: raw.sourceSpan,
  };
  const combinedErrors = [
    ...errors,
    ...filters.flatMap((entry) => entry.errors),
    ...columns.flatMap((entry) => entry.errors),
    ...actions.flatMap((entry) => entry.errors),
  ];

  return {
    value,
    errors: combinedErrors,
    cacheSnapshot: {
      view: {
        signature: viewSignature,
        value,
        errors: combinedErrors,
      },
      filters: Object.fromEntries(filters.map((entry, index) => [`${id}.filter.${index}`, entry.cacheEntry])),
      columns: Object.fromEntries(columns.map((entry, index) => [`${id}.column.${index}`, entry.cacheEntry])),
      actions: Object.fromEntries(actions.map((entry, index) => [`${id}.action.${index}`, entry.cacheEntry])),
    },
  };
}

function resolveNormalizedFormView<TView extends IREditView | IRCreateView>(
  raw: RawEditView | RawCreateView,
  id: string,
  previous: NormalizeFormViewCacheSnapshot<TView> | undefined,
  projectRoot: string | undefined,
  appStyle: IRApp['style'] | undefined,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile: ((fileName: string) => string | undefined) | undefined,
  emitView: (
    rawView: RawEditView | RawCreateView,
    viewId: string,
    fields: IRFormField[],
    includes: IRCreateInclude[],
    errors: NormalizeError[],
    appStyle: IRApp['style'] | undefined,
    projectRoot?: string,
    compilerLanguage?: IRApp['compiler']['language'],
    readFile?: (fileName: string) => string | undefined,
  ) => TView,
): {
  value: TView;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeFormViewCacheSnapshot<TView>;
} {
  const viewSignature = createNormalizeSignature(raw);
  if (previous?.view?.signature === viewSignature) {
    return {
      value: previous.view.value,
      errors: previous.view.errors,
      cacheSnapshot: previous,
    };
  }

  const rawFields = (raw.fields || []);
  const fields = rawFields.map((field, index) => {
    const fieldKey = `${id}.field.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.fields[fieldKey],
      () => {
        const errors: NormalizeError[] = [];
        return {
          value: normalizeFormFieldLike(field, id, errors, projectRoot, compilerLanguage, readFile),
          errors,
        };
      },
    );
  });
  const rawIncludes = 'includes' in raw && Array.isArray(raw.includes) ? raw.includes : [];
  const includes = rawIncludes.map((include, index) => {
      const includeKey = `${id}.include.${index}`;
      return resolveNormalizedSegment(
        createNormalizeSignature(include),
        previous?.includes[includeKey]?.include,
        () => {
          const includeErrors: NormalizeError[] = [];
          const rawIncludeFields = include.fields || [];
          const includeFields = rawIncludeFields.map((field, fieldIndex) =>
            resolveNormalizedSegment(
              createNormalizeSignature(field),
              previous?.includes[includeKey]?.fields[`${includeKey}.field.${fieldIndex}`],
              () => {
                const fieldErrors: NormalizeError[] = [];
                return {
                  value: normalizeFormFieldLike(field, includeKey, fieldErrors, projectRoot, compilerLanguage, readFile),
                  errors: fieldErrors,
                };
              },
            )
          );
          const value: IRCreateInclude = {
            id: `${id}.include.${include.field}`,
            kind: 'createInclude',
            field: include.field,
            minItems: typeof include.minItems === 'number' && Number.isFinite(include.minItems)
              ? include.minItems
              : 0,
            fields: includeFields.map((entry) => entry.value),
            rulesLink: typeof include.rules === 'string'
              ? normalizeRulesLink(include.rules, include.sourceSpan?.file, projectRoot, readFile, includeErrors, `${id}.include.${include.field}`, `${id}.includes.${include.field} rules`)
              : undefined,
            sourceSpan: include.sourceSpan,
          };
          return {
            value,
            errors: [
              ...includeErrors,
              ...includeFields.flatMap((entry) => entry.errors),
            ],
          };
        },
      );
    });
  const errors: NormalizeError[] = [];
  const value = emitView(
    raw,
    id,
    fields.map((entry) => entry.value),
    includes.map((entry) => entry.value),
    errors,
    appStyle,
    projectRoot,
    compilerLanguage,
    readFile,
  );
  const combinedErrors = [
    ...errors,
    ...fields.flatMap((entry) => entry.errors),
    ...includes.flatMap((entry) => entry.errors),
  ];

  return {
    value,
    errors: combinedErrors,
    cacheSnapshot: {
      view: {
        signature: viewSignature,
        value,
        errors: combinedErrors,
      },
      fields: Object.fromEntries(fields.map((entry, index) => [`${id}.field.${index}`, entry.cacheEntry])),
      includes: Object.fromEntries(includes.map((entry, index) => {
        const includeKey = `${id}.include.${index}`;
        const include = rawIncludes[index];
        return [
          includeKey,
          {
            include: entry.cacheEntry,
            fields: Object.fromEntries((include?.fields || []).map((field, fieldIndex) => [
              `${includeKey}.field.${fieldIndex}`,
              resolveNormalizedSegment(
                createNormalizeSignature(field),
                previous?.includes[includeKey]?.fields[`${includeKey}.field.${fieldIndex}`],
                () => {
                  const fieldErrors: NormalizeError[] = [];
                  return {
                    value: normalizeFormFieldLike(field, includeKey, fieldErrors, projectRoot, compilerLanguage, readFile),
                    errors: fieldErrors,
                  };
                },
              ).cacheEntry,
            ])),
          } satisfies NormalizeCreateIncludeCacheSnapshot,
        ];
      })),
    },
  };
}

function resolveNormalizedReadView(
  raw: RawReadView,
  id: string,
  previous: NormalizeReadViewCacheSnapshot | undefined,
  projectRoot: string | undefined,
  appStyle: IRApp['style'] | undefined,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile: ((fileName: string) => string | undefined) | undefined,
): {
  value: IRReadView;
  errors: NormalizeError[];
  cacheSnapshot: NormalizeReadViewCacheSnapshot;
} {
  const viewSignature = createNormalizeSignature(raw);
  if (previous?.view?.signature === viewSignature) {
    return {
      value: previous.view.value,
      errors: previous.view.errors,
      cacheSnapshot: previous,
    };
  }

  const fields = (raw.fields || []).map((field, index) => {
    const fieldKey = `${id}.field.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.fields[fieldKey],
      () => {
        const errors: NormalizeError[] = [];
        return {
          value: normalizeColumn(field, `${id}.field.${field.field}`, errors, projectRoot, compilerLanguage, readFile),
          errors,
        };
      },
    );
  });
  const related = (raw.related || []).map((field, index) => {
    const relatedKey = `${id}.related.${index}`;
    return resolveNormalizedSegment(
      createNormalizeSignature(field),
      previous?.related[relatedKey],
      () => ({
        value: {
          id: `${id}.related.${field}`,
          kind: 'relatedPanel' as const,
          field,
          sourceSpan: undefined,
        },
        errors: [],
      }),
    );
  });

  const errors = [
    ...fields.flatMap((entry) => entry.errors),
    ...related.flatMap((entry) => entry.errors),
  ];
  const value = normalizeReadView(
    raw,
    id,
    fields.map((entry) => entry.value),
    related.map((entry) => entry.value),
    errors,
    appStyle,
  );

  return {
    value,
    errors,
    cacheSnapshot: {
      view: {
        signature: viewSignature,
        value,
        errors,
      },
      fields: Object.fromEntries(fields.map((entry, index) => [`${id}.field.${index}`, entry.cacheEntry])),
      related: Object.fromEntries(related.map((entry, index) => [`${id}.related.${index}`, entry.cacheEntry])),
    },
  };
}

function resolveNormalizedPage(
  raw: RawPage,
  previous: NormalizePageCacheSnapshot | undefined,
  projectRoot?: string,
  appStyle?: IRApp['style'],
  readFile?: (fileName: string) => string | undefined,
): {
  value: IRPage;
  errors: NormalizeError[];
  cacheSnapshot: NormalizePageCacheSnapshot;
} {
  const pageSignature = createNormalizeSignature(raw);
  if (previous?.page?.signature === pageSignature) {
    return {
      value: previous.page.value,
      errors: previous.page.errors,
      cacheSnapshot: previous,
    };
  }

  const id = `page.${raw.name}`;
  const blocks = raw.blocks.map((block, index) =>
    resolveNormalizedSegment(
      createNormalizeSignature(block),
      previous?.blocks[`${id}.block.${index}`],
      () => {
        const errors: NormalizeError[] = [];
        return {
          value: normalizeDashboardBlock(block, `${id}.block.${index}`, errors, projectRoot, appStyle),
          errors,
        };
      },
    )
  );
  const errors = blocks.flatMap((entry) => entry.errors);
  const style = raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'page style') : undefined;
  const seo = raw.seo
    ? {
      description: raw.seo.description
        ? normalizeMessageLike(raw.seo.description, `${id}.seo.description`, errors, 'page seo description')
        : undefined,
      canonicalPath: normalizeCanonicalPath(raw.seo.canonicalPath, `${id}.seo.canonicalPath`, errors),
      image: raw.seo.image
        ? normalizeAssetLink(raw.seo.image, raw.sourceSpan?.file, projectRoot, readFile, errors, `${id}.seo.image`, 'page seo image')
        : undefined,
      noIndex: raw.seo.noIndex === true,
    }
    : undefined;
  const value: IRPage = {
    id,
    kind: 'page',
    name: raw.name,
    title: normalizeMessageLike(raw.title, `${id}.title`, errors, 'page title'),
    style,
    seo,
    pageType: raw.type === 'dashboard' ? 'dashboard' : 'custom',
    path: raw.path,
    layout: raw.layout,
    actions: (raw.actions || []).map((action, index) => normalizePageAction(action, `${id}.action.${index}`)),
    blocks: blocks.map((entry) => entry.value),
    sourceSpan: raw.sourceSpan,
  };

  return {
    value,
    errors,
    cacheSnapshot: {
      page: {
        signature: pageSignature,
        value,
        errors,
      },
      blocks: Object.fromEntries(blocks.map((entry, index) => [`${id}.block.${index}`, entry.cacheEntry])),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function normalizeAppShell(
  ast: RawAST,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): { value: NormalizedAppShellSegment; errors: NormalizeError[] } {
  const errors: NormalizeError[] = [];
  const style = ast.app?.style
    ? normalizeStyleLink(ast.app.style, ast.app.sourceSpan?.file, projectRoot, readFile, errors, 'app.main', 'app style')
    : undefined;
  const seo = ast.app?.seo
    ? {
      siteName: ast.app.seo.siteName
        ? normalizeMessageLike(ast.app.seo.siteName, 'app.main.seo.siteName', errors, 'app seo siteName')
        : undefined,
      defaultTitle: ast.app.seo.defaultTitle
        ? normalizeMessageLike(ast.app.seo.defaultTitle, 'app.main.seo.defaultTitle', errors, 'app seo defaultTitle')
        : undefined,
      titleTemplate: ast.app.seo.titleTemplate
        ? normalizeMessageLike(ast.app.seo.titleTemplate, 'app.main.seo.titleTemplate', errors, 'app seo titleTemplate')
        : undefined,
      defaultDescription: ast.app.seo.defaultDescription
        ? normalizeMessageLike(ast.app.seo.defaultDescription, 'app.main.seo.defaultDescription', errors, 'app seo defaultDescription')
        : undefined,
      defaultImage: ast.app.seo.defaultImage
        ? normalizeAssetLink(ast.app.seo.defaultImage, ast.app.sourceSpan?.file, projectRoot, readFile, errors, 'app.main.seo.defaultImage', 'app seo defaultImage')
        : undefined,
      favicon: ast.app.seo.favicon
        ? normalizeAssetLink(ast.app.seo.favicon, ast.app.sourceSpan?.file, projectRoot, readFile, errors, 'app.main.seo.favicon', 'app seo favicon')
        : undefined,
    }
    : undefined;

  return {
    value: {
      name: ast.app?.name || 'Untitled',
      compiler: normalizeCompiler(ast.compiler, errors),
      theme: normalizeTheme(ast.app?.theme, errors),
      auth: normalizeAuth(ast.app?.auth, errors),
      style,
      seo,
      sourceSpan: ast.app?.sourceSpan,
    },
    errors,
  };
}

function normalizeTheme(theme: string | undefined, errors: NormalizeError[]): 'light' | 'dark' {
  if (theme === undefined) return 'light';
  if (theme === 'dark') return 'dark';
  if (theme !== 'light') {
    errors.push({
      message: `Invalid app theme "${theme}". Expected "light" or "dark".`,
      nodeId: 'app.main',
    });
  }
  return 'light';
}

function normalizeAuth(auth: string | undefined, errors: NormalizeError[]): 'jwt' | 'session' | 'none' {
  if (auth === undefined) return 'none';
  if (auth === 'jwt') return 'jwt';
  if (auth === 'session') return 'session';
  if (auth !== 'none') {
    errors.push({
      message: `Invalid auth mode "${auth}". Expected "jwt", "session", or "none".`,
      nodeId: 'app.main',
    });
  }
  return 'none';
}

function normalizeCompiler(
  compiler: RawAST['compiler'],
  errors: NormalizeError[],
): IRApp['compiler'] {
  const target = compiler?.target;
  if (target === undefined || target === 'react') {
    return {
      target: 'react',
      language: 'typescript',
      sourceSpan: compiler?.sourceSpan,
    };
  }

  errors.push({
    message: `Invalid compiler target "${target}". Expected "react".`,
    nodeId: 'app.main',
  });

  return {
    target: 'react',
    language: 'typescript',
    sourceSpan: compiler?.sourceSpan,
  };
}

// ─── Navigation ──────────────────────────────────────────────────

function normalizeNavItem(raw: RawNavGroup['items'][number], id: string): IRNavItem {
  return {
    id,
    kind: 'navItem',
    label: typeof raw.label === 'string' ? raw.label : normalizeMessageDescriptor(raw.label, `${id}.label`, [], 'navigation label'),
    icon: raw.icon,
    target: raw.target,
    sourceSpan: raw.sourceSpan,
  };
}

function normalizeReadModelField(
  raw: RawField,
  id: string,
  section: 'inputs' | 'result',
): {
  value: IRReadModelField;
  errors: NormalizeError[];
} {
  const errors: NormalizeError[] = [];
  return {
    value: {
      id,
      kind: 'readModel.field',
      name: raw.name,
      section,
      fieldType: normalizeFieldType(raw.typeExpr, id, errors),
      decorators: raw.decorators.map((decorator) => normalizeDecorator(decorator)),
      sourceSpan: raw.sourceSpan,
    },
    errors,
  };
}

function normalizeModelField(raw: RawField, id: string): {
  value: IRModelField;
  errors: NormalizeError[];
} {
  const errors: NormalizeError[] = [];
  return {
    value: {
      id,
      kind: 'field',
      name: raw.name,
      fieldType: normalizeFieldType(raw.typeExpr, id, errors),
      decorators: raw.decorators.map(d => normalizeDecorator(d)),
      sourceSpan: raw.sourceSpan,
    },
    errors,
  };
}

function normalizeFieldType(typeExpr: string, nodeId: string, errors: NormalizeError[]): IRFieldType {
  const relationMatch = typeExpr.match(/^belongsTo\(\s*([^)]+?)\s*\)$/);
  if (relationMatch) {
    return {
      type: 'relation',
      kind: 'belongsTo',
      target: relationMatch[1].trim(),
    };
  }
  if (typeExpr.startsWith('belongsTo(')) {
    errors.push({
      message: 'belongsTo() must use the form belongsTo(Target)',
      nodeId,
    });
    return { type: 'scalar', name: 'string' };
  }

  const hasManyMatch = typeExpr.match(/^hasMany\(\s*([^,]+?)\s*,\s*by:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/);
  if (hasManyMatch) {
    return {
      type: 'relation',
      kind: 'hasMany',
      target: hasManyMatch[1].trim(),
      by: hasManyMatch[2].trim(),
    };
  }
  if (typeExpr.startsWith('hasMany(')) {
    errors.push({
      message: 'hasMany() must use the form hasMany(Target, by: relationField)',
      nodeId,
    });
    return { type: 'scalar', name: 'string' };
  }

  const enumMatch = typeExpr.match(/^enum\(([^)]+)\)$/);
  if (enumMatch) {
    const values = enumMatch[1].split(',').map(v => v.trim());
    return { type: 'enum', values };
  }

  const scalarTypes = ['string', 'number', 'boolean', 'datetime'] as const;
  for (const t of scalarTypes) {
    if (typeExpr === t) {
      return { type: 'scalar', name: t };
    }
  }

  // Default to string for unknown types (with a warning in a real implementation)
  return { type: 'scalar', name: 'string' };
}

function normalizeDecorator(raw: RawDecorator): IRFieldDecorator {
  const dec: IRFieldDecorator = { name: raw.name };
  if (raw.args) {
    dec.args = parseDecoratorArgs(raw.args);
  }
  return dec;
}

/**
 * Parse decorator arguments like:
 *   admin:red, editor:blue   → { admin: "red", editor: "blue" }
 *   2                        → { value: 2 }
 *   "Delete this user?"      → { value: "Delete this user?" }
 *   mode == "edit"           → { expr: 'mode == "edit"' }
 *   "./components/Cell.tsx"  → { path: "./components/Cell.tsx" }
 */
function parseDecoratorArgs(args: string): Record<string, unknown> {
  const trimmed = args.trim();

  // Check if it's a file path (escape hatch)
  if (trimmed.startsWith('"./') || trimmed.startsWith("'./")) {
    return { path: trimmed.replace(/^["']|["']$/g, '') };
  }

  // Check if it's a quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return { value: trimmed.slice(1, -1) };
  }

  // Check if it's a number
  if (/^\d+$/.test(trimmed)) {
    return { value: Number(trimmed) };
  }

  // Check if it's a key:value map (admin:red, editor:blue)
  if (trimmed.includes(':') && !trimmed.includes('==')) {
    const entries: Record<string, string> = {};
    const pairs = trimmed.split(',').map(s => s.trim());
    for (const pair of pairs) {
      const [k, v] = pair.split(':').map(s => s.trim());
      if (k && v) entries[k] = v;
    }
    return entries;
  }

  // Check if it's an expression
  if (trimmed.includes('==') || trimmed.includes('!=') || trimmed.includes('.')) {
    return { expr: trimmed };
  }

  return { value: trimmed };
}

// ─── Resource ────────────────────────────────────────────────────

function normalizeColumn(
  raw: RawColumnEntry,
  id: string,
  errors: NormalizeError[],
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IRColumn {
  const column: IRColumn = {
    id,
    kind: 'column',
    field: raw.field,
    decorators: raw.decorators.map(d => ({
      name: d.name,
      args: d.args ? parseDecoratorArgs(d.args) : undefined,
    })),
    sourceSpan: raw.sourceSpan,
  };

  // Logic escape tier 1: @expr() for computed label
  const exprDec = raw.decorators.find(d => d.name === 'expr');
  if (exprDec?.args) {
    column.dynamicLabel = {
      source: 'escape-expr',
      escape: { tier: 'expr', raw: exprDec.args },
    };
  }

  // Logic escape tier 2: @fn() for display transform
  const fnDec = raw.decorators.find(d => d.name === 'fn');
  if (fnDec?.args) {
    const parsed = parseDecoratorArgs(fnDec.args);
    if (typeof parsed['path'] === 'string') {
      column.displayFn = normalizeFnEscape(
        parsed['path'],
        raw.sourceSpan?.file,
        projectRoot,
        compilerLanguage,
        readFile,
        errors,
        id,
        'column @fn',
      );
    }
  }

  // UI escape: @custom() for full React cell renderer
  const customDec = raw.decorators.find(d => d.name === 'custom');
  if (customDec?.args) {
    const parsed = parseDecoratorArgs(customDec.args);
    if (typeof parsed['path'] === 'string') {
      column.customRenderer = normalizeEscapePath(parsed['path'], raw.sourceSpan?.file, projectRoot, errors, id, 'column @custom');
    }
  }

  return column;
}

function normalizeAction(raw: RawAction, id: string): IRAction {
  const action: IRAction = {
    id,
    kind: 'action',
    name: raw.name,
    sourceSpan: raw.sourceSpan,
  };

  const confirmDec = raw.decorators.find(d => d.name === 'confirm');
  if (confirmDec?.args) {
    const parsed = parseDecoratorArgs(confirmDec.args);
    action.confirm = typeof parsed['value'] === 'string' ? parsed['value'] : String(confirmDec.args);
  }

  return action;
}

function normalizeEditView(
  raw: RawEditView | RawCreateView,
  id: string,
  fields: IRFormField[],
  includes: IRCreateInclude[],
  errors: NormalizeError[],
  appStyle: IRApp['style'] | undefined,
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IREditView {
  const edit = raw as RawEditView;
  const rules = typeof edit.rules === 'string'
    ? undefined
    : edit.rules
      ? normalizeRules(edit.rules, id, errors, edit.sourceSpan?.file, projectRoot, compilerLanguage, readFile)
      : undefined;
  const rulesLink = typeof edit.rules === 'string'
    ? normalizeRulesLink(edit.rules, edit.sourceSpan?.file, projectRoot, readFile, errors, id, 'edit rules')
    : undefined;
  return {
    id,
    kind: 'view.edit',
    style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'edit style') : undefined,
    fields,
    includes,
    rules,
    rulesLink,
    onSuccess: (edit.onSuccess || []).map(e => normalizeEffect(e, id, errors)),
    sourceSpan: edit.sourceSpan,
  };
}

function normalizeCreateView(
  raw: RawEditView | RawCreateView,
  id: string,
  fields: IRFormField[],
  includes: IRCreateInclude[],
  errors: NormalizeError[],
  appStyle: IRApp['style'] | undefined,
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IRCreateView {
  const create = raw as RawCreateView;
  const rules = typeof create.rules === 'string'
    ? undefined
    : create.rules
      ? normalizeRules(create.rules, id, errors, create.sourceSpan?.file, projectRoot, compilerLanguage, readFile)
      : undefined;
  const rulesLink = typeof create.rules === 'string'
    ? normalizeRulesLink(create.rules, create.sourceSpan?.file, projectRoot, readFile, errors, id, 'create rules')
    : undefined;
  return {
    id,
    kind: 'view.create',
    style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'create style') : undefined,
    fields,
    includes,
    rules,
    rulesLink,
    onSuccess: (create.onSuccess || []).map(e => normalizeEffect(e, id, errors)),
    sourceSpan: create.sourceSpan,
  };
}

function normalizeReadView(
  raw: RawReadView,
  id: string,
  fields: IRColumn[],
  related: IRRelatedPanel[],
  errors: NormalizeError[],
  appStyle?: IRApp['style'],
): IRReadView {
  return {
    id,
    kind: 'view.read',
    title: normalizeMessageLike(raw.title, `${id}.title`, errors, 'read title'),
    style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'read style') : undefined,
    fields,
    related,
    sourceSpan: raw.sourceSpan,
  };
}

function normalizeFormFieldLike(
  raw: RawFormFieldEntry | string,
  viewId: string,
  errors: NormalizeError[],
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IRFormField {
  if (typeof raw === 'string') {
    const parsed = parseColumnEntry(raw);
    return {
      id: `${viewId}.field.${parsed.field}`,
      kind: 'formField',
      field: parsed.field,
      decorators: parsed.decorators.map((decorator) => normalizeDecorator(decorator)),
    };
  }

  return normalizeFormField(raw, `${viewId}.field.${raw.field}`, errors, projectRoot, compilerLanguage, readFile);
}

function normalizeFormField(
  raw: RawFormFieldEntry,
  id: string,
  errors: NormalizeError[],
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IRFormField {
  const field: IRFormField = {
    id,
    kind: 'formField',
    field: raw.field,
    decorators: raw.decorators.map(d => normalizeDecorator(d)),
    sourceSpan: raw.sourceSpan,
  };

  // Logic escape tier 1: @expr() for visibility
  const exprDec = raw.decorators.find(d => d.name === 'expr');
  if (exprDec?.args) {
    field.visibleWhen = {
      source: 'escape-expr',
      escape: { tier: 'expr', raw: exprDec.args },
    };
  }

  // Logic escape tier 2: @fn() for validation
  const fnDec = raw.decorators.find(d => d.name === 'fn');
  if (fnDec?.args) {
    const parsed = parseDecoratorArgs(fnDec.args);
    if (typeof parsed['path'] === 'string') {
      field.validateFn = normalizeFnEscape(
        parsed['path'],
        raw.sourceSpan?.file,
        projectRoot,
        compilerLanguage,
        readFile,
        errors,
        id,
        'field validate @fn',
      );
    }
  }

  // UI escape: @custom() for full React field component
  const customDec = raw.decorators.find(d => d.name === 'custom');
  if (customDec?.args) {
    const parsed = parseDecoratorArgs(customDec.args);
    if (typeof parsed['path'] === 'string') {
      field.customField = normalizeEscapePath(parsed['path'], raw.sourceSpan?.file, projectRoot, errors, id, 'field @custom');
    }
  }

  if (raw.rules?.visibleIf) {
    field.visibleWhen = tryParseRuleValue(
      raw.rules.visibleIf,
      `${id}.rules.visibleIf`,
      errors,
      raw.sourceSpan?.file,
      projectRoot,
      compilerLanguage,
      readFile,
      'field visibleIf rule',
    );
  }
  if (raw.rules?.enabledIf) {
    field.enabledWhen = tryParseRuleValue(
      raw.rules.enabledIf,
      `${id}.rules.enabledIf`,
      errors,
      raw.sourceSpan?.file,
      projectRoot,
      compilerLanguage,
      readFile,
      'field enabledIf rule',
    );
  }

  return field;
}

// ─── Rule Value Parser ───────────────────────────────────────────
// Detects the tier of a rule string:
//   @expr(...)        → escape-expr (Tier 1)
//   @fn(...)          → escape-fn   (Tier 2)
//   plain expression  → builtin     (Tier 0)

function tryParseRuleValue(
  input: string,
  nodeId: string,
  errors: NormalizeError[],
  sourceFile?: string,
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
  label: string = 'rule',
): RuleValue | undefined {
  const trimmed = input.trim();

  // Tier 1: @expr("TS expression")
  const exprMatch = trimmed.match(/^@expr\((.+)\)$/);
  if (exprMatch) {
    return {
      source: 'escape-expr',
      escape: { tier: 'expr', raw: exprMatch[1] },
    };
  }

  // Tier 2: @fn("./path/to/file.ts")
  const fnMatch = trimmed.match(/^@fn\(["'](.+?)["']\)$/);
  if (fnMatch) {
    return {
      source: 'escape-fn',
      escape: normalizeFnEscape(fnMatch[1], sourceFile, projectRoot, compilerLanguage, readFile, errors, nodeId, label),
    };
  }

  // Tier 0: built-in DSL expression
  const expr = tryParseExpr(trimmed, nodeId, errors);
  if (expr) {
    return { source: 'builtin', expr };
  }

  return undefined;
}

function normalizeRules(
  raw: RawRules,
  nodeId: string,
  errors: NormalizeError[],
  sourceFile?: string,
  projectRoot?: string,
  compilerLanguage: IRApp['compiler']['language'] = 'typescript',
  readFile?: (fileName: string) => string | undefined,
): IRRules {
  const rules: IRRules = {};
  if (raw.visibleIf) rules.visibleIf = tryParseRuleValue(raw.visibleIf, nodeId, errors, sourceFile, projectRoot, compilerLanguage, readFile, 'visibleIf rule');
  if (raw.enabledIf) rules.enabledIf = tryParseRuleValue(raw.enabledIf, nodeId, errors, sourceFile, projectRoot, compilerLanguage, readFile, 'enabledIf rule');
  if (raw.allowIf) rules.allowIf = tryParseRuleValue(raw.allowIf, nodeId, errors, sourceFile, projectRoot, compilerLanguage, readFile, 'allowIf rule');
  if (raw.enforce) rules.enforce = tryParseRuleValue(raw.enforce, nodeId, errors, sourceFile, projectRoot, compilerLanguage, readFile, 'enforce rule');
  return rules;
}

function normalizeEffect(raw: RawEffect, nodeId: string, errors: NormalizeError[]): EffectNode {
  switch (raw.type) {
    case 'refresh':
      return { type: 'refresh', target: typeof raw.value === 'string' ? raw.value : '' };
    case 'invalidate':
      return { type: 'invalidate', target: typeof raw.value === 'string' ? raw.value : '' };
    case 'toast':
      return { type: 'toast', message: normalizeToastMessage(raw.value, nodeId, errors) };
    case 'redirect':
      return { type: 'redirect', target: typeof raw.value === 'string' ? raw.value : '' };
    case 'openDialog':
      return { type: 'openDialog', dialog: typeof raw.value === 'string' ? raw.value : '' };
    case 'emitEvent':
      return { type: 'emitEvent', event: typeof raw.value === 'string' ? raw.value : '' };
    default:
      return { type: 'toast', message: `Unknown effect: ${raw.type}` };
  }
}

function normalizeToastMessage(
  raw: RawEffect['value'],
  nodeId: string,
  errors: NormalizeError[],
): string | ToastMessageDescriptorNode {
  if (typeof raw === 'string') {
    return raw;
  }

  return normalizeToastDescriptor(raw, nodeId, errors);
}

function normalizeMessageLike(
  raw: RawMessageLike | undefined,
  nodeId: string,
  errors: NormalizeError[],
  label: string,
): MessageLikeNode {
  if (typeof raw === 'string' || raw === undefined) {
    return raw ?? '';
  }
  return normalizeMessageDescriptor(raw, nodeId, errors, label);
}

function normalizeMessageDescriptor(
  raw: Exclude<RawMessageLike, string>,
  nodeId: string,
  errors: NormalizeError[],
  label: string,
): Exclude<MessageLikeNode, string> {
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  const defaultMessage = typeof raw.defaultMessage === 'string' ? raw.defaultMessage : undefined;
  if (!key && (!defaultMessage || defaultMessage.trim().length === 0)) {
    errors.push({
      message: `${label} descriptor must define a non-empty "key" and/or "defaultMessage"`,
      nodeId,
    });
  }
  const values = raw.values
    ? Object.fromEntries(
      Object.entries(raw.values).flatMap(([name, value]) => {
        if (typeof value === 'object' && value !== null && 'ref' in value) {
          errors.push({
            message: `${label} descriptor values may only use scalar literals in the current slice`,
            nodeId,
          });
          return [];
        }
        return [[name, value]];
      }),
    )
    : undefined;
  const descriptor: Exclude<MessageLikeNode, string> = {};
  if (key) {
    descriptor.key = key;
  }
  if (defaultMessage && defaultMessage.length > 0) {
    descriptor.defaultMessage = defaultMessage;
  }
  if (values && Object.keys(values).length > 0) {
    descriptor.values = values;
  }
  return descriptor;
}

function normalizeToastDescriptor(
  raw: RawToastMessageDescriptor,
  nodeId: string,
  errors: NormalizeError[],
): ToastMessageDescriptorNode {
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) {
    errors.push({
      message: 'toast descriptor must define a non-empty "key"',
      nodeId,
    });
  }

  const values = raw.values
    ? Object.fromEntries(
      Object.entries(raw.values).map(([name, value]) => [name, normalizeToastValue(name, value, nodeId, errors)]),
    )
    : undefined;

  const descriptor: ToastMessageDescriptorNode = {
    key,
  };

  if (typeof raw.defaultMessage === 'string' && raw.defaultMessage.length > 0) {
    descriptor.defaultMessage = raw.defaultMessage;
  }
  if (values && Object.keys(values).length > 0) {
    descriptor.values = values;
  }

  return descriptor;
}

function normalizeToastValue(
  name: string,
  raw: NonNullable<RawToastMessageDescriptor['values']>[string],
  nodeId: string,
  errors: NormalizeError[],
): MessageValueNode {
  if (
    typeof raw === 'string'
    || typeof raw === 'number'
    || typeof raw === 'boolean'
    || raw === null
  ) {
    return raw;
  }

  const ref = typeof raw.ref === 'string' ? raw.ref.trim() : '';
  if (!ref) {
    errors.push({
      message: `toast.values.${name} must be a scalar or { ref: <path> }`,
      nodeId,
    });
  }
  return { ref };
}

// ─── Expression Parse Helper ─────────────────────────────────────

function tryParseExpr(input: string, nodeId: string, errors: NormalizeError[]): ExprNode | undefined {
  try {
    return parseExpr(input);
  } catch (err) {
    errors.push({
      message: `Invalid expression "${input}": ${err instanceof Error ? err.message : String(err)}`,
      nodeId,
    });
    return undefined;
  }
}

function normalizeEscapePath(
  rawPath: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): string {
  if (!projectRoot) {
    return rawPath;
  }

  if (!sourceFile) {
    errors.push({
      message: `${label} path "${rawPath}" cannot be resolved because the source file is unknown`,
      nodeId,
    });
    return rawPath;
  }

  const resolved = resolveProjectPath(dirnameProjectPath(sourceFile), rawPath);
  const projectRelative = toProjectRelativePath(projectRoot, resolved);
  if (!projectRelative) {
    errors.push({
      message: `${label} path "${rawPath}" resolves outside the project root`,
      nodeId,
    });
    return rawPath;
  }

  return projectRelative;
}

function normalizeFlowLink(
  input: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  readFile: ((fileName: string) => string | undefined) | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): IRFlowLink | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(FLOW_LINK_REGEX);
  if (!match) {
    errors.push({
      message: `${label} must use @flow("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = match[1];
  const explicitFlowPath = isFlowSourceFile(rawPath);
  if (!explicitFlowPath && hasExplicitExtension(rawPath)) {
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" must use an extensionless path or explicit .flow.loj suffix`,
      nodeId,
    });
    return undefined;
  }

  const requestedPath = explicitFlowPath ? rawPath : `${rawPath}.flow.loj`;
  const resolvedPath = normalizeEscapePath(rawPath === requestedPath ? rawPath : requestedPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!hostFileExists(resolvedPath, readFile)) {
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" did not resolve; expected ${resolvedPath}`,
      nodeId,
    });
    return undefined;
  }

  const compileResult = compileFlowSource(readFile(resolvedPath) ?? '', resolvedPath);
  for (const error of compileResult.errors) {
    const location = error.line !== undefined && error.col !== undefined
      ? `:${error.line}:${error.col}`
      : '';
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" could not be compiled at ${resolvedPath}${location}: ${error.message}`,
      nodeId,
    });
  }
  if (!compileResult.success || !compileResult.program || !compileResult.manifest) {
    return undefined;
  }

  return {
    id: `${nodeId}.workflow`,
    kind: 'flow.link',
    logicalPath: explicitFlowPath ? undefined : rawPath,
    resolvedPath,
    lockIn: explicitFlowPath ? 'explicit' : 'neutral',
    program: compileResult.program,
    manifest: compileResult.manifest,
    sourceSpan: undefined,
  };
}

function normalizeRulesLink(
  input: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  readFile: ((fileName: string) => string | undefined) | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): IRRulesLink | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(RULES_LINK_REGEX);
  if (!match) {
    errors.push({
      message: `${label} must use @rules("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = match[1];
  const explicitRulesPath = isRulesSourceFile(rawPath);
  if (!explicitRulesPath && hasExplicitExtension(rawPath)) {
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" must use an extensionless path or explicit .rules.loj suffix`,
      nodeId,
    });
    return undefined;
  }

  const requestedPath = explicitRulesPath ? rawPath : `${rawPath}.rules.loj`;
  const resolvedPath = normalizeEscapePath(rawPath === requestedPath ? rawPath : requestedPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!hostFileExists(resolvedPath, readFile)) {
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" did not resolve; expected ${resolvedPath}`,
      nodeId,
    });
    return undefined;
  }

  const compileResult = compileRulesSource(readFile(resolvedPath) ?? '', resolvedPath);
  for (const error of compileResult.errors) {
    const location = error.line !== undefined && error.col !== undefined
      ? `:${error.line}:${error.col}`
      : '';
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" could not be compiled at ${resolvedPath}${location}: ${error.message}`,
      nodeId,
    });
  }
  if (!compileResult.success || !compileResult.program || !compileResult.manifest) {
    return undefined;
  }

  return {
    id: `${nodeId}.rules`,
    kind: 'rules.link',
    logicalPath: explicitRulesPath ? undefined : rawPath,
    resolvedPath,
    lockIn: explicitRulesPath ? 'explicit' : 'neutral',
    program: compileResult.program,
    manifest: compileResult.manifest,
    sourceSpan: undefined,
  };
}

function normalizeStyleLink(
  input: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  readFile: ((fileName: string) => string | undefined) | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): IRApp['style'] | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(STYLE_LINK_REGEX);
  if (!match) {
    errors.push({
      message: `${label} must use @style("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = match[1];
  const explicitStylePath = isStyleSourceFile(rawPath);
  if (!explicitStylePath && hasExplicitExtension(rawPath)) {
    errors.push({
      message: `${label} "@style(\\"${rawPath}\\")" must use an extensionless path or explicit .style.loj suffix`,
      nodeId,
    });
    return undefined;
  }

  const requestedPath = explicitStylePath ? rawPath : `${rawPath}.style.loj`;
  const resolvedPath = normalizeEscapePath(rawPath === requestedPath ? rawPath : requestedPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@style(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!hostFileExists(resolvedPath, readFile)) {
    errors.push({
      message: `${label} "@style(\\"${rawPath}\\")" did not resolve; expected ${resolvedPath}`,
      nodeId,
    });
    return undefined;
  }

  const compileResult = compileStyleSource(readFile(resolvedPath) ?? '', resolvedPath);
  for (const error of compileResult.errors) {
    const location = error.line !== undefined && error.col !== undefined
      ? `:${error.line}:${error.col}`
      : '';
    errors.push({
      message: `${label} "@style(\\"${rawPath}\\")" could not be compiled at ${resolvedPath}${location}: ${error.message}`,
      nodeId,
    });
  }
  if (!compileResult.success || !compileResult.program || !compileResult.manifest) {
    return undefined;
  }

  return {
    id: `${nodeId}.style`,
    kind: 'style.link',
    logicalPath: explicitStylePath ? undefined : rawPath,
    resolvedPath,
    lockIn: explicitStylePath ? 'explicit' : 'neutral',
    program: compileResult.program,
    manifest: compileResult.manifest,
    sourceSpan: undefined,
  };
}

function normalizeAssetLink(
  input: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  readFile: ((fileName: string) => string | undefined) | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): import('./ir.js').IRAssetLink | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(ASSET_LINK_REGEX);
  if (!match) {
    errors.push({
      message: `${label} must use @asset("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = match[1];
  const resolvedPath = normalizeEscapePath(rawPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@asset(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!hostFileExists(resolvedPath, readFile)) {
    errors.push({
      message: `${label} "@asset(\\"${rawPath}\\")" did not resolve; expected ${resolvedPath}`,
      nodeId,
    });
    return undefined;
  }

  return {
    id: `${nodeId}.asset`,
    kind: 'asset.link',
    logicalPath: rawPath,
    resolvedPath,
    lockIn: 'neutral',
    sourceSpan: undefined,
  };
}

function normalizeStyleReference(
  input: string,
  appStyle: IRApp['style'] | undefined,
  nodeId: string,
  errors: NormalizeError[],
  label: string,
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    errors.push({
      message: `${label} must not be empty`,
      nodeId,
    });
    return undefined;
  }
  if (!appStyle) {
    errors.push({
      message: `${label} requires app.style to link a .style.loj source`,
      nodeId,
    });
    return undefined;
  }
  if (!appStyle.program.styles.some((style) => style.name === trimmed)) {
    errors.push({
      message: `${label} "${trimmed}" was not found in ${appStyle.resolvedPath}`,
      nodeId,
    });
    return undefined;
  }
  return trimmed;
}

function normalizeCanonicalPath(
  input: string | undefined,
  nodeId: string,
  errors: NormalizeError[],
): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    errors.push({
      message: 'page seo canonicalPath must not be empty',
      nodeId,
    });
    return undefined;
  }
  if (!trimmed.startsWith('/')) {
    errors.push({
      message: 'page seo canonicalPath must start with "/"',
      nodeId,
    });
    return undefined;
  }
  return trimmed;
}

function normalizeFnEscape(
  rawPath: string,
  sourceFile: string | undefined,
  projectRoot: string | undefined,
  compilerLanguage: IRApp['compiler']['language'],
  readFile: ((fileName: string) => string | undefined) | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
): EscapeFn {
  if (hasExplicitExtension(rawPath)) {
    return {
      tier: 'fn',
      path: normalizeEscapePath(rawPath, sourceFile, projectRoot, errors, nodeId, label),
      lockIn: 'explicit',
    };
  }

  const logicalPath = rawPath;
  const basePath = normalizeEscapePath(rawPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!projectRoot || !sourceFile) {
    return {
      tier: 'fn',
      logicalPath,
      path: `${basePath}${preferredFnExtensions(compilerLanguage)[0] ?? ''}`,
      lockIn: 'neutral',
    };
  }

  const candidates = preferredFnExtensions(compilerLanguage).map((extension) => `${basePath}${extension}`);
  const matches = readFile
    ? candidates.filter((candidate) => hostFileExists(candidate, readFile))
    : candidates;

  if (readFile && matches.length === 0) {
    errors.push({
      message: `@fn("${rawPath}") did not resolve for react/${compilerLanguage}; expected ${candidates.join(' or ')}`,
      nodeId,
    });
  }
  if (readFile && matches.length > 1) {
    errors.push({
      message: `@fn("${rawPath}") is ambiguous; found ${matches.join(' and ')}`,
      nodeId,
    });
  }

  return {
    tier: 'fn',
    logicalPath,
    path: matches[0] ?? candidates[0] ?? basePath,
    lockIn: 'neutral',
  };
}

function preferredFnExtensions(language: IRApp['compiler']['language']): string[] {
  return language === 'typescript' ? ['.ts', '.js'] : ['.js'];
}

function hasExplicitExtension(rawPath: string): boolean {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  return /\.[A-Za-z0-9]+$/.test(fileName);
}

function hostFileExists(
  fileName: string,
  readFile: (fileName: string) => string | undefined,
): boolean {
  try {
    return readFile(fileName) !== undefined;
  } catch {
    return false;
  }
}

// ─── Page ────────────────────────────────────────────────────────

function normalizePage(
  raw: RawPage,
  projectRoot?: string,
  appStyle?: IRApp['style'],
  readFile?: (fileName: string) => string | undefined,
): { value: IRPage; errors: NormalizeError[] } {
  const id = `page.${raw.name}`;
  const errors: NormalizeError[] = [];
  return {
    value: {
      id,
      kind: 'page',
      name: raw.name,
      title: normalizeMessageLike(raw.title, `${id}.title`, errors, 'page title'),
      style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'page style') : undefined,
      seo: raw.seo
        ? {
          description: raw.seo.description
            ? normalizeMessageLike(raw.seo.description, `${id}.seo.description`, errors, 'page seo description')
            : undefined,
          canonicalPath: normalizeCanonicalPath(raw.seo.canonicalPath, `${id}.seo.canonicalPath`, errors),
          image: raw.seo.image
            ? normalizeAssetLink(raw.seo.image, raw.sourceSpan?.file, projectRoot, readFile, errors, `${id}.seo.image`, 'page seo image')
            : undefined,
          noIndex: raw.seo.noIndex === true,
        }
        : undefined,
      pageType: raw.type === 'dashboard' ? 'dashboard' : 'custom',
      path: raw.path,
      layout: raw.layout,
      actions: (raw.actions || []).map((action, index) => normalizePageAction(action, `${id}.action.${index}`)),
      blocks: raw.blocks.map((b, i) => normalizeDashboardBlock(b, `${id}.block.${i}`, errors, projectRoot, appStyle)),
      sourceSpan: raw.sourceSpan,
    },
    errors,
  };
}

function normalizeDashboardBlock(
  raw: RawDashboardBlock,
  id: string,
  errors: NormalizeError[],
  projectRoot?: string,
  appStyle?: IRApp['style'],
): IRDashboardBlock {
  const block: IRDashboardBlock = {
    id,
    kind: 'dashboardBlock',
    blockType: (raw.type as 'metric' | 'chart' | 'table' | 'custom') || 'custom',
    title: normalizeMessageLike(raw.title, `${id}.title`, errors, 'page block title'),
    style: raw.style ? normalizeStyleReference(raw.style, appStyle, `${id}.style`, errors, 'page block style') : undefined,
    data: raw.data,
    queryState: raw.queryState,
    selectionState: raw.selectionState,
    dateNavigation: raw.dateNavigation
      ? {
        field: raw.dateNavigation.field,
        prevLabel: raw.dateNavigation.prevLabel
          ? normalizeMessageLike(raw.dateNavigation.prevLabel, `${id}.dateNavigation.prevLabel`, errors, 'dateNavigation prevLabel')
          : undefined,
        nextLabel: raw.dateNavigation.nextLabel
          ? normalizeMessageLike(raw.dateNavigation.nextLabel, `${id}.dateNavigation.nextLabel`, errors, 'dateNavigation nextLabel')
          : undefined,
        sourceSpan: raw.dateNavigation.sourceSpan,
      }
      : undefined,
    rowActions: (raw.rowActions || []).map((action, index) => normalizeDashboardRowAction(action, `${id}.rowAction.${index}`)),
    sourceSpan: raw.sourceSpan,
  };

  // Escape hatch tier 3: custom block
  if (raw.custom) {
    block.customBlock = normalizeEscapePath(raw.custom, raw.sourceSpan?.file, projectRoot, errors, id, 'dashboard block @custom');
    block.blockType = 'custom';
  }

  return block;
}

function normalizePageAction(raw: RawPageAction, id: string): IRPageAction {
  const resourceLabel = raw.create.resource === ''
    ? 'Resource'
    : raw.create.resource.charAt(0).toUpperCase() + raw.create.resource.slice(1);
  return {
    id,
    kind: 'pageAction',
    action: 'create',
    resource: raw.create.resource,
    label: normalizeMessageLike(raw.create.label ?? `Create ${resourceLabel}`, `${id}.label`, [], 'page action label'),
    seed: Object.fromEntries(
      Object.entries(raw.create.seed || {}).flatMap(([fieldName, value]) => {
        const normalized = normalizePageActionSeedValue(value);
        return normalized ? [[fieldName, normalized]] : [];
      }),
    ),
    sourceSpan: raw.sourceSpan,
  };
}

function normalizePageActionSeedValue(raw: RawPageActionSeedValue): IRPageAction['seed'][string] | null {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return {
      kind: 'literal',
      value: raw,
    };
  }
  if (raw.input) {
    const [queryState, ...fieldParts] = raw.input.split('.');
    return {
      kind: 'inputField',
      queryState,
      field: fieldParts.join('.'),
      sourceSpan: raw.sourceSpan,
    };
  }
  if (raw.selection) {
    const [selectionState, ...fieldParts] = raw.selection.split('.');
    return {
      kind: 'selectionField',
      selectionState,
      field: fieldParts.join('.'),
      sourceSpan: raw.sourceSpan,
    };
  }
  return null;
}

function normalizeDashboardRowAction(raw: RawDashboardRowAction, id: string): IRDashboardRowAction {
  const resourceLabel = raw.create.resource === ''
    ? 'Resource'
    : raw.create.resource.charAt(0).toUpperCase() + raw.create.resource.slice(1);
  return {
    id,
    kind: 'dashboardRowAction',
    action: 'create',
    resource: raw.create.resource,
    label: normalizeMessageLike(raw.create.label ?? `Create ${resourceLabel}`, `${id}.label`, [], 'row action label'),
    seed: Object.fromEntries(
      Object.entries(raw.create.seed || {}).flatMap(([fieldName, value]) => {
        const normalized = normalizeDashboardRowSeedValue(value);
        return normalized ? [[fieldName, normalized]] : [];
      }),
    ),
    sourceSpan: raw.sourceSpan,
  };
}

function normalizeDashboardRowSeedValue(raw: RawDashboardRowSeedValue): IRDashboardRowAction['seed'][string] | null {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return {
      kind: 'literal',
      value: raw,
    };
  }
  if (raw.row) {
    return {
      kind: 'rowField',
      field: raw.row,
      sourceSpan: raw.sourceSpan,
    };
  }
  if (raw.input) {
    return {
      kind: 'inputField',
      field: raw.input,
      sourceSpan: raw.sourceSpan,
    };
  }
  return null;
}

// ─── Escape Hatch Metering ───────────────────────────────────────
// Counts all escape hatch usage across the IR and flags overBudget.

const ESCAPE_BUDGET_PERCENT = 20; // healthy threshold

function computeEscapeStats(ir: IRApp): EscapeHatchStats {
  let totalNodes = 0;
  let exprCount = 0;
  let fnCount = 0;
  let customCount = 0;

  // Count model fields
  for (const model of ir.models) {
    totalNodes += model.fields.length;
  }

  // Count resource nodes
  for (const resource of ir.resources) {
    for (const view of [resource.views.list, resource.views.edit, resource.views.create, resource.views.read]) {
      if (!view) continue;

      if ('columns' in view) {
        for (const col of (view as IRListView).columns) {
          totalNodes++;
          if (col.dynamicLabel?.source === 'escape-expr') exprCount++;
          if (col.displayFn) fnCount++;
          if (col.customRenderer) customCount++;
        }
      }

      if ('fields' in view && view.kind !== 'view.read') {
        for (const field of view.fields) {
          totalNodes++;
          if (field.visibleWhen?.source === 'escape-expr') exprCount++;
          if (field.visibleWhen?.source === 'escape-fn') fnCount++;
          if (field.enabledWhen?.source === 'escape-expr') exprCount++;
          if (field.enabledWhen?.source === 'escape-fn') fnCount++;
          if (field.validateFn) fnCount++;
          if (field.customField) customCount++;
        }
        if (view.kind === 'view.create') {
          for (const include of view.includes) {
            totalNodes++;
            for (const field of include.fields) {
              totalNodes++;
              if (field.visibleWhen?.source === 'escape-expr') exprCount++;
              if (field.visibleWhen?.source === 'escape-fn') fnCount++;
              if (field.enabledWhen?.source === 'escape-expr') exprCount++;
              if (field.enabledWhen?.source === 'escape-fn') fnCount++;
              if (field.validateFn) fnCount++;
              if (field.customField) customCount++;
            }
          }
        }
      }

      if (view.kind === 'view.read') {
        for (const field of view.fields) {
          totalNodes++;
          if (field.dynamicLabel?.source === 'escape-expr') exprCount++;
          if (field.displayFn) fnCount++;
          if (field.customRenderer) customCount++;
        }
        totalNodes += view.related.length;
      }

      // Count rule escape hatches
      if ('rules' in view && view.rules) {
        for (const rule of [view.rules.visibleIf, view.rules.enabledIf, view.rules.allowIf, view.rules.enforce]) {
          if (!rule) continue;
          totalNodes++;
          if (rule.source === 'escape-expr') exprCount++;
          if (rule.source === 'escape-fn') fnCount++;
        }
      }
    }
  }

  // Count page blocks
  for (const page of ir.pages) {
    for (const block of page.blocks) {
      totalNodes++;
      if (block.customBlock) customCount++;
    }
  }

  totalNodes = Math.max(totalNodes, 1); // avoid div by zero
  const escapeTotal = exprCount + fnCount + customCount;
  const escapePercent = Math.round((escapeTotal / totalNodes) * 100);

  return {
    totalNodes,
    exprCount,
    fnCount,
    customCount,
    escapePercent,
    overBudget: escapePercent > ESCAPE_BUDGET_PERCENT,
  };
}
