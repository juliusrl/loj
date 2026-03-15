import type {
  IRAction,
  IRApp,
  IRColumn,
  IRDashboardBlock,
  IREditView,
  IRCreateInclude,
  IRCreateView,
  IRReadView,
  IRFilter,
  IRFormField,
  IRListView,
  IRModel,
  IRModelField,
  IRNavGroup,
  IRNavItem,
  IRPage,
  IRPageAction,
  IRReadModel,
  IRReadModelField,
  IRReadModelListView,
  IRRelatedPanel,
  IRResource,
  IRRules,
  IRRulesLink,
} from './ir.js';
import { createStableSignature } from './cache-signature.js';
import { analyzePageBlockData } from './page-table-block.js';

export interface DependencyNodeEntry {
  id: string;
  kind: string;
  rootId: string;
  signature: string;
  dependsOn: string[];
  sourceFile?: string;
}

export interface DependencyGraphSnapshot {
  version: string;
  roots: string[];
  nodes: Record<string, DependencyNodeEntry>;
}

export interface DependencyGraphDiff {
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;
  affectedRootIds: Set<string>;
}

const DEPENDENCY_GRAPH_VERSION = '0.1.6';

export function buildDependencyGraph(ir: IRApp): DependencyGraphSnapshot {
  const nodes: Record<string, DependencyNodeEntry> = {};
  const roots = [
    ir.id,
    ...ir.models.map((model) => model.id),
    ...ir.resources.map((resource) => resource.id),
    ...ir.readModels.map((readModel) => readModel.id),
    ...ir.pages.map((page) => page.id),
  ];

  addNode(nodes, ir, ir.id, ir.navigation.map((group) => group.id), {
    name: ir.name,
    compiler: ir.compiler,
    theme: ir.theme,
    auth: ir.auth,
    escapeStats: ir.escapeStats,
  });

  for (const group of ir.navigation) {
    addNode(nodes, group, ir.id, group.items.map((item) => item.id), {
      group: group.group,
      visibleIf: group.visibleIf,
    });
    for (const item of group.items) {
      addNode(nodes, item, ir.id, [], {
        label: item.label,
        icon: item.icon,
        target: item.target,
      });
    }
  }

  for (const model of ir.models) {
    addModelNodes(nodes, model);
  }

  for (const resource of ir.resources) {
    addResourceNodes(nodes, resource, ir.models, ir.resources);
  }

  for (const readModel of ir.readModels) {
    addReadModelNodes(nodes, readModel);
  }

  for (const page of ir.pages) {
    addPageNodes(nodes, page, ir.models, ir.resources, ir.readModels);
  }

  return {
    version: DEPENDENCY_GRAPH_VERSION,
    roots,
    nodes,
  };
}

export function diffDependencyGraphs(
  previous: DependencyGraphSnapshot | undefined,
  next: DependencyGraphSnapshot,
): DependencyGraphDiff {
  if (!previous || previous.version !== DEPENDENCY_GRAPH_VERSION) {
    const changedNodeIds = new Set(Object.keys(next.nodes));
    return {
      changedNodeIds,
      affectedNodeIds: new Set(changedNodeIds),
      affectedRootIds: new Set(next.roots),
    };
  }

  const changedNodeIds = new Set<string>();
  const previousNodeIds = Object.keys(previous.nodes);
  const nextNodeIds = Object.keys(next.nodes);
  const allNodeIds = new Set([...previousNodeIds, ...nextNodeIds]);

  for (const nodeId of allNodeIds) {
    const prevNode = previous.nodes[nodeId];
    const nextNode = next.nodes[nodeId];
    if (!prevNode || !nextNode || prevNode.signature !== nextNode.signature) {
      changedNodeIds.add(nodeId);
    }
  }

  const reverseDeps = buildReverseDependencies(previous, next);
  const affectedNodeIds = new Set(changedNodeIds);
  const pending = [...changedNodeIds];

  while (pending.length > 0) {
    const nodeId = pending.shift()!;
    const dependents = reverseDeps.get(nodeId);
    if (!dependents) continue;

    for (const dependentId of dependents) {
      if (affectedNodeIds.has(dependentId)) continue;
      affectedNodeIds.add(dependentId);
      pending.push(dependentId);
    }
  }

  const affectedRootIds = new Set<string>();
  for (const nodeId of affectedNodeIds) {
    const currentNode = next.nodes[nodeId];
    if (currentNode) {
      affectedRootIds.add(currentNode.rootId);
      continue;
    }

    const previousNode = previous.nodes[nodeId];
    if (previousNode) {
      affectedRootIds.add(previousNode.rootId);
    }
  }

  return {
    changedNodeIds,
    affectedNodeIds,
    affectedRootIds,
  };
}

export function createDependencyRootSignature(
  graph: DependencyGraphSnapshot,
  rootId: string,
): string {
  const segmentEntries = Object.values(graph.nodes)
    .filter((node) => node.rootId === rootId)
    .map((node) => ({
      id: node.id,
      signature: node.signature,
      dependsOn: [...node.dependsOn].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createStableSignature(segmentEntries);
}

function addModelNodes(
  nodes: Record<string, DependencyNodeEntry>,
  model: IRModel,
): void {
  addNode(nodes, model, model.id, model.fields.map((field) => field.id), {
    name: model.name,
  });

  for (const field of model.fields) {
    addNode(nodes, field, model.id, [], {
      name: field.name,
      fieldType: field.fieldType,
      decorators: field.decorators,
    });
  }
}

function addResourceNodes(
  nodes: Record<string, DependencyNodeEntry>,
  resource: IRResource,
  models: IRModel[],
  resources: IRResource[],
): void {
  addNode(nodes, resource, resource.id, [`model.${resource.model}`], {
    name: resource.name,
    model: resource.model,
    api: resource.api,
    workflow: resource.workflow ? {
      model: resource.workflow.program.model,
      field: resource.workflow.program.field,
      states: resource.workflow.program.states,
      wizard: resource.workflow.program.wizard,
      transitions: resource.workflow.program.transitions,
      resolvedPath: resource.workflow.resolvedPath,
    } : null,
    routes: {
      list: Boolean(resource.views.list),
      edit: Boolean(resource.views.edit),
      create: Boolean(resource.views.create),
      read: Boolean(resource.views.read),
    },
  });

  if (resource.views.list) {
    addListViewNodes(nodes, resource.id, resource.views.list);
  }
  if (resource.views.edit) {
    addEditViewNodes(nodes, resource.id, resource.views.edit);
  }
  if (resource.views.create) {
    addCreateViewNodes(nodes, resource.id, resource.views.create);
  }
  if (resource.views.read) {
    const model = models.find((candidate) => candidate.name === resource.model);
    if (model) {
      addReadViewNodes(nodes, resource.id, resource.views.read, model, models, resources);
    }
  }
}

function addListViewNodes(
  nodes: Record<string, DependencyNodeEntry>,
  rootId: string,
  view: IRListView,
): void {
  addNode(
    nodes,
    view,
    rootId,
    [
      rootId,
      ...view.filters.map((filter) => filter.id),
      ...view.columns.map((column) => column.id),
      ...view.actions.map((action) => action.id),
    ],
    {
      title: view.title,
      pagination: view.pagination,
      rules: serializeRules(view.rules),
    },
  );

  for (const filter of view.filters) {
    addNode(nodes, filter, rootId, [], {
      field: filter.field,
    });
  }

  for (const column of view.columns) {
    addNode(nodes, column, rootId, [], {
      field: column.field,
      decorators: column.decorators,
      dynamicLabel: column.dynamicLabel,
      displayFn: column.displayFn,
      customRenderer: column.customRenderer,
    });
  }

  for (const action of view.actions) {
    addNode(nodes, action, rootId, [], {
      name: action.name,
      confirm: action.confirm,
    });
  }
}

function addEditViewNodes(
  nodes: Record<string, DependencyNodeEntry>,
  rootId: string,
  view: IREditView,
): void {
  addNode(nodes, view, rootId, [
    rootId,
    ...(view.rulesLink ? [view.rulesLink.id] : []),
    ...view.includes.flatMap((include) => include.rulesLink ? [include.rulesLink.id] : []),
    ...view.fields.map((field) => field.id),
    ...view.includes.map((include) => include.id),
    ...view.includes.flatMap((include) => include.fields.map((field) => field.id)),
  ], {
    rules: serializeRules(view.rules),
    rulesLink: serializeRulesLink(view.rulesLink),
    onSuccess: view.onSuccess,
  });

  if (view.rulesLink) {
    addNode(nodes, view.rulesLink, rootId, [], {
      resolvedPath: view.rulesLink.resolvedPath,
      logicalPath: view.rulesLink.logicalPath,
      lockIn: view.rulesLink.lockIn,
      program: view.rulesLink.program,
    });
  }

  for (const field of view.fields) {
    addFormFieldNode(nodes, rootId, field);
  }
  for (const include of view.includes) {
    addNode(nodes, include, rootId, [view.id, ...include.fields.map((field) => field.id)], {
      field: include.field,
      rulesLink: serializeRulesLink(include.rulesLink),
    });
    if (include.rulesLink) {
      addNode(nodes, include.rulesLink, include.id, [], {
        resolvedPath: include.rulesLink.resolvedPath,
        logicalPath: include.rulesLink.logicalPath,
        lockIn: include.rulesLink.lockIn,
        program: include.rulesLink.program,
      });
    }
    for (const field of include.fields) {
      addFormFieldNode(nodes, include.id, field);
    }
  }
}

function addCreateViewNodes(
  nodes: Record<string, DependencyNodeEntry>,
  rootId: string,
  view: IRCreateView,
): void {
  addNode(nodes, view, rootId, [
    rootId,
    ...(view.rulesLink ? [view.rulesLink.id] : []),
    ...view.includes.flatMap((include) => include.rulesLink ? [include.rulesLink.id] : []),
    ...view.fields.map((field) => field.id),
    ...view.includes.map((include) => include.id),
    ...view.includes.flatMap((include) => include.fields.map((field) => field.id)),
  ], {
    rules: serializeRules(view.rules),
    rulesLink: serializeRulesLink(view.rulesLink),
    onSuccess: view.onSuccess,
  });

  if (view.rulesLink) {
    addNode(nodes, view.rulesLink, rootId, [], {
      resolvedPath: view.rulesLink.resolvedPath,
      logicalPath: view.rulesLink.logicalPath,
      lockIn: view.rulesLink.lockIn,
      program: view.rulesLink.program,
    });
  }

  for (const field of view.fields) {
    addFormFieldNode(nodes, rootId, field);
  }
  for (const include of view.includes) {
    addNode(nodes, include, rootId, [view.id, ...include.fields.map((field) => field.id)], {
      field: include.field,
      rulesLink: serializeRulesLink(include.rulesLink),
    });
    if (include.rulesLink) {
      addNode(nodes, include.rulesLink, include.id, [], {
        resolvedPath: include.rulesLink.resolvedPath,
        logicalPath: include.rulesLink.logicalPath,
        lockIn: include.rulesLink.lockIn,
        program: include.rulesLink.program,
      });
    }
    for (const field of include.fields) {
      addFormFieldNode(nodes, include.id, field);
    }
  }
}

function addReadViewNodes(
  nodes: Record<string, DependencyNodeEntry>,
  rootId: string,
  view: IRReadView,
  model: IRModel,
  models: IRModel[],
  resources: IRResource[],
): void {
  const relatedDependencies = collectReadViewRelatedDependencies(view, model, models, resources);
  addNode(
    nodes,
    view,
    rootId,
    [
      rootId,
      ...view.fields.map((field) => field.id),
      ...view.related.map((panel) => panel.id),
      ...relatedDependencies.flatMap((dependency) => dependency.listViewId ? [
        dependency.targetModelId,
        dependency.targetResourceId,
        dependency.listViewId,
      ] : [
        dependency.targetModelId,
        dependency.targetResourceId,
      ]),
    ],
    {
      title: view.title,
    },
  );

  for (const field of view.fields) {
    addNode(nodes, field, rootId, [], {
      field: field.field,
      decorators: field.decorators,
      dynamicLabel: field.dynamicLabel,
      displayFn: field.displayFn,
      customRenderer: field.customRenderer,
    });
  }

  for (const panel of view.related) {
    addNode(nodes, panel, rootId, [], {
      field: panel.field,
    });
  }
}

function collectReadViewRelatedDependencies(
  view: IRReadView,
  model: IRModel,
  models: IRModel[],
  resources: IRResource[],
): Array<{ targetModelId: string; targetResourceId: string; listViewId?: string }> {
  const dependencies: Array<{ targetModelId: string; targetResourceId: string; listViewId?: string }> = [];

  for (const panel of view.related) {
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

    const targetModel = models.find((candidate) => candidate.name === modelField.fieldType.target);
    const targetResource = resources.find((candidate) => candidate.model === modelField.fieldType.target);
    if (!targetModel || !targetResource) {
      continue;
    }

    dependencies.push({
      targetModelId: targetModel.id,
      targetResourceId: targetResource.id,
      listViewId: targetResource.views.list && targetResource.views.list.columns.length > 0
        ? targetResource.views.list.id
        : undefined,
    });
  }

  return dependencies;
}

function addFormFieldNode(
  nodes: Record<string, DependencyNodeEntry>,
  rootId: string,
  field: IRFormField,
): void {
  addNode(nodes, field, rootId, [], {
    field: field.field,
    decorators: field.decorators,
    visibleWhen: field.visibleWhen,
    enabledWhen: field.enabledWhen,
    validateFn: field.validateFn,
    customField: field.customField,
  });
}

function addReadModelNodes(
  nodes: Record<string, DependencyNodeEntry>,
  readModel: IRReadModel,
): void {
  addNode(
    nodes,
    readModel,
    readModel.id,
    [
      ...(readModel.rules ? [readModel.rules.id] : []),
      ...readModel.inputs.map((field) => field.id),
      ...readModel.result.map((field) => field.id),
      ...(readModel.list ? [readModel.list.id, ...readModel.list.columns.map((column) => column.id)] : []),
    ],
    {
      name: readModel.name,
      api: readModel.api,
      rules: readModel.rules ? {
        resolvedPath: readModel.rules.resolvedPath,
        program: readModel.rules.program,
      } : null,
    },
  );

  if (readModel.rules) {
    addNode(nodes, readModel.rules, readModel.id, [], {
      resolvedPath: readModel.rules.resolvedPath,
      logicalPath: readModel.rules.logicalPath,
      lockIn: readModel.rules.lockIn,
      program: readModel.rules.program,
    });
  }

  for (const field of readModel.inputs) {
    addNode(nodes, field, readModel.id, [], {
      name: field.name,
      section: field.section,
      fieldType: field.fieldType,
      decorators: field.decorators,
    });
  }

  for (const field of readModel.result) {
    addNode(nodes, field, readModel.id, [], {
      name: field.name,
      section: field.section,
      fieldType: field.fieldType,
      decorators: field.decorators,
    });
  }

  if (!readModel.list) {
    return;
  }

  addNode(nodes, readModel.list, readModel.id, readModel.list.columns.map((column) => column.id), {
    pagination: readModel.list.pagination ?? null,
  });

  for (const column of readModel.list.columns) {
    addNode(nodes, column, readModel.id, [], {
      field: column.field,
      decorators: column.decorators,
      dynamicLabel: column.dynamicLabel,
      displayFn: column.displayFn,
      customRenderer: column.customRenderer,
    });
  }
}

function addPageNodes(
  nodes: Record<string, DependencyNodeEntry>,
  page: IRPage,
  models: IRModel[],
  resources: IRResource[],
  readModels: IRReadModel[],
): void {
  addNode(nodes, page, page.id, [...page.actions.map((action) => action.id), ...page.blocks.map((block) => block.id)], {
    name: page.name,
    title: page.title,
    pageType: page.pageType,
    path: page.path,
    layout: page.layout,
  });

  for (const action of page.actions) {
    const targetResource = resources.find((candidate) => candidate.name === action.resource);
    const targetModel = targetResource
      ? models.find((candidate) => candidate.name === targetResource.model)
      : undefined;
    addNode(nodes, action, page.id, [
      ...(targetResource ? [targetResource.id] : []),
      ...(targetModel ? [targetModel.id] : []),
      ...(targetResource?.views.create ? [targetResource.views.create.id, ...targetResource.views.create.fields.map((field) => field.id)] : []),
    ], {
      action: action.action,
      resource: action.resource,
      label: action.label,
      seed: action.seed,
    });
  }

  for (const block of page.blocks) {
    const analysis = analyzePageBlockData(block, resources, models, readModels);
    const dependsOn = analysis.kind === 'resourceList'
      ? [
          analysis.resource.id,
          analysis.model.id,
          analysis.listView.id,
          ...analysis.listView.filters.map((filter) => filter.id),
          ...analysis.listView.columns.map((column) => column.id),
          ...analysis.listView.actions.map((action) => action.id),
        ]
      : analysis.kind === 'readModelList'
        ? [
            analysis.readModel.id,
            ...analysis.readModel.inputs.map((field) => field.id),
            ...analysis.readModel.result.map((field) => field.id),
            analysis.listView.id,
            ...analysis.listView.columns.map((column) => column.id),
          ]
      : analysis.kind === 'recordRelationList'
        ? [
            analysis.resource.id,
            analysis.model.id,
            analysis.relationField.id,
            analysis.targetResource.id,
            analysis.targetModel.id,
            ...(analysis.listView ? [
              analysis.listView.id,
              ...analysis.listView.filters.map((filter) => filter.id),
              ...analysis.listView.columns.map((column) => column.id),
              ...analysis.listView.actions.map((action) => action.id),
            ] : []),
          ]
        : analysis.kind === 'recordRelationCount'
          ? [
              analysis.resource.id,
              analysis.model.id,
              analysis.relationField.id,
              analysis.targetResource.id,
              analysis.targetModel.id,
            ]
        : [];
    addNode(nodes, block, page.id, dependsOn, {
      blockType: block.blockType,
      title: block.title,
      data: block.data,
      queryState: block.queryState,
      selectionState: block.selectionState,
      dateNavigation: block.dateNavigation,
      customBlock: block.customBlock,
      analysis,
    });
  }
}

function addNode(
  nodes: Record<string, DependencyNodeEntry>,
  node:
    | IRApp
    | IRNavGroup
    | IRNavItem
    | IRModel
    | IRModelField
    | IRResource
    | IRReadModel
    | IRRulesLink
    | IRReadModelField
    | IRReadModelListView
    | IRListView
    | IREditView
    | IRCreateInclude
    | IRCreateView
    | IRFilter
    | IRColumn
    | IRAction
    | IRPageAction
    | IRFormField
    | IRPage
    | IRDashboardBlock
    | IRReadView
    | IRRelatedPanel,
  rootId: string,
  dependsOn: string[],
  signatureValue: unknown,
): void {
  nodes[node.id] = {
    id: node.id,
    kind: node.kind,
    rootId,
    signature: createStableSignature(signatureValue),
    dependsOn: [...dependsOn].sort(),
    sourceFile: node.sourceSpan?.file,
  };
}

function buildReverseDependencies(
  previous: DependencyGraphSnapshot,
  next: DependencyGraphSnapshot,
): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();

  const addEdges = (graph: DependencyGraphSnapshot) => {
    for (const node of Object.values(graph.nodes)) {
      for (const dep of node.dependsOn) {
        const dependents = reverse.get(dep) ?? new Set<string>();
        dependents.add(node.id);
        reverse.set(dep, dependents);
      }
    }
  };

  addEdges(previous);
  addEdges(next);
  return reverse;
}

function serializeRules(rules: IRRules | undefined): IRRules | null {
  return rules ?? null;
}

function serializeRulesLink(rules: IRRulesLink | undefined): {
  resolvedPath: string;
  logicalPath?: string;
  lockIn: 'neutral' | 'explicit';
  program: IRRulesLink['program'];
} | null {
  if (!rules) {
    return null;
  }
  return {
    resolvedPath: rules.resolvedPath,
    logicalPath: rules.logicalPath,
    lockIn: rules.lockIn,
    program: rules.program,
  };
}
