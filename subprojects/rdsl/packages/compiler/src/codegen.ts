/**
 * ReactDSL Code Generator
 *
 * Transforms IR → React/TypeScript source files.
 *
 * Design principles:
 *  - Direct subpath imports, no barrel files
 *  - Data access through dedup adapter (SWR), no raw fetch in useEffect
 *  - Derived state stays derived: no effect-based mirrors
 *  - Non-urgent updates (filters, search) use startTransition
 *  - Memoized columns and render functions
 *  - Ready-to-run output with semantic source comments
 */

import type {
  IRApp, IRResource, IRModel, IRListView, IREditView, IRCreateView, IRReadView, IRRelatedPanel,
  IRColumn, IRFilter, IRFormField, IRAction, IRRules, ExprNode, EffectNode,
  IRPage, IRDashboardBlock, IRNavGroup, RuleValue, EscapeFn, ToastMessageNode, MessageLikeNode, MessageValueNode, IRReadModel, IRDashboardRowAction, IRRulesLink,
} from './ir.js';
import { analyzePageBlockData } from './page-table-block.js';
import { relativeImportPath } from './project-paths.js';
import { analyzeRelationProjection } from './relation-projection.js';
import { emitReactStyleCss } from './style-proof.js';

// ─── Output Types ────────────────────────────────────────────────

export interface GeneratedFile {
  path: string;
  content: string;
  sourceNode: string;  // IR node ID for tracing
}

export interface CodegenResult {
  files: GeneratedFile[];
  cacheSnapshot: CodegenCacheSnapshot;
}

export interface CodegenSegmentCacheEntry {
  signature: string;
  files: GeneratedFile[];
}

export interface CodegenCacheSnapshot {
  version: string;
  segments: Record<string, CodegenSegmentCacheEntry>;
}

export interface GenerateOptions {
  cache?: CodegenCacheSnapshot;
  affectedNodeIds?: ReadonlySet<string>;
}

interface CodegenSegmentPlan {
  key: string;
  dependsOn: string[];
  getSignature: () => string;
  emit: () => GeneratedFile[];
}

const CODEGEN_CACHE_VERSION = '0.1.19';

// ─── Main Entry Point ────────────────────────────────────────────

export function generate(ir: IRApp, options: GenerateOptions = {}): CodegenResult {
  const previousSegments = options.cache?.version === CODEGEN_CACHE_VERSION
    ? options.cache.segments
    : undefined;
  const nextSegments: Record<string, CodegenSegmentCacheEntry> = {};
  const files: GeneratedFile[] = [];
  const segments = buildCodegenSegments(ir);

  for (const segment of segments) {
    const cached = previousSegments?.[segment.key];
    const canReuseFromDependencyGraph = cached &&
      options.affectedNodeIds &&
      segment.dependsOn.every((nodeId) => !options.affectedNodeIds!.has(nodeId));
    const signature = canReuseFromDependencyGraph
      ? cached.signature
      : segment.getSignature();
    const segmentFiles = cached && (canReuseFromDependencyGraph || cached.signature === signature)
      ? cached.files
      : segment.emit();
    nextSegments[segment.key] = {
      signature,
      files: segmentFiles,
    };
    files.push(...segmentFiles);
  }

  return {
    files,
    cacheSnapshot: {
      version: CODEGEN_CACHE_VERSION,
      segments: nextSegments,
    },
  };
}

function buildCodegenSegments(ir: IRApp): CodegenSegmentPlan[] {
  const segments: CodegenSegmentPlan[] = [];

  for (const model of ir.models) {
    segments.push({
      key: `model:${model.id}`,
      dependsOn: [model.id],
      getSignature: () => createCodegenSignature({ kind: 'model', model }),
      emit: () => [generateModelTypes(model)],
    });
  }

  for (const readModel of ir.readModels) {
    segments.push({
      key: `readModel:${readModel.id}`,
      dependsOn: [readModel.id, ...readModel.inputs.map((field) => field.id), ...readModel.result.map((field) => field.id)],
      getSignature: () => createCodegenSignature({
        kind: 'readModel.types',
        readModel: {
          name: readModel.name,
          api: readModel.api,
          inputs: readModel.inputs.map((field) => ({
            name: field.name,
            section: field.section,
            fieldType: field.fieldType,
            decorators: field.decorators,
          })),
          result: readModel.result.map((field) => ({
            name: field.name,
            section: field.section,
            fieldType: field.fieldType,
            decorators: field.decorators,
          })),
        },
      }),
      emit: () => [generateReadModelTypes(readModel)],
    });
  }

  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model) continue;

    if (resource.views.list) {
      const view = resource.views.list;
      const usesRelationProjection = [...view.columns, ...view.filters].some((entry) => entry.field.includes('.'));
      segments.push({
        key: `view:${view.id}`,
        dependsOn: usesRelationProjection
          ? [view.id, ...ir.models.map((candidate) => candidate.id), ...ir.resources.map((candidate) => candidate.id)]
          : [view.id],
        getSignature: () => createCodegenSignature({
          kind: 'resource.list',
          resource: {
            name: resource.name,
            api: resource.api,
            model: resource.model,
          },
          models: usesRelationProjection
            ? ir.models.map((candidate) => ({
              name: candidate.name,
              fields: candidate.fields.map((field) => ({
                name: field.name,
                fieldType: field.fieldType,
              })),
            }))
            : undefined,
          resources: usesRelationProjection
            ? ir.resources.map((candidate) => ({
              name: candidate.name,
              model: candidate.model,
              api: candidate.api,
            }))
            : undefined,
          view,
          model,
        }),
        emit: () => [generateListView(ir, resource, view, model)],
      });
    }

    if (resource.views.edit) {
      const view = resource.views.edit;
      segments.push({
        key: `view:${view.id}`,
        dependsOn: [view.id, resource.id, ...(view.rulesLink ? [view.rulesLink.id] : [])],
        getSignature: () => createCodegenSignature({
          kind: 'resource.edit',
          resource: {
            name: resource.name,
            api: resource.api,
            model: resource.model,
            workflow: resource.workflow ? {
              field: resource.workflow.program.field,
              states: resource.workflow.program.states,
              wizard: resource.workflow.program.wizard,
              transitions: resource.workflow.program.transitions,
            } : null,
          },
          models: ir.models.map((candidate) => ({
            name: candidate.name,
            fields: candidate.fields.map((field) => ({
              name: field.name,
              fieldType: field.fieldType,
            })),
          })),
          resources: ir.resources.map((candidate) => ({
            name: candidate.name,
            model: candidate.model,
            api: candidate.api,
          })),
          view,
          model,
        }),
        emit: () => [generateEditView(ir, resource, view, model)],
      });
    }

    if (resource.views.create) {
      const view = resource.views.create;
      segments.push({
        key: `view:${view.id}`,
        dependsOn: [view.id, resource.id, ...(view.rulesLink ? [view.rulesLink.id] : [])],
        getSignature: () => createCodegenSignature({
          kind: 'resource.create',
          resource: {
            name: resource.name,
            api: resource.api,
            model: resource.model,
            workflow: resource.workflow ? {
              field: resource.workflow.program.field,
              states: resource.workflow.program.states,
              wizard: resource.workflow.program.wizard,
              transitions: resource.workflow.program.transitions,
            } : null,
          },
          models: ir.models.map((candidate) => ({
            name: candidate.name,
            fields: candidate.fields.map((field) => ({
              name: field.name,
              fieldType: field.fieldType,
            })),
          })),
          resources: ir.resources.map((candidate) => ({
            name: candidate.name,
            model: candidate.model,
            api: candidate.api,
          })),
          view,
          model,
        }),
        emit: () => [generateCreateView(ir, resource, view, model)],
      });
    }

    if (resource.views.read) {
      const view = resource.views.read;
      const usesRelationProjection = view.fields.some((field) => field.field.includes('.'));
      const relatedPanelBindings = collectRelatedPanelBindings(ir, view.related, model);
      segments.push({
        key: `view:${view.id}`,
        dependsOn: [
          view.id,
          ...ir.models.map((candidate) => candidate.id),
          ...ir.resources.map((candidate) => candidate.id),
          ...relatedPanelBindings.flatMap((binding) => binding.listView ? [binding.listView.id] : []),
        ],
        getSignature: () => createCodegenSignature({
          kind: 'resource.read',
          resource: {
            name: resource.name,
            api: resource.api,
            model: resource.model,
            workflow: resource.workflow ? {
              field: resource.workflow.program.field,
              states: resource.workflow.program.states,
              wizard: resource.workflow.program.wizard,
              transitions: resource.workflow.program.transitions,
            } : null,
          },
          models: ir.models.map((candidate) => ({
            name: candidate.name,
            fields: candidate.fields.map((field) => ({
              name: field.name,
              fieldType: field.fieldType,
            })),
          })),
          resources: ir.resources.map((candidate) => ({
            name: candidate.name,
            model: candidate.model,
            api: candidate.api,
            hasEdit: Boolean(candidate.views.edit),
            hasRead: Boolean(candidate.views.read),
          })),
          view,
          model,
          relatedPanels: summarizeReadViewDependencies(relatedPanelBindings),
          usesRelationProjection,
        }),
        emit: () => [generateReadView(ir, resource, view, model)],
      });
      for (const binding of relatedPanelBindings) {
        const usesRelationProjection = binding.listProjectionBindings.length > 0;
        segments.push({
          key: `view:${binding.panelId}:related`,
          dependsOn: [
            resource.id,
            view.id,
            panelNodeId(binding),
            model.id,
            binding.targetModel.id,
            binding.targetResource.id,
            ...(binding.listView ? [binding.listView.id] : []),
            ...(usesRelationProjection ? ir.models.map((candidate) => candidate.id) : []),
            ...(usesRelationProjection ? ir.resources.map((candidate) => candidate.id) : []),
          ],
          getSignature: () => createCodegenSignature({
            kind: 'resource.read.related',
            resource: {
              id: resource.id,
              name: resource.name,
              api: resource.api,
            },
            model: {
              id: model.id,
              name: model.name,
            },
            readView: {
              id: view.id,
              title: view.title,
            },
            panel: summarizeRelatedPanelDependency(binding),
            models: usesRelationProjection
              ? ir.models.map((candidate) => ({
                name: candidate.name,
                fields: candidate.fields.map((field) => ({
                  name: field.name,
                  fieldType: field.fieldType,
                })),
              }))
              : undefined,
            resources: usesRelationProjection
              ? ir.resources.map((candidate) => ({
                name: candidate.name,
                model: candidate.model,
                api: candidate.api,
              }))
              : undefined,
          }),
          emit: () => [generateRelatedCollectionView(ir, resource, model, binding)],
        });
      }
    }

    if (resource.workflow) {
      const workflow = resource.workflow;
      const workflowReadView = resource.views.read;
      const workflowProjectionBindings = workflowReadView
        ? collectListProjectionBindings(ir, workflowReadView.fields, model, `${resource.name}Workflow`)
        : [];
      const workflowRelatedPanelBindings = workflowReadView
        ? collectRelatedPanelBindings(ir, workflowReadView.related, model)
        : [];
      const workflowPanelProjectionBindings = workflowRelatedPanelBindings
        .filter((binding) => binding.listView && binding.listView.columns.length > 0)
        .flatMap((binding) => binding.listProjectionBindings);
      const workflowUsesRelationProjection = workflowProjectionBindings.length > 0 || workflowPanelProjectionBindings.length > 0;
      segments.push({
        key: `view:${resource.id}:workflow`,
        dependsOn: [
          resource.id,
          model.id,
          ...(workflowReadView ? [workflowReadView.id, ...workflowReadView.fields.map((field) => field.id)] : []),
          ...workflowRelatedPanelBindings.flatMap((binding) => [
            panelNodeId(binding),
            binding.targetModel.id,
            binding.targetResource.id,
            ...(binding.listView ? [binding.listView.id] : []),
          ]),
          ...(workflowUsesRelationProjection ? ir.models.map((candidate) => candidate.id) : []),
          ...(workflowUsesRelationProjection ? ir.resources.map((candidate) => candidate.id) : []),
        ],
        getSignature: () => createCodegenSignature({
          kind: 'resource.workflow.page',
          resource: {
            id: resource.id,
            name: resource.name,
            api: resource.api,
            model: resource.model,
            hasList: Boolean(resource.views.list),
            hasRead: Boolean(resource.views.read),
            hasEdit: Boolean(resource.views.edit),
            workflow: {
              field: workflow.program.field,
              states: workflow.program.states,
              wizard: workflow.program.wizard,
              transitions: workflow.program.transitions,
            },
          },
          model: {
            id: model.id,
            name: model.name,
          },
          readView: workflowReadView ? {
            id: workflowReadView.id,
            title: workflowReadView.title,
            fields: workflowReadView.fields.map((field) => ({
              id: field.id,
              field: field.field,
              decorators: field.decorators,
              dynamicLabel: field.dynamicLabel,
              displayFn: field.displayFn,
              customRenderer: field.customRenderer,
            })),
          } : null,
          relatedPanels: summarizeReadViewDependencies(workflowRelatedPanelBindings),
          models: workflowUsesRelationProjection
            ? ir.models.map((candidate) => ({
              name: candidate.name,
              fields: candidate.fields.map((field) => ({
                name: field.name,
                fieldType: field.fieldType,
              })),
            }))
            : undefined,
          resources: workflowUsesRelationProjection
            ? ir.resources.map((candidate) => ({
              name: candidate.name,
              model: candidate.model,
              api: candidate.api,
            }))
            : undefined,
        }),
        emit: () => [generateWorkflowView(ir, resource, model)],
      });
    }
  }

  for (const page of ir.pages) {
    const pageTableSignature = summarizePageTableBlockDependencies(ir, page);
    const pageTableBindings = collectPageTableBlockBindings(ir, page.blocks);
    const pageMetricSignature = summarizePageMetricBlockDependencies(ir, page);
    const pageReadModels = uniqueByName([
      ...pageTableBindings
        .map((binding) => binding.readModel)
        .filter((candidate): candidate is IRReadModel => Boolean(candidate)),
      ...collectPageMetricBlockBindings(ir, page.blocks)
        .map((binding) => binding.readModel)
        .filter((candidate): candidate is IRReadModel => Boolean(candidate)),
    ]);
    const usesRelationProjection = pageTableBindings.some((binding) => binding.listProjectionBindings.length > 0);
    segments.push({
      key: `page:${page.id}`,
      dependsOn: [
        page.id,
        ...page.blocks.map((block) => block.id),
        ...pageReadModels.flatMap((readModel) => [
          readModel.id,
          ...(readModel.rules ? [readModel.rules.id] : []),
          ...readModel.inputs.map((field) => field.id),
          ...readModel.result.map((field) => field.id),
          ...(readModel.list ? [readModel.list.id, ...readModel.list.columns.map((column) => column.id)] : []),
        ]),
        ...(usesRelationProjection ? ir.models.map((candidate) => candidate.id) : []),
        ...(usesRelationProjection ? ir.resources.map((candidate) => candidate.id) : []),
      ],
      getSignature: () => createCodegenSignature({
        kind: 'page',
        page,
        tables: pageTableSignature,
        metrics: pageMetricSignature,
        models: usesRelationProjection
          ? ir.models.map((candidate) => ({
            name: candidate.name,
            fields: candidate.fields.map((field) => ({
              name: field.name,
              fieldType: field.fieldType,
            })),
          }))
          : undefined,
        resources: usesRelationProjection
          ? ir.resources.map((candidate) => ({
            name: candidate.name,
            model: candidate.model,
            api: candidate.api,
          }))
          : undefined,
      }),
      emit: () => [generatePage(ir, page)],
    });
  }

  segments.push({
    key: 'shell:layout',
    dependsOn: [ir.id],
    getSignature: () => createCodegenSignature({
      kind: 'layout',
      name: ir.name,
      theme: ir.theme,
      style: ir.style
        ? {
          id: ir.style.id,
          resolvedPath: ir.style.resolvedPath,
        }
        : null,
      navigation: ir.navigation,
    }),
    emit: () => [generateAppLayout(ir)],
  });
  segments.push({
    key: 'shell:router',
    dependsOn: [
      ...ir.resources.map((resource) => resource.id),
      ...ir.resources.flatMap((resource) => [
        resource.views.list?.id,
        resource.views.edit?.id,
        resource.views.create?.id,
        resource.views.read?.id,
        ...(resource.views.read?.related.map((panel) => panel.id) ?? []),
      ].filter((entry): entry is string => Boolean(entry))),
      ...ir.pages.map((page) => page.id),
    ],
    getSignature: () => createCodegenSignature({
      kind: 'router',
      pages: ir.pages.map((page) => ({
        id: page.id,
        name: page.name,
        path: page.path ?? null,
      })),
      resources: ir.resources.map((resource) => ({
        id: resource.id,
        name: resource.name,
        workflow: Boolean(resource.workflow),
        views: {
          list: resource.views.list?.id ?? null,
          edit: resource.views.edit?.id ?? null,
          create: resource.views.create?.id ?? null,
          read: resource.views.read?.id ?? null,
          related: resource.views.read?.related.map((panel) => panel.id) ?? [],
        },
      })),
    }),
    emit: () => [generateRouter(ir)],
  });
  segments.push({
    key: 'shell:app',
    dependsOn: [ir.id, ...(ir.style ? [ir.style.id] : [])],
    getSignature: () => createCodegenSignature({
      kind: 'app.entry',
      app: {
        name: ir.name,
        style: ir.style
          ? {
            id: ir.style.id,
            resolvedPath: ir.style.resolvedPath,
            manifest: ir.style.manifest,
          }
          : null,
        seo: ir.seo ?? null,
      },
    }),
    emit: () => generateAppShellFiles(ir),
  });

  return segments;
}

function createCodegenSignature(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return current;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current)) {
      if (key === 'sourceSpan' || key === 'sourceFile') {
        continue;
      }
      normalized[key] = entry;
    }
    return normalized;
  });
}

// ─── Model Types ─────────────────────────────────────────────────

function generateModelTypes(model: IRModel): GeneratedFile {
  const generatedFields = generatedModelFields(model);
  const lines: string[] = [];
  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${model.id}`);
  lines.push(``);

  // Generate TypeScript interface
  lines.push(`export interface ${model.name} {`);
  lines.push(`  id: string;`);
  for (const field of generatedFields) {
    const tsType = fieldTypeToTS(field);
    const optional = field.decorators.some(d => d.name === 'auto') ? '?' : '';
    lines.push(`  // @source-node ${field.id}`);
    lines.push(`  ${field.name}${optional}: ${tsType};`);
  }
  lines.push(`}`);
  lines.push(``);

  // Generate validation schema (simple runtime validators)
  lines.push(`export const ${model.name}Schema = {`);
  for (const field of generatedFields) {
    const rules: string[] = [];
    for (const dec of field.decorators) {
      if (dec.name === 'required') rules.push(`required: true`);
      if (dec.name === 'email') rules.push(`pattern: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/`);
      if (dec.name === 'minLen') rules.push(`minLength: ${dec.args?.['value'] || 0}`);
      if (dec.name === 'unique') rules.push(`unique: true`);
    }
    lines.push(`  // @source-node ${field.id}`);
    lines.push(`  ${field.name}: { ${rules.join(', ')} },`);
  }
  lines.push(`} as const;`);

  return {
    path: `models/${model.name}.ts`,
    content: lines.join('\n'),
    sourceNode: model.id,
  };
}

function generateReadModelTypes(readModel: IRReadModel): GeneratedFile {
  const itemTypeName = readModelResultTypeName(readModel);
  const inputTypeName = readModelInputTypeName(readModel);
  const lines: string[] = [];
  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${readModel.id}`);
  lines.push(``);
  lines.push(`export interface ${inputTypeName} {`);
  for (const field of readModel.inputs) {
    const optional = field.decorators.some((decorator) => decorator.name === 'required') ? '' : '?';
    lines.push(`  // @source-node ${field.id}`);
    lines.push(`  ${field.name}${optional}: ${fieldTypeToTS(field)};`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export interface ${itemTypeName} {`);
  lines.push(`  id: string;`);
  for (const field of readModel.result) {
    if (field.name === 'id') {
      continue;
    }
    lines.push(`  // @source-node ${field.id}`);
    lines.push(`  ${field.name}: ${fieldTypeToTS(field)};`);
  }
  lines.push(`}`);

  return {
    path: `read-models/${capitalize(readModel.name)}.ts`,
    content: lines.join('\n'),
    sourceNode: readModel.id,
  };
}

function generatedModelFields(model: IRModel): IRModel['fields'] {
  return model.fields.filter((field) => !(field.fieldType.type === 'relation' && field.fieldType.kind === 'hasMany'));
}

function readModelInputTypeName(readModel: IRReadModel): string {
  return `${capitalize(readModel.name)}ReadModelInput`;
}

function readModelResultTypeName(readModel: IRReadModel): string {
  return `${capitalize(readModel.name)}ReadModelItem`;
}

function fieldTypeToTS(field: Pick<IRModel['fields'][number], 'fieldType'>): string {
  const ft = field.fieldType;
  if (ft.type === 'scalar') {
    switch (ft.name) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'datetime': return 'string'; // ISO string
      default: return 'unknown';
    }
  }
  if (ft.type === 'enum' && ft.values) {
    return ft.values.map(v => `'${v}'`).join(' | ');
  }
  if (ft.type === 'relation') {
    return ft.kind === 'belongsTo' ? 'string | number | null' : 'never';
  }
  return 'unknown';
}

// ─── List View ───────────────────────────────────────────────────

function generateListView(ir: IRApp, resource: IRResource, view: IRListView, model: IRModel): GeneratedFile {
  const componentName = `${capitalize(resource.name)}List`;
  const filePath = `views/${componentName}.tsx`;
  const modelName = model.name;
  const lines: string[] = [];
  const hasViewRules = hasAnyRules(view.rules);
  const listProjectionBindings = collectListProjectionBindings(ir, [...view.columns, ...view.filters], model);
  const sharedListProjectionLookups = uniqueListProjectionLookups(listProjectionBindings);
  const lookupsNeedingById = projectionLookupTargetsNeedingById(listProjectionBindings);
  const titleElementConstName = componentTitleElementConstName(componentName);
  const tableViewOptionsConstName = staticComponentConstName(componentName, 'TableViewOptions');
  const tableActionsConstName = staticComponentConstName(componentName, 'TableActions');
  const usesMessageResolver = messageLikeNeedsRuntimeResolver(view.title);
  const createAction = view.actions.find((action) => action.name === 'create');
  const deleteAction = view.actions.find((action) => action.name === 'delete');
  const rowActions: string[] = [];
  if (view.actions.find((action) => action.name === 'view') && resource.views.read) {
    rowActions.push(`{ label: 'View', href: (row) => prefixAppBasePath(\`/${resource.name}/\${row.id}\`) }`);
  }
  if (view.actions.find((action) => action.name === 'edit')) {
    rowActions.push(`{ label: 'Edit', href: (row) => prefixAppBasePath(\`/${resource.name}/\${row.id}/edit\`) }`);
  }
  if (resource.workflow) {
    rowActions.push(`{ label: 'Workflow', href: (row) => ${workflowViewHrefExpression(resource.name, 'row', { returnToExpr: 'getCurrentAppHref()' })} }`);
  }
  const hasRowActions = rowActions.length > 0 || Boolean(deleteAction);

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${view.id}`);
  lines.push(``);
  lines.push(`import React, { useCallback, startTransition } from 'react';`);
  if (usesMessageResolver) {
    lines.push(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
  }
  if (resource.workflow || createAction || rowActions.length > 0) {
    lines.push(`import { ${resource.workflow ? 'getCurrentAppHref, ' : ''}prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  }
  lines.push(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
  if (hasRowActions) {
    lines.push(`import type { DataTableAction } from '@loj-lang/rdsl-runtime/components/DataTable';`);
  }
  lines.push(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
  lines.push(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
  lines.push(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);

  // Import custom renderers (escape hatch tier 1)
  const customImports = collectCustomImports(view.columns);
  for (const imp of customImports) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  for (const imp of uniqueImports(collectFnImportsFromRules(view.rules))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  // Import visual components based on decorators
  for (const comp of collectDisplayComponents(view.columns)) {
    lines.push(`import { ${comp} } from '@loj-lang/rdsl-runtime/components/${comp}';`);
  }

  // Import confirm dialog if needed
  const hasConfirm = view.actions.some(a => a.confirm);
  if (hasConfirm) {
    lines.push(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
  }

  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  if (hasViewRules) {
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
    lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  lines.push(`import type { ${modelName} } from '../models/${modelName}';`);
  for (const lookup of sharedListProjectionLookups) {
    if (lookup.targetModel.name === modelName) {
      continue;
    }
    lines.push(`import type { ${lookup.targetModel.name} } from '../models/${lookup.targetModel.name}';`);
  }
  lines.push(``);
  appendStaticConst(lines, titleElementConstName, `<h1>{${messageLikeToRuntimeTextSource(view.title || capitalize(resource.name))}}</h1>`);
  const paginationOptions = view.pagination
    ? [`pageSize: ${view.pagination.size}`, `paginate: true`]
    : [`paginate: false`];
  appendStaticConst(lines, tableViewOptionsConstName, `{ ${paginationOptions.join(', ')} } as const`);
  lines.push(``);

  appendDataTableColumnsBlock(lines, 'columns', view.columns, modelName, `${view.id}.columns`, resource.workflow);

  // Filter definitions
  if (view.filters.length > 0) {
    appendFilterFieldsBlock(lines, 'filterFields', view.filters, model, ir.models, ir.resources, `${view.id}.filters`);
  }

  // Component
  lines.push(`export const ${componentName} = React.memo(function ${componentName}() {`);
  lines.push(`  const resourceView = useResource<${modelName}>('${resource.api}');`);
  for (const lookup of sharedListProjectionLookups) {
    lines.push(`  const ${lookup.hookName} = useResource<${lookup.targetModel.name}>('${lookup.targetResource.api}');`);
    if (lookupsNeedingById.has(lookup.targetResource.name)) {
      lines.push(`  const ${lookup.byIdMapName} = React.useMemo(() => new Map(${lookup.hookName}.allData.map((item) => [String(item.id), item] as const)), [${lookup.hookName}.allData]);`);
    }
  }
  for (const binding of listProjectionBindings) {
    if (binding.kind !== 'hasManyCount') {
      continue;
    }
    lines.push(`  const ${binding.countMapName!} = React.useMemo(() => {`);
    lines.push(`    const counts = new Map<string, number>();`);
    lines.push(`    for (const item of ${binding.lookup.hookName}.allData) {`);
    lines.push(`      const ownerId = item.${binding.inverseFieldName!};`);
    lines.push(`      if (ownerId == null) continue;`);
    lines.push(`      const key = String(ownerId);`);
    lines.push(`      counts.set(key, (counts.get(key) ?? 0) + 1);`);
    lines.push(`    }`);
    lines.push(`    return counts;`);
    lines.push(`  }, [${binding.lookup.hookName}.allData]);`);
  }
  if (listProjectionBindings.length > 0) {
    const projectionDeps = [
      'resourceView.allData',
      ...listProjectionBindings.flatMap((binding) => binding.kind === 'belongsToField'
        ? [binding.lookup.byIdMapName]
        : [`${binding.lookup.hookName}.loading`, binding.countMapName!]),
    ];
    lines.push(`  const tableData = React.useMemo(() => resourceView.allData.map((record) => ({`);
    lines.push(`    ...record,`);
    for (const binding of listProjectionBindings) {
      lines.push(`    ['${binding.fieldName}']: ${projectionAssignmentSource(binding)},`);
    }
    lines.push(`  })) as ${modelName}[], [${Array.from(new Set(projectionDeps)).join(', ')}]);`);
  }
  lines.push(`  const tableView = useCollectionView<${modelName}>(${listProjectionBindings.length > 0 ? 'tableData' : 'resourceView.allData'}, ${tableViewOptionsConstName});`);
  lines.push(`  const toast = useToast();`);
  if (hasViewRules) {
    lines.push(`  const { currentUser } = useAuth();`);
  }

  if (hasConfirm) {
    lines.push(`  const [confirmState, setConfirmState] = React.useState<{ open: boolean; id?: string; message?: string }>({ open: false });`);
  }

  lines.push(``);

  if (view.rules?.visibleIf) {
    lines.push(`  // Policy: visibleIf`);
    lines.push(`  // @source-node ${view.id}.rules.visibleIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.visibleIf)}`);
    lines.push(`  const isVisible = ${ruleValueToRuntimeSource(view.rules.visibleIf, `{ currentUser }`)};`);
    lines.push(``);
  } else {
    lines.push(`  const isVisible = true;`);
    lines.push(``);
  }

  if (view.rules?.enabledIf) {
    lines.push(`  // Policy: enabledIf`);
    lines.push(`  // @source-node ${view.id}.rules.enabledIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.enabledIf)}`);
    lines.push(`  const isEnabled = ${ruleValueToRuntimeSource(view.rules.enabledIf, `{ currentUser }`)};`);
    lines.push(``);
  } else {
    lines.push(`  const isEnabled = true;`);
    lines.push(``);
  }

  // Filter handler with startTransition (invariant #5)
  if (view.filters.length > 0) {
    lines.push(`  // Non-urgent filter update via transition (invariant #5)`);
    lines.push(`  const handleFilterChange = useCallback((nextFilters: Record<string, string>) => {`);
      lines.push(`    startTransition(() => tableView.setFilters(nextFilters));`);
    lines.push(`  }, [tableView.setFilters]);`);
    lines.push(``);
  }
  lines.push(`  const handleSortChange = useCallback((nextSort: Parameters<typeof tableView.setSort>[0]) => {`);
  lines.push(`    startTransition(() => tableView.setSort(nextSort));`);
  lines.push(`  }, [tableView.setSort]);`);
  lines.push(``);
  if (view.pagination) {
    lines.push(`  const handlePaginationChange = useCallback((nextPage: Parameters<typeof tableView.setPagination>[0]) => {`);
    lines.push(`    startTransition(() => tableView.setPagination(nextPage));`);
    lines.push(`  }, [tableView.setPagination]);`);
    lines.push(``);
  }

  // Delete handler
  if (deleteAction) {
    if (deleteAction.confirm) {
      lines.push(`  const handleDeleteRequest = useCallback((id: string) => {`);
      lines.push(`    setConfirmState({ open: true, id, message: ${JSON.stringify(deleteAction.confirm)} });`);
      lines.push(`  }, []);`);
      lines.push(``);
      lines.push(`  const handleDeleteConfirm = useCallback(async () => {`);
      lines.push(`    if (confirmState.id) {`);
      lines.push(`      await resourceView.deleteItem(confirmState.id);`);
      lines.push(`      toast.success('Deleted successfully');`);
      lines.push(`      resourceView.refresh();`);
      lines.push(`    }`);
      lines.push(`    setConfirmState({ open: false });`);
      lines.push(`  }, [confirmState.id, resourceView, toast]);`);
    } else {
      lines.push(`  const handleDelete = useCallback(async (id: string) => {`);
      lines.push(`    await resourceView.deleteItem(id);`);
      lines.push(`    toast.success('Deleted successfully');`);
      lines.push(`    resourceView.refresh();`);
      lines.push(`  }, [resourceView, toast]);`);
    }
    lines.push(``);
  }

  // Render
  lines.push(`  if (resourceView.error) return <div className="rdsl-error">Failed to load data</div>;`);
  lines.push(`  if (!isVisible) return null;`);
  lines.push(``);
  if (hasRowActions) {
    const actionEntries = [...rowActions];
    if (deleteAction) {
      const handler = deleteAction.confirm ? 'handleDeleteRequest' : 'handleDelete';
      actionEntries.push(`{ label: 'Delete', onClick: (row) => ${handler}(row.id), variant: 'danger' }`);
    }
    const actionDeps = [
      'isEnabled',
      ...(deleteAction ? [deleteAction.confirm ? 'handleDeleteRequest' : 'handleDelete'] : []),
    ];
    lines.push(`  const ${tableActionsConstName} = React.useMemo<Array<DataTableAction<${modelName}>>>(() => isEnabled ? [${actionEntries.join(', ')}] : [], [${actionDeps.join(', ')}]);`);
    lines.push(``);
  }
  lines.push(`  return (`);
  lines.push(`    <div className="${classNameWithOptionalAuthoredStyle('rdsl-resource-list', view.style)}">`);
  lines.push(`      <header className="rdsl-list-header">`);
  lines.push(`        {${titleElementConstName}}`);

  // Action buttons
  if (createAction) {
    lines.push(`        {isEnabled ? <a href={${routeTargetToHrefExpression(`${resource.name}.create`)}} className="rdsl-btn rdsl-btn-primary">Create</a> : null}`);
  }
  lines.push(`      </header>`);
  lines.push(``);

  if (view.filters.length > 0) {
    lines.push(`      <FilterBar fields={filterFields} values={tableView.filters} onChange={handleFilterChange} />`);
  }

  lines.push(``);
  lines.push(`      <DataTable`);
  lines.push(`        columns={columns}`);
  lines.push(`        data={tableView.data}`);
  lines.push(`        loading={resourceView.loading}`);
  lines.push(`        sort={tableView.sort}`);
  lines.push(`        onSortChange={handleSortChange}`);
  if (hasRowActions) {
    lines.push(`        actions={${tableActionsConstName}}`);
  }

  lines.push(`      />`);
  lines.push(``);

  if (view.pagination) {
    lines.push(`      <Pagination`);
    lines.push(`        current={tableView.pagination.page}`);
    lines.push(`        total={tableView.pagination.totalPages}`);
    lines.push(`        onChange={handlePaginationChange}`);
    lines.push(`      />`);
  }

  if (hasConfirm) {
    lines.push(``);
    lines.push(`      <ConfirmDialog`);
    lines.push(`        open={confirmState.open}`);
    lines.push(`        message={confirmState.message || ''}`);
    lines.push(`        onConfirm={handleDeleteConfirm}`);
    lines.push(`        onCancel={() => setConfirmState({ open: false })}`);
    lines.push(`      />`);
  }

  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: view.id,
  };
}

// ─── Edit View ───────────────────────────────────────────────────

function generateEditView(ir: IRApp, resource: IRResource, view: IREditView, model: IRModel): GeneratedFile {
  const componentName = `${capitalize(resource.name)}Edit`;
  const filePath = `views/${componentName}.tsx`;
  const modelName = model.name;
  const lines: string[] = [];
  const hasViewRules = hasAnyRules(view.rules);
  const hasFieldRules = hasFormFieldReactions(view.fields) || view.includes.some((include) => hasFormFieldReactions(include.fields));
  const hasWorkflowWizardAllows = workflowHasWizardAllows(resource);
  const hasWorkflow = Boolean(resource.workflow);
  const hasRedirectEffect = view.onSuccess.some((effect) => effect.type === 'redirect');
  const relationBindings = collectRelationFieldBindings(ir, view.fields, model);
  const includeBindings = collectCreateIncludeBindings(ir, view, model);
  const linkedIncludeBindings = includeBindings.filter((binding) => Boolean(binding.rulesLink));
  const hasLinkedRules = Boolean(view.rulesLink) || linkedIncludeBindings.length > 0;
  const hasLinkedEligibilityRules = Boolean(view.rulesLink?.program.eligibility.length);
  const hasLinkedValidationRules = Boolean(view.rulesLink?.program.validation.length);
  const hasLinkedDerivations = Boolean(view.rulesLink?.program.derivations.length);
  const hasLinkedIncludeEligibilityRules = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.eligibility.length));
  const hasLinkedIncludeValidationRules = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.validation.length));
  const hasLinkedIncludeDerivations = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.derivations.length));
  const needsAuth = hasViewRules || hasLinkedRules || hasFieldRules || effectRefsRequireUser(view.onSuccess) || hasWorkflow;
  const sharedRelationBindings = uniqueRelationBindings([
    ...relationBindings,
    ...includeBindings.flatMap((binding) => binding.relationBindings),
  ]);
  const includeTargetModels = includeBindings
    .map((binding) => binding.targetModel)
    .filter((candidate, index, all) => all.findIndex((entry) => entry.name === candidate.name) === index);
  const editFormDataTypeName = `${modelName}EditFormData`;
  const importedTypeModelNames = new Set<string>([modelName]);
  const linkedDerivationFields = view.rulesLink?.program.derivations.map((entry) => entry.field) ?? [];
  const linkedDerivationTargets = view.fields
    .map((field) => model.fields.find((candidate) => candidate.name === field.field))
    .filter((field): field is IRModel['fields'][number] => Boolean(field) && linkedDerivationFields.includes(field!.name));
  const linkedEligibilityRulesConstName = hasLinkedEligibilityRules ? staticComponentConstName(componentName, 'LinkedEligibilityRules') : null;
  const linkedValidationRulesConstName = hasLinkedValidationRules ? staticComponentConstName(componentName, 'LinkedValidationRules') : null;
  const linkedDerivationRulesConstName = hasLinkedDerivations ? staticComponentConstName(componentName, 'LinkedDerivationRules') : null;
  const linkedDerivedFieldNamesConstName = staticComponentConstName(componentName, 'LinkedDerivedFieldNames');
  const includeDerivedFieldNamesConstNames = new Map(includeBindings.map((binding) => [
    binding.fieldName,
    staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedDerivedFieldNames`),
  ]));
  const includeLinkedEligibilityRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.eligibility.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedEligibilityRules`),
    ]));
  const includeLinkedValidationRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.validation.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedValidationRules`),
    ]));
  const includeLinkedDerivationRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.derivations.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedDerivationRules`),
    ]));
  const workflowStepsConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowSteps') : null;
  const workflowStatesConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStates') : null;
  const workflowStatesByNameConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStatesByName') : null;
  const lookupOptionsConstName = componentResourceOptionsConstName(componentName);
  const formTitleElementConstName = componentTitleElementConstName(componentName);
  const includeTitleConstNames = new Map(includeBindings.map((binding) => [
    binding.fieldName,
    componentScopedTitleElementConstName(componentName, `${capitalize(camelCase(binding.fieldName))}Include`),
  ]));
  const cancelFallbackExpr = routeTargetToHrefExpression(`${resource.name}.list`);

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${view.id}`);
  lines.push(``);
  lines.push(`import React, { useCallback } from 'react';`);
  lines.push(`import { FormField } from '@loj-lang/rdsl-runtime/components/FormField';`);
  if (hasWorkflow) {
    lines.push(`import { WorkflowSummary } from '@loj-lang/rdsl-runtime/components/WorkflowSummary';`);
  }

  // Import custom fields (escape hatch tier 2)
  const customFieldImports = collectCustomFieldImports([
    ...view.fields,
    ...view.includes.flatMap((include) => include.fields),
  ]);
  for (const imp of uniqueImports(customFieldImports)) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  for (const imp of uniqueImports([
    ...collectFnImportsFromRules(view.rules),
    ...collectFnImportsFromFormFields(view.fields),
    ...view.includes.flatMap((include) => collectFnImportsFromFormFields(include.fields)),
  ])) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  lines.push(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (needsAuth) {
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  }
  if (hasViewRules || hasFieldRules || hasWorkflow) {
    lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  if (hasLinkedRules) {
    lines.push(`import { evaluatePolicyExpr, firstPolicyFailure } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  lines.push(`import type { ${modelName} } from '../models/${modelName}';`);
  for (const binding of sharedRelationBindings) {
    if (importedTypeModelNames.has(binding.targetModel.name)) {
      continue;
    }
    importedTypeModelNames.add(binding.targetModel.name);
    lines.push(`import type { ${binding.targetModel.name} } from '../models/${binding.targetModel.name}';`);
  }
  for (const targetModel of includeTargetModels) {
    if (!importedTypeModelNames.has(targetModel.name)) {
      importedTypeModelNames.add(targetModel.name);
      lines.push(`import type { ${targetModel.name} } from '../models/${targetModel.name}';`);
    }
    if (targetModel.name === modelName) {
      continue;
    }
    lines.push(`import { ${targetModel.name}Schema } from '../models/${targetModel.name}';`);
  }
  lines.push(`import { ${modelName}Schema } from '../models/${modelName}';`);
  lines.push(``);
  lines.push(`type ${editFormDataTypeName} = Partial<${modelName}>${includeBindings.length > 0
    ? ` & {\n${includeBindings.map((binding) => `  ${binding.fieldName}: Array<(Partial<${binding.targetModel.name}> & { id?: string })>;`).join('\n')}\n}`
    : ''};`);
  lines.push(``);

  lines.push(`interface ${componentName}Props {`);
  lines.push(`  id: string;`);
  lines.push(`}`);
  lines.push(``);
  if (linkedEligibilityRulesConstName) {
    appendStaticConst(lines, linkedEligibilityRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'eligibility')} as Array<Record<string, unknown>>`);
  }
  if (linkedValidationRulesConstName) {
    appendStaticConst(lines, linkedValidationRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'validation')} as Array<Record<string, unknown>>`);
  }
  if (linkedDerivationRulesConstName) {
    appendStaticConst(lines, linkedDerivationRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'derivations')} as Array<Record<string, unknown>>`);
  }
  appendStaticConst(lines, linkedDerivedFieldNamesConstName, `${JSON.stringify(linkedDerivationFields)} as string[]`);
  for (const binding of includeBindings) {
    const includeDerivationFields = binding.rulesLink?.program.derivations.map((entry) => entry.field) ?? [];
    appendStaticConst(lines, includeDerivedFieldNamesConstNames.get(binding.fieldName)!, `${JSON.stringify(includeDerivationFields)} as string[]`);
  }
  for (const binding of linkedIncludeBindings) {
    if (binding.rulesLink?.program.eligibility.length) {
      appendStaticConst(lines, includeLinkedEligibilityRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'eligibility')} as Array<Record<string, unknown>>`);
    }
    if (binding.rulesLink?.program.validation.length) {
      appendStaticConst(lines, includeLinkedValidationRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'validation')} as Array<Record<string, unknown>>`);
    }
    if (binding.rulesLink?.program.derivations.length) {
      appendStaticConst(lines, includeLinkedDerivationRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'derivations')} as Array<Record<string, unknown>>`);
    }
  }
  if (workflowStepsConstName) {
    appendStaticConst(lines, workflowStepsConstName, `${workflowStepsRuntimeLiteral(resource)} as ${workflowStepArrayTypeSource()}`);
  }
  if (workflowStatesConstName) {
    appendStaticConst(lines, workflowStatesConstName, `${workflowStateMetaRuntimeLiteral(resource)} as ${workflowStateArrayTypeSource()}`);
  }
  if (workflowStatesByNameConstName) {
    appendStaticConst(lines, workflowStatesByNameConstName, `${workflowStateMetaByNameRuntimeLiteral(resource)} as ${workflowStateMapTypeSource()}`);
  }
  if (sharedRelationBindings.length > 0 || includeBindings.length > 0) {
    appendStaticConst(lines, lookupOptionsConstName, `{ pageSize: 1000 } as const`);
  }
  appendStaticConst(lines, formTitleElementConstName, `<h2>{${JSON.stringify(`Edit ${capitalize(resource.name)}`)}}</h2>`);
  for (const binding of includeBindings) {
    appendStaticConst(lines, includeTitleConstNames.get(binding.fieldName)!, `<h3>{${JSON.stringify(columnLabel(binding.fieldName))}}</h3>`);
  }
  lines.push(``);

  lines.push(`interface ${componentName}FormProps {`);
  lines.push(`  id: string;`);
  lines.push(`  record: ${modelName};`);
  lines.push(`  updateItem: ReturnType<typeof useResource<${modelName}>>['updateItem'];`);
  lines.push(`  loading: boolean;`);
  lines.push(`  toast: ReturnType<typeof useToast>;`);
  if (needsAuth) {
    lines.push(`  currentUser: ReturnType<typeof useAuth>['currentUser'];`);
  }
  lines.push(`  returnTo: string | null;`);
  lines.push(`  cancelHref: string;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`function ${componentName}Form({ id, record, updateItem, loading, toast${needsAuth ? ', currentUser' : ''}, returnTo, cancelHref }: ${componentName}FormProps) {`);
  for (const binding of includeBindings) {
    if (!binding.targetResource) {
      continue;
    }
    const includeKey = camelCase(binding.fieldName);
    const collectionName = `${includeKey}Collection`;
    const existingItemsName = `${includeKey}ExistingItems`;
    lines.push(`  const ${collectionName} = useResource<${binding.targetModel.name}>('${binding.targetResource.api}', ${lookupOptionsConstName});`);
    lines.push(`  const ${existingItemsName} = React.useMemo(() => ${collectionName}.allData`);
    lines.push(`    .filter((item) => String(item.${binding.inverseFieldName} ?? '') === id)`);
    lines.push(`    .map((item) => ({`);
    lines.push(`      id: item.id,`);
    for (const field of binding.fields) {
      lines.push(`      ${field.field}: item.${field.field},`);
    }
    lines.push(`    })), [${collectionName}.allData, id]);`);
  }
  lines.push(`  const [formEdits, setFormEdits] = React.useState<Partial<${editFormDataTypeName}>>({});`);
  lines.push(`  const baseFormData = React.useMemo<${editFormDataTypeName}>(() => {`);
  lines.push(`    const nextFormData = (record ? { ...record, ...formEdits } : { ...formEdits }) as ${editFormDataTypeName};`);
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    const existingItemsName = `${includeKey}ExistingItems`;
    lines.push(`    nextFormData.${binding.fieldName} = formEdits.${binding.fieldName} ?? (${existingItemsName}.length > 0`);
    lines.push(`      ? ${existingItemsName}`);
    lines.push(`      : Array.from({ length: ${binding.minItems} }, () => ({})));`);
  }
  lines.push(`    return nextFormData;`);
  lines.push(`  }, [record, formEdits${includeBindings.map((binding) => `, ${camelCase(binding.fieldName)}ExistingItems`).join('')}]);`);
  if (hasLinkedEligibilityRules) {
    lines.push(`  const linkedEligibilityRules = ${linkedEligibilityRulesConstName};`);
  }
  if (hasLinkedValidationRules) {
    lines.push(`  const linkedValidationRules = ${linkedValidationRulesConstName};`);
  }
  for (const binding of linkedIncludeBindings) {
    const includeKey = camelCase(binding.fieldName);
    if (binding.rulesLink?.program.eligibility.length) {
      lines.push(`  const ${includeKey}LinkedEligibilityRules = ${includeLinkedEligibilityRulesConstNames.get(binding.fieldName)};`);
    }
    if (binding.rulesLink?.program.validation.length) {
      lines.push(`  const ${includeKey}LinkedValidationRules = ${includeLinkedValidationRulesConstNames.get(binding.fieldName)};`);
    }
    if (binding.rulesLink?.program.derivations.length) {
      lines.push(`  const ${includeKey}LinkedDerivationRules = ${includeLinkedDerivationRulesConstNames.get(binding.fieldName)};`);
    }
  }
  if (hasLinkedDerivations) {
    lines.push(`  const linkedDerivationRules = ${linkedDerivationRulesConstName};`);
  }
  lines.push(`  const linkedDerivedFieldNames = ${linkedDerivedFieldNamesConstName};`);
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    lines.push(`  const ${includeKey}LinkedDerivedFieldNames = ${includeDerivedFieldNamesConstNames.get(binding.fieldName)};`);
  }
  if (hasLinkedDerivations || hasLinkedIncludeDerivations) {
    lines.push(`  const formData = React.useMemo<${editFormDataTypeName}>(() => {`);
    lines.push(`    const nextFormData: ${editFormDataTypeName} = { ...baseFormData };`);
    if (hasLinkedDerivations) {
      lines.push(`    for (const derivation of linkedDerivationRules) {`);
      lines.push(`      if (typeof derivation.field !== 'string') continue;`);
      lines.push(`      if (derivation.when && !Boolean(evaluatePolicyExpr(derivation.when, { currentUser, formData: nextFormData, record }))) continue;`);
      lines.push(`      switch (derivation.field) {`);
      for (const field of linkedDerivationTargets) {
        lines.push(`        case '${field.name}': {`);
        lines.push(`          const value = evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData, record });`);
        lines.push(`          nextFormData.${field.name} = ${formRulesDerivationAssignmentExpression(field, 'value', `nextFormData.${field.name}`)};`);
        lines.push(`          break;`);
        lines.push(`        }`);
      }
      lines.push(`        default:`);
      lines.push(`          break;`);
      lines.push(`      }`);
      lines.push(`    }`);
    }
    for (const binding of linkedIncludeBindings.filter((candidate) => Boolean(candidate.rulesLink?.program.derivations.length))) {
      const includeKey = camelCase(binding.fieldName);
      const includeDerivationTargets = binding.fields
        .map((field) => binding.targetModel.fields.find((candidate) => candidate.name === field.field))
        .filter((field): field is IRModel['fields'][number] => Boolean(field) && (binding.rulesLink?.program.derivations.some((entry) => entry.field === field!.name) ?? false));
      lines.push(`    nextFormData.${binding.fieldName} = (nextFormData.${binding.fieldName} ?? []).map((item) => {`);
      lines.push(`      const nextItem = { ...item };`);
      lines.push(`      for (const derivation of ${includeKey}LinkedDerivationRules) {`);
      lines.push(`        if (typeof derivation.field !== 'string') continue;`);
      lines.push(`        if (derivation.when && !Boolean(evaluatePolicyExpr(derivation.when, { currentUser, formData: nextFormData, record, item: nextItem }))) continue;`);
      lines.push(`        switch (derivation.field) {`);
      for (const field of includeDerivationTargets) {
        lines.push(`          case '${field.name}': {`);
        lines.push(`            const value = evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData, record, item: nextItem });`);
        lines.push(`            nextItem.${field.name} = ${formRulesDerivationAssignmentExpression(field, 'value', `nextItem.${field.name}`)};`);
        lines.push(`            break;`);
        lines.push(`          }`);
      }
      lines.push(`          default:`);
      lines.push(`            break;`);
      lines.push(`        }`);
      lines.push(`      }`);
      lines.push(`      return nextItem;`);
      lines.push(`    });`);
    }
    lines.push(`    return nextFormData;`);
    lines.push(`  }, [baseFormData${hasLinkedDerivations ? ', linkedDerivationRules' : ''}, currentUser, record${linkedIncludeBindings.filter((candidate) => Boolean(candidate.rulesLink?.program.derivations.length)).map((binding) => `, ${camelCase(binding.fieldName)}LinkedDerivationRules`).join('')}]);`);
  } else {
    lines.push(`  const formData = baseFormData;`);
  }
  if (hasLinkedEligibilityRules) {
    lines.push(`  const linkedEligibilityFailure = firstPolicyFailure(linkedEligibilityRules, { currentUser, formData, record }, 'Forbidden');`);
  } else {
    lines.push(`  const linkedEligibilityFailure = null;`);
  }
  if (hasLinkedValidationRules) {
    lines.push(`  const linkedValidationFailure = linkedEligibilityFailure ? null : firstPolicyFailure(linkedValidationRules, { currentUser, formData, record }, 'Invalid request');`);
  } else {
    lines.push(`  const linkedValidationFailure = null;`);
  }
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    if (binding.rulesLink?.program.eligibility.length) {
      lines.push(`  const ${includeKey}LinkedEligibilityFailures = (formData.${binding.fieldName} ?? []).map((item) => firstPolicyFailure(${includeKey}LinkedEligibilityRules, { currentUser, formData, record, item }, 'Forbidden'));`);
    } else {
      lines.push(`  const ${includeKey}LinkedEligibilityFailures: Array<string | null> = [];`);
    }
    if (binding.rulesLink?.program.validation.length) {
      lines.push(`  const ${includeKey}LinkedValidationFailures = (formData.${binding.fieldName} ?? []).map((item, index) => ${includeKey}LinkedEligibilityFailures[index] ? null : firstPolicyFailure(${includeKey}LinkedValidationRules, { currentUser, formData, record, item }, 'Invalid request'));`);
    } else {
      lines.push(`  const ${includeKey}LinkedValidationFailures: Array<string | null> = [];`);
    }
    lines.push(`  const ${includeKey}LinkedFailure = ${includeKey}LinkedEligibilityFailures.find((failure) => Boolean(failure)) ?? ${includeKey}LinkedValidationFailures.find((failure) => Boolean(failure)) ?? null;`);
  }
  if (includeBindings.length > 0) {
    lines.push(`  const linkedIncludeFailure = [${includeBindings.map((binding) => `${camelCase(binding.fieldName)}LinkedFailure`).join(', ')}].find((failure) => Boolean(failure)) ?? null;`);
  } else {
    lines.push(`  const linkedIncludeFailure = null;`);
  }
  if (hasWorkflow) {
    lines.push(`  const workflowSteps = ${workflowStepsConstName};`);
    lines.push(`  const workflowStatesByName = ${workflowStatesByNameConstName};`);
    lines.push(`  const currentWorkflowState = String(record?.${resource.workflow!.program.field} ?? ${JSON.stringify(workflowInitialState(resource))});`);
    lines.push(`  const visibleWorkflowSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record, formData }));`);
    lines.push(`  const activeWorkflowIndex = visibleWorkflowSteps.findIndex((step) => step.completesWith === currentWorkflowState);`);
    lines.push(`  const currentWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex] ?? null : null;`);
    lines.push(`  const nextWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    lines.push(`  const currentWorkflowStateMeta = workflowStatesByName[currentWorkflowState] ?? null;`);
    lines.push(`  const workflowSummarySteps = visibleWorkflowSteps.map((step, index) => ({`);
    lines.push(`    name: step.name,`);
    lines.push(`    status: index < activeWorkflowIndex ? 'done' as const : index === activeWorkflowIndex ? 'current' as const : 'upcoming' as const,`);
    lines.push(`  }));`);
  }
  for (const binding of sharedRelationBindings) {
    lines.push(`  const ${binding.hookName} = useResource<${binding.targetModel.name}>('${binding.targetResource.api}', ${lookupOptionsConstName});`);
    lines.push(`  const ${binding.optionsName} = React.useMemo(() => ${binding.hookName}.allData.map((item) => ({ value: item.id, label: String(item.${binding.labelField} ?? item.id) })), [${binding.hookName}.allData]);`);
  }
  lines.push(``);

  // Policy check
  if (view.rules?.visibleIf) {
    lines.push(`  // Policy: visibleIf`);
    lines.push(`  // @source-node ${view.id}.rules.visibleIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.visibleIf)}`);
    lines.push(`  const isVisible = ${ruleValueToRuntimeSource(view.rules.visibleIf, `{ currentUser, record, formData }`)};`);
  } else {
    lines.push(`  const isVisible = true;`);
  }
  if (view.rules?.enabledIf) {
    lines.push(`  // Policy: enabledIf — controls form interactivity`);
    lines.push(`  // @source-node ${view.id}.rules.enabledIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.enabledIf)}`);
    lines.push(`  const isEnabled = ${ruleValueToRuntimeSource(view.rules.enabledIf, `{ currentUser, record, formData }`)};`);
  } else {
    lines.push(`  const isEnabled = true;`);
  }
  if (view.rules?.allowIf) {
    lines.push(`  // Policy: allowIf — guards submission`);
    lines.push(`  // @source-node ${view.id}.rules.allowIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.allowIf)}`);
    lines.push(`  const canSubmit = ${ruleValueToRuntimeSource(view.rules.allowIf, `{ currentUser, record, formData }`)};`);
  } else {
    lines.push(`  const canSubmit = true;`);
  }
  if (view.rules?.enforce) {
    lines.push(`  // Policy: enforce`);
    lines.push(`  // @source-node ${view.id}.rules.enforce`);
    lines.push(`  // ${ruleValueToComment(view.rules.enforce)}`);
    lines.push(`  const passesEnforcement = ${ruleValueToRuntimeSource(view.rules.enforce, `{ currentUser, record, formData }`)};`);
  } else {
    lines.push(`  const passesEnforcement = true;`);
  }
  lines.push(``);

  // Field change handler
  lines.push(`  const handleFieldChange = useCallback((field: string, value: unknown) => {`);
  lines.push(`    setFormEdits(prev => ({ ...prev, [field]: value }));`);
  lines.push(`  }, []);`);
  lines.push(``);
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    const itemsName = `${includeKey}Items`;
    const handleAdd = `handleAdd${capitalize(includeKey)}`;
    const handleRemove = `handleRemove${capitalize(includeKey)}`;
    const handleChange = `handle${capitalize(includeKey)}FieldChange`;
    lines.push(`  const ${itemsName} = formData.${binding.fieldName};`);
    lines.push(`  const ${handleAdd} = useCallback(() => {`);
    lines.push(`    setFormEdits((prev) => ({`);
    lines.push(`      ...prev,`);
    lines.push(`      ${binding.fieldName}: [...(prev.${binding.fieldName} ?? formData.${binding.fieldName}), {}],`);
    lines.push(`    }));`);
    lines.push(`  }, [formData.${binding.fieldName}]);`);
    lines.push(`  const ${handleRemove} = useCallback((index: number) => {`);
    lines.push(`    setFormEdits((prev) => {`);
    lines.push(`      const currentItems = prev.${binding.fieldName} ?? formData.${binding.fieldName};`);
    lines.push(`      return {`);
    lines.push(`        ...prev,`);
    lines.push(`        ${binding.fieldName}: currentItems.length <= ${binding.minItems}`);
    lines.push(`          ? currentItems`);
    lines.push(`          : currentItems.filter((_, itemIndex) => itemIndex !== index),`);
    lines.push(`      };`);
    lines.push(`    });`);
    lines.push(`  }, [formData.${binding.fieldName}]);`);
    lines.push(`  const ${handleChange} = useCallback((index: number, field: string, value: unknown) => {`);
    lines.push(`    setFormEdits((prev) => {`);
    lines.push(`      const currentItems = prev.${binding.fieldName} ?? formData.${binding.fieldName};`);
    lines.push(`      return {`);
    lines.push(`        ...prev,`);
    lines.push(`        ${binding.fieldName}: currentItems.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),`);
    lines.push(`      };`);
    lines.push(`    });`);
    lines.push(`  }, [formData.${binding.fieldName}]);`);
    lines.push(``);
  }

  // Submit handler with effect chain
  lines.push(`  const handleSubmit = useCallback(async (e: React.FormEvent) => {`);
  lines.push(`    e.preventDefault();`);
  lines.push(`    if (linkedEligibilityFailure) {`);
  lines.push(`      toast.error(linkedEligibilityFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (linkedValidationFailure) {`);
  lines.push(`      toast.error(linkedValidationFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (linkedIncludeFailure) {`);
  lines.push(`      toast.error(linkedIncludeFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (!isEnabled || !canSubmit || !passesEnforcement) {`);
  lines.push(`      toast.error('You do not have permission to perform this action');`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    try {`);
    lines.push(`      await updateItem(id, formData);`);
  for (const binding of includeBindings) {
    if (!binding.targetResource) {
      continue;
    }
    lines.push(`      if (typeof window !== 'undefined') {`);
    lines.push(`        window.dispatchEvent(new CustomEvent('rdsl:invalidate', { detail: { target: '${binding.targetResource.api}' } }));`);
    lines.push(`      }`);
  }
  for (const effect of view.onSuccess) {
    lines.push(`      ${generateEffectCode(effect, {
      routeIdExpr: 'id',
      messageContext: {
        form: 'formData',
        record: 'record',
        user: 'currentUser',
        params: { id: 'id' },
      },
    })}`);
  }
  if (!hasRedirectEffect) {
    if (hasWorkflow) {
      lines.push(`      if (nextWorkflowStep) {`);
      lines.push(`        window.location.href = ${workflowStepSurfaceHandoffHrefExpression(resource, 'nextWorkflowStep', 'id', 'returnTo')};`);
      lines.push(`      } else if (visibleWorkflowSteps.length > 0) {`);
        lines.push(`        window.location.href = ${pathWithOptionalReturnToExpression(`\`/${resource.name}/\${id}/workflow\``, 'returnTo')};`);
      lines.push(`      } else if (returnTo) {`);
      lines.push(`        window.location.href = returnTo;`);
      lines.push(`      }`);
    } else {
      lines.push(`      if (returnTo) {`);
      lines.push(`        window.location.href = returnTo;`);
      lines.push(`      }`);
    }
  }
  lines.push(`    } catch (err) {`);
      lines.push(`      toast.error('Failed to save');`);
    lines.push(`    }`);
  lines.push(`  }, [id, formData, isEnabled, canSubmit, passesEnforcement, linkedEligibilityFailure, linkedValidationFailure, linkedIncludeFailure, returnTo, updateItem, toast${hasWorkflow ? ', nextWorkflowStep, visibleWorkflowSteps' : ''}]);`);
  lines.push(``);

  lines.push(`  if (!record && loading) return <div className="rdsl-loading">Loading...</div>;`);
  lines.push(`  if (!record) return <div className="rdsl-error">Record not found</div>;`);
  lines.push(`  if (!isVisible) return null;`);
  lines.push(`  if (linkedEligibilityFailure) return <div className="rdsl-error">{linkedEligibilityFailure}</div>;`);
  lines.push(``);
  if (hasWorkflow) {
    lines.push(`  const submitLabel = nextWorkflowStep ? \`Save and continue to \${nextWorkflowStep.name}\` : 'Save';`);
    lines.push(``);
  }

  lines.push(`  return (`);
  lines.push(`    <form className="${classNameWithOptionalAuthoredStyle('rdsl-form', view.style)}" onSubmit={handleSubmit}>`);
  lines.push(`      {${formTitleElementConstName}}`);
  lines.push(`      {linkedValidationFailure ? <p className="rdsl-error">{linkedValidationFailure}</p> : null}`);
  lines.push(`      {linkedIncludeFailure ? <p className="rdsl-error">{linkedIncludeFailure}</p> : null}`);
  if (hasWorkflow) {
    lines.push(`      <WorkflowSummary`);
    lines.push(`        stateHeading="Current state"`);
    lines.push(`        stateLabel={currentWorkflowStateMeta?.label ?? currentWorkflowState}`);
    lines.push(`        currentStepName={currentWorkflowStep?.name ?? null}`);
    lines.push(`        nextStepName={nextWorkflowStep?.name ?? null}`);
    lines.push(`        steps={workflowSummarySteps}`);
    lines.push(`      />`);
  }

  for (const field of view.fields) {
    const fieldVisible = formFieldVisibleExpression(field, `{ currentUser, record, formData }`);
    const fieldEnabled = formFieldEnabledExpression(field, 'isEnabled', `{ currentUser, record, formData }`);
    if (field.customField) {
      // Escape hatch tier 2: custom field component
      const importName = getCustomComponentName(field.customField);
      lines.push(`      {/* @source-node ${field.id} */}`);
      lines.push(`      {${fieldVisible} ? <${importName} value={formData.${field.field}} onChange={(v: unknown) => handleFieldChange('${field.field}', v)} disabled={!(${fieldEnabled}) || linkedDerivedFieldNames.includes('${field.field}')} /> : null}`);
    } else {
      const disabled = field.decorators.find(d => d.name === 'disabled');
      const fieldType = getFormFieldType(field, model);
      const modelField = model.fields.find(f => f.name === field.field);
      let optionsAttr = '';
      if (modelField?.fieldType.type === 'enum') {
        const enumValues = (modelField.fieldType as { values: string[] }).values;
        // Hoist enum to avoid inline arrays causing re-renders
        const hoistedName = `${modelName}${capitalize(field.field)}Options`;
        if (!lines.includes(`const ${hoistedName} = [${enumValues.map(v => `'${v}'`).join(', ')}];`)) {
           lines.splice(2, 0, `const ${hoistedName} = [${enumValues.map(v => `'${v}'`).join(', ')}];`);
        }
        optionsAttr = ` options={${hoistedName}}`;
      } else {
        const relationBinding = relationBindings.find((binding) => binding.fieldName === field.field);
        if (relationBinding) {
          optionsAttr = ` options={${relationBinding.optionsName}}`;
        }
      }
      lines.push(`      {/* @source-node ${field.id} */}`);
      lines.push(`      {${fieldVisible} ? (`);
      lines.push(`        <FormField`);
      lines.push(`          label="${columnLabel(field.field)}"`);
      lines.push(`          name="${field.field}"`);
      lines.push(`          type="${fieldType}"`);
      lines.push(`          value={formData.${field.field} ?? ''}`);
      lines.push(`          onChange={(v: unknown) => handleFieldChange('${field.field}', v)}`);
      lines.push(`          schema={${modelName}Schema.${field.field}}`);
      if (optionsAttr) lines.push(`       ${optionsAttr}`);
      lines.push(`          disabled={${disabled ? 'true' : `!(${fieldEnabled}) || linkedDerivedFieldNames.includes('${field.field}')`}}`);
      lines.push(`        />`);
      lines.push(`      ) : null}`);
    }
  }

  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    const itemsName = `${includeKey}Items`;
    const handleAdd = `handleAdd${capitalize(includeKey)}`;
    const handleRemove = `handleRemove${capitalize(includeKey)}`;
    const handleChange = `handle${capitalize(includeKey)}FieldChange`;
    lines.push(`      <section className="rdsl-form-include">`);
    lines.push(`        <div className="rdsl-form-include-header">`);
    lines.push(`          {${includeTitleConstNames.get(binding.fieldName)}}`);
    lines.push(`          <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={${handleAdd}} disabled={!isEnabled}>Add item</button>`);
    lines.push(`        </div>`);
    if (binding.minItems > 0) {
      lines.push(`        <p className="rdsl-form-hint">At least ${binding.minItems} ${columnLabel(binding.fieldName).toLowerCase()} item${binding.minItems === 1 ? '' : 's'} required in the current slice.</p>`);
    }
    lines.push(`        {${itemsName}.length === 0 ? <p className="rdsl-form-include-empty">No ${columnLabel(binding.fieldName).toLowerCase()} added yet.</p> : null}`);
    lines.push(`        {${itemsName}.map((item, index) => (`);
    lines.push(`          <div key={item.id ?? \`${binding.fieldName}-\${index}\`} className="rdsl-form-include-item">`);
    lines.push(`            <div className="rdsl-form-include-item-header">`);
    lines.push(`              <strong>${columnLabel(binding.fieldName)} item {index + 1}</strong>`);
    lines.push(`              <div className="rdsl-read-actions">`);
    lines.push(`                {item.id ? <span className="rdsl-btn rdsl-btn-secondary">Existing</span> : <span className="rdsl-btn rdsl-btn-secondary">New</span>}`);
    lines.push(`                <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={() => ${handleRemove}(index)} disabled={!isEnabled || ${itemsName}.length <= ${binding.minItems}}>Remove</button>`);
    lines.push(`              </div>`);
    lines.push(`            </div>`);
    lines.push(`            {${includeKey}LinkedEligibilityFailures[index] ? <p className="rdsl-error">{${includeKey}LinkedEligibilityFailures[index]}</p> : null}`);
    lines.push(`            {${includeKey}LinkedValidationFailures[index] ? <p className="rdsl-error">{${includeKey}LinkedValidationFailures[index]}</p> : null}`);
    for (const field of binding.fields) {
      const fieldVisible = formFieldVisibleExpression(field, `{ currentUser, record, formData, item }`);
      const fieldEnabled = formFieldEnabledExpression(field, 'isEnabled', `{ currentUser, record, formData, item }`);
      if (field.customField) {
        const importName = getCustomComponentName(field.customField);
        lines.push(`            {/* @source-node ${field.id} */}`);
        lines.push(`            {${fieldVisible} ? <${importName} value={item.${field.field}} onChange={(v: unknown) => ${handleChange}(index, '${field.field}', v)} disabled={!(${fieldEnabled}) || ${includeKey}LinkedDerivedFieldNames.includes('${field.field}')} /> : null}`);
        continue;
      }
      const fieldType = getFormFieldType(field, binding.targetModel);
      const modelField = binding.targetModel.fields.find((candidate) => candidate.name === field.field);
      let optionsAttr = '';
      if (modelField?.fieldType.type === 'enum') {
        const enumValues = (modelField.fieldType as { values: string[] }).values;
        const hoistedName = `${binding.targetModel.name}${capitalize(field.field)}Options`;
        if (!lines.includes(`const ${hoistedName} = [${enumValues.map((value) => `'${value}'`).join(', ')}];`)) {
          lines.splice(2, 0, `const ${hoistedName} = [${enumValues.map((value) => `'${value}'`).join(', ')}];`);
        }
        optionsAttr = ` options={${hoistedName}}`;
      } else {
        const relationBinding = binding.relationBindings.find((candidate) => candidate.fieldName === field.field);
        if (relationBinding) {
          optionsAttr = ` options={${relationBinding.optionsName}}`;
        }
      }
      lines.push(`            {/* @source-node ${field.id} */}`);
      lines.push(`            {${fieldVisible} ? (`);
      lines.push(`              <FormField`);
      lines.push(`                label="${columnLabel(field.field)}"`);
      lines.push(`                name="${field.field}"`);
      lines.push(`                type="${fieldType}"`);
      lines.push(`                value={item.${field.field} ?? ''}`);
      lines.push(`                onChange={(v: unknown) => ${handleChange}(index, '${field.field}', v)}`);
      lines.push(`                schema={${binding.targetModel.name}Schema.${field.field}}`);
      if (optionsAttr) lines.push(`               ${optionsAttr}`);
      lines.push(`                disabled={!(${fieldEnabled}) || ${includeKey}LinkedDerivedFieldNames.includes('${field.field}')}`);
      lines.push(`              />`);
      lines.push(`            ) : null}`);
    }
    lines.push(`          </div>`);
    lines.push(`        ))}`);
  lines.push(`      </section>`);
  }

  lines.push(`      <div className="rdsl-form-actions">`);
  lines.push(`        <button type="submit" className="rdsl-btn rdsl-btn-primary" disabled={loading || !isEnabled || !canSubmit || !passesEnforcement || Boolean(linkedEligibilityFailure) || Boolean(linkedValidationFailure) || Boolean(linkedIncludeFailure)}>${hasWorkflow ? '{submitLabel}' : 'Save'}</button>`);
  if (hasWorkflow) {
    lines.push(`        <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}/workflow\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-secondary">Workflow</a>`);
  }
  lines.push(`        <a href={cancelHref} className="rdsl-btn rdsl-btn-secondary">Cancel</a>`);
  lines.push(`      </div>`);
  lines.push(`    </form>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const ${componentName} = React.memo(function ${componentName}({ id }: ${componentName}Props) {`);
  lines.push(`  const { getById, updateItem, loading } = useResource<${modelName}>('${resource.api}');`);
  lines.push(`  const record = getById(id);`);
  lines.push(`  const toast = useToast();`);
  if (needsAuth) {
    lines.push(`  const { currentUser } = useAuth();`);
  }
  lines.push(`  const searchParams = getLocationSearchParams();`);
  lines.push(`  const returnTo = getSanitizedReturnTo(searchParams);`);
  lines.push(`  const cancelHref = returnTo || ${cancelFallbackExpr};`);
  lines.push(`  if (!record && loading) return <div className="rdsl-loading">Loading...</div>;`);
  lines.push(`  if (!record) return <div className="rdsl-error">Record not found</div>;`);
  lines.push(`  return <${componentName}Form id={id} record={record} updateItem={updateItem} loading={loading} toast={toast}${needsAuth ? ' currentUser={currentUser}' : ''} returnTo={returnTo} cancelHref={cancelHref} />;`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: view.id,
  };
}

// ─── Create View ─────────────────────────────────────────────────

function generateCreateView(ir: IRApp, resource: IRResource, view: IRCreateView, model: IRModel): GeneratedFile {
  const componentName = `${capitalize(resource.name)}Create`;
  const filePath = `views/${componentName}.tsx`;
  const modelName = model.name;
  const lines: string[] = [];
  const hasViewRules = hasAnyRules(view.rules);
  const hasFieldRules = hasFormFieldReactions(view.fields) || view.includes.some((include) => hasFormFieldReactions(include.fields));
  const hasWorkflow = Boolean(resource.workflow);
  const hasWorkflowWizardAllows = workflowHasWizardAllows(resource);
  const hasRedirectEffect = view.onSuccess.some((effect) => effect.type === 'redirect');
  const relationBindings = collectRelationFieldBindings(ir, view.fields, model);
  const includeBindings = collectCreateIncludeBindings(ir, view, model);
  const linkedIncludeBindings = includeBindings.filter((binding) => Boolean(binding.rulesLink));
  const hasLinkedRules = Boolean(view.rulesLink) || linkedIncludeBindings.length > 0;
  const hasLinkedEligibilityRules = Boolean(view.rulesLink?.program.eligibility.length);
  const hasLinkedValidationRules = Boolean(view.rulesLink?.program.validation.length);
  const hasLinkedDerivations = Boolean(view.rulesLink?.program.derivations.length);
  const hasLinkedIncludeEligibilityRules = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.eligibility.length));
  const hasLinkedIncludeValidationRules = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.validation.length));
  const hasLinkedIncludeDerivations = linkedIncludeBindings.some((binding) => Boolean(binding.rulesLink?.program.derivations.length));
  const needsAuth = hasViewRules || hasLinkedRules || hasFieldRules || effectRefsRequireUser(view.onSuccess) || hasWorkflow;
  const sharedRelationBindings = uniqueRelationBindings([
    ...relationBindings,
    ...includeBindings.flatMap((binding) => binding.relationBindings),
  ]);
  const createSeedFields = view.fields
    .map((field) => model.fields.find((candidate) => candidate.name === field.field))
    .filter((candidate): candidate is IRModel['fields'][number] => Boolean(candidate))
    .filter((candidate) =>
      candidate.fieldType.type === 'enum'
      || candidate.fieldType.type === 'scalar'
      || (candidate.fieldType.type === 'relation' && candidate.fieldType.kind === 'belongsTo'));
  const includeTargetModels = includeBindings
    .map((binding) => binding.targetModel)
    .filter((candidate, index, all) => all.findIndex((entry) => entry.name === candidate.name) === index);
  const createFormDataTypeName = `${modelName}CreateFormData`;
  const importedTypeModelNames = new Set<string>([modelName]);
  const linkedDerivationFields = view.rulesLink?.program.derivations.map((entry) => entry.field) ?? [];
  const linkedDerivationTargets = view.fields
    .map((field) => model.fields.find((candidate) => candidate.name === field.field))
    .filter((field): field is IRModel['fields'][number] => Boolean(field) && linkedDerivationFields.includes(field!.name));
  const linkedEligibilityRulesConstName = hasLinkedEligibilityRules ? staticComponentConstName(componentName, 'LinkedEligibilityRules') : null;
  const linkedValidationRulesConstName = hasLinkedValidationRules ? staticComponentConstName(componentName, 'LinkedValidationRules') : null;
  const linkedDerivationRulesConstName = hasLinkedDerivations ? staticComponentConstName(componentName, 'LinkedDerivationRules') : null;
  const linkedDerivedFieldNamesConstName = staticComponentConstName(componentName, 'LinkedDerivedFieldNames');
  const includeDerivedFieldNamesConstNames = new Map(includeBindings.map((binding) => [
    binding.fieldName,
    staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedDerivedFieldNames`),
  ]));
  const includeLinkedEligibilityRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.eligibility.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedEligibilityRules`),
    ]));
  const includeLinkedValidationRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.validation.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedValidationRules`),
    ]));
  const includeLinkedDerivationRulesConstNames = new Map(linkedIncludeBindings
    .filter((binding) => Boolean(binding.rulesLink?.program.derivations.length))
    .map((binding) => [
      binding.fieldName,
      staticComponentConstName(componentName, `${capitalize(camelCase(binding.fieldName))}LinkedDerivationRules`),
    ]));
  const workflowStepsConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowSteps') : null;
  const workflowStatesConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStates') : null;
  const workflowStatesByNameConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStatesByName') : null;
  const lookupOptionsConstName = componentResourceOptionsConstName(componentName);
  const formTitleElementConstName = componentTitleElementConstName(componentName);
  const includeTitleConstNames = new Map(includeBindings.map((binding) => [
    binding.fieldName,
    componentScopedTitleElementConstName(componentName, `${capitalize(camelCase(binding.fieldName))}Include`),
  ]));
  const cancelFallbackExpr = routeTargetToHrefExpression(`${resource.name}.list`);

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${view.id}`);
  lines.push(``);
  lines.push(`import React, { useCallback } from 'react';`);
  lines.push(`import { FormField } from '@loj-lang/rdsl-runtime/components/FormField';`);
  if (hasWorkflow) {
    lines.push(`import { WorkflowSummary } from '@loj-lang/rdsl-runtime/components/WorkflowSummary';`);
  }

  const customFieldImports = collectCustomFieldImports([
    ...view.fields,
    ...view.includes.flatMap((include) => include.fields),
  ]);
  for (const imp of customFieldImports) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  for (const imp of uniqueImports([
    ...collectFnImportsFromRules(view.rules),
    ...collectFnImportsFromFormFields(view.fields),
    ...view.includes.flatMap((include) => collectFnImportsFromFormFields(include.fields)),
  ])) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  lines.push(`import { getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (needsAuth) {
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  }
  if (hasViewRules || hasFieldRules || hasWorkflow) {
    lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  if (hasLinkedRules) {
    lines.push(`import { evaluatePolicyExpr, firstPolicyFailure } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  lines.push(`import type { ${modelName} } from '../models/${modelName}';`);
  lines.push(`import { ${modelName}Schema } from '../models/${modelName}';`);
  for (const binding of sharedRelationBindings) {
    if (importedTypeModelNames.has(binding.targetModel.name)) {
      continue;
    }
    importedTypeModelNames.add(binding.targetModel.name);
    lines.push(`import type { ${binding.targetModel.name} } from '../models/${binding.targetModel.name}';`);
  }
  for (const targetModel of includeTargetModels) {
    if (!importedTypeModelNames.has(targetModel.name)) {
      importedTypeModelNames.add(targetModel.name);
      lines.push(`import type { ${targetModel.name} } from '../models/${targetModel.name}';`);
    }
    if (targetModel.name === modelName) {
      continue;
    }
    lines.push(`import { ${targetModel.name}Schema } from '../models/${targetModel.name}';`);
  }
  lines.push(``);
  lines.push(`type ${createFormDataTypeName} = Partial<${modelName}>${includeBindings.length > 0
    ? ` & {\n${includeBindings.map((binding) => `  ${binding.fieldName}: Array<Partial<${binding.targetModel.name}>>;`).join('\n')}\n}`
    : ''};`);
  lines.push(``);
  if (linkedEligibilityRulesConstName) {
    appendStaticConst(lines, linkedEligibilityRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'eligibility')} as Array<Record<string, unknown>>`);
  }
  if (linkedValidationRulesConstName) {
    appendStaticConst(lines, linkedValidationRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'validation')} as Array<Record<string, unknown>>`);
  }
  if (linkedDerivationRulesConstName) {
    appendStaticConst(lines, linkedDerivationRulesConstName, `${rulesLinkManifestEntriesLiteral(view.rulesLink, 'derivations')} as Array<Record<string, unknown>>`);
  }
  appendStaticConst(lines, linkedDerivedFieldNamesConstName, `${JSON.stringify(linkedDerivationFields)} as string[]`);
  for (const binding of includeBindings) {
    const includeDerivationFields = binding.rulesLink?.program.derivations.map((entry) => entry.field) ?? [];
    appendStaticConst(lines, includeDerivedFieldNamesConstNames.get(binding.fieldName)!, `${JSON.stringify(includeDerivationFields)} as string[]`);
  }
  for (const binding of linkedIncludeBindings) {
    if (binding.rulesLink?.program.eligibility.length) {
      appendStaticConst(lines, includeLinkedEligibilityRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'eligibility')} as Array<Record<string, unknown>>`);
    }
    if (binding.rulesLink?.program.validation.length) {
      appendStaticConst(lines, includeLinkedValidationRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'validation')} as Array<Record<string, unknown>>`);
    }
    if (binding.rulesLink?.program.derivations.length) {
      appendStaticConst(lines, includeLinkedDerivationRulesConstNames.get(binding.fieldName)!, `${rulesLinkManifestEntriesLiteral(binding.rulesLink, 'derivations')} as Array<Record<string, unknown>>`);
    }
  }
  if (workflowStepsConstName) {
    appendStaticConst(lines, workflowStepsConstName, `${workflowStepsRuntimeLiteral(resource)} as ${workflowStepArrayTypeSource()}`);
  }
  if (workflowStatesConstName) {
    appendStaticConst(lines, workflowStatesConstName, `${workflowStateMetaRuntimeLiteral(resource)} as ${workflowStateArrayTypeSource()}`);
  }
  if (workflowStatesByNameConstName) {
    appendStaticConst(lines, workflowStatesByNameConstName, `${workflowStateMetaByNameRuntimeLiteral(resource)} as ${workflowStateMapTypeSource()}`);
  }
  if (sharedRelationBindings.length > 0) {
    appendStaticConst(lines, lookupOptionsConstName, `{ pageSize: 1000 } as const`);
  }
  appendStaticConst(lines, formTitleElementConstName, `<h2>{${JSON.stringify(`Create ${capitalize(resource.name)}`)}}</h2>`);
  for (const binding of includeBindings) {
    appendStaticConst(lines, includeTitleConstNames.get(binding.fieldName)!, `<h3>{${JSON.stringify(columnLabel(binding.fieldName))}}</h3>`);
  }
  lines.push(``);

  lines.push(`interface ${componentName}FormProps {`);
  lines.push(`  createItem: ReturnType<typeof useResource<${modelName}>>['createItem'];`);
  lines.push(`  loading: boolean;`);
  lines.push(`  toast: ReturnType<typeof useToast>;`);
  if (needsAuth) {
    lines.push(`  currentUser: ReturnType<typeof useAuth>['currentUser'];`);
  }
  lines.push(`  searchParams: URLSearchParams | null;`);
  lines.push(`  returnTo: string | null;`);
  lines.push(`  cancelHref: string;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`function ${componentName}Form({ createItem, loading, toast${needsAuth ? ', currentUser' : ''}, searchParams, returnTo, cancelHref }: ${componentName}FormProps) {`);
  lines.push(`  const initialFormData: ${createFormDataTypeName} = (() => {`);
  lines.push(`    const initial: ${createFormDataTypeName} = {`);
  if (hasWorkflow) {
    lines.push(`      ${resource.workflow!.program.field}: ${JSON.stringify(workflowInitialState(resource))} as ${modelName}['${resource.workflow!.program.field}'],`);
  }
  for (const binding of includeBindings) {
    lines.push(`      ${binding.fieldName}: Array.from({ length: ${binding.minItems} }, () => ({})),`);
  }
  lines.push(`    };`);
  lines.push(`    if (!searchParams) return initial;`);
  for (const field of createSeedFields) {
    const paramName = `${camelCase(field.name)}Param`;
    lines.push(`    const ${paramName} = searchParams.get('${field.name}');`);
    lines.push(`    if (${paramName}) {`);
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'number') {
      lines.push(`      initial.${field.name} = Number.isNaN(Number(${paramName})) ? initial.${field.name} : Number(${paramName});`);
    } else if (field.fieldType.type === 'scalar' && field.fieldType.name === 'boolean') {
      lines.push(`      initial.${field.name} = ${paramName} === 'true';`);
    } else if (field.fieldType.type === 'enum') {
      lines.push(`      initial.${field.name} = ${paramName} as ${modelName}['${field.name}'];`);
    } else {
      lines.push(`      initial.${field.name} = ${paramName};`);
    }
    lines.push(`    }`);
  }
  lines.push(`    return initial;`);
  lines.push(`  })();`);
  lines.push(`  const [draftFormData, setFormData] = React.useState<${createFormDataTypeName}>(initialFormData);`);
  if (hasLinkedEligibilityRules) {
    lines.push(`  const linkedEligibilityRules = ${linkedEligibilityRulesConstName};`);
  }
  if (hasLinkedValidationRules) {
    lines.push(`  const linkedValidationRules = ${linkedValidationRulesConstName};`);
  }
  for (const binding of linkedIncludeBindings) {
    const includeKey = camelCase(binding.fieldName);
    if (binding.rulesLink?.program.eligibility.length) {
      lines.push(`  const ${includeKey}LinkedEligibilityRules = ${includeLinkedEligibilityRulesConstNames.get(binding.fieldName)};`);
    }
    if (binding.rulesLink?.program.validation.length) {
      lines.push(`  const ${includeKey}LinkedValidationRules = ${includeLinkedValidationRulesConstNames.get(binding.fieldName)};`);
    }
    if (binding.rulesLink?.program.derivations.length) {
      lines.push(`  const ${includeKey}LinkedDerivationRules = ${includeLinkedDerivationRulesConstNames.get(binding.fieldName)};`);
    }
  }
  if (hasLinkedDerivations) {
    lines.push(`  const linkedDerivationRules = ${linkedDerivationRulesConstName};`);
  }
  lines.push(`  const linkedDerivedFieldNames = ${linkedDerivedFieldNamesConstName};`);
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    lines.push(`  const ${includeKey}LinkedDerivedFieldNames = ${includeDerivedFieldNamesConstNames.get(binding.fieldName)};`);
  }
  if (hasLinkedDerivations || hasLinkedIncludeDerivations) {
    lines.push(`  const formData = React.useMemo<${createFormDataTypeName}>(() => {`);
    lines.push(`    const nextFormData: ${createFormDataTypeName} = { ...draftFormData };`);
    if (hasLinkedDerivations) {
      lines.push(`    for (const derivation of linkedDerivationRules) {`);
      lines.push(`      if (typeof derivation.field !== 'string') continue;`);
      lines.push(`      if (derivation.when && !Boolean(evaluatePolicyExpr(derivation.when, { currentUser, formData: nextFormData }))) continue;`);
      lines.push(`      switch (derivation.field) {`);
      for (const field of linkedDerivationTargets) {
        lines.push(`        case '${field.name}': {`);
        lines.push(`          const value = evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData });`);
        lines.push(`          nextFormData.${field.name} = ${formRulesDerivationAssignmentExpression(field, 'value', `nextFormData.${field.name}`)};`);
        lines.push(`          break;`);
        lines.push(`        }`);
      }
      lines.push(`        default:`);
      lines.push(`          break;`);
      lines.push(`      }`);
      lines.push(`    }`);
    }
    for (const binding of linkedIncludeBindings.filter((candidate) => Boolean(candidate.rulesLink?.program.derivations.length))) {
      const includeKey = camelCase(binding.fieldName);
      const includeDerivationTargets = binding.fields
        .map((field) => binding.targetModel.fields.find((candidate) => candidate.name === field.field))
        .filter((field): field is IRModel['fields'][number] => Boolean(field) && (binding.rulesLink?.program.derivations.some((entry) => entry.field === field!.name) ?? false));
      lines.push(`    nextFormData.${binding.fieldName} = (nextFormData.${binding.fieldName} ?? []).map((item) => {`);
      lines.push(`      const nextItem = { ...item };`);
      lines.push(`      for (const derivation of ${includeKey}LinkedDerivationRules) {`);
      lines.push(`        if (typeof derivation.field !== 'string') continue;`);
      lines.push(`        if (derivation.when && !Boolean(evaluatePolicyExpr(derivation.when, { currentUser, formData: nextFormData, item: nextItem }))) continue;`);
      lines.push(`        switch (derivation.field) {`);
      for (const field of includeDerivationTargets) {
        lines.push(`          case '${field.name}': {`);
        lines.push(`            const value = evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData, item: nextItem });`);
        lines.push(`            nextItem.${field.name} = ${formRulesDerivationAssignmentExpression(field, 'value', `nextItem.${field.name}`)};`);
        lines.push(`            break;`);
        lines.push(`          }`);
      }
      lines.push(`          default:`);
      lines.push(`            break;`);
      lines.push(`        }`);
      lines.push(`      }`);
      lines.push(`      return nextItem;`);
      lines.push(`    });`);
    }
    lines.push(`    return nextFormData;`);
    lines.push(`  }, [draftFormData${hasLinkedDerivations ? ', linkedDerivationRules' : ''}, currentUser${linkedIncludeBindings.filter((candidate) => Boolean(candidate.rulesLink?.program.derivations.length)).map((binding) => `, ${camelCase(binding.fieldName)}LinkedDerivationRules`).join('')}]);`);
  } else {
    lines.push(`  const formData = draftFormData;`);
  }
  if (hasLinkedEligibilityRules) {
    lines.push(`  const linkedEligibilityFailure = firstPolicyFailure(linkedEligibilityRules, { currentUser, formData }, 'Forbidden');`);
  } else {
    lines.push(`  const linkedEligibilityFailure = null;`);
  }
  if (hasLinkedValidationRules) {
    lines.push(`  const linkedValidationFailure = linkedEligibilityFailure ? null : firstPolicyFailure(linkedValidationRules, { currentUser, formData }, 'Invalid request');`);
  } else {
    lines.push(`  const linkedValidationFailure = null;`);
  }
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    if (binding.rulesLink?.program.eligibility.length) {
      lines.push(`  const ${includeKey}LinkedEligibilityFailures = (formData.${binding.fieldName} ?? []).map((item) => firstPolicyFailure(${includeKey}LinkedEligibilityRules, { currentUser, formData, item }, 'Forbidden'));`);
    } else {
      lines.push(`  const ${includeKey}LinkedEligibilityFailures: Array<string | null> = [];`);
    }
    if (binding.rulesLink?.program.validation.length) {
      lines.push(`  const ${includeKey}LinkedValidationFailures = (formData.${binding.fieldName} ?? []).map((item, index) => ${includeKey}LinkedEligibilityFailures[index] ? null : firstPolicyFailure(${includeKey}LinkedValidationRules, { currentUser, formData, item }, 'Invalid request'));`);
    } else {
      lines.push(`  const ${includeKey}LinkedValidationFailures: Array<string | null> = [];`);
    }
    lines.push(`  const ${includeKey}LinkedFailure = ${includeKey}LinkedEligibilityFailures.find((failure) => Boolean(failure)) ?? ${includeKey}LinkedValidationFailures.find((failure) => Boolean(failure)) ?? null;`);
  }
  if (includeBindings.length > 0) {
    lines.push(`  const linkedIncludeFailure = [${includeBindings.map((binding) => `${camelCase(binding.fieldName)}LinkedFailure`).join(', ')}].find((failure) => Boolean(failure)) ?? null;`);
  } else {
    lines.push(`  const linkedIncludeFailure = null;`);
  }
  if (hasWorkflow) {
    lines.push(`  const workflowSteps = ${workflowStepsConstName};`);
    lines.push(`  const workflowStatesByName = ${workflowStatesByNameConstName};`);
    lines.push(`  const currentWorkflowState = ${JSON.stringify(workflowInitialState(resource))};`);
    lines.push(`  const visibleWorkflowSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, formData }));`);
    lines.push(`  const activeWorkflowIndex = visibleWorkflowSteps.findIndex((step) => step.completesWith === currentWorkflowState);`);
    lines.push(`  const currentWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex] ?? null : null;`);
    lines.push(`  const nextWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    lines.push(`  const currentWorkflowStateMeta = workflowStatesByName[currentWorkflowState] ?? null;`);
    lines.push(`  const workflowSummarySteps = visibleWorkflowSteps.map((step, index) => ({`);
    lines.push(`    name: step.name,`);
    lines.push(`    status: index < activeWorkflowIndex ? 'done' as const : index === activeWorkflowIndex ? 'current' as const : 'upcoming' as const,`);
    lines.push(`  }));`);
  }
  for (const binding of sharedRelationBindings) {
    lines.push(`  const ${binding.hookName} = useResource<${binding.targetModel.name}>('${binding.targetResource.api}', ${lookupOptionsConstName});`);
    lines.push(`  const ${binding.optionsName} = React.useMemo(() => ${binding.hookName}.allData.map((item) => ({ value: item.id, label: String(item.${binding.labelField} ?? item.id) })), [${binding.hookName}.allData]);`);
  }
  lines.push(``);

  if (view.rules?.visibleIf) {
    lines.push(`  // Policy: visibleIf`);
    lines.push(`  // @source-node ${view.id}.rules.visibleIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.visibleIf)}`);
    lines.push(`  const isVisible = ${ruleValueToRuntimeSource(view.rules.visibleIf, `{ currentUser, formData }`)};`);
  } else {
    lines.push(`  const isVisible = true;`);
  }
  if (view.rules?.enabledIf) {
    lines.push(`  // Policy: enabledIf`);
    lines.push(`  // @source-node ${view.id}.rules.enabledIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.enabledIf)}`);
    lines.push(`  const isEnabled = ${ruleValueToRuntimeSource(view.rules.enabledIf, `{ currentUser, formData }`)};`);
  } else {
    lines.push(`  const isEnabled = true;`);
  }
  if (view.rules?.allowIf) {
    lines.push(`  // Policy: allowIf`);
    lines.push(`  // @source-node ${view.id}.rules.allowIf`);
    lines.push(`  // ${ruleValueToComment(view.rules.allowIf)}`);
    lines.push(`  const canSubmit = ${ruleValueToRuntimeSource(view.rules.allowIf, `{ currentUser, formData }`)};`);
  } else {
    lines.push(`  const canSubmit = true;`);
  }
  if (view.rules?.enforce) {
    lines.push(`  // Policy: enforce`);
    lines.push(`  // @source-node ${view.id}.rules.enforce`);
    lines.push(`  // ${ruleValueToComment(view.rules.enforce)}`);
    lines.push(`  const passesEnforcement = ${ruleValueToRuntimeSource(view.rules.enforce, `{ currentUser, formData }`)};`);
  } else {
    lines.push(`  const passesEnforcement = true;`);
  }
  lines.push(``);

  lines.push(`  const handleFieldChange = useCallback((field: string, value: unknown) => {`);
  lines.push(`    setFormData(prev => ({ ...prev, [field]: value }));`);
  lines.push(`  }, []);`);
  lines.push(``);
  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    const itemsName = `${includeKey}Items`;
    const handleAdd = `handleAdd${capitalize(includeKey)}`;
    const handleRemove = `handleRemove${capitalize(includeKey)}`;
    const handleChange = `handle${capitalize(includeKey)}FieldChange`;
    lines.push(`  const ${itemsName} = formData.${binding.fieldName};`);
    lines.push(`  const ${handleAdd} = useCallback(() => {`);
    lines.push(`    setFormData((prev) => ({`);
    lines.push(`      ...prev,`);
    lines.push(`      ${binding.fieldName}: [...prev.${binding.fieldName}, {}],`);
    lines.push(`    }));`);
    lines.push(`  }, []);`);
    lines.push(`  const ${handleRemove} = useCallback((index: number) => {`);
    lines.push(`    setFormData((prev) => ({`);
    lines.push(`      ...prev,`);
    lines.push(`      ${binding.fieldName}: prev.${binding.fieldName}.length <= ${binding.minItems}`);
    lines.push(`        ? prev.${binding.fieldName}`);
    lines.push(`        : prev.${binding.fieldName}.filter((_, itemIndex) => itemIndex !== index),`);
    lines.push(`    }));`);
    lines.push(`  }, []);`);
    lines.push(`  const ${handleChange} = useCallback((index: number, field: string, value: unknown) => {`);
    lines.push(`    setFormData((prev) => ({`);
    lines.push(`      ...prev,`);
    lines.push(`      ${binding.fieldName}: prev.${binding.fieldName}.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),`);
    lines.push(`    }));`);
    lines.push(`  }, []);`);
    lines.push(``);
  }

  lines.push(`  const handleSubmit = useCallback(async (e: React.FormEvent) => {`);
  lines.push(`    e.preventDefault();`);
  lines.push(`    if (linkedEligibilityFailure) {`);
  lines.push(`      toast.error(linkedEligibilityFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (linkedValidationFailure) {`);
  lines.push(`      toast.error(linkedValidationFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (linkedIncludeFailure) {`);
  lines.push(`      toast.error(linkedIncludeFailure);`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    if (!isEnabled || !canSubmit || !passesEnforcement) {`);
  lines.push(`      toast.error('You do not have permission to perform this action');`);
  lines.push(`      return;`);
  lines.push(`    }`);
  lines.push(`    try {`);
  lines.push(`      const createdRecord = await createItem(formData);`);
  for (const effect of view.onSuccess) {
    lines.push(`      ${generateEffectCode(effect, {
      routeIdExpr: 'createdRecord?.id',
      messageContext: {
        form: 'formData',
        user: 'currentUser',
      },
    })}`);
  }
  if (!hasRedirectEffect) {
    if (hasWorkflow) {
      lines.push(`      if (createdRecord?.id && nextWorkflowStep) {`);
      lines.push(`        window.location.href = ${workflowStepSurfaceHandoffHrefExpression(resource, 'nextWorkflowStep', 'createdRecord.id', 'returnTo')};`);
      lines.push(`      } else if (createdRecord?.id && visibleWorkflowSteps.length > 0) {`);
        lines.push(`        window.location.href = ${pathWithOptionalReturnToExpression(`\`/${resource.name}/\${createdRecord.id}/workflow\``, 'returnTo')};`);
      lines.push(`      } else if (returnTo) {`);
      lines.push(`        window.location.href = returnTo;`);
      lines.push(`      }`);
    } else {
      lines.push(`      if (returnTo) {`);
      lines.push(`        window.location.href = returnTo;`);
      lines.push(`      }`);
    }
  }
  lines.push(`    } catch (err) {`);
    lines.push(`      toast.error('Failed to create');`);
    lines.push(`    }`);
  lines.push(`  }, [formData, isEnabled, canSubmit, passesEnforcement, linkedEligibilityFailure, linkedValidationFailure, linkedIncludeFailure, createItem, returnTo, toast${hasWorkflow ? ', nextWorkflowStep, visibleWorkflowSteps' : ''}]);`);
  lines.push(``);

  lines.push(`  if (!isVisible) return null;`);
  lines.push(`  if (linkedEligibilityFailure) return <div className="rdsl-error">{linkedEligibilityFailure}</div>;`);
  lines.push(``);
  if (hasWorkflow) {
    lines.push(`  const submitLabel = nextWorkflowStep ? \`Create and continue to \${nextWorkflowStep.name}\` : 'Create';`);
    lines.push(``);
  }
  lines.push(`  return (`);
  lines.push(`    <form className="${classNameWithOptionalAuthoredStyle('rdsl-form', view.style)}" onSubmit={handleSubmit}>`);
  lines.push(`      {${formTitleElementConstName}}`);
  lines.push(`      {linkedValidationFailure ? <p className="rdsl-error">{linkedValidationFailure}</p> : null}`);
  lines.push(`      {linkedIncludeFailure ? <p className="rdsl-error">{linkedIncludeFailure}</p> : null}`);
  if (hasWorkflow) {
    lines.push(`      <WorkflowSummary`);
    lines.push(`        stateHeading="Initial state"`);
    lines.push(`        stateLabel={currentWorkflowStateMeta?.label ?? currentWorkflowState}`);
    lines.push(`        currentStepName={currentWorkflowStep?.name ?? null}`);
    lines.push(`        nextStepName={nextWorkflowStep?.name ?? null}`);
    lines.push(`        steps={workflowSummarySteps}`);
    lines.push(`      />`);
  }

  for (const field of view.fields) {
    const fieldVisible = formFieldVisibleExpression(field, `{ currentUser, formData }`);
    const fieldEnabled = formFieldEnabledExpression(field, 'isEnabled', `{ currentUser, formData }`);
    if (field.customField) {
      const importName = getCustomComponentName(field.customField);
      lines.push(`      {/* @source-node ${field.id} */}`);
      lines.push(`      {${fieldVisible} ? <${importName} value={formData.${field.field}} onChange={(v: unknown) => handleFieldChange('${field.field}', v)} disabled={!(${fieldEnabled}) || linkedDerivedFieldNames.includes('${field.field}')} /> : null}`);
    } else {
      const fieldType = getFormFieldType(field, model);
      const modelField = model.fields.find(f => f.name === field.field);
      let optionsAttr = '';
      if (modelField?.fieldType.type === 'enum') {
        const enumValues = (modelField.fieldType as { values: string[] }).values;
        // Hoist enum to avoid inline arrays causing re-renders
        const hoistedName = `${modelName}${capitalize(field.field)}Options`;
        if (!lines.includes(`const ${hoistedName} = [${enumValues.map(v => `'${v}'`).join(', ')}];`)) {
           lines.splice(2, 0, `const ${hoistedName} = [${enumValues.map(v => `'${v}'`).join(', ')}];`);
        }
        optionsAttr = ` options={${hoistedName}}`;
      } else {
        const relationBinding = relationBindings.find((binding) => binding.fieldName === field.field);
        if (relationBinding) {
          optionsAttr = ` options={${relationBinding.optionsName}}`;
        }
      }
      lines.push(`      {/* @source-node ${field.id} */}`);
      lines.push(`      {${fieldVisible} ? (`);
      lines.push(`        <FormField`);
      lines.push(`          label="${columnLabel(field.field)}"`);
      lines.push(`          name="${field.field}"`);
      lines.push(`          type="${fieldType}"`);
      lines.push(`          value={formData.${field.field} ?? ''}`);
      lines.push(`          onChange={(v: unknown) => handleFieldChange('${field.field}', v)}`);
      lines.push(`          schema={${modelName}Schema.${field.field}}`);
      if (optionsAttr) lines.push(`       ${optionsAttr}`);
      lines.push(`          disabled={!(${fieldEnabled}) || linkedDerivedFieldNames.includes('${field.field}')}`);
      lines.push(`        />`);
      lines.push(`      ) : null}`);
    }
  }

  for (const binding of includeBindings) {
    const includeKey = camelCase(binding.fieldName);
    const itemsName = `${includeKey}Items`;
    const handleAdd = `handleAdd${capitalize(includeKey)}`;
    const handleRemove = `handleRemove${capitalize(includeKey)}`;
    const handleChange = `handle${capitalize(includeKey)}FieldChange`;
    lines.push(`      <section className="rdsl-form-include">`);
    lines.push(`        <div className="rdsl-form-include-header">`);
    lines.push(`          {${includeTitleConstNames.get(binding.fieldName)}}`);
    lines.push(`          <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={${handleAdd}} disabled={!isEnabled}>Add item</button>`);
    lines.push(`        </div>`);
    if (binding.minItems > 0) {
      lines.push(`        <p className="rdsl-form-hint">At least ${binding.minItems} ${columnLabel(binding.fieldName).toLowerCase()} item${binding.minItems === 1 ? '' : 's'} required in the current slice.</p>`);
    }
    lines.push(`        {${itemsName}.length === 0 ? <p className="rdsl-form-include-empty">No ${columnLabel(binding.fieldName).toLowerCase()} added yet.</p> : null}`);
    lines.push(`        {${itemsName}.map((item, index) => (`);
    lines.push(`          <div key={\`${binding.fieldName}-\${index}\`} className="rdsl-form-include-item">`);
    lines.push(`            <div className="rdsl-form-include-item-header">`);
    lines.push(`              <strong>${columnLabel(binding.fieldName)} item {index + 1}</strong>`);
    lines.push(`              <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={() => ${handleRemove}(index)} disabled={!isEnabled || ${itemsName}.length <= ${binding.minItems}}>Remove</button>`);
    lines.push(`            </div>`);
    lines.push(`            {${includeKey}LinkedEligibilityFailures[index] ? <p className="rdsl-error">{${includeKey}LinkedEligibilityFailures[index]}</p> : null}`);
    lines.push(`            {${includeKey}LinkedValidationFailures[index] ? <p className="rdsl-error">{${includeKey}LinkedValidationFailures[index]}</p> : null}`);
    for (const field of binding.fields) {
      const fieldVisible = formFieldVisibleExpression(field, `{ currentUser, formData, item }`);
      const fieldEnabled = formFieldEnabledExpression(field, 'isEnabled', `{ currentUser, formData, item }`);
      if (field.customField) {
        const importName = getCustomComponentName(field.customField);
        lines.push(`            {/* @source-node ${field.id} */}`);
        lines.push(`            {${fieldVisible} ? <${importName} value={item.${field.field}} onChange={(v: unknown) => ${handleChange}(index, '${field.field}', v)} disabled={!(${fieldEnabled}) || ${includeKey}LinkedDerivedFieldNames.includes('${field.field}')} /> : null}`);
        continue;
      }
      const fieldType = getFormFieldType(field, binding.targetModel);
      const modelField = binding.targetModel.fields.find((candidate) => candidate.name === field.field);
      let optionsAttr = '';
      if (modelField?.fieldType.type === 'enum') {
        const enumValues = (modelField.fieldType as { values: string[] }).values;
        const hoistedName = `${binding.targetModel.name}${capitalize(field.field)}Options`;
        if (!lines.includes(`const ${hoistedName} = [${enumValues.map((value) => `'${value}'`).join(', ')}];`)) {
          lines.splice(2, 0, `const ${hoistedName} = [${enumValues.map((value) => `'${value}'`).join(', ')}];`);
        }
        optionsAttr = ` options={${hoistedName}}`;
      } else {
        const relationBinding = binding.relationBindings.find((candidate) => candidate.fieldName === field.field);
        if (relationBinding) {
          optionsAttr = ` options={${relationBinding.optionsName}}`;
        }
      }
      lines.push(`            {/* @source-node ${field.id} */}`);
      lines.push(`            {${fieldVisible} ? (`);
      lines.push(`              <FormField`);
      lines.push(`                label="${columnLabel(field.field)}"`);
      lines.push(`                name="${binding.fieldName}.${field.field}"`);
      lines.push(`                type="${fieldType}"`);
      lines.push(`                value={item.${field.field} ?? ''}`);
      lines.push(`                onChange={(v: unknown) => ${handleChange}(index, '${field.field}', v)}`);
      lines.push(`                schema={${binding.targetModel.name}Schema.${field.field}}`);
      if (optionsAttr) {
        lines.push(`               ${optionsAttr}`);
      }
      lines.push(`                disabled={!(${fieldEnabled}) || ${includeKey}LinkedDerivedFieldNames.includes('${field.field}')}`);
      lines.push(`              />`);
      lines.push(`            ) : null}`);
    }
    lines.push(`          </div>`);
    lines.push(`        ))}`);
    lines.push(`      </section>`);
  }

  lines.push(`      <div className="rdsl-form-actions">`);
  lines.push(`        <button type="submit" className="rdsl-btn rdsl-btn-primary" disabled={loading || !isEnabled || !canSubmit || !passesEnforcement || Boolean(linkedEligibilityFailure) || Boolean(linkedValidationFailure) || Boolean(linkedIncludeFailure)}>${hasWorkflow ? '{submitLabel}' : 'Create'}</button>`);
  lines.push(`        <a href={cancelHref} className="rdsl-btn rdsl-btn-secondary">Cancel</a>`);
  lines.push(`      </div>`);
  lines.push(`    </form>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const ${componentName} = React.memo(function ${componentName}() {`);
  lines.push(`  const { createItem, loading } = useResource<${modelName}>('${resource.api}');`);
  lines.push(`  const toast = useToast();`);
  if (needsAuth) {
    lines.push(`  const { currentUser } = useAuth();`);
  }
  lines.push(`  const searchParams = getLocationSearchParams();`);
  lines.push(`  const returnTo = getSanitizedReturnTo(searchParams);`);
  lines.push(`  const cancelHref = returnTo || ${cancelFallbackExpr};`);
  lines.push(`  return <${componentName}Form createItem={createItem} loading={loading} toast={toast}${needsAuth ? ' currentUser={currentUser}' : ''} searchParams={searchParams} returnTo={returnTo} cancelHref={cancelHref} />;`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: view.id,
  };
}

// ─── Read View ───────────────────────────────────────────────────

function generateReadView(ir: IRApp, resource: IRResource, view: IRReadView, model: IRModel): GeneratedFile {
  const componentName = `${capitalize(resource.name)}Read`;
  const filePath = `views/${componentName}.tsx`;
  const modelName = model.name;
  const lines: string[] = [];
  const hasWorkflow = Boolean(resource.workflow);
  const hasWorkflowWizardAllows = workflowHasWizardAllows(resource);
  const hasWorkflowTransitionAllows = workflowHasTransitionAllows(resource);
  const readFieldProjectionBindings = collectListProjectionBindings(ir, view.fields, model);
  const relatedPanelBindings = collectRelatedPanelBindings(ir, view.related, model);
  const panelTableBindings = relatedPanelBindings.filter((panel) => panel.listView && panel.listView.columns.length > 0);
  const panelProjectionBindings = panelTableBindings.flatMap((panel) => panel.listProjectionBindings);
  const sharedProjectionLookups = uniqueListProjectionLookups([...readFieldProjectionBindings, ...panelProjectionBindings]);
  const readColumns = [
    ...view.fields,
    ...panelTableBindings.flatMap((panel) => panel.listView?.columns ?? []),
  ];
  const hasPanelFilters = panelTableBindings.some((panel) => panel.listView && panel.listView.filters.length > 0);
  const hasPanelPagination = panelTableBindings.some((panel) => Boolean(panel.listView?.pagination));
  const hasPanelDelete = panelTableBindings.some((panel) => Boolean(panel.deleteAction));
  const hasPanelActions = panelTableBindings.some((panel) => panel.tableActions.length > 0 || Boolean(panel.deleteAction));
  const workflowStepsConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowSteps') : null;
  const workflowTransitionsConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowTransitions') : null;
  const workflowStatesConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStates') : null;
  const workflowStatesByNameConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowStatesByName') : null;
  const workflowTransitionTargetsConstName = hasWorkflow ? staticComponentConstName(componentName, 'WorkflowTransitionTargets') : null;
  const titleElementConstName = componentTitleElementConstName(componentName);
  const usesMessageResolver = messageLikeNeedsRuntimeResolver(view.title);

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${view.id}`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  if (usesMessageResolver) {
    lines.push(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
  }
  if (panelTableBindings.length > 0) {
    lines.push(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    if (hasPanelActions) {
      lines.push(`import type { DataTableAction } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    }
    lines.push(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    if (hasPanelDelete) {
      lines.push(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    }
    if (hasPanelFilters) {
      lines.push(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
    }
    if (hasPanelPagination) {
      lines.push(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    }
  }
  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  lines.push(`import { getCurrentAppHref, getLocationSearchParams, getLocationSearchValues, getSanitizedReturnTo, replaceLocationSearchValues, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (hasPanelDelete || hasWorkflow) {
    lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  }
  if (hasWorkflow) {
    lines.push(`import { useResourceClient } from '@loj-lang/rdsl-runtime/hooks/resourceClient';`);
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  }
  if (hasWorkflow || hasWorkflowWizardAllows || hasWorkflowTransitionAllows) {
    lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  for (const comp of collectDisplayComponents(readColumns)) {
    lines.push(`import { ${comp} } from '@loj-lang/rdsl-runtime/components/${comp}';`);
  }

  for (const imp of uniqueImports(collectCustomImports(readColumns))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }

  lines.push(`import type { ${modelName} } from '../models/${modelName}';`);
  for (const targetModel of uniqueByName([
    ...sharedProjectionLookups.map((lookup) => lookup.targetModel),
    ...relatedPanelBindings.map((binding) => binding.targetModel),
  ])) {
    if (targetModel.name === modelName) {
      continue;
    }
    lines.push(`import type { ${targetModel.name} } from '../models/${targetModel.name}';`);
  }
  lines.push(``);
  for (const panel of panelTableBindings) {
    appendDataTableColumnsBlock(
      lines,
      panel.tableColumnsName!,
      panel.listView!.columns,
      panel.targetModel.name,
      `${panel.panelId}.columns`,
      panel.targetResource.workflow,
    );
    if (panel.listView!.filters.length > 0) {
      appendFilterFieldsBlock(
        lines,
        panel.filterFieldsName!,
        panel.listView!.filters,
        panel.targetModel,
        ir.models,
        ir.resources,
        `${panel.panelId}.filters`,
      );
    }
  }
  lines.push(`function formatReadValue(value: unknown, format?: 'date'): React.ReactNode {`);
  lines.push(`  if (value === null || value === undefined || value === '') return '—';`);
  lines.push(`  if (format !== 'date') return String(value);`);
  lines.push(`  const date = new Date(String(value));`);
  lines.push(`  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`interface ${componentName}Props {`);
  lines.push(`  id: string;`);
  lines.push(`}`);
  lines.push(``);
  if (workflowStepsConstName) {
    appendStaticConst(lines, workflowStepsConstName, `${workflowStepsRuntimeLiteral(resource)} as ${workflowStepArrayTypeSource()}`);
  }
  if (workflowTransitionsConstName) {
    appendStaticConst(lines, workflowTransitionsConstName, `${workflowTransitionsRuntimeLiteral(resource)} as ${workflowTransitionArrayTypeSource()}`);
  }
  if (workflowStatesConstName) {
    appendStaticConst(lines, workflowStatesConstName, `${workflowStateMetaRuntimeLiteral(resource)} as ${workflowStateArrayTypeSource()}`);
  }
  if (workflowStatesByNameConstName) {
    appendStaticConst(lines, workflowStatesByNameConstName, `${workflowStateMetaByNameRuntimeLiteral(resource)} as ${workflowStateMapTypeSource()}`);
  }
  if (workflowTransitionTargetsConstName) {
    appendStaticConst(lines, workflowTransitionTargetsConstName, `${workflowTransitionTargetsRuntimeLiteral(resource)} as import('@loj-lang/shared-contracts').WorkflowTransitionTargetMap`);
  }
  appendStaticConst(lines, titleElementConstName, `<h1>{${messageLikeToRuntimeTextSource(view.title || capitalize(resource.name))}}</h1>`);
  if (hasWorkflow) {
    lines.push(``);
  }
  const readFieldsSectionName = appendReadFieldsSectionComponent(lines, {
    componentName,
    resource,
    modelName,
    fields: view.fields,
    projectionBindings: readFieldProjectionBindings,
  });
  const relatedPanelsSectionName = appendRelatedPanelsSectionComponent(lines, {
    componentName,
    resource,
    relatedPanelBindings,
  });
  if (readFieldsSectionName || relatedPanelsSectionName) {
    lines.push(``);
  }
  lines.push(`export const ${componentName} = React.memo(function ${componentName}({ id }: ${componentName}Props) {`);
  lines.push(`  const resourceView = useResource<${modelName}>('${resource.api}');`);
  lines.push(`  const { getById, loading, error } = resourceView;`);
  lines.push(`  const record = resourceView.getById(id);`);
  appendReturnToNavigationLines(lines, {
    fallbackExpr: resource.views.list ? appLocalHrefExpression(JSON.stringify(`/${resource.name}`)) : 'null',
    hrefName: 'backHref',
  });
  if (hasWorkflow) {
    lines.push(`  const resourceClient = useResourceClient();`);
    lines.push(`  const toast = useToast();`);
    lines.push(`  const { currentUser } = useAuth();`);
    lines.push(`  const workflowSteps = ${workflowStepsConstName};`);
    lines.push(`  const workflowTransitions = ${workflowTransitionsConstName};`);
    lines.push(`  const workflowStatesByName = ${workflowStatesByNameConstName};`);
    lines.push(`  const workflowTransitionTargets = ${workflowTransitionTargetsConstName};`);
    lines.push(`  const currentWorkflowState = String(record?.${resource.workflow!.program.field} ?? ${JSON.stringify(workflowInitialState(resource))});`);
    lines.push(`  const currentWorkflowStateMeta = workflowStatesByName[currentWorkflowState] ?? null;`);
    lines.push(`  const visibleWorkflowSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record, formData: record }));`);
    lines.push(`  const activeWorkflowIndex = visibleWorkflowSteps.findIndex((step) => step.completesWith === currentWorkflowState);`);
    lines.push(`  const requestedWorkflowStepName = returnToSearchParams?.get('workflowStep');`);
    lines.push(`  const requestedWorkflowStepIndex = requestedWorkflowStepName ? visibleWorkflowSteps.findIndex((step) => step.name === requestedWorkflowStepName) : -1;`);
    lines.push(`  const currentWorkflowIndex = requestedWorkflowStepIndex >= activeWorkflowIndex ? requestedWorkflowStepIndex : activeWorkflowIndex;`);
    lines.push(`  const currentWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex] ?? null : null;`);
    lines.push(`  const previousWorkflowStep = currentWorkflowIndex > 0 ? visibleWorkflowSteps[currentWorkflowIndex - 1] ?? null : null;`);
    lines.push(`  const nextWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    lines.push(`  const previousWorkflowStepHref = previousWorkflowStep ? ${workflowStepSurfaceHandoffHrefExpression(resource, 'previousWorkflowStep', 'id', 'returnTo')} : null;`);
    lines.push(`  const availableWorkflowTransitions = workflowTransitions.filter((transition) => transition.from.includes(currentWorkflowState) && (!transition.allow || can(transition.allow, { currentUser, record })));`);
    lines.push(`  const prioritizedWorkflowStep = requestedWorkflowStepIndex > activeWorkflowIndex ? currentWorkflowStep : nextWorkflowStep;`);
    lines.push(`  const nextStepWorkflowTransitions = prioritizedWorkflowStep ? availableWorkflowTransitions.filter((transition) => transition.to === prioritizedWorkflowStep.completesWith) : [];`);
    lines.push(`  const otherWorkflowTransitions = nextStepWorkflowTransitions.length === 0 ? availableWorkflowTransitions : availableWorkflowTransitions.filter((transition) => !nextStepWorkflowTransitions.some((candidate) => candidate.name === transition.name));`);
    lines.push(`  const primaryWorkflowActionLabel = requestedWorkflowStepIndex > activeWorkflowIndex && prioritizedWorkflowStep ? \`Complete \${prioritizedWorkflowStep.name}\` : nextWorkflowStep ? \`Advance to \${nextWorkflowStep.name}\` : null;`);
    lines.push(`  const resolveNextWorkflowSurfaceHref = React.useCallback((stateName: string) => {`);
    lines.push(`    const postTransitionRecord = record ? { ...record, ${resource.workflow!.program.field}: stateName } : ({ ${resource.workflow!.program.field}: stateName } as Partial<${modelName}>);`);
    lines.push(`    const postTransitionVisibleSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record: postTransitionRecord, formData: postTransitionRecord }));`);
    lines.push(`    const postTransitionActiveIndex = postTransitionVisibleSteps.findIndex((step) => step.completesWith === stateName);`);
    lines.push(`    const postTransitionNextStep = postTransitionActiveIndex >= 0 ? postTransitionVisibleSteps[postTransitionActiveIndex + 1] ?? null : postTransitionVisibleSteps[0] ?? null;`);
    lines.push(`    if (!postTransitionNextStep) return null;`);
    lines.push(`    return ${workflowStepSurfaceHandoffHrefExpression(resource, 'postTransitionNextStep', 'id', 'returnTo')};`);
    lines.push(`  }, [currentUser, id, record, returnTo, workflowSteps]);`);
    lines.push(`  const handleWorkflowTransition = React.useCallback(async (transitionName: string) => {`);
    lines.push(`    try {`);
    lines.push(`      await resourceClient.post<unknown>(\`${resource.api}/\${encodeURIComponent(id)}/transitions/\${encodeURIComponent(transitionName)}\`);`);
    lines.push(`      toast.success('Workflow updated');`);
    lines.push(`      const transitionedState = workflowTransitionTargets[transitionName] ?? null;`);
    lines.push(`      const nextStepHref = transitionedState ? resolveNextWorkflowSurfaceHref(transitionedState) : null;`);
    lines.push(`      if (nextStepHref && typeof window !== 'undefined' && nextStepHref !== getCurrentAppHref()) {`);
    lines.push(`        window.location.href = nextStepHref;`);
    lines.push(`        return;`);
    lines.push(`      }`);
    lines.push(`      await resourceView.refresh();`);
    lines.push(`    } catch (err) {`);
    lines.push(`      toast.error(err instanceof Error ? err.message : 'Failed to update workflow');`);
    lines.push(`    }`);
    lines.push(`  }, [id, resourceClient, resourceView, resolveNextWorkflowSurfaceHref, toast, workflowTransitionTargets]);`);
  } else if (hasPanelDelete) {
    lines.push(`  const toast = useToast();`);
  }
  lines.push(``);
  lines.push(`  if (error) return <div className="rdsl-error">Failed to load record</div>;`);
  lines.push(`  if (!record && loading) return <div className="rdsl-loading">Loading...</div>;`);
  lines.push(`  if (!record) return <div className="rdsl-error">Record not found</div>;`);
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <div className="${classNameWithOptionalAuthoredStyle('rdsl-resource-read', view.style)}">`);
  lines.push(`      <header className="rdsl-read-header">`);
  lines.push(`        <div>`);
  lines.push(`          {${titleElementConstName}}`);
  if (hasWorkflow) {
    lines.push(`          <p>{currentWorkflowStateMeta?.label ?? currentWorkflowState}</p>`);
  }
  lines.push(`        </div>`);
  lines.push(`        <div className="rdsl-read-actions">`);
  if (hasWorkflow) {
    lines.push(`          {nextStepWorkflowTransitions.map((transition) => (`);
    lines.push(`            <button key={transition.name} type="button" className="rdsl-btn rdsl-btn-primary" onClick={() => handleWorkflowTransition(transition.name)}>`);
    lines.push(`              {primaryWorkflowActionLabel ?? transition.name}`);
    lines.push(`            </button>`);
    lines.push(`          ))}`);
    lines.push(`          {otherWorkflowTransitions.map((transition) => (`);
    lines.push(`            <button key={transition.name} type="button" className="rdsl-btn rdsl-btn-primary" onClick={() => handleWorkflowTransition(transition.name)}>`);
    lines.push(`              {transition.name}`);
    lines.push(`            </button>`);
    lines.push(`          ))}`);
    lines.push(`          {previousWorkflowStepHref && previousWorkflowStep ? <a href={previousWorkflowStepHref} className="rdsl-btn rdsl-btn-secondary">{\`Redo \${previousWorkflowStep.name}\`}</a> : null}`);
  }
  if (resource.views.edit) {
    lines.push(`          <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}/edit\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-primary">Edit</a>`);
  }
  if (hasWorkflow) {
    lines.push(`          <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}/workflow\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-secondary">Workflow</a>`);
  }
  lines.push(`          {backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
  lines.push(`        </div>`);
  lines.push(`      </header>`);
  if (hasWorkflow) {
    lines.push(`      <section className="rdsl-workflow-summary">`);
    lines.push(`        <div className="rdsl-read-actions">`);
    lines.push(`          <strong>Current state</strong>`);
    lines.push(`          <span className="rdsl-btn rdsl-btn-secondary">{currentWorkflowStateMeta?.label ?? currentWorkflowState}</span>`);
    lines.push(`        </div>`);
    lines.push(`        <div className="rdsl-read-actions">`);
    lines.push(`          <strong>Current step</strong>`);
    lines.push(`          <span>{currentWorkflowStep?.name ?? '—'}</span>`);
    lines.push(`        </div>`);
    lines.push(`        {nextWorkflowStep ? (`);
    lines.push(`          <div className="rdsl-read-actions">`);
    lines.push(`            <strong>Next step</strong>`);
    lines.push(`            <span>{nextWorkflowStep.name}</span>`);
    lines.push(`          </div>`);
    lines.push(`        ) : null}`);
    lines.push(`        {visibleWorkflowSteps.length > 0 ? (`);
    lines.push(`          <ol className="rdsl-related-list">`);
    lines.push(`            {visibleWorkflowSteps.map((step, index) => (`);
    lines.push(`              <li key={step.name}>`);
    lines.push(`                <strong>{step.name}</strong>`);
    lines.push(`                {' '}<span>{index < activeWorkflowIndex ? 'done' : index === activeWorkflowIndex ? 'current' : 'upcoming'}</span>`);
    lines.push(`              </li>`);
    lines.push(`            ))}`);
    lines.push(`          </ol>`);
    lines.push(`        ) : null}`);
    lines.push(`      </section>`);
  }
  if (readFieldsSectionName) {
    lines.push(``);
    lines.push(`      <${readFieldsSectionName} record={record} />`);
  }
  if (relatedPanelsSectionName) {
    lines.push(``);
    lines.push(`      <${relatedPanelsSectionName} id={id} />`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: view.id,
  };
}

function generateWorkflowView(ir: IRApp, resource: IRResource, model: IRModel): GeneratedFile {
  const componentName = workflowViewComponentName(resource.name);
  const filePath = `views/${componentName}.tsx`;
  const lines: string[] = [];
  const readView = resource.views.read;
  const readFieldProjectionBindings = readView
    ? collectListProjectionBindings(ir, readView.fields, model, `${resource.name}Workflow`)
    : [];
  const relatedPanelBindings = readView ? collectRelatedPanelBindings(ir, readView.related, model) : [];
  const panelTableBindings = relatedPanelBindings.filter((panel) => panel.listView && panel.listView.columns.length > 0);
  const panelProjectionBindings = panelTableBindings.flatMap((panel) => panel.listProjectionBindings);
  const sharedProjectionLookups = uniqueListProjectionLookups([...readFieldProjectionBindings, ...panelProjectionBindings]);
  const workflowReadColumns = readView?.fields ?? [];
  const workflowColumns = [
    ...workflowReadColumns,
    ...panelTableBindings.flatMap((panel) => panel.listView?.columns ?? []),
  ];
  const hasRelatedSummary = relatedPanelBindings.length > 0;
  const hasPanelFilters = panelTableBindings.some((panel) => panel.listView && panel.listView.filters.length > 0);
  const hasPanelPagination = panelTableBindings.some((panel) => Boolean(panel.listView?.pagination));
  const hasPanelDelete = panelTableBindings.some((panel) => Boolean(panel.deleteAction));
  const hasPanelActions = panelTableBindings.some((panel) => panel.tableActions.length > 0 || Boolean(panel.deleteAction));
  const workflowStepsConstName = staticComponentConstName(componentName, 'WorkflowSteps');
  const workflowTransitionsConstName = staticComponentConstName(componentName, 'WorkflowTransitions');
  const workflowStatesConstName = staticComponentConstName(componentName, 'WorkflowStates');
  const workflowStatesByNameConstName = staticComponentConstName(componentName, 'WorkflowStatesByName');
  const workflowTransitionTargetsConstName = staticComponentConstName(componentName, 'WorkflowTransitionTargets');
  const titleElementConstName = componentTitleElementConstName(componentName);
  const backFallbackExpr = resource.views.read
    ? appLocalHrefExpression(`\`/${resource.name}/\${id}\``)
    : resource.views.list
      ? appLocalHrefExpression(JSON.stringify(`/${resource.name}`))
      : 'null';

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${resource.id}`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  if (panelTableBindings.length > 0) {
    lines.push(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    if (hasPanelActions) {
      lines.push(`import type { DataTableAction } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    }
    lines.push(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    if (hasPanelDelete) {
      lines.push(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    }
    if (hasPanelFilters) {
      lines.push(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
    }
    if (hasPanelPagination) {
      lines.push(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    }
  }
  lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  lines.push(`import { useResourceClient } from '@loj-lang/rdsl-runtime/hooks/resourceClient';`);
  lines.push(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  lines.push(`import type { ${model.name} } from '../models/${model.name}';`);
  for (const comp of collectDisplayComponents(workflowColumns)) {
    lines.push(`import { ${comp} } from '@loj-lang/rdsl-runtime/components/${comp}';`);
  }
  for (const imp of uniqueImports(collectCustomImports(workflowColumns))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }
  for (const targetModel of uniqueByName([
    ...sharedProjectionLookups.map((lookup) => lookup.targetModel),
    ...relatedPanelBindings.map((binding) => binding.targetModel),
  ])) {
    if (targetModel.name === model.name) {
      continue;
    }
    lines.push(`import type { ${targetModel.name} } from '../models/${targetModel.name}';`);
  }
  lines.push(``);
  for (const panel of panelTableBindings) {
    appendDataTableColumnsBlock(
      lines,
      panel.tableColumnsName!,
      panel.listView!.columns,
      panel.targetModel.name,
      `${panel.panelId}.columns`,
      panel.targetResource.workflow,
    );
    if (panel.listView!.filters.length > 0) {
      appendFilterFieldsBlock(
        lines,
        panel.filterFieldsName!,
        panel.listView!.filters,
        panel.targetModel,
        ir.models,
        ir.resources,
        `${panel.panelId}.filters`,
      );
    }
  }
  if (readView && readView.fields.length > 0) {
    lines.push(``);
    lines.push(`function formatReadValue(value: unknown, format?: 'date'): React.ReactNode {`);
    lines.push(`  if (value === null || value === undefined || value === '') return '—';`);
    lines.push(`  if (format !== 'date') return String(value);`);
    lines.push(`  const date = new Date(String(value));`);
    lines.push(`  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();`);
    lines.push(`}`);
  }
  lines.push(``);
  lines.push(`interface ${componentName}Props {`);
  lines.push(`  id: string;`);
  lines.push(`}`);
  lines.push(``);
  appendStaticConst(lines, workflowStepsConstName, `${workflowStepsRuntimeLiteral(resource)} as ${workflowStepArrayTypeSource()}`);
  appendStaticConst(lines, workflowTransitionsConstName, `${workflowTransitionsRuntimeLiteral(resource)} as ${workflowTransitionArrayTypeSource()}`);
  appendStaticConst(lines, workflowStatesConstName, `${workflowStateMetaRuntimeLiteral(resource)} as ${workflowStateArrayTypeSource()}`);
  appendStaticConst(lines, workflowStatesByNameConstName, `${workflowStateMetaByNameRuntimeLiteral(resource)} as ${workflowStateMapTypeSource()}`);
  appendStaticConst(lines, workflowTransitionTargetsConstName, `${workflowTransitionTargetsRuntimeLiteral(resource)} as import('@loj-lang/shared-contracts').WorkflowTransitionTargetMap`);
  appendStaticConst(lines, titleElementConstName, `<h1>{${JSON.stringify(`${capitalize(resource.name)} workflow`)}}</h1>`);
  const readFieldsSectionName = appendReadFieldsSectionComponent(lines, {
    componentName,
    resource,
    modelName: model.name,
    fields: readView?.fields ?? [],
    projectionBindings: readFieldProjectionBindings,
  });
  const relatedPanelsSectionName = appendRelatedPanelsSectionComponent(lines, {
    componentName,
    resource,
    relatedPanelBindings,
    includeWorkflowRelatedSummary: hasRelatedSummary,
  });
  lines.push(``);
  lines.push(`export const ${componentName} = React.memo(function ${componentName}({ id }: ${componentName}Props) {`);
  lines.push(`  const resourceView = useResource<${model.name}>('${resource.api}');`);
  lines.push(`  const { currentUser } = useAuth();`);
  lines.push(`  const resourceClient = useResourceClient();`);
  lines.push(`  const toast = useToast();`);
  lines.push(`  const record = resourceView.getById(id);`);
  appendReturnToNavigationLines(lines, {
    fallbackExpr: backFallbackExpr,
    hrefName: 'backHref',
  });
  lines.push(`  const workflowSteps = ${workflowStepsConstName};`);
  lines.push(`  const workflowTransitions = ${workflowTransitionsConstName};`);
  lines.push(`  const workflowStatesByName = ${workflowStatesByNameConstName};`);
  lines.push(`  const workflowTransitionTargets = ${workflowTransitionTargetsConstName};`);
  lines.push(`  const currentWorkflowState = String(record?.${resource.workflow!.program.field} ?? ${JSON.stringify(workflowInitialState(resource))});`);
  lines.push(`  const currentWorkflowStateMeta = workflowStatesByName[currentWorkflowState] ?? null;`);
  lines.push(`  const visibleWorkflowSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record, formData: record }));`);
  lines.push(`  const activeWorkflowIndex = visibleWorkflowSteps.findIndex((step) => step.completesWith === currentWorkflowState);`);
  lines.push(`  const requestedWorkflowStepName = returnToSearchParams?.get('workflowStep');`);
  lines.push(`  const requestedWorkflowStepIndex = requestedWorkflowStepName ? visibleWorkflowSteps.findIndex((step) => step.name === requestedWorkflowStepName) : -1;`);
  lines.push(`  const currentWorkflowIndex = requestedWorkflowStepIndex >= activeWorkflowIndex ? requestedWorkflowStepIndex : activeWorkflowIndex;`);
  lines.push(`  const currentWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex] ?? null : null;`);
  lines.push(`  const previousWorkflowStep = currentWorkflowIndex > 0 ? visibleWorkflowSteps[currentWorkflowIndex - 1] ?? null : null;`);
  lines.push(`  const nextWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
  lines.push(`  const previousWorkflowStepHref = previousWorkflowStep ? ${workflowStepSurfaceHandoffHrefExpression(resource, 'previousWorkflowStep', 'id', 'returnTo')} : null;`);
  lines.push(`  const availableWorkflowTransitions = workflowTransitions.filter((transition) => transition.from.includes(currentWorkflowState) && (!transition.allow || can(transition.allow, { currentUser, record })));`);
  lines.push(`  const prioritizedWorkflowStep = requestedWorkflowStepIndex > activeWorkflowIndex ? currentWorkflowStep : nextWorkflowStep;`);
  lines.push(`  const nextStepWorkflowTransitions = prioritizedWorkflowStep ? availableWorkflowTransitions.filter((transition) => transition.to === prioritizedWorkflowStep.completesWith) : [];`);
  lines.push(`  const otherWorkflowTransitions = nextStepWorkflowTransitions.length === 0 ? availableWorkflowTransitions : availableWorkflowTransitions.filter((transition) => !nextStepWorkflowTransitions.some((candidate) => candidate.name === transition.name));`);
  lines.push(`  const primaryWorkflowActionLabel = requestedWorkflowStepIndex > activeWorkflowIndex && prioritizedWorkflowStep ? \`Complete \${prioritizedWorkflowStep.name}\` : nextWorkflowStep ? \`Advance to \${nextWorkflowStep.name}\` : null;`);
  lines.push(`  const resolveNextWorkflowSurfaceHref = React.useCallback((stateName: string) => {`);
  lines.push(`    const postTransitionRecord = record ? { ...record, ${resource.workflow!.program.field}: stateName } : ({ ${resource.workflow!.program.field}: stateName } as Partial<${model.name}>);`);
  lines.push(`    const postTransitionVisibleSteps = workflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record: postTransitionRecord, formData: postTransitionRecord }));`);
  lines.push(`    const postTransitionActiveIndex = postTransitionVisibleSteps.findIndex((step) => step.completesWith === stateName);`);
  lines.push(`    const postTransitionNextStep = postTransitionActiveIndex >= 0 ? postTransitionVisibleSteps[postTransitionActiveIndex + 1] ?? null : postTransitionVisibleSteps[0] ?? null;`);
  lines.push(`    if (!postTransitionNextStep) return null;`);
  lines.push(`    return ${workflowStepSurfaceHandoffHrefExpression(resource, 'postTransitionNextStep', 'id', 'returnTo')};`);
  lines.push(`  }, [currentUser, id, record, returnTo, workflowSteps]);`);
  lines.push(`  const handleWorkflowTransition = React.useCallback(async (transitionName: string) => {`);
  lines.push(`    try {`);
  lines.push(`      await resourceClient.post<unknown>(\`${resource.api}/\${encodeURIComponent(id)}/transitions/\${encodeURIComponent(transitionName)}\`);`);
  lines.push(`      toast.success('Workflow updated');`);
  lines.push(`      const transitionedState = workflowTransitionTargets[transitionName] ?? null;`);
  lines.push(`      const nextStepHref = transitionedState ? resolveNextWorkflowSurfaceHref(transitionedState) : null;`);
  lines.push(`      if (nextStepHref && typeof window !== 'undefined' && nextStepHref !== getCurrentAppHref()) {`);
  lines.push(`        window.location.href = nextStepHref;`);
  lines.push(`        return;`);
  lines.push(`      }`);
  lines.push(`      await resourceView.refresh();`);
  lines.push(`    } catch (err) {`);
  lines.push(`      toast.error(err instanceof Error ? err.message : 'Failed to update workflow');`);
  lines.push(`    }`);
  lines.push(`  }, [id, resourceClient, resolveNextWorkflowSurfaceHref, resourceView, toast, workflowTransitionTargets]);`);
  lines.push(``);
  lines.push(`  if (resourceView.error) return <div className="rdsl-error">Failed to load record</div>;`);
  lines.push(`  if (!record && resourceView.loading) return <div className="rdsl-loading">Loading...</div>;`);
  lines.push(`  if (!record) return <div className="rdsl-error">Record not found</div>;`);
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <div className="${classNameWithOptionalAuthoredStyle('rdsl-resource-read', resource.workflowStyle)}">`);
  lines.push(`      <header className="rdsl-read-header">`);
  lines.push(`        <div>`);
  lines.push(`          {${titleElementConstName}}`);
  lines.push(`          <p>{currentWorkflowStateMeta?.label ?? currentWorkflowState}</p>`);
  lines.push(`        </div>`);
  lines.push(`        <div className="rdsl-read-actions">`);
  lines.push(`          {nextStepWorkflowTransitions.map((transition) => (`);
  lines.push(`            <button key={transition.name} type="button" className="rdsl-btn rdsl-btn-primary" onClick={() => handleWorkflowTransition(transition.name)}>`);
  lines.push(`              {primaryWorkflowActionLabel ?? transition.name}`);
  lines.push(`            </button>`);
  lines.push(`          ))}`);
  lines.push(`          {otherWorkflowTransitions.map((transition) => (`);
  lines.push(`            <button key={transition.name} type="button" className="rdsl-btn rdsl-btn-primary" onClick={() => handleWorkflowTransition(transition.name)}>`);
  lines.push(`              {transition.name}`);
  lines.push(`            </button>`);
  lines.push(`          ))}`);
  lines.push(`          {previousWorkflowStepHref && previousWorkflowStep ? <a href={previousWorkflowStepHref} className="rdsl-btn rdsl-btn-secondary">{\`Redo \${previousWorkflowStep.name}\`}</a> : null}`);
  if (resource.views.read) {
    lines.push(`          <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-secondary">View</a>`);
  }
  if (resource.views.edit) {
    lines.push(`          <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}/edit\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-secondary">Edit</a>`);
  }
  lines.push(`          {backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
  lines.push(`        </div>`);
  lines.push(`      </header>`);
  lines.push(`      <section className="rdsl-workflow-summary">`);
  lines.push(`        <div className="rdsl-read-actions">`);
  lines.push(`          <strong>Current state</strong>`);
  lines.push(`          <span className="rdsl-btn rdsl-btn-secondary">{currentWorkflowStateMeta?.label ?? currentWorkflowState}</span>`);
  lines.push(`        </div>`);
  lines.push(`        <div className="rdsl-read-actions">`);
  lines.push(`          <strong>Current step</strong>`);
  lines.push(`          <span>{currentWorkflowStep?.name ?? '—'}</span>`);
  lines.push(`        </div>`);
  lines.push(`        {nextWorkflowStep ? (`);
  lines.push(`          <div className="rdsl-read-actions">`);
  lines.push(`            <strong>Next step</strong>`);
  lines.push(`            <span>{nextWorkflowStep.name}</span>`);
  lines.push(`          </div>`);
  lines.push(`        ) : null}`);
  lines.push(`        {visibleWorkflowSteps.length > 0 ? (`);
  lines.push(`          <ol className="rdsl-related-list">`);
  lines.push(`            {visibleWorkflowSteps.map((step, index) => (`);
  lines.push(`              <li key={step.name}>`);
  lines.push(`                <strong>{step.name}</strong>`);
  lines.push(`                {' '}<span>{index < activeWorkflowIndex ? 'done' : index === activeWorkflowIndex ? 'current' : 'upcoming'}</span>`);
  lines.push(`              </li>`);
  lines.push(`            ))}`);
  lines.push(`          </ol>`);
  lines.push(`        ) : null}`);
  lines.push(`      </section>`);
  if (readFieldsSectionName) {
    lines.push(``);
    lines.push(`      <${readFieldsSectionName} record={record} />`);
  }
  if (relatedPanelsSectionName) {
    lines.push(``);
    lines.push(`      <${relatedPanelsSectionName} id={id} />`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: resource.id,
  };
}

function generateRelatedCollectionView(
  ir: IRApp,
  resource: IRResource,
  model: IRModel,
  panel: RelatedPanelBinding,
): GeneratedFile {
  const componentName = relatedPanelComponentName(resource.name, panel.panelField);
  const filePath = `views/${componentName}.tsx`;
  const lines: string[] = [];
  const parentLabelField = pickRelationLabelField(model);
  const panelColumns = panel.listView?.columns ?? [];
  const sharedProjectionLookups = uniqueListProjectionLookups(panel.listProjectionBindings);
  const lookupsNeedingById = projectionLookupTargetsNeedingById(panel.listProjectionBindings);
  const hasFilters = Boolean(panel.listView && panel.listView.filters.length > 0);
  const hasPagination = Boolean(panel.listView?.pagination);
  const hasDelete = Boolean(panel.deleteAction);
  const hasPanelActions = panel.tableActions.length > 0 || hasDelete;
  const lookupOptionsConstName = componentResourceOptionsConstName(componentName);
  const titleElementConstName = componentTitleElementConstName(componentName);
  const panelTitleElementConstName = componentScopedTitleElementConstName(componentName, `${capitalize(camelCase(panel.panelField))}Panel`);
  const tableViewOptionsConstName = panel.listView && panelColumns.length > 0
    ? componentScopedTableViewOptionsConstName(componentName, `${capitalize(camelCase(panel.panelField))}Panel`)
    : null;
  const tableActionsConstName = hasPanelActions
    ? componentScopedTableActionsConstName(componentName, `${capitalize(camelCase(panel.panelField))}Panel`)
    : null;

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${panel.panelId}`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  lines.push(`import { getCurrentAppHref, getLocationSearchParams, getLocationSearchValues, getSanitizedReturnTo, replaceLocationSearchValues, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (panel.listView && panelColumns.length > 0) {
    lines.push(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    if (hasPanelActions) {
      lines.push(`import type { DataTableAction } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    }
    lines.push(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    if (hasDelete) {
      lines.push(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    }
    if (hasFilters) {
      lines.push(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
    }
    if (hasPagination) {
      lines.push(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    }
  }
  lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  if (hasDelete) {
    lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
  }
  for (const comp of collectDisplayComponents(panelColumns)) {
    lines.push(`import { ${comp} } from '@loj-lang/rdsl-runtime/components/${comp}';`);
  }
  for (const imp of uniqueImports(collectCustomImports(panelColumns))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }
  lines.push(`import type { ${model.name} } from '../models/${model.name}';`);
  if (panel.targetModel.name !== model.name) {
    lines.push(`import type { ${panel.targetModel.name} } from '../models/${panel.targetModel.name}';`);
  }
  for (const targetModel of uniqueByName(sharedProjectionLookups.map((lookup) => lookup.targetModel))) {
    if (targetModel.name === model.name || targetModel.name === panel.targetModel.name) {
      continue;
    }
    lines.push(`import type { ${targetModel.name} } from '../models/${targetModel.name}';`);
  }
  lines.push(``);
  if (panel.listView && panelColumns.length > 0) {
    appendDataTableColumnsBlock(
      lines,
      panel.tableColumnsName!,
      panelColumns,
      panel.targetModel.name,
      `${panel.panelId}.columns`,
      panel.targetResource.workflow,
    );
    if (panel.listView.filters.length > 0) {
      appendFilterFieldsBlock(
        lines,
        panel.filterFieldsName!,
        panel.listView.filters,
        panel.targetModel,
        ir.models,
        ir.resources,
        `${panel.panelId}.filters`,
      );
    }
  }
  appendStaticConst(lines, lookupOptionsConstName, `{ pageSize: 1000 } as const`);
  appendStaticConst(lines, titleElementConstName, `<h1>{${JSON.stringify(columnLabel(panel.panelField))}}</h1>`);
  appendStaticConst(lines, panelTitleElementConstName, `<h2>{${JSON.stringify(columnLabel(panel.panelField))}}</h2>`);
  if (tableViewOptionsConstName && panel.listView && panelColumns.length > 0) {
    const paginationOptions = panel.listView.pagination
      ? [`pageSize: ${panel.listView.pagination.size}`, `paginate: true`]
      : [`paginate: false`];
    appendStaticConst(lines, tableViewOptionsConstName, `{ ${paginationOptions.join(', ')} } as const`);
  }
  lines.push(`interface ${componentName}Props {`);
  lines.push(`  id: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const ${componentName} = React.memo(function ${componentName}({ id }: ${componentName}Props) {`);
  lines.push(`  const { getById, loading: parentLoading, error: parentError } = useResource<${model.name}>('${resource.api}');`);
  lines.push(`  const record = getById(id);`);
  appendReturnToNavigationLines(lines, {
    fallbackExpr: appLocalHrefExpression(`\`/${resource.name}/\${id}\``),
    hrefName: 'backHref',
  });
  lines.push(`  const ${panel.hookName} = useResource<${panel.targetModel.name}>('${panel.targetResource.api}', ${lookupOptionsConstName});`);
  for (const lookup of sharedProjectionLookups) {
    lines.push(`  const ${lookup.hookName} = useResource<${lookup.targetModel.name}>('${lookup.targetResource.api}', ${lookupOptionsConstName});`);
    if (lookupsNeedingById.has(lookup.targetResource.name)) {
      lines.push(`  const ${lookup.byIdMapName} = React.useMemo(() => new Map(${lookup.hookName}.allData.map((item) => [String(item.id), item] as const)), [${lookup.hookName}.allData]);`);
    }
  }
  for (const binding of panel.listProjectionBindings.filter((candidate) => candidate.kind === 'hasManyCount')) {
    lines.push(`  const ${binding.countMapName!} = React.useMemo(() => {`);
    lines.push(`    const counts = new Map<string, number>();`);
    lines.push(`    for (const item of ${binding.lookup.hookName}.allData) {`);
    lines.push(`      const ownerId = item.${binding.inverseFieldName!};`);
    lines.push(`      if (ownerId == null) continue;`);
    lines.push(`      const key = String(ownerId);`);
    lines.push(`      counts.set(key, (counts.get(key) ?? 0) + 1);`);
    lines.push(`    }`);
    lines.push(`    return counts;`);
    lines.push(`  }, [${binding.lookup.hookName}.allData]);`);
  }
  lines.push(`  const ${panel.itemsName} = React.useMemo(() => ${panel.hookName}.allData.filter((item) => String(item.${panel.inverseFieldName} ?? '') === String(id)), [${panel.hookName}.allData, id]);`);
  if (panel.listView && panelColumns.length > 0) {
    if (panel.listProjectionBindings.length === 0) {
      lines.push(`  const ${panel.tableViewName!} = useCollectionView<${panel.targetModel.name}>(${panel.itemsName}, ${tableViewOptionsConstName});`);
    } else {
      const projectionDeps = [
        panel.itemsName,
        ...panel.listProjectionBindings.flatMap((binding) => binding.kind === 'belongsToField'
          ? [binding.lookup.byIdMapName]
          : [`${binding.lookup.hookName}.loading`, binding.countMapName!]),
      ];
      lines.push(`  const ${panel.tableDataName!} = React.useMemo(() => ${panel.itemsName}.map((record) => ({`);
      lines.push(`    ...record,`);
      for (const binding of panel.listProjectionBindings) {
        lines.push(`    ['${binding.fieldName}']: ${projectionAssignmentSource(binding)},`);
      }
      lines.push(`  })) as ${panel.targetModel.name}[], [${Array.from(new Set(projectionDeps)).join(', ')}]);`);
      lines.push(`  const ${panel.tableViewName!} = useCollectionView<${panel.targetModel.name}>(${panel.tableDataName!}, ${tableViewOptionsConstName});`);
    }
    appendTableViewTransitionHandlers(lines, panel.tableViewName!, {
      filters: panel.listView.filters.length > 0,
      sort: true,
      pagination: Boolean(panel.listView.pagination),
    });
  }
  if (hasDelete) {
    const actionPrefix = `${camelCase(panel.panelField)}Related`;
    const stateName = `${actionPrefix}DeleteConfirmState`;
    const stateSetterName = `set${capitalize(stateName)}`;
    const requestName = `${actionPrefix}DeleteRequest`;
    const confirmName = `${actionPrefix}DeleteConfirm`;
    const deleteName = `${actionPrefix}Delete`;
    lines.push(`  const toast = useToast();`);
    if (panel.deleteAction?.confirm) {
      lines.push(`  const [${stateName}, ${stateSetterName}] = React.useState<{ open: boolean; id?: string; message?: string }>({ open: false });`);
      lines.push(`  const ${requestName} = React.useCallback((id: string) => {`);
      lines.push(`    ${stateSetterName}({ open: true, id, message: ${JSON.stringify(panel.deleteAction.confirm)} });`);
      lines.push(`  }, []);`);
      lines.push(`  const ${confirmName} = React.useCallback(async () => {`);
      lines.push(`    if (${stateName}.id) {`);
      lines.push(`      await ${panel.hookName}.deleteItem(${stateName}.id);`);
      lines.push(`      toast.success('Deleted successfully');`);
      lines.push(`      ${panel.hookName}.refresh();`);
      lines.push(`    }`);
      lines.push(`    ${stateSetterName}({ open: false });`);
      lines.push(`  }, [${stateName}.id, ${panel.hookName}, toast]);`);
    } else {
      lines.push(`  const ${deleteName} = React.useCallback(async (id: string) => {`);
      lines.push(`    await ${panel.hookName}.deleteItem(id);`);
      lines.push(`    toast.success('Deleted successfully');`);
      lines.push(`    ${panel.hookName}.refresh();`);
      lines.push(`  }, [${panel.hookName}, toast]);`);
    }
  }
  if (tableActionsConstName) {
    const actionEntries = panel.tableActions.map((action) =>
      action === 'view'
        ? `{ label: 'View', href: (row) => ${resourceRecordHrefExpression(panel.targetResource.name, 'row', 'read', { returnToExpr: 'getCurrentAppHref()' })} }`
        : action === 'edit'
          ? `{ label: 'Edit', href: (row) => ${resourceRecordHrefExpression(panel.targetResource.name, 'row', 'edit', { returnToExpr: 'getCurrentAppHref()' })} }`
          : `{ label: 'Workflow', href: (row) => ${workflowViewHrefExpression(panel.targetResource.name, 'row', { returnToExpr: 'getCurrentAppHref()' })} }`);
    if (panel.deleteAction) {
      const handlerName = panel.deleteAction.confirm
        ? `${camelCase(panel.panelField)}RelatedDeleteRequest`
        : `${camelCase(panel.panelField)}RelatedDelete`;
      actionEntries.push(`{ label: 'Delete', onClick: (row) => ${handlerName}(row.id), variant: 'danger' }`);
    }
    const dependencies = panel.deleteAction
      ? [panel.deleteAction.confirm ? `${camelCase(panel.panelField)}RelatedDeleteRequest` : `${camelCase(panel.panelField)}RelatedDelete`]
      : [];
    lines.push(`  const ${tableActionsConstName} = React.useMemo<Array<DataTableAction<${panel.targetModel.name}>>>(() => [${actionEntries.join(', ')}], [${dependencies.join(', ')}]);`);
  }
  lines.push(``);
  lines.push(`  if (parentError) return <div className="rdsl-error">Failed to load record</div>;`);
  lines.push(`  if (!record && parentLoading) return <div className="rdsl-loading">Loading...</div>;`);
  lines.push(`  if (!record) return <div className="rdsl-error">Record not found</div>;`);
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <div className="rdsl-resource-read">`);
  lines.push(`      <header className="rdsl-read-header">`);
  lines.push(`        <div>`);
  lines.push(`          {${titleElementConstName}}`);
  lines.push(`          <p>Related to {String(record.${parentLabelField} ?? record.id)}</p>`);
  lines.push(`        </div>`);
  lines.push(`        <div className="rdsl-read-actions">`);
  if (panel.createAction) {
    lines.push(`          <a href={${createViewHrefExpression(panel.targetResource.name, {
      inverseFieldName: panel.inverseFieldName,
      parentIdExpr: 'id',
      returnToExpr: 'getCurrentAppHref()',
    })}} className="rdsl-btn rdsl-btn-primary">Create</a>`);
  }
  lines.push(`          <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a>`);
  lines.push(`        </div>`);
  lines.push(`      </header>`);
  lines.push(`      <section className="rdsl-related-panel">`);
  lines.push(`        <div className="rdsl-related-panel-header">`);
  lines.push(`          <div>`);
  lines.push(`            {${panelTitleElementConstName}}`);
  lines.push(`            <span>{${panel.itemsName}.length} record{${panel.itemsName}.length === 1 ? '' : 's'}</span>`);
  lines.push(`          </div>`);
  lines.push(`        </div>`);
  if (panel.listView && panelColumns.length > 0) {
    lines.push(`        {${panel.hookName}.error ? <div className="rdsl-error">Failed to load data</div> : (`);
    lines.push(`          <>`);
    if (panel.listView.filters.length > 0) {
      lines.push(`            <FilterBar fields={${panel.filterFieldsName!}} values={${panel.tableViewName!}.filters} onChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'filters')}} />`);
    }
    lines.push(`            <DataTable`);
    lines.push(`              columns={${panel.tableColumnsName!}}`);
    lines.push(`              data={${panel.tableViewName!}.data}`);
    lines.push(`              loading={${panel.hookName}.loading}`);
    lines.push(`              sort={${panel.tableViewName!}.sort}`);
    lines.push(`              onSortChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'sort')}}`);
    if (tableActionsConstName) {
      lines.push(`              actions={${tableActionsConstName}}`);
    }
    lines.push(`            />`);
    if (panel.listView.pagination) {
      lines.push(`            <Pagination`);
      lines.push(`              current={${panel.tableViewName!}.pagination.page}`);
      lines.push(`              total={${panel.tableViewName!}.pagination.totalPages}`);
      lines.push(`              onChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'pagination')}}`);
      lines.push(`            />`);
    }
    lines.push(`          </>`);
    lines.push(`        )}`);
  } else {
    lines.push(`        {${panel.hookName}.loading ? <div className="rdsl-loading">Loading...</div> : null}`);
    lines.push(`        {!${panel.hookName}.loading && ${panel.itemsName}.length === 0 ? <div className="rdsl-empty">No related records</div> : null}`);
    lines.push(`        {!${panel.hookName}.loading && ${panel.itemsName}.length > 0 ? (`);
    lines.push(`          <ul className="rdsl-related-list">`);
    lines.push(`            {${panel.itemsName}.map((item) => (`);
    lines.push(`              <li key={item.id}>`);
    const itemHrefExpr = fallbackRecordHrefExpression(panel.targetResource, 'item', {
      returnToExpr: 'getCurrentAppHref()',
    });
    const itemWorkflowStateExpr = fallbackRecordWorkflowStateExpression(panel.targetResource, 'item');
    if (itemHrefExpr) {
      lines.push(`                <a href={${itemHrefExpr}}>{String(item.${panel.labelField} ?? item.id)}</a>`);
    } else {
      lines.push(`                {String(item.${panel.labelField} ?? item.id)}`);
    }
    if (itemWorkflowStateExpr) {
      lines.push(`                {' '}<span className="rdsl-btn rdsl-btn-secondary">{${itemWorkflowStateExpr}}</span>`);
    }
    lines.push(`              </li>`);
    lines.push(`            ))}`);
    lines.push(`          </ul>`);
    lines.push(`        ) : null}`);
  }
  lines.push(`      </section>`);
  if (panel.deleteAction?.confirm) {
    const actionPrefix = `${camelCase(panel.panelField)}Related`;
    const stateName = `${actionPrefix}DeleteConfirmState`;
    const stateSetterName = `set${capitalize(stateName)}`;
    const confirmName = `${actionPrefix}DeleteConfirm`;
    lines.push(`      <ConfirmDialog`);
    lines.push(`        open={${stateName}.open}`);
    lines.push(`        message={${stateName}.message || ''}`);
    lines.push(`        onConfirm={${confirmName}}`);
    lines.push(`        onCancel={() => ${stateSetterName}({ open: false })}`);
    lines.push(`      />`);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: panel.panelId,
  };
}

// ─── Page / Dashboard ────────────────────────────────────────────

function generatePage(ir: IRApp, page: IRPage): GeneratedFile {
  const componentName = `${capitalize(page.name)}Page`;
  const filePath = `pages/${componentName}.tsx`;
  const lines: string[] = [];
  const tableBindings = collectPageTableBlockBindings(ir, page.blocks);
  const metricBindings = collectPageMetricBlockBindings(ir, page.blocks);
  sharePageReadModelQueryBindings(tableBindings, metricBindings);
  sharePageRecordRelationBindings(tableBindings, metricBindings);
  const readModelTableBindings = tableBindings.filter((binding) => binding.sourceKind === 'readModelList');
  const resourceTableBindings = tableBindings.filter((binding) => binding.sourceKind !== 'readModelList');
  const pageCreateActionBindings = collectPageCreateActionBindings(page, ir.resources, tableBindings, metricBindings);
  const tableBindingsWithList = tableBindings.filter((binding) => Boolean(binding.listView));
  const readModelMetricBindings = metricBindings.filter((binding): binding is ReadModelMetricBlockBinding => binding.sourceKind === 'readModelCount');
  const relationMetricBindings = metricBindings.filter((binding): binding is RecordRelationMetricBlockBinding => binding.sourceKind === 'recordRelationCount');
  const relationTableBindings = resourceTableBindings.filter((binding) => binding.sourceKind === 'recordRelationList');
  const needsReadModelRules = [...readModelTableBindings, ...readModelMetricBindings].some((binding) => Boolean(binding.readModel?.rules));
  const recordScopedCustomRelationBindings = collectRecordScopedCustomRelationContextBindings(relationTableBindings, relationMetricBindings);
  const relationPageParentResource = relationTableBindings[0]?.parentResource ?? relationMetricBindings[0]?.parentResource;
  const relationPageParentModel = relationTableBindings[0]?.parentModel ?? relationMetricBindings[0]?.parentModel;
  const needsParentWorkflowSummary = Boolean(relationTableBindings.length > 0 || relationMetricBindings.length > 0)
    && Boolean(relationPageParentResource?.workflow)
    && Boolean(relationPageParentModel);
  const needsAuth = needsReadModelRules || needsParentWorkflowSummary;
  const needsRelationPageParentResourceLookup = needsParentWorkflowSummary
    || (Boolean(relationTableBindings.length > 0 || relationMetricBindings.length > 0)
      && Boolean(page.blocks.some((block) => Boolean(block.customBlock)))
      && Boolean(relationPageParentResource)
      && Boolean(relationPageParentModel));
  const pageTableColumns = tableBindings.flatMap((binding) => binding.listView?.columns ?? []);
  const tableProjectionBindings = tableBindings.flatMap((binding) => binding.listProjectionBindings);
  const sharedProjectionLookups = uniqueListProjectionLookups(tableProjectionBindings);
  const lookupsNeedingById = projectionLookupTargetsNeedingById(tableProjectionBindings);
  const hasFilterBars = resourceTableBindings.some((binding) => binding.listView && 'filters' in binding.listView && Boolean(binding.listView.filters.length))
    || readModelTableBindings.some((binding) => Boolean(binding.queryFieldsName))
    || readModelMetricBindings.some((binding) => Boolean(binding.queryFieldsName));
  const hasTablePagination = tableBindings.some((binding) => Boolean(binding.listView?.pagination));
  const hasTableDelete = tableBindings.some((binding) => Boolean(binding.deleteAction));
  const hasGroupedReadModelTables = readModelTableBindings.some((binding) => Boolean(binding.readModel?.list?.groupBy.length));
  const hasPlainTableBlocks = tableBindingsWithList.some((binding) => binding.sourceKind !== 'readModelList' || !binding.readModel?.list?.groupBy.length);
  const hasGroupedOnlyReadModelTables = readModelTableBindings.some((binding) => Boolean(binding.readModel?.list?.groupBy.length) && !binding.readModel?.list?.pivotBy);
  const hasPivotReadModelTables = readModelTableBindings.some((binding) => Boolean(binding.readModel?.list?.pivotBy));
  const hasReadModelDateNavigation = readModelTableBindings.some((binding) => Boolean(binding.dateNavigation));
  const needsRouteId = relationTableBindings.length > 0 || relationMetricBindings.length > 0;
  const needsUseReadModel = readModelTableBindings.length > 0 || readModelMetricBindings.length > 0;
  const needsUseResource = resourceTableBindings.length > 0 || relationMetricBindings.length > 0 || needsRouteId;
  const relationPageBackFallbackExpr = relationPageParentResource
    ? relationPageParentResource.views.read
      ? appLocalHrefExpression(`\`/${relationPageParentResource.name}/\${id}\``)
      : relationPageParentResource.views.list
        ? appLocalHrefExpression(JSON.stringify(`/${relationPageParentResource.name}`))
        : 'null'
    : 'null';
  const pageTitleElementName = pageTitleElementConstName(componentName);
  const usesMessageResolver = messageLikeNeedsRuntimeResolver(page.title)
    || Boolean(ir.seo?.siteName && messageLikeNeedsRuntimeResolver(ir.seo.siteName))
    || Boolean(ir.seo?.defaultTitle && messageLikeNeedsRuntimeResolver(ir.seo.defaultTitle))
    || Boolean(ir.seo?.titleTemplate && messageLikeNeedsRuntimeResolver(ir.seo.titleTemplate))
    || Boolean(ir.seo?.defaultDescription && messageLikeNeedsRuntimeResolver(ir.seo.defaultDescription))
    || Boolean(page.seo?.description && messageLikeNeedsRuntimeResolver(page.seo.description))
    || page.blocks.some((block) => messageLikeNeedsRuntimeResolver(block.title))
    || page.blocks.some((block) => Boolean(block.dateNavigation?.prevLabel && messageLikeNeedsRuntimeResolver(block.dateNavigation.prevLabel)))
    || page.blocks.some((block) => Boolean(block.dateNavigation?.nextLabel && messageLikeNeedsRuntimeResolver(block.dateNavigation.nextLabel)))
    || pageCreateActionBindings.some((action) => messageLikeNeedsRuntimeResolver(action.label))
    || tableBindings.some((binding) => binding.readModelRowActions.some((action) => messageLikeNeedsRuntimeResolver(action.label)));
  const needsDocumentMetadata = Boolean(ir.seo || page.seo);
  const seoAssetImports = collectPageSeoAssetImports(ir, page);
  const blockTitleElementNames = new Map<string, string>();
  for (const block of page.blocks) {
    if (block.blockType === 'table' || block.blockType === 'metric') {
      blockTitleElementNames.set(block.id, pageBlockTitleElementConstName(componentName, block.id));
    }
  }
  const sharedPageResourceHookGroups = new Map<string, {
    typeName: string;
    api: string;
    primaryHookName: string;
    aliases: string[];
  }>();
  const pageResourceHookRequests = [
    ...resourceTableBindings
      .filter((binding): binding is PageTableBlockBinding & { model: IRModel; resource: IRResource } => Boolean(binding.model && binding.resource))
      .map((binding) => ({
        typeName: binding.model.name,
        api: binding.resource.api,
        hookName: binding.hookName,
      })),
    ...relationMetricBindings.map((binding) => ({
      typeName: binding.model.name,
      api: binding.resource.api,
      hookName: binding.hookName,
    })),
    ...sharedProjectionLookups.map((lookup) => ({
      typeName: lookup.targetModel.name,
      api: lookup.targetResource.api,
      hookName: lookup.hookName,
    })),
    ...(needsRouteId && needsRelationPageParentResourceLookup && relationPageParentResource && relationPageParentModel
      ? [{
        typeName: relationPageParentModel.name,
        api: relationPageParentResource.api,
        hookName: `${camelCase(page.name)}ParentResource`,
      }]
      : []),
  ];
  for (const request of pageResourceHookRequests) {
    const key = `${request.typeName}:${request.api}`;
    const existing = sharedPageResourceHookGroups.get(key);
    if (existing) {
      existing.aliases.push(request.hookName);
      continue;
    }
    sharedPageResourceHookGroups.set(key, {
      typeName: request.typeName,
      api: request.api,
      primaryHookName: request.hookName,
      aliases: [],
    });
  }
  const sharedReadModelHookGroups = new Map<string, {
    typeName: string;
    api: string;
    queryExprName: string;
    optionsName: string;
    primaryHookName: string;
    aliases: string[];
  }>();
  for (const binding of [...readModelTableBindings, ...readModelMetricBindings]) {
    if (!binding.readModel || !binding.queryCanLoadName || !binding.readModelOptionsName) {
      continue;
    }
    const queryExprName = binding.queryStateName
      ? readModelDeferredQueryStateName(binding.queryStateName)
      : binding.queryStateName ?? 'undefined';
    const key = `${binding.readModel.id}:${queryExprName}:${binding.readModelOptionsName}`;
    const existing = sharedReadModelHookGroups.get(key);
    if (existing) {
      existing.aliases.push(binding.hookName);
      continue;
    }
    sharedReadModelHookGroups.set(key, {
      typeName: readModelResultTypeName(binding.readModel),
      api: binding.readModel.api,
      queryExprName,
      optionsName: binding.readModelOptionsName,
      primaryHookName: binding.hookName,
      aliases: [],
    });
  }
  const sharedRelationItemGroups = new Map<string, {
    hookName: string;
    inverseFieldName: string;
    itemsName: string;
  }>();
  for (const binding of [
    ...relationTableBindings.filter((candidate): candidate is PageTableBlockBinding & { itemsName: string; inverseFieldName: string } => Boolean(candidate.itemsName && candidate.inverseFieldName)),
    ...relationMetricBindings.filter((candidate): candidate is RecordRelationMetricBlockBinding & { itemsName: string; inverseFieldName: string } => Boolean(candidate.itemsName && candidate.inverseFieldName)),
  ]) {
    if (sharedRelationItemGroups.has(binding.itemsName)) {
      continue;
    }
    sharedRelationItemGroups.set(binding.itemsName, {
      hookName: binding.hookName,
      inverseFieldName: binding.inverseFieldName,
      itemsName: binding.itemsName,
    });
  }

  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node ${page.id}`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  if (usesMessageResolver) {
    lines.push(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
  }
  if (needsDocumentMetadata) {
    lines.push(`import { useDocumentMetadata } from '@loj-lang/rdsl-runtime/hooks/useDocumentMetadata';`);
  }
  lines.push(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath${needsUseReadModel ? ', getLocationSearchValues, replaceLocationSearchValues' : ''}${hasReadModelDateNavigation ? ', shiftDateInputValue' : ''} } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (needsAuth) {
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  }
  if (needsReadModelRules || needsParentWorkflowSummary) {
    const policyImports = [
      ...(needsParentWorkflowSummary ? ['can'] : []),
      ...(needsReadModelRules ? ['evaluatePolicyExpr', 'firstPolicyFailure'] : []),
    ];
    lines.push(`import { ${policyImports.join(', ')} } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  if (needsUseResource) {
    lines.push(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
  }
  if (needsUseReadModel) {
    lines.push(`import { useReadModel } from '@loj-lang/rdsl-runtime/hooks/useReadModel';`);
  }
  if (hasFilterBars) {
    lines.push(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
  }
  if (tableBindingsWithList.length > 0) {
    if (hasPlainTableBlocks) {
      lines.push(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    }
    if (tableBindingsWithList.some((binding) => Boolean(binding.tableActionsName))) {
      lines.push(`import type { DataTableAction } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    }
    if (hasGroupedReadModelTables) {
      lines.push(`import { useGroupedCollectionView } from '@loj-lang/rdsl-runtime/hooks/useGroupedCollectionView';`);
    }
    if (hasGroupedOnlyReadModelTables) {
      lines.push(`import { GroupedDataTable } from '@loj-lang/rdsl-runtime/components/GroupedDataTable';`);
    }
    if (hasPivotReadModelTables) {
      lines.push(`import { PivotDataTable } from '@loj-lang/rdsl-runtime/components/PivotDataTable';`);
    }
    if (hasPlainTableBlocks) {
      lines.push(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    }
    if (hasTableDelete) {
      lines.push(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
      lines.push(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
    }
    if (hasTablePagination) {
      lines.push(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    }
  }
  for (const comp of collectDisplayComponents(pageTableColumns)) {
    lines.push(`import { ${comp} } from '@loj-lang/rdsl-runtime/components/${comp}';`);
  }

  // Import custom blocks (escape hatch tier 3)
  const customBlocks = uniqueImports(
    page.blocks
      .filter((block): block is IRDashboardBlock & { customBlock: string } => Boolean(block.customBlock))
      .map((block) => ({
        path: block.customBlock,
        componentName: getCustomComponentName(block.customBlock),
      })),
  );
  for (const block of customBlocks) {
    lines.push(`import ${block.componentName} from '${hostFileImportPath(filePath, block.path)}';`);
  }
  for (const assetImport of seoAssetImports) {
    lines.push(`import ${assetImport.importName} from '${hostFileImportPath(filePath, assetImport.path)}';`);
  }
  for (const imp of uniqueImports(collectCustomImports(pageTableColumns))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }
  for (const model of uniqueByName([
    ...resourceTableBindings.map((binding) => binding.model).filter((candidate): candidate is IRModel => Boolean(candidate)),
    ...relationMetricBindings.map((binding) => binding.model).filter((candidate): candidate is IRModel => Boolean(candidate)),
    ...sharedProjectionLookups.map((lookup) => lookup.targetModel),
    ...(relationPageParentModel ? [relationPageParentModel] : []),
  ])) {
    lines.push(`import type { ${model.name} } from '../models/${model.name}';`);
  }
  for (const readModel of uniqueByName(
    [...readModelTableBindings, ...readModelMetricBindings]
      .map((binding) => binding.readModel)
      .filter((candidate): candidate is IRReadModel => Boolean(candidate)),
  )) {
    lines.push(`import type { ${readModelResultTypeName(readModel)} } from '../read-models/${capitalize(readModel.name)}';`);
  }
  if (needsParentWorkflowSummary || (needsRouteId && customBlocks.length > 0 && relationPageParentModel)) {
    const sharedContractsImports = uniqueByName([
      ...(needsParentWorkflowSummary ? [{ name: 'WorkflowStateSummaryDescriptor' }] : []),
      ...(needsRouteId && customBlocks.length > 0 && relationPageParentModel ? [{ name: 'RelationContextItemDescriptor' }] : []),
      ...(needsRouteId && customBlocks.length > 0 && relationPageParentModel ? [{ name: 'RecordScopedCustomBlockContextDescriptor' }] : []),
    ]);
    lines.push(`import type { ${sharedContractsImports.map((item) => item.name).join(', ')} } from '@loj-lang/shared-contracts';`);
  }

  lines.push(``);
  if (needsRouteId && needsParentWorkflowSummary) {
    lines.push(`type RecordScopedParentWorkflowSummary = WorkflowStateSummaryDescriptor;`);
    lines.push(``);
  }
  if (needsRouteId && customBlocks.length > 0 && relationPageParentModel) {
    lines.push(`type RecordScopedRelationContextItem = RelationContextItemDescriptor;`);
    lines.push(``);
    lines.push(`type RecordScopedCustomBlockProps<TParentRecord = unknown> = RecordScopedCustomBlockContextDescriptor<TParentRecord>;`);
    lines.push(``);
    for (const block of customBlocks) {
      lines.push(`const ${recordScopedCustomBlockComponentName(block.componentName)} = ${block.componentName} as React.ComponentType<RecordScopedCustomBlockProps<${relationPageParentModel.name}>>;`);
    }
    lines.push(``);
  }
  const emittedReadModelQueryFields = new Set<string>();
  for (const binding of tableBindingsWithList) {
    if (binding.sourceKind === 'readModelList') {
      appendDataTableColumnsBlock(
        lines,
        binding.tableColumnsName!,
        binding.listView!.columns,
        readModelResultTypeName(binding.readModel!),
        `${binding.blockId}.columns`,
      );
      if (binding.queryFieldsName && !emittedReadModelQueryFields.has(binding.queryFieldsName)) {
        appendReadModelQueryFieldsBlock(
          lines,
          binding.queryFieldsName,
          binding.readModel!,
          `${binding.blockId}.filters`,
        );
        emittedReadModelQueryFields.add(binding.queryFieldsName);
      }
      continue;
    }
    appendDataTableColumnsBlock(
      lines,
      binding.tableColumnsName!,
      binding.listView!.columns,
      binding.model!.name,
      `${binding.blockId}.columns`,
      binding.resource?.workflow,
    );
    if ('filters' in binding.listView! && binding.listView!.filters.length > 0) {
      appendFilterFieldsBlock(
        lines,
        binding.filterFieldsName!,
        binding.listView!.filters,
        binding.model!,
        ir.models,
        ir.resources,
        `${binding.blockId}.filters`,
      );
    }
  }
  for (const binding of readModelMetricBindings) {
    if (!binding.queryFieldsName || emittedReadModelQueryFields.has(binding.queryFieldsName)) {
      continue;
    }
    appendReadModelQueryFieldsBlock(
      lines,
      binding.queryFieldsName,
      binding.readModel,
      `${binding.blockId}.filters`,
    );
    emittedReadModelQueryFields.add(binding.queryFieldsName);
  }
  const emittedReadModelPageQueryStaticStates = new Set<string>();
  for (const binding of [...readModelTableBindings, ...readModelMetricBindings]) {
    if (!binding.readModel || !binding.queryStateName || emittedReadModelPageQueryStaticStates.has(binding.queryStateName)) {
      continue;
    }
    const queryParamPrefix = binding.queryParamPrefix || readModelQueryParamPrefix(binding.readModel);
    appendStaticConst(
      lines,
      readModelQueryDefaultsConstName(binding.queryStateName),
      `${readModelInitialQueryStateSource(binding.readModel)} as Record<string, string>`,
    );
    appendStaticConst(
      lines,
      readModelQueryLocationOptionsConstName(binding.queryStateName),
      `{ prefix: ${JSON.stringify(queryParamPrefix)} } as const`,
    );
    appendStaticConst(
      lines,
      readModelQueryLocationSyncOptionsConstName(binding.queryStateName),
      `{ prefix: ${JSON.stringify(queryParamPrefix)}, keys: ${JSON.stringify(binding.readModel.inputs.map((field) => field.name))} } as const`,
    );
    if (binding.queryEligibilityRulesName) {
      appendStaticConst(
        lines,
        binding.queryEligibilityRulesName,
        `${readModelRulesManifestEntriesLiteral(binding.readModel, 'eligibility')} as Array<Record<string, unknown>>`,
      );
    }
    if (binding.queryValidationRulesName) {
      appendStaticConst(
        lines,
        binding.queryValidationRulesName,
        `${readModelRulesManifestEntriesLiteral(binding.readModel, 'validation')} as Array<Record<string, unknown>>`,
      );
    }
    emittedReadModelPageQueryStaticStates.add(binding.queryStateName);
  }
  const emittedReadModelDerivationConsts = new Set<string>();
  for (const binding of readModelTableBindings) {
    if (!binding.queryDerivationsName || emittedReadModelDerivationConsts.has(binding.queryDerivationsName)) {
      continue;
    }
    appendStaticConst(
      lines,
      binding.queryDerivationsName,
      `${readModelRulesManifestEntriesLiteral(binding.readModel!, 'derivations')} as Array<Record<string, unknown>>`,
    );
    emittedReadModelDerivationConsts.add(binding.queryDerivationsName);
  }
  appendStaticConst(lines, pageTitleElementName, `<h1>{${messageLikeToRuntimeTextSource(page.title)}}</h1>`);
  for (const block of page.blocks) {
    const titleElementName = blockTitleElementNames.get(block.id);
    if (!titleElementName) {
      continue;
    }
    const tableBinding = tableBindings.find((binding) => binding.blockId === block.id);
    const metricBinding = metricBindings.find((binding) => binding.blockId === block.id);
    const titleSource = tableBinding?.blockTitle ?? metricBinding?.blockTitle ?? block.title ?? block.id;
    appendStaticConst(lines, titleElementName, `<h3>{${messageLikeToRuntimeTextSource(titleSource)}}</h3>`);
  }
  if (needsUseResource) {
    appendStaticConst(lines, pageResourceOptionsConstName(componentName), `{ pageSize: 1000 } as const`);
  }
  for (const binding of tableBindings.filter((candidate) => Boolean(candidate.listView && candidate.tableViewOptionsName))) {
    const paginationOptions = binding.listView?.pagination
      ? [`pageSize: ${binding.listView.pagination.size}`, `paginate: true`]
      : [`paginate: false`];
    appendStaticConst(lines, binding.tableViewOptionsName!, `{ ${paginationOptions.join(', ')} } as const`);
    if (binding.sourceKind === 'readModelList' && binding.readModel?.list?.groupBy.length) {
      appendStaticConst(lines, binding.groupByConstName!, `${JSON.stringify(binding.readModel.list.groupBy)} as const`);
    }
  }
  lines.push(``);
  if (needsRouteId) {
    lines.push(`interface ${componentName}Props {`);
    lines.push(`  id: string;`);
    lines.push(`}`);
    lines.push(``);
  }
  lines.push(`export const ${componentName} = React.memo(function ${componentName}(${needsRouteId ? `{ id }: ${componentName}Props` : ''}) {`);
  if (needsAuth) {
    lines.push(`  const { currentUser } = useAuth();`);
  }
  if (needsDocumentMetadata) {
    appendPageDocumentMetadataLines(lines, ir, page, seoAssetImports);
  }
  const emittedReadModelPageQueryStates = new Set<string>();
  for (const binding of [...readModelTableBindings, ...readModelMetricBindings]) {
    if (binding.queryStateName && !emittedReadModelPageQueryStates.has(binding.queryStateName)) {
      appendReadModelPageQueryContextLines(lines, binding);
      lines.push(`  const ${binding.readModelOptionsName!} = React.useMemo(() => ({ enabled: ${binding.queryCanLoadName!} }), [${binding.queryCanLoadName!}]);`);
      emittedReadModelPageQueryStates.add(binding.queryStateName);
    }
  }
  for (const group of sharedPageResourceHookGroups.values()) {
    lines.push(`  const ${group.primaryHookName} = useResource<${group.typeName}>('${group.api}', ${pageResourceOptionsConstName(componentName)});`);
    for (const alias of group.aliases) {
      lines.push(`  const ${alias} = ${group.primaryHookName};`);
    }
  }
  for (const group of sharedReadModelHookGroups.values()) {
    lines.push(`  const ${group.primaryHookName} = useReadModel<${group.typeName}>('${group.api}', ${group.queryExprName}, ${group.optionsName});`);
    for (const alias of group.aliases) {
      lines.push(`  const ${alias} = ${group.primaryHookName};`);
    }
  }
  for (const binding of readModelTableBindings) {
    const deferredQueryStateName = binding.queryStateName
      ? readModelDeferredQueryStateName(binding.queryStateName)
      : undefined;
    if (binding.queryDerivationsName) {
      lines.push(`  const ${binding.itemsName!} = React.useMemo(() => {`);
      lines.push(`    if (${binding.queryDerivationsName}.length === 0) {`);
        lines.push(`      return ${binding.hookName}.allData;`);
      lines.push(`    }`);
      lines.push(`    return ${binding.hookName}.allData.map((item) => {`);
      lines.push(`      const nextItem: ${readModelResultTypeName(binding.readModel!)} = { ...item };`);
      lines.push(`      for (const derivation of ${binding.queryDerivationsName}) {`);
      lines.push(`        if (typeof derivation.field !== 'string') continue;`);
      lines.push(`        if (derivation.when && !Boolean(evaluatePolicyExpr(derivation.when, { currentUser, input: ${deferredQueryStateName ?? binding.queryStateName!}, item: nextItem }))) continue;`);
      lines.push(`        switch (derivation.field) {`);
      for (const field of binding.readModel!.result.filter((candidate) => candidate.name !== 'id')) {
        lines.push(`          case '${field.name}': {`);
        lines.push(`            const value = evaluatePolicyExpr(derivation.value, { currentUser, input: ${deferredQueryStateName ?? binding.queryStateName!}, item: nextItem });`);
        lines.push(`            nextItem.${field.name} = ${readModelDerivationAssignmentExpression(field, 'value', `nextItem.${field.name}`)};`);
        lines.push(`            break;`);
        lines.push(`          }`);
      }
      lines.push(`          default:`);
      lines.push(`            break;`);
      lines.push(`        }`);
      lines.push(`      }`);
      lines.push(`      return nextItem;`);
      lines.push(`    });`);
      lines.push(`  }, [${binding.hookName}.allData, ${binding.queryDerivationsName}, currentUser, ${deferredQueryStateName ?? binding.queryStateName!}]);`);
    } else {
      lines.push(`  const ${binding.itemsName!} = ${binding.hookName}.allData;`);
    }
  }
  for (const binding of readModelMetricBindings) {
    lines.push(`  const ${binding.countName} = ${binding.hookName}.allData.length;`);
  }
  for (const binding of readModelTableBindings.filter((candidate) => candidate.dateNavigation)) {
    const dateNavigation = binding.dateNavigation!;
    lines.push(`  const ${dateNavigation.currentLabelName} = String(${binding.queryStateName!}.${dateNavigation.field} ?? '').trim() || 'No date';`);
    lines.push(`  const ${dateNavigation.shiftBackwardName} = React.useCallback(() => {`);
    lines.push(`    React.startTransition(() => {`);
    lines.push(`      ${binding.querySetterName!}((previous) => ({ ...previous, ${dateNavigation.field}: shiftDateInputValue(String(previous.${dateNavigation.field} ?? ''), -1) }));`);
    lines.push(`    });`);
    lines.push(`  }, [${binding.querySetterName!}]);`);
    lines.push(`  const ${dateNavigation.shiftForwardName} = React.useCallback(() => {`);
    lines.push(`    React.startTransition(() => {`);
    lines.push(`      ${binding.querySetterName!}((previous) => ({ ...previous, ${dateNavigation.field}: shiftDateInputValue(String(previous.${dateNavigation.field} ?? ''), 1) }));`);
    lines.push(`    });`);
    lines.push(`  }, [${binding.querySetterName!}]);`);
  }
  for (const binding of readModelTableBindings.filter((candidate) => Boolean(candidate.selectionStateKey))) {
    lines.push(`  const [${binding.selectionIdName!}, ${binding.setSelectionIdName!}] = React.useState<string | null>(null);`);
    lines.push(`  const ${binding.selectionRowsByIdName!} = React.useMemo(() => new Map(${binding.itemsName!}.map((item) => [String(item.id), item] as const)), [${binding.itemsName!}]);`);
    lines.push(`  const ${binding.selectedRowName!} = ${binding.selectionIdName!} == null ? null : ${binding.selectionRowsByIdName!}.get(String(${binding.selectionIdName!})) ?? null;`);
    lines.push(`  const ${binding.selectRowHandlerName!} = React.useCallback((row: ${readModelResultTypeName(binding.readModel!)}) => {`);
    lines.push(`    ${binding.setSelectionIdName!}(String(row.id));`);
    lines.push(`  }, []);`);
  }
  for (const action of pageCreateActionBindings) {
    lines.push(`  const ${action.hrefName} = ${action.enabledExpr} ? ${pageCreateActionHrefExpression(action, 'getCurrentAppHref()')} : null;`);
  }
  if (needsRouteId && needsRelationPageParentResourceLookup && relationPageParentResource && relationPageParentModel) {
    lines.push(`  const ${camelCase(page.name)}ParentRecord = React.useMemo(() => ${camelCase(page.name)}ParentResource.allData.find((item) => String(item.id) === String(id)) ?? null, [${camelCase(page.name)}ParentResource.allData, id]);`);
    if (relationPageParentResource.workflow) {
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowSteps = React.useMemo(() => ${workflowStepsRuntimeLiteral(relationPageParentResource)} as ${workflowStepArrayTypeSource()}, []);`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowTransitions = React.useMemo(() => ${workflowTransitionsRuntimeLiteral(relationPageParentResource)} as ${workflowTransitionArrayTypeSource()}, []);`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowStates = React.useMemo(() => ${workflowStateMetaRuntimeLiteral(relationPageParentResource)} as ${workflowStateArrayTypeSource()}, []);`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowCurrentState = String(${camelCase(page.name)}ParentRecord?.${relationPageParentResource.workflow.program.field} ?? ${JSON.stringify(workflowInitialState(relationPageParentResource))});`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowCurrentStateMeta = React.useMemo(() => ${camelCase(page.name)}ParentWorkflowStates.find((state) => state.name === ${camelCase(page.name)}ParentWorkflowCurrentState) ?? null, [${camelCase(page.name)}ParentWorkflowStates, ${camelCase(page.name)}ParentWorkflowCurrentState]);`);
      lines.push(`  const ${camelCase(page.name)}ParentVisibleWorkflowSteps = React.useMemo(() => ${camelCase(page.name)}ParentWorkflowSteps.filter((step) => !step.allow || can(step.allow, { currentUser, record: ${camelCase(page.name)}ParentRecord, formData: ${camelCase(page.name)}ParentRecord })), [${camelCase(page.name)}ParentWorkflowSteps, currentUser, ${camelCase(page.name)}ParentRecord]);`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflowActiveStepIndex = React.useMemo(() => ${camelCase(page.name)}ParentVisibleWorkflowSteps.findIndex((step) => step.completesWith === ${camelCase(page.name)}ParentWorkflowCurrentState), [${camelCase(page.name)}ParentVisibleWorkflowSteps, ${camelCase(page.name)}ParentWorkflowCurrentState]);`);
      lines.push(`  const ${camelCase(page.name)}ParentAvailableWorkflowTransitions = React.useMemo(() => ${camelCase(page.name)}ParentWorkflowTransitions.filter((transition) => transition.from.includes(${camelCase(page.name)}ParentWorkflowCurrentState) && (!transition.allow || can(transition.allow, { currentUser, record: ${camelCase(page.name)}ParentRecord }))), [${camelCase(page.name)}ParentWorkflowTransitions, ${camelCase(page.name)}ParentWorkflowCurrentState, currentUser, ${camelCase(page.name)}ParentRecord]);`);
      lines.push(`  const ${camelCase(page.name)}ParentWorkflow = React.useMemo<RecordScopedParentWorkflowSummary | null>(() => ${camelCase(page.name)}ParentRecord ? ({`);
      lines.push(`    field: '${relationPageParentResource.workflow.program.field}',`);
      lines.push(`    currentState: ${camelCase(page.name)}ParentWorkflowCurrentState,`);
      lines.push(`    currentStateLabel: ${camelCase(page.name)}ParentWorkflowCurrentStateMeta?.label ?? ${camelCase(page.name)}ParentWorkflowCurrentState,`);
      lines.push(`    workflowHref: ${pathWithReturnToExpression(`\`/${relationPageParentResource.name}/\${id}/workflow\``, 'getCurrentAppHref()')},`);
      lines.push(`    steps: ${camelCase(page.name)}ParentVisibleWorkflowSteps.map((step, index) => ({`);
      lines.push(`      name: step.name,`);
      lines.push(`      completesWith: step.completesWith,`);
      lines.push(`      status: index < ${camelCase(page.name)}ParentWorkflowActiveStepIndex ? 'done' : index === ${camelCase(page.name)}ParentWorkflowActiveStepIndex ? 'current' : 'upcoming',`);
      lines.push(`    })),`);
      lines.push(`    transitions: ${camelCase(page.name)}ParentAvailableWorkflowTransitions.map((transition) => ({`);
      lines.push(`      name: transition.name,`);
      lines.push(`      to: transition.to,`);
      lines.push(`      toLabel: ${camelCase(page.name)}ParentWorkflowStates.find((state) => state.name === transition.to)?.label ?? transition.to,`);
      lines.push(`    })),`);
      lines.push(`  }) : null, [id, ${camelCase(page.name)}ParentRecord, ${camelCase(page.name)}ParentWorkflowCurrentState, ${camelCase(page.name)}ParentWorkflowCurrentStateMeta, ${camelCase(page.name)}ParentVisibleWorkflowSteps, ${camelCase(page.name)}ParentWorkflowActiveStepIndex, ${camelCase(page.name)}ParentAvailableWorkflowTransitions, ${camelCase(page.name)}ParentWorkflowStates]);`);
    }
  }
  for (const group of sharedRelationItemGroups.values()) {
    lines.push(`  const ${group.itemsName} = React.useMemo(() => ${group.hookName}.allData.filter((item) => String(item.${group.inverseFieldName} ?? '') === String(id)), [${group.hookName}.allData, id]);`);
  }
  for (const binding of relationMetricBindings) {
    lines.push(`  const ${binding.countName} = ${binding.itemsName!}.length;`);
  }
  if (needsRouteId && customBlocks.length > 0 && relationPageParentResource && relationPageParentModel) {
    lines.push(`  const ${camelCase(page.name)}RelationContexts = React.useMemo<RecordScopedRelationContextItem[]>(() => [`);
    for (const binding of recordScopedCustomRelationBindings) {
      lines.push(`    { field: '${binding.relationFieldName}', title: ${JSON.stringify(binding.title)}, surfaceKind: '${binding.surfaceKind}', targetResource: '${binding.targetResource.name}', targetModel: '${binding.targetModel.name}', count: ${binding.countExpr}, items: ${binding.itemsExpr}, createHref: ${binding.createHrefExpr}, loading: ${binding.loadingExpr}, error: ${binding.errorExpr} },`);
    }
    lines.push(`  ], [${Array.from(new Set(recordScopedCustomRelationBindings.flatMap((binding) => binding.dependencyExprs))).join(', ')}]);`);
  }
  for (const lookup of sharedProjectionLookups) {
    if (lookupsNeedingById.has(lookup.targetResource.name)) {
      lines.push(`  const ${lookup.byIdMapName} = React.useMemo(() => new Map(${lookup.hookName}.allData.map((item) => [String(item.id), item] as const)), [${lookup.hookName}.allData]);`);
    }
  }
  for (const binding of tableProjectionBindings.filter((candidate) => candidate.kind === 'hasManyCount')) {
    lines.push(`  const ${binding.countMapName!} = React.useMemo(() => {`);
    lines.push(`    const counts = new Map<string, number>();`);
    lines.push(`    for (const item of ${binding.lookup.hookName}.allData) {`);
    lines.push(`      const ownerId = item.${binding.inverseFieldName!};`);
    lines.push(`      if (ownerId == null) continue;`);
    lines.push(`      const key = String(ownerId);`);
    lines.push(`      counts.set(key, (counts.get(key) ?? 0) + 1);`);
    lines.push(`    }`);
    lines.push(`    return counts;`);
    lines.push(`  }, [${binding.lookup.hookName}.allData]);`);
  }
  for (const binding of tableBindings) {
    const baseItems = binding.sourceKind === 'recordRelationList'
      ? binding.itemsName!
      : binding.sourceKind === 'readModelList'
        ? binding.itemsName!
        : `${binding.hookName}.allData`;
    if (!binding.listView) {
      continue;
    }
    if (binding.sourceKind === 'readModelList') {
      const readModelListView = binding.readModel!.list!;
      if (readModelListView.groupBy.length > 0) {
        lines.push(`  const ${binding.tableViewName!} = useGroupedCollectionView<${readModelResultTypeName(binding.readModel!)}>(${baseItems}, ${binding.groupByConstName!}, ${binding.tableViewOptionsName!});`);
      } else {
        lines.push(`  const ${binding.tableViewName!} = useCollectionView<${readModelResultTypeName(binding.readModel!)}>(${baseItems}, ${binding.tableViewOptionsName!});`);
      }
      continue;
    }
    if (binding.listProjectionBindings.length === 0) {
      lines.push(`  const ${binding.tableViewName!} = useCollectionView<${binding.model!.name}>(${baseItems}, ${binding.tableViewOptionsName!});`);
      continue;
    }
    const projectionDeps = [
      baseItems,
      ...binding.listProjectionBindings.flatMap((projection) => projection.kind === 'belongsToField'
        ? [projection.lookup.byIdMapName]
        : [`${projection.lookup.hookName}.loading`, projection.countMapName!]),
    ];
    lines.push(`  const ${binding.tableDataName!} = React.useMemo(() => ${baseItems}.map((record) => ({`);
    lines.push(`    ...record,`);
    for (const projection of binding.listProjectionBindings) {
      lines.push(`    ['${projection.fieldName}']: ${projectionAssignmentSource(projection)},`);
    }
    lines.push(`  })) as ${binding.model!.name}[], [${Array.from(new Set(projectionDeps)).join(', ')}]);`);
    lines.push(`  const ${binding.tableViewName!} = useCollectionView<${binding.model!.name}>(${binding.tableDataName!}, ${binding.tableViewOptionsName!});`);
  }
  for (const binding of tableBindings.filter((candidate) => Boolean(candidate.listView && candidate.tableViewName))) {
    appendTableViewTransitionHandlers(lines, binding.tableViewName!, {
      filters: binding.sourceKind !== 'readModelList' && Boolean('filters' in binding.listView! && binding.listView.filters.length > 0),
      sort: true,
      pagination: Boolean(binding.listView?.pagination),
    });
  }
  if (hasTableDelete) {
    lines.push(`  const toast = useToast();`);
  }
  for (const binding of tableBindings.filter((candidate) => candidate.deleteAction)) {
    const deleteAction = binding.deleteAction!;
    const stateName = `${camelCase(binding.blockId)}DeleteConfirmState`;
    const stateSetterName = `set${capitalize(stateName)}`;
    const requestName = `${camelCase(binding.blockId)}DeleteRequest`;
    const confirmName = `${camelCase(binding.blockId)}DeleteConfirm`;
    const deleteName = `${camelCase(binding.blockId)}Delete`;
    if (deleteAction.confirm) {
      lines.push(`  const [${stateName}, ${stateSetterName}] = React.useState<{ open: boolean; id?: string; message?: string }>({ open: false });`);
      lines.push(`  const ${requestName} = React.useCallback((id: string) => {`);
      lines.push(`    ${stateSetterName}({ open: true, id, message: ${JSON.stringify(deleteAction.confirm)} });`);
      lines.push(`  }, []);`);
      lines.push(`  const ${confirmName} = React.useCallback(async () => {`);
      lines.push(`    if (${stateName}.id) {`);
      lines.push(`      await ${binding.hookName}.deleteItem(${stateName}.id);`);
      lines.push(`      toast.success('Deleted successfully');`);
      lines.push(`      ${binding.hookName}.refresh();`);
      lines.push(`    }`);
      lines.push(`    ${stateSetterName}({ open: false });`);
      lines.push(`  }, [${stateName}.id, ${binding.hookName}, toast]);`);
    } else {
      lines.push(`  const ${deleteName} = React.useCallback(async (id: string) => {`);
      lines.push(`    await ${binding.hookName}.deleteItem(id);`);
      lines.push(`    toast.success('Deleted successfully');`);
      lines.push(`    ${binding.hookName}.refresh();`);
      lines.push(`  }, [${binding.hookName}, toast]);`);
    }
  }
  for (const binding of tableBindingsWithList.filter((candidate) => Boolean(candidate.tableActionsName))) {
    const rowTypeName = binding.sourceKind === 'readModelList'
      ? readModelResultTypeName(binding.readModel!)
      : binding.model!.name;
    const actionEntries = binding.sourceKind === 'readModelList'
      ? binding.readModelRowActions.map((action) =>
        `{ label: ${messageLikeToRuntimeTextSource(action.label)}, href: (row) => ${readModelRowActionHrefExpression(
          action,
          'row',
          binding.queryStateName!,
          'getCurrentAppHref()',
        )} }`)
      : binding.tableActions.map((action) =>
        action === 'view'
          ? `{ label: 'View', href: (row) => ${resourceRecordHrefExpression(binding.resource!.name, 'row', 'read', { returnToExpr: 'getCurrentAppHref()' })} }`
          : action === 'edit'
            ? `{ label: 'Edit', href: (row) => ${resourceRecordHrefExpression(binding.resource!.name, 'row', 'edit', { returnToExpr: 'getCurrentAppHref()' })} }`
            : `{ label: 'Workflow', href: (row) => ${workflowViewHrefExpression(binding.resource!.name, 'row', { returnToExpr: 'getCurrentAppHref()' })} }`);
    if (binding.deleteAction) {
      const handlerName = binding.deleteAction.confirm
        ? `${camelCase(binding.blockId)}DeleteRequest`
        : `${camelCase(binding.blockId)}Delete`;
      actionEntries.push(`{ label: 'Delete', onClick: (row) => ${handlerName}(row.id), variant: 'danger' }`);
    }
    const dependencies = [
      ...(binding.sourceKind === 'readModelList' && binding.readModelRowActions.some((action) => action.seed.some((entry) => entry.value.kind === 'inputField'))
        ? [binding.queryStateName!]
        : []),
      ...(binding.deleteAction
        ? [binding.deleteAction.confirm ? `${camelCase(binding.blockId)}DeleteRequest` : `${camelCase(binding.blockId)}Delete`]
        : []),
    ];
    lines.push(`  const ${binding.tableActionsName!} = React.useMemo<Array<DataTableAction<${rowTypeName}>>>(() => [${actionEntries.join(', ')}], [${dependencies.join(', ')}]);`);
  }
  lines.push(``);
  if (relationPageParentResource) {
    appendReturnToNavigationLines(lines, {
      fallbackExpr: relationPageBackFallbackExpr,
      hrefName: 'backHref',
    });
    lines.push(`  const parentReadHref = ${relationPageParentResource.views.read
      ? pathWithReturnToExpression(`\`/${relationPageParentResource.name}/\${id}\``, 'getCurrentAppHref()')
      : 'null'};`);
    lines.push(`  const parentEditHref = ${relationPageParentResource.views.edit
      ? pathWithReturnToExpression(`\`/${relationPageParentResource.name}/\${id}/edit\``, 'getCurrentAppHref()')
      : 'null'};`);
    lines.push(``);
  }
  if (needsRouteId) {
    lines.push(`  if (!id) return <div className="rdsl-error">Missing route param</div>;`);
    lines.push(``);
  }
  lines.push(`  return (`);
  lines.push(`    <div className="${classNameWithOptionalAuthoredStyle('rdsl-page', page.style)}">`);
  lines.push(`      <header className="rdsl-page-header">`);
  lines.push(`        <div>`);
  lines.push(`          {${pageTitleElementName}}`);
  if (needsParentWorkflowSummary) {
    lines.push(`          {${camelCase(page.name)}ParentWorkflow ? <p>{${camelCase(page.name)}ParentWorkflow.currentStateLabel}</p> : null}`);
  }
  lines.push(`        </div>`);
  if (relationPageParentResource || pageCreateActionBindings.length > 0) {
    lines.push(`        <div className="rdsl-table-actions">`);
    if (relationPageParentResource) {
      if (relationPageParentResource.views.read) {
        lines.push(`          {parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View ${relationPageParentResource.model}</a> : null}`);
      }
      if (relationPageParentResource.views.edit) {
        lines.push(`          {parentEditHref ? <a href={parentEditHref} className="rdsl-btn rdsl-btn-primary">Edit ${relationPageParentResource.model}</a> : null}`);
      }
      if (needsParentWorkflowSummary) {
        lines.push(`          {${camelCase(page.name)}ParentWorkflow?.workflowHref ? <a href={${camelCase(page.name)}ParentWorkflow.workflowHref} className="rdsl-btn rdsl-btn-secondary">Workflow</a> : null}`);
      }
    }
    for (const action of pageCreateActionBindings) {
      lines.push(`          {${action.hrefName} ? <a href={${action.hrefName}} className="rdsl-btn rdsl-btn-primary">{${messageLikeToRuntimeTextSource(action.label)}}</a> : <button type="button" className="rdsl-btn rdsl-btn-primary" disabled>{${messageLikeToRuntimeTextSource(action.label)}}</button>}`);
    }
    if (relationPageParentResource) {
      lines.push(`          {backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
    }
    lines.push(`        </div>`);
  }
  lines.push(`      </header>`);

  if (page.layout) {
    const gridMatch = page.layout.match(/^grid\((\d+)\)$/);
    const gridCols = gridMatch ? Number(gridMatch[1]) : 1;
    lines.push(`      <div className="rdsl-grid" style={{ gridTemplateColumns: 'repeat(${gridCols}, 1fr)' }}>`);
  } else {
    lines.push(`      <div className="rdsl-grid">`);
  }

  for (const block of page.blocks) {
    const tableBinding = tableBindings.find((binding) => binding.blockId === block.id);
    const metricBinding = metricBindings.find((binding) => binding.blockId === block.id);
    lines.push(`        {/* @source-node ${block.id} */}`);
    if (block.customBlock) {
      const name = getCustomComponentName(block.customBlock);
      if (needsRouteId && relationPageParentResource && relationPageParentModel) {
        lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block', block.style)}"><${recordScopedCustomBlockComponentName(name)} recordId={id} returnTo={returnTo} backHref={backHref} parentReadHref={parentReadHref} parentEditHref={parentEditHref} parentRecord={${camelCase(page.name)}ParentRecord} parentLoading={${camelCase(page.name)}ParentResource.loading} parentError={Boolean(${camelCase(page.name)}ParentResource.error)} parentWorkflow={${relationPageParentResource.workflow ? `${camelCase(page.name)}ParentWorkflow` : 'null'}} relations={${camelCase(page.name)}RelationContexts} /></div>`);
      } else {
        lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block', block.style)}"><${name} /></div>`);
      }
    } else if (block.blockType === 'table' && tableBinding) {
      lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block', block.style)}">`);
      lines.push(`          <div className="rdsl-related-panel-header">`);
      lines.push(`            {${blockTitleElementNames.get(block.id)!}}`);
      if (tableBinding.createAction && tableBinding.resource) {
        lines.push(`            <a href={${createViewHrefExpression(tableBinding.resource.name, tableBinding.sourceKind === 'recordRelationList'
          ? {
            inverseFieldName: tableBinding.inverseFieldName,
            parentIdExpr: 'id',
            returnToExpr: 'getCurrentAppHref()',
          }
          : {
            returnToExpr: 'getCurrentAppHref()',
          })}} className="rdsl-btn rdsl-btn-primary">Create</a>`);
      }
      lines.push(`          </div>`);
      if (tableBinding.listView) {
        lines.push(`          {${tableBinding.hookName}.error ? <div className="rdsl-error">Failed to load data</div> : (`);
        lines.push(`            <>`);
        if (tableBinding.sourceKind === 'readModelList') {
          if (tableBinding.showQueryControls) {
            lines.push(`              <FilterBar fields={${tableBinding.queryFieldsName!}} values={${tableBinding.queryStateName!}} onChange={${tableBinding.querySetterName!}} />`);
            lines.push(`              {!${tableBinding.queryEnabledName!} ? <div className="rdsl-empty">Fill the required search inputs to load results</div> : null}`);
            if (tableBinding.queryEligibilityFailureName) {
              lines.push(`              {${tableBinding.queryEnabledName!} && ${tableBinding.queryEligibilityFailureName} ? <div className="rdsl-error">{${tableBinding.queryEligibilityFailureName}}</div> : null}`);
            }
            if (tableBinding.queryValidationFailureName) {
              lines.push(`              {${tableBinding.queryEnabledName!}${tableBinding.queryEligibilityFailureName ? ` && !${tableBinding.queryEligibilityFailureName}` : ''} && ${tableBinding.queryValidationFailureName} ? <div className="rdsl-error">{${tableBinding.queryValidationFailureName}}</div> : null}`);
            }
          }
          if (tableBinding.dateNavigation) {
            lines.push(`              <div className="rdsl-table-pager rdsl-table-pager-top">`);
            lines.push(`                <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={${tableBinding.dateNavigation.shiftBackwardName}}>{${messageLikeToRuntimeTextSource(tableBinding.dateNavigation.prevLabel)}}</button>`);
            lines.push(`                <span className="rdsl-table-pager-current">{${tableBinding.dateNavigation.currentLabelName}}</span>`);
            lines.push(`                <button type="button" className="rdsl-btn rdsl-btn-secondary" onClick={${tableBinding.dateNavigation.shiftForwardName}}>{${messageLikeToRuntimeTextSource(tableBinding.dateNavigation.nextLabel)}}</button>`);
            lines.push(`              </div>`);
          }
        } else if ('filters' in tableBinding.listView && tableBinding.listView.filters.length > 0) {
          lines.push(`              <FilterBar fields={${tableBinding.filterFieldsName!}} values={${tableBinding.tableViewName!}.filters} onChange={${tableViewTransitionHandlerName(tableBinding.tableViewName!, 'filters')}} />`);
        }
        if (tableBinding.sourceKind === 'readModelList' && tableBinding.readModel!.list!.pivotBy) {
          lines.push(`              <PivotDataTable`);
          lines.push(`                columns={${tableBinding.tableColumnsName!}}`);
          lines.push(`                groupBy={${tableBinding.groupByConstName!}}`);
          lines.push(`                pivotBy=${JSON.stringify(tableBinding.readModel!.list!.pivotBy)}`);
          lines.push(`                groups={${tableBinding.tableViewName!}.groups}`);
          lines.push(`                loading={${tableBinding.queryCanLoadName!} && ${tableBinding.hookName}.loading}`);
          if (tableBinding.selectionStateKey) {
            lines.push(`                selectedRowId={${tableBinding.selectionIdName!}}`);
            lines.push(`                onSelectRow={${tableBinding.selectRowHandlerName!}}`);
            lines.push(`                selectionName=${JSON.stringify(tableBinding.selectionName)}`);
          }
          if (tableBinding.tableActionsName) {
            lines.push(`                actions={${tableBinding.tableActionsName}}`);
          }
          lines.push(`              />`);
        } else if (tableBinding.sourceKind === 'readModelList' && tableBinding.readModel!.list!.groupBy.length > 0) {
          lines.push(`              <GroupedDataTable`);
          lines.push(`                columns={${tableBinding.tableColumnsName!}}`);
          lines.push(`                groupBy={${tableBinding.groupByConstName!}}`);
          lines.push(`                groups={${tableBinding.tableViewName!}.groups}`);
          lines.push(`                loading={${tableBinding.queryCanLoadName!} && ${tableBinding.hookName}.loading}`);
          lines.push(`                sort={${tableBinding.tableViewName!}.sort}`);
          lines.push(`                onSortChange={${tableViewTransitionHandlerName(tableBinding.tableViewName!, 'sort')}}`);
          if (tableBinding.selectionStateKey) {
            lines.push(`                selectedRowId={${tableBinding.selectionIdName!}}`);
            lines.push(`                onSelectRow={${tableBinding.selectRowHandlerName!}}`);
            lines.push(`                selectionName=${JSON.stringify(tableBinding.selectionName)}`);
          }
          if (tableBinding.tableActionsName) {
            lines.push(`                actions={${tableBinding.tableActionsName}}`);
          }
          lines.push(`              />`);
        } else {
          lines.push(`              <DataTable`);
          lines.push(`                columns={${tableBinding.tableColumnsName!}}`);
          lines.push(`                data={${tableBinding.tableViewName!}.data}`);
          lines.push(`                loading={${tableBinding.sourceKind === 'readModelList' ? `${tableBinding.queryCanLoadName!} && ${tableBinding.hookName}.loading` : `${tableBinding.hookName}.loading`}}`);
          lines.push(`                sort={${tableBinding.tableViewName!}.sort}`);
          lines.push(`                onSortChange={${tableViewTransitionHandlerName(tableBinding.tableViewName!, 'sort')}}`);
          if (tableBinding.selectionStateKey) {
            lines.push(`                selectedRowId={${tableBinding.selectionIdName!}}`);
            lines.push(`                onSelectRow={${tableBinding.selectRowHandlerName!}}`);
            lines.push(`                selectionName=${JSON.stringify(tableBinding.selectionName)}`);
          }
          if (tableBinding.tableActionsName) {
            lines.push(`                actions={${tableBinding.tableActionsName}}`);
          }
          lines.push(`              />`);
        }
        if (tableBinding.listView.pagination) {
          lines.push(`              <Pagination`);
          lines.push(`                current={${tableBinding.tableViewName!}.pagination.page}`);
          lines.push(`                total={${tableBinding.tableViewName!}.pagination.totalPages}`);
          lines.push(`                onChange={${tableViewTransitionHandlerName(tableBinding.tableViewName!, 'pagination')}}`);
          lines.push(`              />`);
        }
        if (tableBinding.deleteAction?.confirm) {
          const stateName = `${camelCase(tableBinding.blockId)}DeleteConfirmState`;
          const stateSetterName = `set${capitalize(stateName)}`;
          const confirmName = `${camelCase(tableBinding.blockId)}DeleteConfirm`;
          lines.push(`              <ConfirmDialog`);
          lines.push(`                open={${stateName}.open}`);
          lines.push(`                message={${stateName}.message || ''}`);
          lines.push(`                onConfirm={${confirmName}}`);
          lines.push(`                onCancel={() => ${stateSetterName}({ open: false })}`);
          lines.push(`              />`);
        }
        lines.push(`            </>`);
        lines.push(`          )}`);
      } else {
        lines.push(`          {${tableBinding.hookName}.error ? <div className="rdsl-error">Failed to load data</div> : null}`);
        lines.push(`          {!${tableBinding.hookName}.error && ${tableBinding.hookName}.loading ? <div className="rdsl-loading">Loading...</div> : null}`);
        lines.push(`          {!${tableBinding.hookName}.error && !${tableBinding.hookName}.loading && ${tableBinding.itemsName!}.length === 0 ? <div className="rdsl-empty">No related records</div> : null}`);
        lines.push(`          {!${tableBinding.hookName}.error && !${tableBinding.hookName}.loading && ${tableBinding.itemsName!}.length > 0 ? (`);
        lines.push(`            <ul className="rdsl-related-list">`);
        lines.push(`              {${tableBinding.itemsName!}.map((item) => (`);
        lines.push(`                <li key={item.id}>`);
        const itemHrefExpr = tableBinding.resource
          ? fallbackRecordHrefExpression(tableBinding.resource, 'item', {
            returnToExpr: 'getCurrentAppHref()',
          })
          : null;
        const itemWorkflowStateExpr = tableBinding.resource
          ? fallbackRecordWorkflowStateExpression(tableBinding.resource, 'item')
          : null;
        if (itemHrefExpr) {
          lines.push(`                  <a href={${itemHrefExpr}}>{String(item.${tableBinding.labelField!} ?? item.id)}</a>`);
        } else {
          lines.push(`                  {String(item.${tableBinding.labelField!} ?? item.id)}`);
        }
        if (itemWorkflowStateExpr) {
          lines.push(`                  {' '}<span className="rdsl-btn rdsl-btn-secondary">{${itemWorkflowStateExpr}}</span>`);
        }
        lines.push(`                </li>`);
        lines.push(`              ))}`);
        lines.push(`            </ul>`);
        lines.push(`          ) : null}`);
      }
      lines.push(`        </div>`);
    } else if (block.blockType === 'metric' && metricBinding) {
      lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block rdsl-metric', block.style)}">`);
      lines.push(`          {${blockTitleElementNames.get(block.id)!}}`);
      if (metricBinding.sourceKind === 'readModelCount') {
        if (metricBinding.queryFieldsName && metricBinding.showQueryControls) {
          lines.push(`          <FilterBar fields={${metricBinding.queryFieldsName}} values={${metricBinding.queryStateName!}} onChange={${metricBinding.querySetterName!}} />`);
        }
        if (metricBinding.showQueryControls) {
          lines.push(`          {!${metricBinding.queryEnabledName!} ? <div className="rdsl-empty">Fill the required search inputs to load results</div> : null}`);
          if (metricBinding.queryEligibilityFailureName) {
            lines.push(`          {${metricBinding.queryEnabledName!} && ${metricBinding.queryEligibilityFailureName} ? <div className="rdsl-error">{${metricBinding.queryEligibilityFailureName}}</div> : null}`);
          }
          if (metricBinding.queryValidationFailureName) {
            lines.push(`          {${metricBinding.queryEnabledName!}${metricBinding.queryEligibilityFailureName ? ` && !${metricBinding.queryEligibilityFailureName}` : ''} && ${metricBinding.queryValidationFailureName} ? <div className="rdsl-error">{${metricBinding.queryValidationFailureName}}</div> : null}`);
          }
        }
        lines.push(`          {${metricBinding.queryCanLoadName!} && ${metricBinding.hookName}.error ? <div className="rdsl-error">Failed to load data</div> : <div className="rdsl-metric-value">{!${metricBinding.queryCanLoadName!} || ${metricBinding.hookName}.loading ? '—' : ${metricBinding.countName}}</div>}`);
      } else {
        lines.push(`          {${metricBinding.hookName}.error ? <div className="rdsl-error">Failed to load data</div> : <div className="rdsl-metric-value">{${metricBinding.hookName}.loading ? '—' : ${metricBinding.countName}}</div>}`);
      }
      lines.push(`        </div>`);
    } else if (block.blockType === 'metric') {
      lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block rdsl-metric', block.style)}">`);
      lines.push(`          {${blockTitleElementNames.get(block.id)!}}`);
      lines.push(`          <div className="rdsl-metric-value">—</div>`);
      lines.push(`        </div>`);
    } else if (block.blockType === 'chart') {
      lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block rdsl-chart', block.style)}">`);
      lines.push(`          {${blockTitleElementNames.get(block.id)!}}`);
      lines.push(`          <div className="rdsl-chart-placeholder">Chart: ${block.data || 'no data source'}</div>`);
      lines.push(`        </div>`);
    } else {
      lines.push(`        <div className="${classNameWithOptionalAuthoredStyle('rdsl-block', block.style)}">`);
      lines.push(`          {${blockTitleElementNames.get(block.id)!}}`);
      lines.push(`        </div>`);
    }
  }

  lines.push(`      </div>`);
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`});`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: page.id,
  };
}

function appendReadFieldsSectionComponent(
  lines: string[],
  options: {
    componentName: string;
    resource: IRResource;
    modelName: string;
    fields: readonly IRColumn[];
    projectionBindings: readonly ListColumnProjectionBinding[];
  },
): string | null {
  const { componentName, resource, modelName, fields, projectionBindings } = options;
  if (fields.length === 0) {
    return null;
  }

  const sectionComponentName = generatedSectionComponentName(componentName, 'ReadFieldsSection');
  const propsName = `${sectionComponentName}Props`;
  const sharedProjectionLookups = uniqueListProjectionLookups([...projectionBindings]);
  const lookupsNeedingById = projectionLookupTargetsNeedingById(projectionBindings);
  const hasManyCountBindings = projectionBindings.filter((binding) => binding.kind === 'hasManyCount');
  const lookupOptionsConstName = componentResourceOptionsConstName(sectionComponentName);

  lines.push(``);
  if (sharedProjectionLookups.length > 0) {
    appendStaticConst(lines, lookupOptionsConstName, `{ pageSize: 1000 } as const`);
    lines.push(``);
  }
  lines.push(`interface ${propsName} {`);
  lines.push(`  record: ${modelName};`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`const ${sectionComponentName} = React.memo(function ${sectionComponentName}({ record }: ${propsName}) {`);
  for (const lookup of sharedProjectionLookups) {
    lines.push(`  const ${lookup.hookName} = useResource<${lookup.targetModel.name}>('${lookup.targetResource.api}', ${lookupOptionsConstName});`);
    if (lookupsNeedingById.has(lookup.targetResource.name)) {
      lines.push(`  const ${lookup.byIdMapName} = React.useMemo(() => new Map(${lookup.hookName}.allData.map((item) => [String(item.id), item] as const)), [${lookup.hookName}.allData]);`);
    }
  }
  for (const binding of hasManyCountBindings) {
    lines.push(`  const ${binding.countMapName!} = React.useMemo(() => {`);
    lines.push(`    const counts = new Map<string, number>();`);
    lines.push(`    for (const item of ${binding.lookup.hookName}.allData) {`);
    lines.push(`      const ownerId = item.${binding.inverseFieldName!};`);
    lines.push(`      if (ownerId == null) continue;`);
    lines.push(`      const key = String(ownerId);`);
    lines.push(`      counts.set(key, (counts.get(key) ?? 0) + 1);`);
    lines.push(`    }`);
    lines.push(`    return counts;`);
    lines.push(`  }, [${binding.lookup.hookName}.allData]);`);
  }
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <dl className="rdsl-read-fields">`);
  for (const field of fields) {
    const projectionBinding = projectionBindings.find((binding) => binding.fieldName === field.field);
    const valueSource = projectionBinding ? projectionAssignmentSource(projectionBinding) : `record.${field.field}`;
    const renderFn = generateColumnRender(field, modelName);
    let renderedValue = resource.workflow && field.field === resource.workflow.program.field && !projectionBinding
      ? workflowStateValueExpression(valueSource, resource.workflow)
      : `formatReadValue(${valueSource}${field.decorators.some((decorator) => decorator.name === 'date') ? `, 'date'` : ''})`;
    if (renderFn) {
      renderedValue = `(${renderFn})(${valueSource}, record)`;
    }
    if (field.customRenderer) {
      renderedValue = `<${getCustomComponentName(field.customRenderer)} value={${valueSource}} record={record} />`;
    }
    lines.push(`      {/* @source-node ${field.id} */}`);
    lines.push(`      <div className="rdsl-read-field">`);
    lines.push(`        <dt>${columnLabel(field.field)}</dt>`);
    lines.push(`        <dd>{${renderedValue}}</dd>`);
    lines.push(`      </div>`);
  }
  lines.push(`    </dl>`);
  lines.push(`  );`);
  lines.push(`});`);

  return sectionComponentName;
}

function appendRelatedPanelsSectionComponent(
  lines: string[],
  options: {
    componentName: string;
    resource: IRResource;
    relatedPanelBindings: readonly RelatedPanelBinding[];
    includeWorkflowRelatedSummary?: boolean;
  },
): string | null {
  const { componentName, resource, relatedPanelBindings, includeWorkflowRelatedSummary = false } = options;
  if (relatedPanelBindings.length === 0) {
    return null;
  }

  const sectionComponentName = generatedSectionComponentName(componentName, 'RelatedPanelsSection');
  const propsName = `${sectionComponentName}Props`;
  const panelTableBindings = relatedPanelBindings.filter((panel) => panel.listView && panel.listView.columns.length > 0);
  const panelProjectionBindings = panelTableBindings.flatMap((panel) => panel.listProjectionBindings);
  const sharedProjectionLookups = uniqueListProjectionLookups(panelProjectionBindings);
  const lookupsNeedingById = projectionLookupTargetsNeedingById(panelProjectionBindings);
  const hasManyCountBindings = panelProjectionBindings.filter((binding) => binding.kind === 'hasManyCount');
  const hasPanelDelete = panelTableBindings.some((panel) => Boolean(panel.deleteAction));
  const lookupOptionsConstName = componentResourceOptionsConstName(sectionComponentName);
  const workflowRelatedTitleConstName = includeWorkflowRelatedSummary
    ? componentScopedTitleElementConstName(sectionComponentName, 'RelatedSummary')
    : null;
  const panelTitleConstNames = new Map(relatedPanelBindings.map((panel) => [
    panel.panelField,
    componentScopedTitleElementConstName(sectionComponentName, `${capitalize(camelCase(panel.panelField))}Panel`),
  ]));
  const tableViewOptionsConstNames = new Map(panelTableBindings.map((panel) => [
    panel.panelField,
    componentScopedTableViewOptionsConstName(sectionComponentName, `${capitalize(camelCase(panel.panelField))}Panel`),
  ]));
  const tableActionsConstNames = new Map(panelTableBindings
    .filter((panel) => panel.tableActions.length > 0 || Boolean(panel.deleteAction))
    .map((panel) => [
      panel.panelField,
      componentScopedTableActionsConstName(sectionComponentName, `${capitalize(camelCase(panel.panelField))}Panel`),
    ]));

  if (includeWorkflowRelatedSummary) {
    lines.push(``);
    lines.push(`interface WorkflowRelatedSurfaceSummary {`);
    lines.push(`  field: string;`);
    lines.push(`  title: string;`);
    lines.push(`  surfaceKind: 'table' | 'label-list';`);
    lines.push(`  count: number;`);
    lines.push(`  createHref: string | null;`);
    lines.push(`  viewAllHref: string;`);
    lines.push(`}`);
  }
  lines.push(``);
  appendStaticConst(lines, lookupOptionsConstName, `{ pageSize: 1000 } as const`);
  if (workflowRelatedTitleConstName) {
    appendStaticConst(lines, workflowRelatedTitleConstName, `<h2>{"Related"}</h2>`);
  }
  for (const panel of relatedPanelBindings) {
    appendStaticConst(lines, panelTitleConstNames.get(panel.panelField)!, `<h2>{${JSON.stringify(columnLabel(panel.panelField))}}</h2>`);
  }
  for (const panel of panelTableBindings) {
    const paginationOptions = panel.listView!.pagination
      ? [`pageSize: ${panel.listView!.pagination.size}`, `paginate: true`]
      : [`paginate: false`];
    appendStaticConst(lines, tableViewOptionsConstNames.get(panel.panelField)!, `{ ${paginationOptions.join(', ')} } as const`);
  }
  lines.push(``);
  lines.push(`interface ${propsName} {`);
  lines.push(`  id: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`const ${sectionComponentName} = React.memo(function ${sectionComponentName}({ id }: ${propsName}) {`);
  if (hasPanelDelete) {
    lines.push(`  const toast = useToast();`);
  }
  for (const lookup of sharedProjectionLookups) {
    lines.push(`  const ${lookup.hookName} = useResource<${lookup.targetModel.name}>('${lookup.targetResource.api}', ${lookupOptionsConstName});`);
    if (lookupsNeedingById.has(lookup.targetResource.name)) {
      lines.push(`  const ${lookup.byIdMapName} = React.useMemo(() => new Map(${lookup.hookName}.allData.map((item) => [String(item.id), item] as const)), [${lookup.hookName}.allData]);`);
    }
  }
  for (const binding of hasManyCountBindings) {
    lines.push(`  const ${binding.countMapName!} = React.useMemo(() => {`);
    lines.push(`    const counts = new Map<string, number>();`);
    lines.push(`    for (const item of ${binding.lookup.hookName}.allData) {`);
    lines.push(`      const ownerId = item.${binding.inverseFieldName!};`);
    lines.push(`      if (ownerId == null) continue;`);
    lines.push(`      const key = String(ownerId);`);
    lines.push(`      counts.set(key, (counts.get(key) ?? 0) + 1);`);
    lines.push(`    }`);
    lines.push(`    return counts;`);
    lines.push(`  }, [${binding.lookup.hookName}.allData]);`);
  }
  for (const panel of relatedPanelBindings) {
    lines.push(`  const ${panel.hookName} = useResource<${panel.targetModel.name}>('${panel.targetResource.api}', ${lookupOptionsConstName});`);
    lines.push(`  const ${panel.itemsName} = React.useMemo(() => ${panel.hookName}.allData.filter((item) => String(item.${panel.inverseFieldName} ?? '') === String(id)), [${panel.hookName}.allData, id]);`);
  }
  if (includeWorkflowRelatedSummary) {
    lines.push(`  const workflowRelatedSurfaceSummaries: WorkflowRelatedSurfaceSummary[] = [`);
    for (const panel of relatedPanelBindings) {
      lines.push(`    { field: '${panel.panelField}', title: ${JSON.stringify(columnLabel(panel.panelField))}, surfaceKind: '${panel.listView && panel.listView.columns.length > 0 ? 'table' : 'label-list'}', count: ${panel.itemsName}.length, createHref: ${panel.createAction
        ? createViewHrefExpression(panel.targetResource.name, {
          inverseFieldName: panel.inverseFieldName,
          parentIdExpr: 'id',
          returnToExpr: 'getCurrentAppHref()',
        })
        : 'null'}, viewAllHref: ${pathWithReturnToExpression(`\`/${resource.name}/\${id}/related/${panel.panelField}\``, 'getCurrentAppHref()')} },`);
    }
    lines.push(`  ];`);
  }
  for (const panel of panelTableBindings) {
    if (panel.listProjectionBindings.length === 0) {
      lines.push(`  const ${panel.tableViewName!} = useCollectionView<${panel.targetModel.name}>(${panel.itemsName}, ${tableViewOptionsConstNames.get(panel.panelField)!});`);
    } else {
      const projectionDeps = [
        panel.itemsName,
        ...panel.listProjectionBindings.flatMap((binding) => binding.kind === 'belongsToField'
          ? [binding.lookup.byIdMapName]
          : [`${binding.lookup.hookName}.loading`, binding.countMapName!]),
      ];
      lines.push(`  const ${panel.tableDataName!} = React.useMemo(() => ${panel.itemsName}.map((record) => ({`);
      lines.push(`    ...record,`);
      for (const binding of panel.listProjectionBindings) {
        lines.push(`    ['${binding.fieldName}']: ${projectionAssignmentSource(binding)},`);
      }
      lines.push(`  })) as ${panel.targetModel.name}[], [${Array.from(new Set(projectionDeps)).join(', ')}]);`);
      lines.push(`  const ${panel.tableViewName!} = useCollectionView<${panel.targetModel.name}>(${panel.tableDataName!}, ${tableViewOptionsConstNames.get(panel.panelField)!});`);
    }
    appendTableViewTransitionHandlers(lines, panel.tableViewName!, {
      filters: panel.listView!.filters.length > 0,
      sort: true,
      pagination: Boolean(panel.listView?.pagination),
    });
  }
  for (const panel of panelTableBindings.filter((candidate) => candidate.deleteAction)) {
    const deleteAction = panel.deleteAction!;
    const actionPrefix = `${camelCase(panel.panelField)}Related`;
    const stateName = `${actionPrefix}DeleteConfirmState`;
    const stateSetterName = `set${capitalize(stateName)}`;
    const requestName = `${actionPrefix}DeleteRequest`;
    const confirmName = `${actionPrefix}DeleteConfirm`;
    const deleteName = `${actionPrefix}Delete`;
    if (deleteAction.confirm) {
      lines.push(`  const [${stateName}, ${stateSetterName}] = React.useState<{ open: boolean; id?: string; message?: string }>({ open: false });`);
      lines.push(`  const ${requestName} = React.useCallback((id: string) => {`);
      lines.push(`    ${stateSetterName}({ open: true, id, message: ${JSON.stringify(deleteAction.confirm)} });`);
      lines.push(`  }, []);`);
      lines.push(`  const ${confirmName} = React.useCallback(async () => {`);
      lines.push(`    if (${stateName}.id) {`);
      lines.push(`      await ${panel.hookName}.deleteItem(${stateName}.id);`);
      lines.push(`      toast.success('Deleted successfully');`);
      lines.push(`      ${panel.hookName}.refresh();`);
      lines.push(`    }`);
      lines.push(`    ${stateSetterName}({ open: false });`);
      lines.push(`  }, [${stateName}.id, ${panel.hookName}, toast]);`);
    } else {
      lines.push(`  const ${deleteName} = React.useCallback(async (id: string) => {`);
      lines.push(`    await ${panel.hookName}.deleteItem(id);`);
      lines.push(`    toast.success('Deleted successfully');`);
      lines.push(`    ${panel.hookName}.refresh();`);
      lines.push(`  }, [${panel.hookName}, toast]);`);
    }
  }
  for (const panel of panelTableBindings.filter((candidate) => tableActionsConstNames.has(candidate.panelField))) {
    const actionEntries = panel.tableActions.map((action) =>
      action === 'view'
        ? `{ label: 'View', href: (row) => ${resourceRecordHrefExpression(panel.targetResource.name, 'row', 'read', { returnToExpr: 'getCurrentAppHref()' })} }`
        : action === 'edit'
          ? `{ label: 'Edit', href: (row) => ${resourceRecordHrefExpression(panel.targetResource.name, 'row', 'edit', { returnToExpr: 'getCurrentAppHref()' })} }`
          : `{ label: 'Workflow', href: (row) => ${workflowViewHrefExpression(panel.targetResource.name, 'row', { returnToExpr: 'getCurrentAppHref()' })} }`);
    if (panel.deleteAction) {
      const handlerName = panel.deleteAction.confirm
        ? `${camelCase(panel.panelField)}RelatedDeleteRequest`
        : `${camelCase(panel.panelField)}RelatedDelete`;
      actionEntries.push(`{ label: 'Delete', onClick: (row) => ${handlerName}(row.id), variant: 'danger' }`);
    }
    const dependencies = panel.deleteAction
      ? [panel.deleteAction.confirm ? `${camelCase(panel.panelField)}RelatedDeleteRequest` : `${camelCase(panel.panelField)}RelatedDelete`]
      : [];
    lines.push(`  const ${tableActionsConstNames.get(panel.panelField)!} = React.useMemo<Array<DataTableAction<${panel.targetModel.name}>>>(() => [${actionEntries.join(', ')}], [${dependencies.join(', ')}]);`);
  }
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <>`);
  if (includeWorkflowRelatedSummary) {
    lines.push(`      <section className="rdsl-related-panel">`);
    lines.push(`        <div className="rdsl-related-panel-header">`);
    lines.push(`          <div>`);
    lines.push(`            {${workflowRelatedTitleConstName}}`);
    lines.push(`            <span>{workflowRelatedSurfaceSummaries.length} surface{workflowRelatedSurfaceSummaries.length === 1 ? '' : 's'}</span>`);
    lines.push(`          </div>`);
    lines.push(`        </div>`);
    lines.push(`        <ul className="rdsl-related-list">`);
    lines.push(`          {workflowRelatedSurfaceSummaries.map((summary) => (`);
    lines.push(`            <li key={summary.field}>`);
    lines.push(`              <div className="rdsl-read-actions">`);
    lines.push(`                <strong>{summary.title}</strong>`);
    lines.push(`                <span>{summary.count} record{summary.count === 1 ? '' : 's'}</span>`);
    lines.push(`                {summary.createHref ? <a href={summary.createHref} className="rdsl-btn rdsl-btn-primary">Create</a> : null}`);
    lines.push(`                <a href={summary.viewAllHref} className="rdsl-btn rdsl-btn-secondary">View all</a>`);
    lines.push(`              </div>`);
    lines.push(`            </li>`);
    lines.push(`          ))}`);
    lines.push(`        </ul>`);
    lines.push(`      </section>`);
  }
  for (const panel of relatedPanelBindings) {
    lines.push(``);
    lines.push(`      {/* @source-node ${panel.panelId} */}`);
    lines.push(`      <section className="rdsl-related-panel">`);
    lines.push(`        <div className="rdsl-related-panel-header">`);
    lines.push(`          <div>`);
    lines.push(`            {${panelTitleConstNames.get(panel.panelField)}}`);
    lines.push(`            <span>{${panel.itemsName}.length} record{${panel.itemsName}.length === 1 ? '' : 's'}</span>`);
    lines.push(`          </div>`);
    lines.push(`          <div className="rdsl-read-actions">`);
    if (panel.createAction) {
      lines.push(`            <a href={${createViewHrefExpression(panel.targetResource.name, {
        inverseFieldName: panel.inverseFieldName,
        parentIdExpr: 'id',
        returnToExpr: 'getCurrentAppHref()',
      })}} className="rdsl-btn rdsl-btn-primary">Create</a>`);
    }
    lines.push(`            <a href={${pathWithReturnToExpression(`\`/${resource.name}/\${id}/related/${panel.panelField}\``, 'getCurrentAppHref()')}} className="rdsl-btn rdsl-btn-secondary">View all</a>`);
    lines.push(`          </div>`);
    lines.push(`        </div>`);
    if (panel.listView && panel.listView.columns.length > 0) {
    if (panel.listView.filters.length > 0) {
      lines.push(`        <FilterBar fields={${panel.filterFieldsName!}} values={${panel.tableViewName!}.filters} onChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'filters')}} />`);
    }
    lines.push(`        <DataTable`);
    lines.push(`          columns={${panel.tableColumnsName!}}`);
    lines.push(`          data={${panel.tableViewName!}.data}`);
    lines.push(`          loading={${panel.hookName}.loading}`);
    lines.push(`          sort={${panel.tableViewName!}.sort}`);
    lines.push(`          onSortChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'sort')}}`);
      if (tableActionsConstNames.has(panel.panelField)) {
        lines.push(`          actions={${tableActionsConstNames.get(panel.panelField)}}`);
      }
      lines.push(`        />`);
    if (panel.listView.pagination) {
      lines.push(`        <Pagination`);
      lines.push(`          current={${panel.tableViewName!}.pagination.page}`);
      lines.push(`          total={${panel.tableViewName!}.pagination.totalPages}`);
      lines.push(`          onChange={${tableViewTransitionHandlerName(panel.tableViewName!, 'pagination')}}`);
      lines.push(`        />`);
    }
    } else {
      lines.push(`        {${panel.hookName}.loading ? <div className="rdsl-loading">Loading...</div> : null}`);
      lines.push(`        {!${panel.hookName}.loading && ${panel.itemsName}.length === 0 ? <div className="rdsl-empty">No related records</div> : null}`);
      lines.push(`        {!${panel.hookName}.loading && ${panel.itemsName}.length > 0 ? (`);
      lines.push(`          <ul className="rdsl-related-list">`);
      lines.push(`            {${panel.itemsName}.map((item) => (`);
      lines.push(`              <li key={item.id}>`);
      const itemHrefExpr = fallbackRecordHrefExpression(panel.targetResource, 'item', {
        returnToExpr: 'getCurrentAppHref()',
      });
      const itemWorkflowStateExpr = fallbackRecordWorkflowStateExpression(panel.targetResource, 'item');
      if (itemHrefExpr) {
        lines.push(`                <a href={${itemHrefExpr}}>{String(item.${panel.labelField} ?? item.id)}</a>`);
      } else {
        lines.push(`                {String(item.${panel.labelField} ?? item.id)}`);
      }
      if (itemWorkflowStateExpr) {
        lines.push(`                {' '}<span className="rdsl-btn rdsl-btn-secondary">{${itemWorkflowStateExpr}}</span>`);
      }
      lines.push(`              </li>`);
      lines.push(`            ))}`);
      lines.push(`          </ul>`);
      lines.push(`        ) : null}`);
    }
    lines.push(`      </section>`);
  }
  for (const panel of panelTableBindings.filter((candidate) => candidate.deleteAction?.confirm)) {
    const actionPrefix = `${camelCase(panel.panelField)}Related`;
    const stateName = `${actionPrefix}DeleteConfirmState`;
    const stateSetterName = `set${capitalize(stateName)}`;
    const confirmName = `${actionPrefix}DeleteConfirm`;
    lines.push(`      <ConfirmDialog`);
    lines.push(`        open={${stateName}.open}`);
    lines.push(`        message={${stateName}.message || ''}`);
    lines.push(`        onConfirm={${confirmName}}`);
    lines.push(`        onCancel={() => ${stateSetterName}({ open: false })}`);
    lines.push(`      />`);
  }
  lines.push(`    </>`);
  lines.push(`  );`);
  lines.push(`});`);

  return sectionComponentName;
}

// ─── App Layout ──────────────────────────────────────────────────

function generateAppLayout(ir: IRApp): GeneratedFile {
  const filePath = 'layout/AdminLayout.tsx';
  const lines: string[] = [];
  const hasVisibleNavRules = ir.navigation.some(group => Boolean(group.visibleIf));
  const usesMessageResolver = ir.navigation.some((group) => (
    messageLikeNeedsRuntimeResolver(group.group)
    || group.items.some((item) => messageLikeNeedsRuntimeResolver(item.label))
  ));
  const titleElementConstName = staticComponentConstName('AdminLayout', 'TitleElement');
  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node app.main`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  if (usesMessageResolver) {
    lines.push(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
  }
  lines.push(`import { prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  if (hasVisibleNavRules) {
    lines.push(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
    lines.push(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
  }
  for (const imp of uniqueImports(collectFnImportsFromNavGroups(ir.navigation))) {
    lines.push(`import ${imp.componentName} from '${hostFileImportPath(filePath, imp.path)}';`);
  }
  lines.push(``);

  lines.push(`interface AdminLayoutProps {`);
  lines.push(`  children: React.ReactNode;`);
  lines.push(`}`);
  lines.push(``);
  appendStaticConst(lines, titleElementConstName, `<h2>{${JSON.stringify(ir.name)}}</h2>`);

  lines.push(`export function AdminLayout({ children }: AdminLayoutProps) {`);
  if (hasVisibleNavRules) {
    lines.push(`  const { currentUser } = useAuth();`);
  }
  lines.push(`  const navigation: Array<{ group: string; visible: boolean; items: Array<{ label: string; href: string; icon?: string | null }> }> = [`);
  for (const group of ir.navigation) {
    lines.push(`    // @source-node ${group.id}`);
    lines.push(`    {`);
    lines.push(`      group: ${messageLikeToRuntimeTextSource(group.group)},`);
    if (group.visibleIf) {
      lines.push(`      visible: ${ruleValueToRuntimeSource(group.visibleIf, `{ currentUser }`)},`);
    } else {
      lines.push(`      visible: true,`);
    }
    lines.push(`      items: [`);
    for (const item of group.items) {
      lines.push(`        // @source-node ${item.id}`);
      lines.push(`        { label: ${messageLikeToRuntimeTextSource(item.label)}, icon: ${JSON.stringify(item.icon ?? null)}, href: ${routeTargetToHrefExpression(item.target)} },`);
    }
    lines.push(`      ],`);
    lines.push(`    },`);
  }
  lines.push(`  ];`);
  lines.push(`  const visibleNavigation = navigation.filter((group) => group.visible);`);
  lines.push(``);
  lines.push(`  return (`);
  lines.push(`    <div className="rdsl-layout" data-theme="${ir.theme}">`);
  lines.push(`      <aside className="rdsl-sidebar">`);
  lines.push(`        <div className="rdsl-sidebar-header">`);
  lines.push(`          {${titleElementConstName}}`);
  lines.push(`        </div>`);
  lines.push(`        <nav className="rdsl-nav">`);
  lines.push(`          {visibleNavigation.map((group) => (`);
  lines.push(`            <div key={group.group} className="rdsl-nav-group">`);
  lines.push(`              <h3 className="rdsl-nav-group-title">{group.group}</h3>`);
  lines.push(`              {group.items.map((item) => (`);
  lines.push(`                <a key={item.label} href={item.href} className="rdsl-nav-item">`);
  lines.push(`                  {item.label}`);
  lines.push(`                </a>`);
  lines.push(`              ))}`);
  lines.push(`            </div>`);
  lines.push(`          ))}`);
  lines.push(`        </nav>`);
  lines.push(`      </aside>`);
  lines.push(`      <main className="rdsl-main">`);
  lines.push(`        {children}`);
  lines.push(`      </main>`);
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);

  return {
    path: filePath,
    content: lines.join('\n'),
    sourceNode: 'app.main',
  };
}

// ─── Router ──────────────────────────────────────────────────────

function generateRouter(ir: IRApp): GeneratedFile {
  const lines: string[] = [];
  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node app.main.router`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  lines.push(``);

  // Dynamic imports for code splitting (invariant #6)
  for (const resource of ir.resources) {
    const name = capitalize(resource.name);
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (resource.views.list) {
      lines.push(`const ${name}List = React.lazy(() => import('./views/${name}List').then((m) => ({ default: m.${name}List })));`);
    }
    if (resource.views.edit) {
      lines.push(`const ${name}Edit = React.lazy(() => import('./views/${name}Edit').then((m) => ({ default: m.${name}Edit })));`);
    }
    if (resource.views.create) {
      lines.push(`const ${name}Create = React.lazy(() => import('./views/${name}Create').then((m) => ({ default: m.${name}Create })));`);
    }
    if (resource.views.read) {
      lines.push(`const ${name}Read = React.lazy(() => import('./views/${name}Read').then((m) => ({ default: m.${name}Read })));`);
      if (model) {
        for (const panel of collectRelatedPanelBindings(ir, resource.views.read.related, model)) {
          const relatedName = relatedPanelComponentName(resource.name, panel.panelField);
          lines.push(`const ${relatedName} = React.lazy(() => import('./views/${relatedName}').then((m) => ({ default: m.${relatedName} })));`);
        }
      }
    }
    if (resource.workflow) {
      const workflowName = workflowViewComponentName(resource.name);
      lines.push(`const ${workflowName} = React.lazy(() => import('./views/${workflowName}').then((m) => ({ default: m.${workflowName} })));`);
    }
  }

  for (const page of ir.pages) {
    const name = capitalize(page.name);
    lines.push(`const ${name}Page = React.lazy(() => import('./pages/${name}Page').then((m) => ({ default: m.${name}Page })));`);
  }

  lines.push(``);
  lines.push(`interface RouteDef {`);
  lines.push(`  path: string;`);
  lines.push(`  component: React.ComponentType<any>;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const routes: RouteDef[] = [`);

  for (const page of ir.pages) {
    const name = capitalize(page.name);
    lines.push(`  // @source-node ${page.id}`);
    lines.push(`  { path: '${page.path ?? `/${page.name}`}', component: ${name}Page },`);
  }

  for (const resource of ir.resources) {
    const name = capitalize(resource.name);
    if (resource.views.list) {
      lines.push(`  // @source-node ${resource.views.list.id}`);
      lines.push(`  { path: '/${resource.name}', component: ${name}List },`);
    }
    if (resource.views.create) {
      lines.push(`  // @source-node ${resource.views.create.id}`);
      lines.push(`  { path: '/${resource.name}/create', component: ${name}Create },`);
    }
    if (resource.views.edit) {
      lines.push(`  // @source-node ${resource.views.edit.id}`);
      lines.push(`  { path: '/${resource.name}/:id/edit', component: ${name}Edit },`);
    }
    if (resource.views.read) {
      lines.push(`  // @source-node ${resource.views.read.id}`);
      lines.push(`  { path: '/${resource.name}/:id', component: ${name}Read },`);
      const model = ir.models.find((candidate) => candidate.name === resource.model);
      if (model) {
        for (const panel of collectRelatedPanelBindings(ir, resource.views.read.related, model)) {
          lines.push(`  // @source-node ${panel.panelId}`);
          lines.push(`  { path: '/${resource.name}/:id/related/${panel.panelField}', component: ${relatedPanelComponentName(resource.name, panel.panelField)} },`);
        }
      }
    }
    if (resource.workflow) {
      lines.push(`  // @source-node ${resource.id}`);
      lines.push(`  { path: '/${resource.name}/:id/workflow', component: ${workflowViewComponentName(resource.name)} },`);
    }
  }

  lines.push(`];`);
  lines.push(``);
  lines.push(`function matchPath(pattern: string, pathname: string): Record<string, string> | null {`);
  lines.push(`  const patternParts = pattern.split('/').filter(Boolean);`);
  lines.push(`  const pathParts = pathname.split('/').filter(Boolean);`);
  lines.push(`  if (patternParts.length !== pathParts.length) return null;`);
  lines.push(`  const params: Record<string, string> = {};`);
  lines.push(`  for (let index = 0; index < patternParts.length; index += 1) {`);
  lines.push(`    const patternPart = patternParts[index];`);
  lines.push(`    const pathPart = pathParts[index];`);
  lines.push(`    if (patternPart.startsWith(':')) {`);
  lines.push(`      params[patternPart.slice(1)] = pathPart;`);
  lines.push(`      continue;`);
  lines.push(`    }`);
  lines.push(`    if (patternPart !== pathPart) return null;`);
  lines.push(`  }`);
  lines.push(`  return params;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function matchRoute(pathname: string): { component: React.ComponentType<any>; params: Record<string, string> } | null {`);
  lines.push(`  const normalizedPath = pathname === '' ? '/' : pathname.replace(/\\/+$/, '') || '/';`);
  lines.push(`  for (const route of routes) {`);
  lines.push(`    const params = matchPath(route.path, normalizedPath);`);
  lines.push(`    if (params) {`);
  lines.push(`      return { component: route.component, params };`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return null;`);
  lines.push(`}`);

  return {
    path: 'router.tsx',
    content: lines.join('\n'),
    sourceNode: 'app.main',
  };
}

// ─── App Entry ───────────────────────────────────────────────────

function generateAppEntry(ir: IRApp): GeneratedFile {
  const lines: string[] = [];
  lines.push(`// Generated by ReactDSL compiler v0.1.0`);
  lines.push(`// @source-node app.main`);
  lines.push(`// Prefer editing source .web.loj/.style.loj files or documented escape hatches instead of this generated file.`);
  lines.push(`// This is the application entry point.`);
  lines.push(``);
  lines.push(`import React from 'react';`);
  if (ir.style) {
    lines.push(`import './styles/generated-styles.css';`);
  }
  lines.push(`import { getCurrentAppPathname } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
  lines.push(`import { AdminLayout } from './layout/AdminLayout';`);
  lines.push(`import { matchRoute } from './router';`);
  lines.push(``);
  lines.push(`export function App() {`);
  lines.push(`  const [pathname, setPathname] = React.useState(() => getCurrentAppPathname());`);
  lines.push(``);
  lines.push(`  React.useEffect(() => {`);
  lines.push(`    const handlePopState = () => setPathname(getCurrentAppPathname());`);
  lines.push(`    window.addEventListener('popstate', handlePopState);`);
  lines.push(`    return () => window.removeEventListener('popstate', handlePopState);`);
  lines.push(`  }, []);`);
  lines.push(``);
  lines.push(`  const matchedRoute = matchRoute(pathname);`);
  lines.push(`  const ResolvedRoute = matchedRoute?.component;`);
  lines.push(`  const routeParams = matchedRoute?.params ?? {};`);
  lines.push(`  return (`);
  lines.push(`    <AdminLayout>`);
  lines.push(`      <React.Suspense fallback={<div className="rdsl-loading">Loading...</div>}>`);
  lines.push(`        {ResolvedRoute ? <ResolvedRoute {...routeParams} /> : <div className="rdsl-error">Page not found</div>}`);
  lines.push(`      </React.Suspense>`);
  lines.push(`    </AdminLayout>`);
  lines.push(`  );`);
  lines.push(`}`);

  return {
    path: 'App.tsx',
    content: lines.join('\n'),
    sourceNode: 'app.main',
  };
}

function generateGeneratedNotice(): GeneratedFile {
  return {
    path: 'GENERATED.md',
    content: [
      '# Generated Output',
      '',
      'This directory is generated by Loj.',
      '',
      'Prefer editing source `.web.loj`, `.style.loj`, linked rules/workflow files, or documented escape hatches instead of editing generated files directly.',
      '',
      'If you need an emergency hotfix, you may patch generated code temporarily, but the durable fix should go back into source DSL, an escape hatch, or the generator/runtime itself.',
      '',
      'If the generated output itself is wrong, keep the hotfix narrow, then report it as a generator/runtime bug.',
      '',
    ].join('\n'),
    sourceNode: 'app.main',
  };
}

function generateAppShellFiles(ir: IRApp): GeneratedFile[] {
  const files = [generateAppEntry(ir), generateGeneratedNotice()];
  if (ir.style) {
    files.push(generateStyleSheet(ir));
  }
  return files;
}

function generateStyleSheet(ir: IRApp): GeneratedFile {
  return {
    path: 'styles/generated-styles.css',
    content: emitReactStyleCss(ir.style?.program ?? { tokens: { colors: {}, typography: {}, spacing: {}, borderRadius: {}, elevation: {} }, styles: [] }),
    sourceNode: ir.style?.id ?? ir.id,
  };
}

interface SeoAssetImportBinding {
  importName: string;
  path: string;
}

function collectPageSeoAssetImports(ir: IRApp, page: IRPage): SeoAssetImportBinding[] {
  const imports: SeoAssetImportBinding[] = [];
  if (ir.seo?.defaultImage?.resolvedPath) {
    imports.push({
      importName: 'appSeoDefaultImageAsset',
      path: ir.seo.defaultImage.resolvedPath,
    });
  }
  if (ir.seo?.favicon?.resolvedPath) {
    imports.push({
      importName: 'appSeoFaviconAsset',
      path: ir.seo.favicon.resolvedPath,
    });
  }
  if (page.seo?.image?.resolvedPath) {
    imports.push({
      importName: `${camelCase(page.name)}PageSeoImageAsset`,
      path: page.seo.image.resolvedPath,
    });
  }
  return imports;
}

function appendPageDocumentMetadataLines(
  lines: string[],
  ir: IRApp,
  page: IRPage,
  assetImports: readonly SeoAssetImportBinding[],
): void {
  const defaultImageImport = ir.seo?.defaultImage
    ? assetImports.find((entry) => entry.path === ir.seo?.defaultImage?.resolvedPath)?.importName ?? 'null'
    : 'null';
  const faviconImport = ir.seo?.favicon
    ? assetImports.find((entry) => entry.path === ir.seo?.favicon?.resolvedPath)?.importName ?? 'null'
    : 'null';
  const pageImageImport = page.seo?.image
    ? assetImports.find((entry) => entry.path === page.seo?.image?.resolvedPath)?.importName ?? 'null'
    : 'null';
  lines.push(`  useDocumentMetadata({`);
  lines.push(`    title: ${messageLikeToRuntimeTextSource(page.title)},`);
  if (ir.seo?.defaultTitle) {
    lines.push(`    defaultTitle: ${messageLikeToRuntimeTextSource(ir.seo.defaultTitle)},`);
  }
  if (ir.seo?.titleTemplate) {
    lines.push(`    titleTemplate: ${messageLikeToRuntimeTextSource(ir.seo.titleTemplate)},`);
  }
  if (page.seo?.description || ir.seo?.defaultDescription) {
    lines.push(`    description: ${page.seo?.description ? messageLikeToRuntimeTextSource(page.seo.description) : messageLikeToRuntimeTextSource(ir.seo!.defaultDescription!)},`);
  }
  if (page.seo?.canonicalPath) {
    lines.push(`    canonicalPath: ${JSON.stringify(page.seo.canonicalPath)},`);
  }
  if (page.seo?.image || ir.seo?.defaultImage) {
    lines.push(`    image: ${page.seo?.image ? pageImageImport : defaultImageImport},`);
  }
  if (ir.seo?.favicon) {
    lines.push(`    favicon: ${faviconImport},`);
  }
  if (page.seo?.noIndex) {
    lines.push(`    noIndex: true,`);
  }
  if (ir.seo?.siteName) {
    lines.push(`    siteName: ${messageLikeToRuntimeTextSource(ir.seo.siteName)},`);
  }
  lines.push(`  });`);
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function authoredStyleClassName(styleName: string): string {
  return `loj-style-${kebabCase(styleName)}`;
}

function classNameWithOptionalAuthoredStyle(baseClassName: string, styleName?: string): string {
  return styleName
    ? `${baseClassName} ${authoredStyleClassName(styleName)}`
    : baseClassName;
}

// ─── Utility Functions ───────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generateColumnRender(col: IRColumn, modelName: string, workflow?: IRResource['workflow']): string | null {
  const tagDec = col.decorators.find(d => d.name === 'tag');
  if (tagDec && tagDec.args) {
    const colors = JSON.stringify(tagDec.args);
    return `(value: unknown) => <Tag value={String(value)} colors={${colors}} />`;
  }

  const badgeDec = col.decorators.find(d => d.name === 'badge');
  if (badgeDec && badgeDec.args) {
    const colors = JSON.stringify(badgeDec.args);
    return `(value: unknown) => <Badge value={String(value)} colors={${colors}} />`;
  }

  if (workflow && col.field === workflow.program.field) {
    return workflowStateRenderSource(workflow);
  }

  return null;
}

function collectDisplayComponents(columns: IRColumn[]): string[] {
  const usedComponents = new Set<string>();
  for (const col of columns) {
    for (const dec of col.decorators) {
      if (dec.name === 'tag') usedComponents.add('Tag');
      if (dec.name === 'badge') usedComponents.add('Badge');
    }
  }
  return [...usedComponents];
}

function appendDataTableColumnsBlock(
  lines: string[],
  constName: string,
  columns: IRColumn[],
  modelName: string,
  sourceNode: string,
  workflow?: IRResource['workflow'],
): void {
  lines.push(`// @source-node ${sourceNode}`);
  lines.push(`const ${constName} = [`);
  for (const col of columns) {
    lines.push(`  // @source-node ${col.id}`);
    const sortable = col.decorators.some((decorator) => decorator.name === 'sortable');

    if (col.customRenderer) {
      const importName = getCustomComponentName(col.customRenderer);
      lines.push(`  { key: '${col.field}', label: '${columnLabel(col.field)}', render: (value: unknown, record: ${modelName}) => <${importName} value={value} record={record} /> },`);
      continue;
    }

    const renderFn = generateColumnRender(col, modelName, workflow);
    if (renderFn) {
      lines.push(`  { key: '${col.field}', label: '${columnLabel(col.field)}'${sortable ? ', sortable: true' : ''}, render: ${renderFn} },`);
      continue;
    }

    const format = col.decorators.find((decorator) => decorator.name === 'date') ? ", format: 'date'" : '';
    lines.push(`  { key: '${col.field}', label: '${columnLabel(col.field)}'${sortable ? ', sortable: true' : ''}${format} },`);
  }
  lines.push(`] as const;`);
  lines.push(``);
}

function relatedPanelComponentName(resourceName: string, panelField: string): string {
  return `${capitalize(resourceName)}${capitalize(camelCase(panelField))}Related`;
}

function workflowViewComponentName(resourceName: string): string {
  return `${capitalize(resourceName)}Workflow`;
}

function appendFilterFieldsBlock(
  lines: string[],
  constName: string,
  filters: IRFilter[],
  model: IRModel,
  models: readonly IRModel[],
  resources: readonly IRResource[],
  sourceNode: string,
): void {
  lines.push(`// @source-node ${sourceNode}`);
  lines.push(`const ${constName} = [`);
  for (const filter of filters) {
    const modelField = model.fields.find((candidate) => candidate.name === filter.field);
    const relationProjection = analyzeRelationProjection(filter.field, model, models, resources);
    const enumValues = relationProjection.kind === 'belongsToField' && relationProjection.targetField.fieldType.type === 'enum'
      ? relationProjection.targetField.fieldType.values
      : modelField?.fieldType.type === 'enum'
        ? modelField.fieldType.values
        : undefined;
    const filterType = enumValues ? 'select' : 'text';
    const options = enumValues ? `, options: [${enumValues.map((value) => `'${value}'`).join(', ')}]` : '';
    lines.push(`  // @source-node ${filter.id}`);
    lines.push(`  { key: '${filter.field}', label: '${columnLabel(filter.field)}', type: '${filterType}'${options} },`);
  }
  lines.push(`] as const;`);
  lines.push(``);
}

function appendReadModelQueryFieldsBlock(
  lines: string[],
  constName: string,
  readModel: IRReadModel,
  sourceNode: string,
): void {
  lines.push(`// @source-node ${sourceNode}`);
  lines.push(`const ${constName} = [`);
  for (const field of readModel.inputs) {
    const filterType = field.fieldType.type === 'enum' || (field.fieldType.type === 'scalar' && field.fieldType.name === 'boolean')
      ? 'select'
      : 'text';
    const options = field.fieldType.type === 'enum'
      ? field.fieldType.values
      : field.fieldType.type === 'scalar' && field.fieldType.name === 'boolean'
        ? ['true', 'false']
        : undefined;
    lines.push(`  // @source-node ${field.id}`);
    lines.push(`  { key: '${field.name}', label: '${columnLabel(field.name)}', type: '${filterType}'${options ? `, options: [${options.map((value) => `'${value}'`).join(', ')}]` : ''} },`);
  }
  lines.push(`] as const;`);
  lines.push(``);
}

function readModelInitialQueryStateSource(readModel: IRReadModel): string {
  if (readModel.inputs.length === 0) {
    return '{}';
  }
  return `{ ${readModel.inputs.map((field) => `${field.name}: ''`).join(', ')} }`;
}

function readModelQueryDefaultsConstName(queryStateName: string): string {
  return `${queryStateName}Defaults`;
}

function readModelQueryLocationOptionsConstName(queryStateName: string): string {
  return `${queryStateName}LocationOptions`;
}

function readModelQueryLocationSyncOptionsConstName(queryStateName: string): string {
  return `${queryStateName}LocationSyncOptions`;
}

function readModelDeferredQueryStateName(queryStateName: string): string {
  return `${queryStateName}Deferred`;
}

function readModelQueryParamPrefix(readModel: IRReadModel): string {
  return camelCase(readModel.name);
}

function tableViewTransitionHandlerName(
  tableViewName: string,
  action: 'filters' | 'sort' | 'pagination',
): string {
  return `${tableViewName}${capitalize(action)}WithTransition`;
}

function appendTableViewTransitionHandlers(
  lines: string[],
  tableViewName: string,
  options: { filters?: boolean; sort?: boolean; pagination?: boolean },
): void {
  if (options.filters) {
    lines.push(`  const ${tableViewTransitionHandlerName(tableViewName, 'filters')} = React.useCallback((nextFilters: Parameters<typeof ${tableViewName}.setFilters>[0]) => {`);
    lines.push(`    React.startTransition(() => ${tableViewName}.setFilters(nextFilters));`);
    lines.push(`  }, [${tableViewName}.setFilters]);`);
  }
  if (options.sort) {
    lines.push(`  const ${tableViewTransitionHandlerName(tableViewName, 'sort')} = React.useCallback((nextSort: Parameters<typeof ${tableViewName}.setSort>[0]) => {`);
    lines.push(`    React.startTransition(() => ${tableViewName}.setSort(nextSort));`);
    lines.push(`  }, [${tableViewName}.setSort]);`);
  }
  if (options.pagination) {
    lines.push(`  const ${tableViewTransitionHandlerName(tableViewName, 'pagination')} = React.useCallback((nextPage: Parameters<typeof ${tableViewName}.setPagination>[0]) => {`);
    lines.push(`    React.startTransition(() => ${tableViewName}.setPagination(nextPage));`);
    lines.push(`  }, [${tableViewName}.setPagination]);`);
  }
}

function readModelQueryEnabledExpr(readModel: IRReadModel, stateName: string): string {
  const requiredFields = readModel.inputs.filter((field) => field.decorators.some((decorator) => decorator.name === 'required'));
  if (requiredFields.length === 0) {
    return 'true';
  }
  return requiredFields
    .map((field) => `String(${stateName}.${field.name} ?? '').trim() !== ''`)
    .join(' && ');
}

function readModelRulesManifestEntriesLiteral(
  readModel: IRReadModel,
  section: 'eligibility' | 'validation' | 'derivations',
): string {
  return JSON.stringify(readModel.rules?.manifest?.[section] ?? []);
}

function rulesLinkManifestEntriesLiteral(
  rulesLink: IREditView['rulesLink'] | IRCreateView['rulesLink'],
  section: 'eligibility' | 'validation' | 'derivations',
): string {
  return JSON.stringify(rulesLink?.manifest?.[section] ?? []);
}

function appendReadModelPageQueryContextLines(
  lines: string[],
  binding: PageTableBlockBinding | PageMetricBlockBinding,
): void {
  if (!binding.readModel || !binding.queryStateName || !binding.querySetterName || !binding.queryEnabledName || !binding.queryCanLoadName) {
    return;
  }

  const defaultsName = readModelQueryDefaultsConstName(binding.queryStateName);
  const locationOptionsName = readModelQueryLocationOptionsConstName(binding.queryStateName);
  const locationSyncOptionsName = readModelQueryLocationSyncOptionsConstName(binding.queryStateName);
  const deferredStateName = readModelDeferredQueryStateName(binding.queryStateName);
  const stateSetterName = `${binding.querySetterName}State`;
  lines.push(`  const [${binding.queryStateName}, ${stateSetterName}] = React.useState<Record<string, string>>(() => getLocationSearchValues(${defaultsName}, ${locationOptionsName}));`);
  lines.push(`  const ${binding.querySetterName} = React.useCallback((nextQueryState: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => {`);
  lines.push(`    React.startTransition(() => {`);
  lines.push(`      ${stateSetterName}((previous) => typeof nextQueryState === 'function'`);
  lines.push(`        ? (nextQueryState as (previous: Record<string, string>) => Record<string, string>)(previous)`);
  lines.push(`        : nextQueryState);`);
  lines.push(`    });`);
  lines.push(`  }, []);`);
  lines.push(`  const ${deferredStateName} = React.useDeferredValue(${binding.queryStateName});`);
  lines.push(`  React.useEffect(() => {`);
  lines.push(`    replaceLocationSearchValues(${binding.queryStateName}, ${locationSyncOptionsName});`);
  lines.push(`  }, [${binding.queryStateName}]);`);
  lines.push(`  const ${binding.queryEnabledName} = ${readModelQueryEnabledExpr(binding.readModel, binding.queryStateName)};`);
  if (binding.queryEligibilityRulesName) {
    lines.push(`  const ${binding.queryEligibilityFailureName!} = !${binding.queryEnabledName} ? null : firstPolicyFailure(${binding.queryEligibilityRulesName}, { currentUser, input: ${deferredStateName} }, 'Forbidden');`);
  }
  if (binding.queryValidationRulesName) {
    lines.push(`  const ${binding.queryValidationFailureName!} = !${binding.queryEnabledName}${binding.queryEligibilityFailureName ? ` || ${binding.queryEligibilityFailureName}` : ''} ? null : firstPolicyFailure(${binding.queryValidationRulesName}, { currentUser, input: ${deferredStateName} }, 'Invalid request');`);
  }
  const canLoadExpr = [
    binding.queryEnabledName,
    binding.queryEligibilityFailureName ? `!${binding.queryEligibilityFailureName}` : null,
    binding.queryValidationFailureName ? `!${binding.queryValidationFailureName}` : null,
  ].filter(Boolean).join(' && ');
  lines.push(`  const ${binding.queryCanLoadName} = ${canLoadExpr};`);
}

function readModelDerivationAssignmentExpression(
  field: IRReadModel['result'][number],
  valueExpr: string,
  fallbackExpr: string,
): string {
  if (field.fieldType.type !== 'scalar') {
    return fallbackExpr;
  }
  switch (field.fieldType.name) {
    case 'boolean':
      return `${valueExpr} == null ? ${fallbackExpr} : Boolean(${valueExpr})`;
    case 'number':
      return `Number.isNaN(Number(${valueExpr})) ? ${fallbackExpr} : Number(${valueExpr})`;
    case 'string':
      return `${valueExpr} == null ? ${fallbackExpr} : String(${valueExpr})`;
    case 'datetime':
      return `${valueExpr} == null ? ${fallbackExpr} : String(${valueExpr})`;
    default:
      return fallbackExpr;
  }
}

function formRulesDerivationAssignmentExpression(
  field: IRModel['fields'][number],
  valueExpr: string,
  fallbackExpr: string,
): string {
  if (field.fieldType.type !== 'scalar') {
    return fallbackExpr;
  }
  switch (field.fieldType.name) {
    case 'boolean':
      return `${valueExpr} == null ? ${fallbackExpr} : Boolean(${valueExpr})`;
    case 'number':
      return `Number.isNaN(Number(${valueExpr})) ? ${fallbackExpr} : Number(${valueExpr})`;
    case 'string':
      return `${valueExpr} == null ? ${fallbackExpr} : String(${valueExpr})`;
    case 'datetime':
      return `${valueExpr} == null ? ${fallbackExpr} : String(${valueExpr})`;
    default:
      return fallbackExpr;
  }
}

interface CustomImport {
  path: string;
  componentName: string;
}

function uniqueImports(imports: CustomImport[]): CustomImport[] {
  const seen = new Set<string>();
  const deduped: CustomImport[] = [];
  for (const imp of imports) {
    if (seen.has(imp.path)) continue;
    seen.add(imp.path);
    deduped.push(imp);
  }
  return deduped;
}

function uniqueByName<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    deduped.push(entry);
  }
  return deduped;
}

function collectCustomImports(columns: IRColumn[]): CustomImport[] {
  const imports: CustomImport[] = [];
  for (const col of columns) {
    if (col.customRenderer) {
      imports.push({
        path: col.customRenderer,
        componentName: getCustomComponentName(col.customRenderer),
      });
    }
  }
  return imports;
}

function collectCustomFieldImports(fields: IRFormField[]): CustomImport[] {
  const imports: CustomImport[] = [];
  for (const field of fields) {
    if (field.customField) {
      imports.push({
        path: field.customField,
        componentName: getCustomComponentName(field.customField),
      });
    }
  }
  return imports;
}

function getCustomComponentName(filePath: string): string {
  return getSafeIdentifier(filePath, 'component');
}

function hostFileImportPath(fromFile: string, toFile: string): string {
  return relativeImportPath(fromFile, toFile).replace(/\.(tsx?|jsx?)$/, '');
}

function recordScopedCustomBlockComponentName(componentName: string): string {
  return `${componentName}RecordScopedBlock`;
}

function getFunctionName(filePath: string): string {
  return getSafeIdentifier(filePath, 'function');
}

function getSafeIdentifier(filePath: string, kind: 'component' | 'function'): string {
  const fileName = filePath.split('/').pop() || '';
  const baseName = fileName.replace(/\.(tsx?|jsx?)$/, '').replace(/\.(ts|js)$/, '');
  const parts = baseName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) {
    return kind === 'component' ? 'CustomComponent' : 'customRule';
  }
  if (kind === 'component') {
    return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }
  const [first, ...rest] = parts;
  return first.charAt(0).toLowerCase() + first.slice(1) + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function getFormFieldType(field: IRFormField, model: IRModel): string {
  const selectDec = field.decorators.find(d => d.name === 'select');
  if (selectDec) return 'select';

  const modelField = model.fields.find(f => f.name === field.field);
  if (modelField) {
    if (modelField.fieldType.type === 'enum') return 'select';
    if (modelField.fieldType.type === 'relation' && modelField.fieldType.kind === 'belongsTo') return 'select';
    if (modelField.fieldType.type === 'scalar') {
      switch (modelField.fieldType.name) {
        case 'number': return 'number';
        case 'boolean': return 'checkbox';
        case 'datetime': return 'datetime';
        default: return 'text';
      }
    }
  }
  return 'text';
}

interface RelationFieldBinding {
  fieldName: string;
  targetModel: IRModel;
  targetResource: IRResource;
  labelField: string;
  hookName: string;
  optionsName: string;
}

interface CreateIncludeBinding {
  fieldName: string;
  minItems: number;
  targetModel: IRModel;
  targetResource?: IRResource;
  inverseFieldName: string;
  fields: IRFormField[];
  rulesLink?: IRRulesLink;
  relationBindings: RelationFieldBinding[];
}

function collectRelationFieldBindings(ir: IRApp, fields: IRFormField[], model: IRModel): RelationFieldBinding[] {
  const bindings: RelationFieldBinding[] = [];
  const sharedBindings = new Map<string, Omit<RelationFieldBinding, 'fieldName'>>();

  for (const field of fields) {
    const modelField = model.fields.find((candidate): candidate is IRModel['fields'][number] & { fieldType: { type: 'relation'; kind: 'belongsTo'; target: string } } =>
      candidate.name === field.field
      && candidate.fieldType.type === 'relation'
      && candidate.fieldType.kind === 'belongsTo');
    if (!modelField) {
      continue;
    }

    const targetModel = ir.models.find((candidate) => candidate.name === modelField.fieldType.target);
    const targetResource = ir.resources.find((candidate) => candidate.model === modelField.fieldType.target);
    if (!targetModel || !targetResource) {
      continue;
    }

    const labelField = pickRelationLabelField(targetModel);
    const sharedKey = `${targetResource.name}:${labelField}`;
    const shared = sharedBindings.get(sharedKey) ?? {
      targetModel,
      targetResource,
      labelField,
      hookName: `${camelCase(targetResource.name)}Lookup`,
      optionsName: `${camelCase(targetResource.name)}Options`,
    };
    sharedBindings.set(sharedKey, shared);
    bindings.push({
      fieldName: field.field,
      ...shared,
    });
  }

  return bindings;
}

function uniqueRelationBindings(bindings: RelationFieldBinding[]): RelationFieldBinding[] {
  const unique = new Map<string, RelationFieldBinding>();
  for (const binding of bindings) {
    const key = `${binding.targetResource.name}:${binding.labelField}`;
    if (!unique.has(key)) {
      unique.set(key, binding);
    }
  }
  return [...unique.values()];
}

function collectCreateIncludeBindings(ir: IRApp, view: IREditView | IRCreateView, model: IRModel): CreateIncludeBinding[] {
  const bindings: CreateIncludeBinding[] = [];

  for (const include of view.includes) {
    const relationField = model.fields.find((candidate): candidate is IRModel['fields'][number] & {
      fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
    } =>
      candidate.name === include.field
      && candidate.fieldType.type === 'relation'
      && candidate.fieldType.kind === 'hasMany');
    if (!relationField) {
      continue;
    }

    const targetModel = ir.models.find((candidate) => candidate.name === relationField.fieldType.target);
    const targetResource = ir.resources.find((candidate) => candidate.model === relationField.fieldType.target);
    if (!targetModel) {
      continue;
    }

    bindings.push({
      fieldName: include.field,
      minItems: include.minItems,
      targetModel,
      targetResource,
      inverseFieldName: relationField.fieldType.by,
      fields: include.fields,
      rulesLink: include.rulesLink,
      relationBindings: collectRelationFieldBindings(ir, include.fields, targetModel),
    });
  }

  return bindings;
}

interface ListProjectionLookupBinding {
  targetModel: IRModel;
  targetResource: IRResource;
  hookName: string;
  byIdMapName: string;
}

type ProjectionFieldRef = Pick<IRColumn, 'field'> | Pick<IRFilter, 'field'>;

interface ListColumnProjectionBinding {
  fieldName: string;
  kind: 'belongsToField' | 'hasManyCount';
  lookup: ListProjectionLookupBinding;
  targetFieldName?: string;
  inverseFieldName?: string;
  countMapName?: string;
}

interface RelatedPanelBinding {
  panelId: string;
  panelField: string;
  targetModel: IRModel;
  targetResource: IRResource;
  inverseFieldName: string;
  hookName: string;
  itemsName: string;
  filterFieldsName?: string;
  tableColumnsName?: string;
  tableDataName?: string;
  tableViewName?: string;
  listView?: IRListView;
  listProjectionBindings: ListColumnProjectionBinding[];
  createAction: boolean;
  deleteAction?: IRAction;
  tableActions: Array<'view' | 'edit' | 'workflow'>;
  labelField: string;
  itemHrefSource?: string;
}

interface PageTableBlockBinding {
  blockId: string;
  blockTitle: MessageLikeNode;
  sourceKind: 'resourceList' | 'readModelList' | 'recordRelationList';
  resource?: IRResource;
  model?: IRModel;
  readModel?: IRReadModel;
  listView?: IRListView | IRReadModel['list'];
  hookName: string;
  itemsName?: string;
  tableColumnsName?: string;
  tableDataName?: string;
  tableViewName?: string;
  filterFieldsName?: string;
  tableViewOptionsName?: string;
  tableActionsName?: string;
  listProjectionBindings: ListColumnProjectionBinding[];
  createAction: boolean;
  deleteAction?: IRAction;
  tableActions: Array<'view' | 'edit' | 'workflow'>;
  queryFieldsName?: string;
  queryStateName?: string;
  querySetterName?: string;
  queryGroupKey?: string;
  queryParamPrefix?: string;
  showQueryControls?: boolean;
  queryEnabledName?: string;
  queryEligibilityRulesName?: string;
  queryValidationRulesName?: string;
  queryDerivationsName?: string;
  queryEligibilityFailureName?: string;
  queryValidationFailureName?: string;
  queryCanLoadName?: string;
  readModelOptionsName?: string;
  groupByConstName?: string;
  selectionStateKey?: string;
  selectionIdName?: string;
  setSelectionIdName?: string;
  selectedRowName?: string;
  selectionRowsByIdName?: string;
  selectRowHandlerName?: string;
  selectionName?: string;
  dateNavigation?: {
    field: string;
    prevLabel: MessageLikeNode;
    nextLabel: MessageLikeNode;
    currentLabelName: string;
    shiftBackwardName: string;
    shiftForwardName: string;
  };
  parentResource?: IRResource;
  parentModel?: IRModel;
  relationFieldName?: string;
  inverseFieldName?: string;
  labelField?: string;
  itemHrefSource?: string;
  readModelRowActions: ReadModelRowActionBinding[];
}

interface ReadModelRowActionBinding {
  label: MessageLikeNode;
  targetResource: IRResource;
  seed: Array<{
    fieldName: string;
    value:
      | { kind: 'literal'; value: string | number | boolean }
      | { kind: 'rowField'; field: string }
      | { kind: 'inputField'; field: string };
  }>;
}

interface PageCreateActionBinding {
  id: string;
  label: MessageLikeNode;
  targetResource: IRResource;
  seed: Array<{
    fieldName: string;
    value:
      | { kind: 'literal'; value: string | number | boolean }
      | { kind: 'inputField'; queryState: string; field: string; queryStateName: string }
      | { kind: 'selectionField'; selectionState: string; field: string; selectedRowName: string };
  }>;
  enabledExpr: string;
  hrefName: string;
}

interface PageMetricBlockBinding {
  blockId: string;
  blockTitle: MessageLikeNode;
  sourceKind: 'recordRelationCount' | 'readModelCount';
  resource?: IRResource;
  model?: IRModel;
  readModel?: IRReadModel;
  hookName: string;
  countName: string;
  parentResource?: IRResource;
  parentModel?: IRModel;
  relationFieldName?: string;
  inverseFieldName?: string;
  queryFieldsName?: string;
  queryStateName?: string;
  querySetterName?: string;
  queryGroupKey?: string;
  queryParamPrefix?: string;
  showQueryControls?: boolean;
  queryEnabledName?: string;
  queryEligibilityRulesName?: string;
  queryValidationRulesName?: string;
  queryEligibilityFailureName?: string;
  queryValidationFailureName?: string;
  queryCanLoadName?: string;
  readModelOptionsName?: string;
  itemsName?: string;
}

type RecordRelationMetricBlockBinding = PageMetricBlockBinding & {
  sourceKind: 'recordRelationCount';
  resource: IRResource;
  model: IRModel;
  parentResource: IRResource;
  parentModel: IRModel;
  relationFieldName: string;
  inverseFieldName: string;
};

type ReadModelMetricBlockBinding = PageMetricBlockBinding & {
  sourceKind: 'readModelCount';
  readModel: IRReadModel;
  queryStateName: string;
  querySetterName: string;
  queryEnabledName: string;
  queryCanLoadName: string;
};

interface RecordScopedCustomRelationContextBinding {
  relationFieldName: string;
  title: MessageLikeNode;
  surfaceKind: 'table' | 'label-list' | 'count';
  targetResource: IRResource;
  targetModel: IRModel;
  countExpr: string;
  itemsExpr: string;
  createHrefExpr: string;
  loadingExpr: string;
  errorExpr: string;
  dependencyExprs: string[];
}

function panelNodeId(panel: Pick<RelatedPanelBinding, 'panelId'>): string {
  return panel.panelId;
}

function collectListProjectionBindings(
  ir: IRApp,
  fields: readonly ProjectionFieldRef[],
  model: IRModel,
  countNamePrefix?: string,
): ListColumnProjectionBinding[] {
  const bindings: ListColumnProjectionBinding[] = [];
  const sharedLookups = new Map<string, ListProjectionLookupBinding>();
  const seenFields = new Set<string>();

  for (const field of fields) {
    if (seenFields.has(field.field)) {
      continue;
    }
    const projection = analyzeRelationProjection(field.field, model, ir.models, ir.resources);
    if (projection.kind !== 'belongsToField' && projection.kind !== 'hasManyCount') {
      continue;
    }
    seenFields.add(field.field);

    const sharedKey = projection.targetResource.name;
    const lookup = sharedLookups.get(sharedKey) ?? {
      targetModel: projection.targetModel,
      targetResource: projection.targetResource,
      hookName: `${camelCase(projection.targetResource.name)}ProjectionLookup`,
      byIdMapName: `${camelCase(projection.targetResource.name)}ById`,
    };
    sharedLookups.set(sharedKey, lookup);

    if (projection.kind === 'belongsToField') {
      bindings.push({
        fieldName: field.field,
        kind: 'belongsToField',
        lookup,
        targetFieldName: projection.targetField.name,
      });
      continue;
    }

    bindings.push({
      fieldName: field.field,
      kind: 'hasManyCount',
      lookup,
      inverseFieldName: projection.rootField.fieldType.by,
      countMapName: countNamePrefix
        ? `${camelCase(countNamePrefix)}${capitalize(`${camelCase(field.field)}ProjectionCountMap`)}`
        : `${camelCase(field.field)}ProjectionCountMap`,
    });
  }

  return bindings;
}

function uniqueListProjectionLookups(bindings: ListColumnProjectionBinding[]): ListProjectionLookupBinding[] {
  const unique = new Map<string, ListProjectionLookupBinding>();
  for (const binding of bindings) {
    unique.set(binding.lookup.targetResource.name, binding.lookup);
  }
  return [...unique.values()];
}

function projectionLookupTargetsNeedingById(bindings: readonly ListColumnProjectionBinding[]): Set<string> {
  return new Set(
    bindings
      .filter((binding) => binding.kind === 'belongsToField')
      .map((binding) => binding.lookup.targetResource.name),
  );
}

function projectionAssignmentSource(binding: ListColumnProjectionBinding): string {
  if (binding.kind === 'belongsToField') {
    return `record.${binding.fieldName.split('.')[0]} == null ? undefined : ${binding.lookup.byIdMapName}.get(String(record.${binding.fieldName.split('.')[0]}))?.${binding.targetFieldName}`;
  }
  return `${binding.lookup.hookName}.loading ? undefined : (${binding.countMapName!}.get(String(record.id)) ?? 0)`;
}

function collectReadModelRowActionBindings(
  block: IRDashboardBlock,
  resources: readonly IRResource[],
): ReadModelRowActionBinding[] {
  return block.rowActions.flatMap((action) => {
    if (action.action !== 'create') {
      return [];
    }
    const targetResource = resources.find((candidate) => candidate.name === action.resource);
    if (!targetResource?.views.create) {
      return [];
    }
    return [{
      label: action.label,
      targetResource,
      seed: Object.entries(action.seed).map(([fieldName, value]) => ({ fieldName, value })),
    }];
  });
}

function collectPageCreateActionBindings(
  page: IRPage,
  resources: readonly IRResource[],
  tableBindings: readonly PageTableBlockBinding[],
  metricBindings: readonly PageMetricBlockBinding[],
): PageCreateActionBinding[] {
  const queryStates = new Map<string, string>();
  for (const binding of [...tableBindings, ...metricBindings]) {
    if (!binding.queryGroupKey || !binding.queryStateName) {
      continue;
    }
    queryStates.set(binding.queryGroupKey, binding.queryStateName);
  }

  const selectionStates = new Map<string, string>();
  for (const binding of tableBindings) {
    if (!binding.selectionStateKey || !binding.selectedRowName) {
      continue;
    }
    selectionStates.set(binding.selectionStateKey, binding.selectedRowName);
  }

  return page.actions.flatMap((action) => {
    if (action.action !== 'create') {
      return [] as PageCreateActionBinding[];
    }
    const targetResource = resources.find((candidate) => candidate.name === action.resource);
    if (!targetResource?.views.create) {
      return [] as PageCreateActionBinding[];
    }
    const seed: PageCreateActionBinding['seed'] = [];
    for (const [fieldName, value] of Object.entries(action.seed) as Array<[string, IRPage['actions'][number]['seed'][string]]>) {
      if (value.kind === 'literal') {
        seed.push({ fieldName, value: { kind: 'literal', value: value.value } });
        continue;
      }
      if (value.kind === 'inputField') {
        const queryStateName = queryStates.get(value.queryState);
        if (!queryStateName) {
          continue;
        }
        seed.push({
          fieldName,
          value: {
            kind: 'inputField' as const,
            queryState: value.queryState,
            field: value.field,
            queryStateName,
          },
        });
        continue;
      }
      if (value.kind === 'selectionField') {
        const selectedRowName = selectionStates.get(value.selectionState);
        if (!selectedRowName) {
          continue;
        }
        seed.push({
          fieldName,
          value: {
            kind: 'selectionField' as const,
            selectionState: value.selectionState,
            field: value.field,
            selectedRowName,
          },
        });
        continue;
      }
    }
    const requiredSelections = Array.from(new Set(seed
      .flatMap((entry) => {
        if (entry.value.kind !== 'selectionField') {
          return [];
        }
        return [entry.value.selectedRowName];
      })));
    return [{
      id: action.id,
      label: action.label,
      targetResource,
      seed,
      enabledExpr: requiredSelections.length > 0
        ? requiredSelections.map((name) => `Boolean(${name})`).join(' && ')
        : 'true',
      hrefName: `${camelCase(action.id)}Href`,
    }];
  });
}

function collectPageTableBlockBindings(ir: IRApp, blocks: IRDashboardBlock[]): PageTableBlockBinding[] {
  const bindings: PageTableBlockBinding[] = [];

  for (const block of blocks) {
    const analysis = analyzePageBlockData(block, ir.resources, ir.models, ir.readModels);
    if (analysis.kind !== 'resourceList' && analysis.kind !== 'readModelList' && analysis.kind !== 'recordRelationList') {
      continue;
    }
    if (analysis.kind === 'readModelList') {
      const queryGroupKey = block.queryState?.trim() || analysis.readModel.id;
      const selectionStateKey = block.selectionState?.trim() || undefined;
      const dateNavigation = block.dateNavigation
        ? {
          field: block.dateNavigation.field,
          prevLabel: block.dateNavigation.prevLabel || 'Previous day',
          nextLabel: block.dateNavigation.nextLabel || 'Next day',
          currentLabelName: `${camelCase(block.id)}DateNavigationCurrentLabel`,
          shiftBackwardName: `${camelCase(block.id)}ShiftDateBackward`,
          shiftForwardName: `${camelCase(block.id)}ShiftDateForward`,
        }
        : undefined;
      bindings.push({
        blockId: block.id,
        blockTitle: block.title || analysis.readModel.name,
        sourceKind: analysis.kind,
        readModel: analysis.readModel,
        listView: analysis.listView,
        hookName: `${camelCase(analysis.readModel.name)}${capitalize(camelCase(block.id))}ReadModel`,
        itemsName: `${camelCase(block.id)}ReadModelItems`,
        tableColumnsName: analysis.listView.columns.length > 0 ? `${camelCase(block.id)}TableColumns` : undefined,
        tableViewName: analysis.listView.columns.length > 0 ? `${camelCase(block.id)}TableView` : undefined,
        tableViewOptionsName: analysis.listView.columns.length > 0 ? pageTableViewOptionsConstName(block.id) : undefined,
        tableActionsName: block.rowActions?.length ? pageTableActionsConstName(block.id) : undefined,
        queryFieldsName: analysis.readModel.inputs.length > 0 ? `${camelCase(block.id)}QueryFields` : undefined,
        queryStateName: `${camelCase(block.id)}Query`,
        querySetterName: `set${capitalize(camelCase(block.id))}Query`,
        queryGroupKey,
        queryParamPrefix: undefined,
        showQueryControls: true,
        queryEnabledName: `${camelCase(block.id)}QueryEnabled`,
        queryEligibilityRulesName: analysis.readModel.rules?.program.eligibility.length ? `${camelCase(block.id)}EligibilityRules` : undefined,
        queryValidationRulesName: analysis.readModel.rules?.program.validation.length ? `${camelCase(block.id)}ValidationRules` : undefined,
        queryDerivationsName: analysis.readModel.rules?.program.derivations.length ? `${camelCase(block.id)}DerivationRules` : undefined,
        queryEligibilityFailureName: analysis.readModel.rules?.program.eligibility.length ? `${camelCase(block.id)}EligibilityFailure` : undefined,
        queryValidationFailureName: analysis.readModel.rules?.program.validation.length ? `${camelCase(block.id)}ValidationFailure` : undefined,
        queryCanLoadName: `${camelCase(block.id)}CanLoad`,
        readModelOptionsName: readModelOptionsConstName(`${camelCase(block.id)}`),
        groupByConstName: analysis.readModel.list?.groupBy.length ? pageReadModelGroupByConstName(block.id) : undefined,
        selectionStateKey,
        selectionIdName: selectionStateKey ? `${camelCase(selectionStateKey)}SelectedId` : undefined,
        setSelectionIdName: selectionStateKey ? `set${capitalize(camelCase(selectionStateKey))}SelectedId` : undefined,
        selectedRowName: selectionStateKey ? `${camelCase(selectionStateKey)}SelectedRow` : undefined,
        selectionRowsByIdName: selectionStateKey ? pageSelectionRowsByIdName(selectionStateKey) : undefined,
        selectRowHandlerName: selectionStateKey ? pageSelectRowHandlerName(selectionStateKey) : undefined,
        selectionName: selectionStateKey ? `${camelCase(block.id)}Selection` : undefined,
        dateNavigation,
        listProjectionBindings: [],
        createAction: false,
        tableActions: [],
        readModelRowActions: collectReadModelRowActionBindings(block, ir.resources),
      });
      continue;
    }

    const targetResource = analysis.kind === 'resourceList' ? analysis.resource : analysis.targetResource;
    const targetModel = analysis.kind === 'resourceList' ? analysis.model : analysis.targetModel;
    const listView = analysis.kind === 'recordRelationList' && analysis.listView && analysis.listView.columns.length === 0
      ? undefined
      : analysis.listView;
    const tableActions = listView
      ? [
        ...listView.actions.flatMap((action) => {
          if (action.name === 'view' && targetResource.views.read) {
            return ['view' as const];
          }
          if (action.name === 'edit' && targetResource.views.edit) {
            return ['edit' as const];
          }
          return [];
        }),
        ...(targetResource.workflow ? ['workflow' as const] : []),
      ]
      : [];

    bindings.push({
      blockId: block.id,
      blockTitle: block.title || (analysis.kind === 'recordRelationList' ? columnLabel(analysis.relationFieldName) : block.id),
      sourceKind: analysis.kind,
      resource: targetResource,
      model: targetModel,
      listView,
      hookName: `${camelCase(targetResource.name)}${capitalize(camelCase(block.id))}TableResource`,
      itemsName: analysis.kind === 'recordRelationList' ? `${camelCase(block.id)}Items` : undefined,
      tableColumnsName: listView ? `${camelCase(block.id)}TableColumns` : undefined,
      tableDataName: listView ? `${camelCase(block.id)}TableData` : undefined,
      tableViewName: listView ? `${camelCase(block.id)}TableView` : undefined,
      tableViewOptionsName: listView ? pageTableViewOptionsConstName(block.id) : undefined,
      tableActionsName: (tableActions.length > 0 || Boolean(listView?.actions.find((action) => action.name === 'delete'))) ? pageTableActionsConstName(block.id) : undefined,
      filterFieldsName: listView && listView.filters.length > 0 ? `${camelCase(block.id)}FilterFields` : undefined,
      listProjectionBindings: listView
        ? collectListProjectionBindings(
          ir,
          [...listView.columns, ...listView.filters],
          targetModel,
          `${block.id}Table`,
        )
        : [],
      createAction: Boolean(listView?.actions.some((action) => action.name === 'create') && targetResource.views.create),
      deleteAction: listView?.actions.find((action) => action.name === 'delete'),
      tableActions,
      queryFieldsName: undefined,
      queryStateName: undefined,
      querySetterName: undefined,
      queryGroupKey: undefined,
      queryParamPrefix: undefined,
      showQueryControls: undefined,
      queryEnabledName: undefined,
      queryEligibilityRulesName: undefined,
      queryValidationRulesName: undefined,
      queryDerivationsName: undefined,
      queryEligibilityFailureName: undefined,
      queryValidationFailureName: undefined,
      queryCanLoadName: undefined,
      readModelOptionsName: undefined,
      groupByConstName: undefined,
      selectionStateKey: undefined,
      selectionIdName: undefined,
      setSelectionIdName: undefined,
      selectedRowName: undefined,
      selectionRowsByIdName: undefined,
      selectRowHandlerName: undefined,
      dateNavigation: undefined,
      parentResource: analysis.kind === 'recordRelationList' ? analysis.resource : undefined,
      parentModel: analysis.kind === 'recordRelationList' ? analysis.model : undefined,
      relationFieldName: analysis.kind === 'recordRelationList' ? analysis.relationFieldName : undefined,
      inverseFieldName: analysis.kind === 'recordRelationList' ? analysis.relationField.fieldType.by : undefined,
      labelField: analysis.kind === 'recordRelationList' ? pickRelationLabelField(targetModel) : undefined,
      itemHrefSource: analysis.kind === 'recordRelationList'
        ? targetResource.views.read
          ? `(item) => \`/${targetResource.name}/\${item.id}\``
          : targetResource.views.edit
            ? `(item) => \`/${targetResource.name}/\${item.id}/edit\``
            : undefined
        : undefined,
      readModelRowActions: [],
    });
  }

  return bindings;
}

function collectPageMetricBlockBindings(ir: IRApp, blocks: IRDashboardBlock[]): PageMetricBlockBinding[] {
  const bindings: PageMetricBlockBinding[] = [];

  for (const block of blocks) {
    const analysis = analyzePageBlockData(block, ir.resources, ir.models, ir.readModels);
    if (analysis.kind === 'readModelCount') {
      const queryGroupKey = block.queryState?.trim() || analysis.readModel.id;
      bindings.push({
        blockId: block.id,
        blockTitle: block.title || analysis.readModel.name,
        sourceKind: 'readModelCount',
        readModel: analysis.readModel,
        hookName: `${camelCase(analysis.readModel.name)}${capitalize(camelCase(block.id))}ReadModel`,
        countName: `${camelCase(block.id)}MetricCount`,
        queryFieldsName: analysis.readModel.inputs.length > 0 ? `${camelCase(block.id)}QueryFields` : undefined,
        queryStateName: `${camelCase(block.id)}Query`,
        querySetterName: `set${capitalize(camelCase(block.id))}Query`,
        queryGroupKey,
        queryParamPrefix: undefined,
        showQueryControls: true,
        queryEnabledName: `${camelCase(block.id)}QueryEnabled`,
        queryEligibilityRulesName: analysis.readModel.rules?.program.eligibility.length ? `${camelCase(block.id)}EligibilityRules` : undefined,
        queryValidationRulesName: analysis.readModel.rules?.program.validation.length ? `${camelCase(block.id)}ValidationRules` : undefined,
        queryEligibilityFailureName: analysis.readModel.rules?.program.eligibility.length ? `${camelCase(block.id)}EligibilityFailure` : undefined,
        queryValidationFailureName: analysis.readModel.rules?.program.validation.length ? `${camelCase(block.id)}ValidationFailure` : undefined,
        queryCanLoadName: `${camelCase(block.id)}CanLoad`,
        readModelOptionsName: readModelOptionsConstName(`${camelCase(block.id)}`),
      });
      continue;
    }
    if (analysis.kind !== 'recordRelationCount') {
      continue;
    }

    bindings.push({
      blockId: block.id,
      blockTitle: block.title || columnLabel(analysis.relationFieldName),
      sourceKind: 'recordRelationCount',
      resource: analysis.targetResource,
      model: analysis.targetModel,
      hookName: `${camelCase(analysis.targetResource.name)}${capitalize(camelCase(block.id))}MetricResource`,
      countName: `${camelCase(block.id)}MetricCount`,
      parentResource: analysis.resource,
      parentModel: analysis.model,
      relationFieldName: analysis.relationFieldName,
      inverseFieldName: analysis.relationField.fieldType.by,
      itemsName: `${camelCase(block.id)}Items`,
    });
  }

  return bindings;
}

function sharePageReadModelQueryBindings(
  tableBindings: PageTableBlockBinding[],
  metricBindings: PageMetricBlockBinding[],
): void {
  const sharedContexts = new Map<string, {
    groupKey: string;
    queryParamPrefix: string;
    queryFieldsName?: string;
    queryStateName: string;
    querySetterName: string;
    showQueryControls: boolean;
    queryEnabledName: string;
    queryEligibilityRulesName?: string;
    queryValidationRulesName?: string;
    queryEligibilityFailureName?: string;
      queryValidationFailureName?: string;
      queryCanLoadName: string;
      readModelOptionsName: string;
  }>();

  const readModelBindings = [
    ...tableBindings.filter((binding): binding is PageTableBlockBinding & { readModel: IRReadModel; sourceKind: 'readModelList' } => binding.sourceKind === 'readModelList' && Boolean(binding.readModel)),
    ...metricBindings.filter((binding): binding is PageMetricBlockBinding & { readModel: IRReadModel; sourceKind: 'readModelCount' } => binding.sourceKind === 'readModelCount' && Boolean(binding.readModel)),
  ];

  const ownerByGroupKey = new Map<string, string>();
  const groupedBindings = new Map<string, typeof readModelBindings>();
  for (const binding of readModelBindings) {
    const groupKey = binding.queryGroupKey || binding.readModel.id;
    const group = groupedBindings.get(groupKey) ?? [];
    group.push(binding);
    groupedBindings.set(groupKey, group);
  }
  for (const [groupKey, group] of groupedBindings.entries()) {
    const owner = group.find((binding) => binding.sourceKind === 'readModelList') ?? group[0];
    ownerByGroupKey.set(groupKey, owner.blockId);
  }

  for (const binding of readModelBindings) {
    const groupKey = binding.queryGroupKey || binding.readModel.id;
    const existing = sharedContexts.get(groupKey);
    if (existing) {
      binding.queryFieldsName = existing.queryFieldsName;
      binding.queryStateName = existing.queryStateName;
      binding.querySetterName = existing.querySetterName;
      binding.queryParamPrefix = existing.queryParamPrefix;
      binding.showQueryControls = existing.showQueryControls && ownerByGroupKey.get(groupKey) === binding.blockId;
      binding.queryEnabledName = existing.queryEnabledName;
      binding.queryEligibilityRulesName = existing.queryEligibilityRulesName;
      binding.queryValidationRulesName = existing.queryValidationRulesName;
      binding.queryEligibilityFailureName = existing.queryEligibilityFailureName;
      binding.queryValidationFailureName = existing.queryValidationFailureName;
      binding.queryCanLoadName = existing.queryCanLoadName;
      binding.readModelOptionsName = existing.readModelOptionsName;
      continue;
    }

    const sharedBaseName = groupKey === binding.readModel.id
      ? `${camelCase(binding.readModel.name)}Page`
      : `${camelCase(groupKey)}Page`;
    const sharedContext = {
      groupKey,
      queryParamPrefix: groupKey === binding.readModel.id ? readModelQueryParamPrefix(binding.readModel) : camelCase(groupKey),
      queryFieldsName: binding.readModel.inputs.length > 0 ? `${sharedBaseName}QueryFields` : undefined,
      queryStateName: `${sharedBaseName}Query`,
      querySetterName: `set${capitalize(sharedBaseName)}Query`,
      showQueryControls: true,
      queryEnabledName: `${sharedBaseName}QueryEnabled`,
      queryEligibilityRulesName: binding.readModel.rules?.program.eligibility.length ? `${sharedBaseName}EligibilityRules` : undefined,
      queryValidationRulesName: binding.readModel.rules?.program.validation.length ? `${sharedBaseName}ValidationRules` : undefined,
      queryEligibilityFailureName: binding.readModel.rules?.program.eligibility.length ? `${sharedBaseName}EligibilityFailure` : undefined,
      queryValidationFailureName: binding.readModel.rules?.program.validation.length ? `${sharedBaseName}ValidationFailure` : undefined,
      queryCanLoadName: `${sharedBaseName}CanLoad`,
      readModelOptionsName: readModelOptionsConstName(sharedBaseName),
    };
    sharedContexts.set(groupKey, sharedContext);
    binding.queryFieldsName = sharedContext.queryFieldsName;
    binding.queryStateName = sharedContext.queryStateName;
    binding.querySetterName = sharedContext.querySetterName;
    binding.queryParamPrefix = sharedContext.queryParamPrefix;
    binding.showQueryControls = ownerByGroupKey.get(groupKey) === binding.blockId;
    binding.queryEnabledName = sharedContext.queryEnabledName;
    binding.queryEligibilityRulesName = sharedContext.queryEligibilityRulesName;
    binding.queryValidationRulesName = sharedContext.queryValidationRulesName;
    binding.queryEligibilityFailureName = sharedContext.queryEligibilityFailureName;
    binding.queryValidationFailureName = sharedContext.queryValidationFailureName;
    binding.queryCanLoadName = sharedContext.queryCanLoadName;
    binding.readModelOptionsName = sharedContext.readModelOptionsName;
  }
}

function sharePageRecordRelationBindings(
  tableBindings: PageTableBlockBinding[],
  metricBindings: PageMetricBlockBinding[],
): void {
  const groupedBindings = new Map<string, Array<PageTableBlockBinding | PageMetricBlockBinding>>();
  for (const binding of [
    ...tableBindings.filter((candidate) => candidate.sourceKind === 'recordRelationList'),
    ...metricBindings.filter((candidate) => candidate.sourceKind === 'recordRelationCount'),
  ]) {
    const key = `${binding.resource?.name ?? 'resource'}:${binding.inverseFieldName ?? 'inverse'}`;
    const group = groupedBindings.get(key) ?? [];
    group.push(binding);
    groupedBindings.set(key, group);
  }

  for (const group of groupedBindings.values()) {
    const owner = group.find((binding) => binding.sourceKind === 'recordRelationList') ?? group[0];
    const sharedItemsName = owner.itemsName ?? `${camelCase(owner.blockId)}Items`;
    for (const binding of group) {
      binding.itemsName = sharedItemsName;
    }
  }
}

function collectRecordScopedCustomRelationContextBindings(
  tableBindings: PageTableBlockBinding[],
  metricBindings: PageMetricBlockBinding[],
): RecordScopedCustomRelationContextBinding[] {
  const bindings = new Map<string, RecordScopedCustomRelationContextBinding>();

  for (const tableBinding of tableBindings) {
    if (tableBinding.sourceKind !== 'recordRelationList' || !tableBinding.relationFieldName || !tableBinding.itemsName) {
      continue;
    }
    const targetResource = tableBinding.resource!;
    const targetModel = tableBinding.model!;
    bindings.set(tableBinding.relationFieldName, {
      relationFieldName: tableBinding.relationFieldName,
      title: tableBinding.blockTitle,
      surfaceKind: tableBinding.listView ? 'table' : 'label-list',
      targetResource,
      targetModel,
      countExpr: `${tableBinding.itemsName}.length`,
      itemsExpr: `${tableBinding.itemsName}.map((item) => ({ id: String(item.id), label: String(item.${tableBinding.labelField!} ?? item.id), viewHref: ${targetResource.views.read
        ? resourceRecordHrefExpression(targetResource.name, 'item', 'read', { returnToExpr: 'getCurrentAppHref()' })
        : 'null'}, editHref: ${targetResource.views.edit
          ? resourceRecordHrefExpression(targetResource.name, 'item', 'edit', { returnToExpr: 'getCurrentAppHref()' })
          : 'null'}, workflowHref: ${targetResource.workflow
            ? workflowViewHrefExpression(targetResource.name, 'item', { returnToExpr: 'getCurrentAppHref()' })
            : 'null'}, workflowStateLabel: ${targetResource.workflow
              ? workflowStateValueExpression(`item.${targetResource.workflow.program.field}`, targetResource.workflow)
              : 'null'} }))`,
      createHrefExpr: targetResource.views.create
        ? createViewHrefExpression(targetResource.name, {
          inverseFieldName: tableBinding.inverseFieldName,
          parentIdExpr: 'id',
          returnToExpr: 'getCurrentAppHref()',
        })
        : 'null',
      loadingExpr: `${tableBinding.hookName}.loading`,
      errorExpr: `Boolean(${tableBinding.hookName}.error)`,
      dependencyExprs: [tableBinding.itemsName, `${tableBinding.hookName}.loading`, `${tableBinding.hookName}.error`, 'id'],
    });
  }

  for (const metricBinding of metricBindings) {
    if (metricBinding.sourceKind !== 'recordRelationCount' || !metricBinding.relationFieldName || !metricBinding.resource || !metricBinding.model || !metricBinding.inverseFieldName) {
      continue;
    }
    if (bindings.has(metricBinding.relationFieldName)) {
      continue;
    }
    bindings.set(metricBinding.relationFieldName, {
      relationFieldName: metricBinding.relationFieldName,
      title: metricBinding.blockTitle,
      surfaceKind: 'count',
      targetResource: metricBinding.resource,
      targetModel: metricBinding.model,
      countExpr: metricBinding.countName,
      itemsExpr: 'null',
      createHrefExpr: metricBinding.resource.views.create
        ? createViewHrefExpression(metricBinding.resource.name, {
          inverseFieldName: metricBinding.inverseFieldName,
          parentIdExpr: 'id',
          returnToExpr: 'getCurrentAppHref()',
        })
        : 'null',
      loadingExpr: `${metricBinding.hookName}.loading`,
      errorExpr: `Boolean(${metricBinding.hookName}.error)`,
      dependencyExprs: [metricBinding.countName, `${metricBinding.hookName}.loading`, `${metricBinding.hookName}.error`, 'id'],
    });
  }

  return [...bindings.values()];
}

function summarizePageTableBlockDependencies(ir: IRApp, page: IRPage): unknown[] {
  return page.blocks.map((block) => {
    const analysis = analyzePageBlockData(block, ir.resources, ir.models, ir.readModels);
    if (analysis.kind !== 'resourceList') {
      if (analysis.kind === 'readModelList') {
        return {
          blockId: block.id,
          blockType: block.blockType,
          data: block.data ?? null,
          queryState: block.queryState ?? null,
          selectionState: block.selectionState ?? null,
          dateNavigation: block.dateNavigation
            ? {
              field: block.dateNavigation.field,
              prevLabel: block.dateNavigation.prevLabel ?? null,
              nextLabel: block.dateNavigation.nextLabel ?? null,
            }
            : null,
          sourceKind: analysis.kind,
          readModel: {
            id: analysis.readModel.id,
            name: analysis.readModel.name,
            api: analysis.readModel.api,
            rules: analysis.readModel.rules
              ? {
                id: analysis.readModel.rules.id,
                resolvedPath: analysis.readModel.rules.resolvedPath,
                program: analysis.readModel.rules.program,
              }
              : null,
            inputs: analysis.readModel.inputs.map((field) => ({
              id: field.id,
              name: field.name,
              fieldType: field.fieldType,
              decorators: field.decorators,
            })),
            result: analysis.readModel.result.map((field) => ({
              id: field.id,
              name: field.name,
              fieldType: field.fieldType,
              decorators: field.decorators,
            })),
          },
          list: {
            id: analysis.listView.id,
            columns: analysis.listView.columns.map((column) => ({
              id: column.id,
              field: column.field,
              decorators: column.decorators,
              customRenderer: column.customRenderer,
            })),
            pagination: analysis.listView.pagination ?? null,
          },
          rowActions: block.rowActions.map((action) => {
            const targetResource = ir.resources.find((candidate) => candidate.name === action.resource);
            const targetModel = targetResource ? ir.models.find((candidate) => candidate.name === targetResource.model) : undefined;
            return {
              id: action.id,
              action: action.action,
              resource: action.resource,
              label: action.label,
              seed: Object.entries(action.seed).map(([fieldName, value]) => ({ fieldName, value })),
              targetResource: targetResource
                ? {
                  id: targetResource.id,
                  name: targetResource.name,
                  api: targetResource.api,
                  createFields: targetResource.views.create?.fields.map((field) => ({
                    id: field.id,
                    field: field.field,
                  })) ?? [],
                }
                : null,
              targetModel: targetModel
                ? {
                  id: targetModel.id,
                  name: targetModel.name,
                  fields: targetModel.fields.map((field) => ({
                    id: field.id,
                    name: field.name,
                    fieldType: field.fieldType,
                  })),
                }
                : null,
            };
          }),
        };
      }
      if (analysis.kind === 'recordRelationList') {
        return {
          blockId: block.id,
          blockType: block.blockType,
          data: block.data ?? null,
          sourceKind: analysis.kind,
          parentResource: {
            id: analysis.resource.id,
            name: analysis.resource.name,
            api: analysis.resource.api,
            hasList: Boolean(analysis.resource.views.list),
            hasEdit: Boolean(analysis.resource.views.edit),
            hasRead: Boolean(analysis.resource.views.read),
            workflow: analysis.resource.workflow ? {
              field: analysis.resource.workflow.program.field,
              states: analysis.resource.workflow.program.states,
              wizard: analysis.resource.workflow.program.wizard,
              transitions: analysis.resource.workflow.program.transitions,
            } : null,
          },
          parentModel: {
            id: analysis.model.id,
            name: analysis.model.name,
          },
          relationField: {
            id: analysis.relationField.id,
            name: analysis.relationFieldName,
            by: analysis.relationField.fieldType.by,
          },
          resource: {
            id: analysis.targetResource.id,
            name: analysis.targetResource.name,
            api: analysis.targetResource.api,
            hasCreate: Boolean(analysis.targetResource.views.create),
            hasRead: Boolean(analysis.targetResource.views.read),
            hasEdit: Boolean(analysis.targetResource.views.edit),
            hasWorkflow: Boolean(analysis.targetResource.workflow),
          },
          model: {
            id: analysis.targetModel.id,
            name: analysis.targetModel.name,
          },
          list: analysis.listView
            ? {
              id: analysis.listView.id,
              filters: analysis.listView.filters.map((filter) => ({
                id: filter.id,
                field: filter.field,
              })),
              columns: analysis.listView.columns.map((column) => ({
                id: column.id,
                field: column.field,
                decorators: column.decorators,
                customRenderer: column.customRenderer,
              })),
              actions: analysis.listView.actions.map((action) => ({
                id: action.id,
                name: action.name,
                confirm: action.confirm ?? null,
              })),
              pagination: analysis.listView.pagination ?? null,
            }
            : null,
        };
      }
      return {
        blockId: block.id,
        blockType: block.blockType,
        data: block.data ?? null,
        analysis,
      };
    }

    return {
      blockId: block.id,
      blockType: block.blockType,
      data: block.data ?? null,
      selectionState: block.selectionState ?? null,
      resource: {
        id: analysis.resource.id,
        name: analysis.resource.name,
        api: analysis.resource.api,
        hasCreate: Boolean(analysis.resource.views.create),
        hasRead: Boolean(analysis.resource.views.read),
        hasEdit: Boolean(analysis.resource.views.edit),
        hasWorkflow: Boolean(analysis.resource.workflow),
      },
      model: {
        id: analysis.model.id,
        name: analysis.model.name,
      },
      list: {
        id: analysis.listView.id,
        filters: analysis.listView.filters.map((filter) => ({
          id: filter.id,
          field: filter.field,
        })),
        columns: analysis.listView.columns.map((column) => ({
          id: column.id,
          field: column.field,
          decorators: column.decorators,
          customRenderer: column.customRenderer,
        })),
        actions: analysis.listView.actions.map((action) => ({
          id: action.id,
          name: action.name,
          confirm: action.confirm ?? null,
        })),
        pagination: analysis.listView.pagination ?? null,
      },
    };
  });
}

function summarizePageMetricBlockDependencies(ir: IRApp, page: IRPage): unknown[] {
  const summaries: unknown[] = [];
  for (const block of page.blocks) {
    const analysis = analyzePageBlockData(block, ir.resources, ir.models, ir.readModels);
    if (analysis.kind === 'readModelCount') {
      summaries.push({
        blockId: block.id,
        blockType: block.blockType,
        data: block.data ?? null,
        sourceKind: analysis.kind,
        readModel: {
          id: analysis.readModel.id,
          name: analysis.readModel.name,
          api: analysis.readModel.api,
          rules: analysis.readModel.rules
            ? {
              id: analysis.readModel.rules.id,
              resolvedPath: analysis.readModel.rules.resolvedPath,
              program: analysis.readModel.rules.program,
            }
            : null,
          inputs: analysis.readModel.inputs.map((field) => ({
            id: field.id,
            name: field.name,
            fieldType: field.fieldType,
            decorators: field.decorators,
          })),
          result: analysis.readModel.result.map((field) => ({
            id: field.id,
            name: field.name,
            fieldType: field.fieldType,
            decorators: field.decorators,
          })),
        },
      });
      continue;
    }
    if (analysis.kind !== 'recordRelationCount') {
      continue;
    }

      summaries.push({
        blockId: block.id,
        blockType: block.blockType,
        data: block.data ?? null,
        sourceKind: analysis.kind,
        parentResource: {
          id: analysis.resource.id,
          name: analysis.resource.name,
          api: analysis.resource.api,
          hasList: Boolean(analysis.resource.views.list),
          hasEdit: Boolean(analysis.resource.views.edit),
          hasRead: Boolean(analysis.resource.views.read),
          workflow: analysis.resource.workflow ? {
            field: analysis.resource.workflow.program.field,
            states: analysis.resource.workflow.program.states,
            wizard: analysis.resource.workflow.program.wizard,
            transitions: analysis.resource.workflow.program.transitions,
          } : null,
        },
      parentModel: {
        id: analysis.model.id,
        name: analysis.model.name,
      },
      relationField: {
        id: analysis.relationField.id,
        name: analysis.relationFieldName,
        by: analysis.relationField.fieldType.by,
      },
      resource: {
        id: analysis.targetResource.id,
        name: analysis.targetResource.name,
        api: analysis.targetResource.api,
      },
      model: {
        id: analysis.targetModel.id,
        name: analysis.targetModel.name,
      },
    });
  }
  return summaries;
}

function collectRelatedPanelBindings(ir: IRApp, related: IRRelatedPanel[], model: IRModel): RelatedPanelBinding[] {
  const bindings: RelatedPanelBinding[] = [];

  for (const panel of related) {
    const modelField = model.fields.find((candidate): candidate is IRModel['fields'][number] & {
      fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
    } =>
      candidate.name === panel.field
      && candidate.fieldType.type === 'relation'
      && candidate.fieldType.kind === 'hasMany');
    if (!modelField) {
      continue;
    }

    const targetModel = ir.models.find((candidate) => candidate.name === modelField.fieldType.target);
    const targetResource = ir.resources.find((candidate) => candidate.model === modelField.fieldType.target);
    if (!targetModel || !targetResource) {
      continue;
    }

    const listView = targetResource.views.list && targetResource.views.list.columns.length > 0
      ? targetResource.views.list
      : undefined;
    const tableActions = listView
      ? [
        ...listView.actions
          .flatMap((action) => {
            if (action.name === 'view' && targetResource.views.read) {
              return ['view' as const];
            }
            if (action.name === 'edit' && targetResource.views.edit) {
              return ['edit' as const];
            }
            return [];
          }),
        ...(targetResource.workflow ? ['workflow' as const] : []),
      ]
      : [];

    bindings.push({
      panelId: panel.id,
      panelField: panel.field,
      targetModel,
      targetResource,
      inverseFieldName: modelField.fieldType.by,
      hookName: `${camelCase(panel.field)}RelatedResource`,
      itemsName: `${camelCase(panel.field)}RelatedItems`,
      filterFieldsName: listView && listView.filters.length > 0 ? `${camelCase(panel.field)}RelatedFilterFields` : undefined,
      tableColumnsName: listView ? `${camelCase(panel.field)}RelatedColumns` : undefined,
      tableDataName: listView ? `${camelCase(panel.field)}RelatedTableData` : undefined,
      tableViewName: listView ? `${camelCase(panel.field)}RelatedTableView` : undefined,
      listView,
      listProjectionBindings: listView
        ? collectListProjectionBindings(ir, [...listView.columns, ...listView.filters], targetModel, `${panel.field}Related`)
        : [],
      createAction: Boolean(listView?.actions.some((action) => action.name === 'create') && targetResource.views.create),
      deleteAction: listView?.actions.find((action) => action.name === 'delete'),
      tableActions,
      labelField: pickRelationLabelField(targetModel),
      itemHrefSource: targetResource.views.read
        ? `(item) => \`/${targetResource.name}/\${item.id}\``
        : targetResource.views.edit
          ? `(item) => \`/${targetResource.name}/\${item.id}/edit\``
          : undefined,
    });
  }

  return bindings;
}

function pickRelationLabelField(model: IRModel): string {
  const candidateFields = generatedModelFields(model);
  const emailField = candidateFields.find((field) => field.decorators.some((decorator) => decorator.name === 'email'));
  if (emailField) {
    return emailField.name;
  }
  const stringField = candidateFields.find((field) =>
    field.fieldType.type === 'scalar' && (field.fieldType.name === 'string' || field.fieldType.name === 'datetime'),
  );
  if (stringField) {
    return stringField.name;
  }
  return candidateFields[0]?.name ?? 'id';
}

function summarizeReadViewDependencies(bindings: RelatedPanelBinding[]): unknown[] {
  return bindings.map((binding) => summarizeRelatedPanelDependency(binding));
}

function summarizeRelatedPanelDependency(binding: RelatedPanelBinding): {
  panelId: string;
  panelField: string;
  targetModel: { id: string; name: string };
  targetResource: { id: string; name: string; api: string; hasRead: boolean; hasEdit: boolean; hasCreate: boolean; hasWorkflow: boolean };
  inverseFieldName: string;
  list: {
    id: string;
    filters: Array<{ id: string; field: string }>;
    columns: Array<{ id: string; field: string; decorators: IRColumn['decorators']; customRenderer?: string }>;
    actions: Array<{ id: string; name: string; confirm: string | null }>;
    pagination: IRListView['pagination'] | null;
  } | null;
} {
  return {
    panelId: binding.panelId,
    panelField: binding.panelField,
    targetModel: {
      id: binding.targetModel.id,
      name: binding.targetModel.name,
    },
    targetResource: {
      id: binding.targetResource.id,
      name: binding.targetResource.name,
      api: binding.targetResource.api,
      hasRead: Boolean(binding.targetResource.views.read),
      hasEdit: Boolean(binding.targetResource.views.edit),
      hasCreate: Boolean(binding.targetResource.views.create),
      hasWorkflow: Boolean(binding.targetResource.workflow),
    },
    inverseFieldName: binding.inverseFieldName,
    list: binding.listView
      ? {
        id: binding.listView.id,
        filters: binding.listView.filters.map((filter) => ({
          id: filter.id,
          field: filter.field,
        })),
        columns: binding.listView.columns.map((column) => ({
          id: column.id,
          field: column.field,
          decorators: column.decorators,
          customRenderer: column.customRenderer,
        })),
        actions: binding.listView.actions.map((action) => ({
          id: action.id,
          name: action.name,
          confirm: action.confirm ?? null,
        })),
        pagination: binding.listView.pagination ?? null,
      }
      : null,
  };
}

function camelCase(input: string): string {
  const parts = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return 'resource';
  }
  const [first, ...rest] = parts;
  return first.toLowerCase() + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function columnLabel(field: string): string {
  const normalized = field.includes('.') ? field.replace(/\./g, ' ') : field;
  return normalized
    .split(/[\s_]+/)
    .filter(Boolean)
    .flatMap(splitIdentifierWords)
    .map((part) => capitalize(part.toLowerCase()))
    .join(' ');
}

function splitIdentifierWords(part: string): string[] {
  return part
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

function workflowInitialState(resource: IRResource): string {
  return resource.workflow?.program.wizard?.steps[0]?.completesWith
    ?? resource.workflow?.program.states[0]?.name
    ?? '';
}

function workflowStateFieldName(resource: IRResource): string | null {
  return resource.workflow?.program.field ?? null;
}

function workflowHasWizardAllows(resource: IRResource): boolean {
  return Boolean(resource.workflow?.program.wizard?.steps.some((step) => Boolean(step.allow)));
}

function workflowHasTransitionAllows(resource: IRResource): boolean {
  return Boolean(resource.workflow?.program.transitions.some((transition) => Boolean(transition.allow)));
}

function workflowStepsRuntimeLiteral(resource: IRResource): string {
  const steps = resource.workflow?.program.wizard?.steps ?? [];
  return JSON.stringify(steps.map((step) => ({
    name: step.name,
    completesWith: step.completesWith,
    surface: step.surface,
    allow: step.allow ? { source: 'builtin', expr: step.allow } : undefined,
  })));
}

function workflowTransitionsRuntimeLiteral(resource: IRResource): string {
  const transitions = resource.workflow?.program.transitions ?? [];
  return JSON.stringify(transitions.map((transition) => ({
    name: transition.name,
    from: transition.from,
    to: transition.to,
    allow: transition.allow ? { source: 'builtin', expr: transition.allow } : undefined,
  })));
}

function workflowStateMetaRuntimeLiteral(resource: IRResource): string {
  const states = resource.workflow?.program.states ?? [];
  return JSON.stringify(states.map((state) => ({
    name: state.name,
    label: state.label ?? state.name,
    color: state.color ?? null,
  })));
}

function workflowStateMetaByNameRuntimeLiteral(resource: IRResource): string {
  const states = resource.workflow?.program.states ?? [];
  return JSON.stringify(Object.fromEntries(states.map((state) => [state.name, {
    name: state.name,
    label: state.label ?? state.name,
    color: state.color ?? null,
  }])));
}

function workflowTransitionTargetsRuntimeLiteral(resource: IRResource): string {
  const transitions = resource.workflow?.program.transitions ?? [];
  return JSON.stringify(Object.fromEntries(transitions.map((transition) => [transition.name, transition.to])));
}

function workflowStateLabelsLiteral(workflow: NonNullable<IRResource['workflow']>): string {
  return JSON.stringify(
    Object.fromEntries(workflow.program.states.map((state) => [state.name, state.label ?? state.name])),
  );
}

function workflowStepArrayTypeSource(): string {
  return `Array<import('@loj-lang/shared-contracts').WorkflowStepMetaDescriptor>`;
}

function workflowTransitionArrayTypeSource(): string {
  return `Array<import('@loj-lang/shared-contracts').WorkflowTransitionMetaDescriptor>`;
}

function workflowStateArrayTypeSource(): string {
  return `Array<import('@loj-lang/shared-contracts').WorkflowStateMetaDescriptor>`;
}

function workflowStateMapTypeSource(): string {
  return `import('@loj-lang/shared-contracts').WorkflowStateMetaDescriptorMap`;
}

function staticComponentConstName(componentName: string, suffix: string): string {
  return `${componentName}${suffix}`;
}

function generatedSectionComponentName(componentName: string, suffix: string): string {
  return `${componentName}${suffix}`;
}

function pageTitleElementConstName(componentName: string): string {
  return staticComponentConstName(componentName, 'TitleElement');
}

function pageBlockTitleElementConstName(componentName: string, blockId: string): string {
  return staticComponentConstName(componentName, `${capitalize(camelCase(blockId))}TitleElement`);
}

function pageResourceOptionsConstName(componentName: string): string {
  return staticComponentConstName(componentName, 'ResourceOptions');
}

function pageTableViewOptionsConstName(blockId: string): string {
  return `${camelCase(blockId)}TableViewOptions`;
}

function readModelOptionsConstName(baseName: string): string {
  return `${baseName}ReadModelOptions`;
}

function pageReadModelGroupByConstName(blockId: string): string {
  return `${camelCase(blockId)}GroupBy`;
}

function pageSelectionRowsByIdName(selectionStateKey: string): string {
  return `${camelCase(selectionStateKey)}RowsById`;
}

function pageSelectRowHandlerName(selectionStateKey: string): string {
  return `select${capitalize(camelCase(selectionStateKey))}Row`;
}

function pageTableActionsConstName(blockId: string): string {
  return `${camelCase(blockId)}TableActions`;
}

function componentTitleElementConstName(componentName: string): string {
  return staticComponentConstName(componentName, 'TitleElement');
}

function componentScopedTitleElementConstName(componentName: string, suffix: string): string {
  return staticComponentConstName(componentName, `${suffix}TitleElement`);
}

function componentResourceOptionsConstName(componentName: string): string {
  return staticComponentConstName(componentName, 'ResourceOptions');
}

function componentScopedTableViewOptionsConstName(componentName: string, suffix: string): string {
  return staticComponentConstName(componentName, `${suffix}TableViewOptions`);
}

function componentScopedTableActionsConstName(componentName: string, suffix: string): string {
  return staticComponentConstName(componentName, `${suffix}TableActions`);
}

function appendStaticConst(lines: string[], name: string, expression: string): void {
  lines.push(`const ${name} = ${expression};`);
}

function appendReturnToNavigationLines(
  lines: string[],
  options: { fallbackExpr: string; hrefName: 'cancelHref' | 'backHref' },
): void {
  lines.push(`  const returnToSearchParams = getLocationSearchParams();`);
  lines.push(`  const returnTo = getSanitizedReturnTo(returnToSearchParams);`);
  lines.push(`  const ${options.hrefName} = returnTo || ${options.fallbackExpr};`);
}

function workflowStateRenderSource(workflow: NonNullable<IRResource['workflow']>): string {
  const labels = workflowStateLabelsLiteral(workflow);
  return `(value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    const labels: import('@loj-lang/shared-contracts').WorkflowStateLabelMap = ${labels};
    const label = labels[String(value)];
    return label ?? String(value);
  }`;
}

function workflowStateValueExpression(valueExpr: string, workflow: NonNullable<IRResource['workflow']>): string {
  const labels = workflowStateLabelsLiteral(workflow);
  return `(() => {
    const value: unknown = ${valueExpr};
    if (value === null || value === undefined || value === '') return '—';
    const labels: import('@loj-lang/shared-contracts').WorkflowStateLabelMap = ${labels};
    const label = labels[String(value)];
    return label ?? String(value);
  })()`;
}

interface ToastMessageContext {
  form?: string;
  record?: string;
  user?: string;
  params?: Record<string, string>;
}

function generateEffectCode(
  effect: EffectNode,
  options: { routeIdExpr?: string; messageContext?: ToastMessageContext } = {},
): string {
  switch (effect.type) {
    case 'refresh':
      return `window.dispatchEvent(new CustomEvent('rdsl:refresh', { detail: { target: ${JSON.stringify(effect.target)} } }));`;
    case 'invalidate':
      return `window.dispatchEvent(new CustomEvent('rdsl:invalidate', { detail: { target: ${JSON.stringify(effect.target)} } }));`;
    case 'toast':
      return `toast.success(${toastMessageToRuntimeSource(effect.message, options.messageContext)});`;
    case 'redirect':
      return `window.location.href = ${routeTargetToRuntimeExpression(effect.target, options)};`;
    case 'openDialog':
      return `window.dispatchEvent(new CustomEvent('rdsl:open-dialog', { detail: { dialog: ${JSON.stringify(effect.dialog)} } }));`;
    case 'emitEvent':
      return `window.dispatchEvent(new CustomEvent(${JSON.stringify(effect.event)}));`;
    default:
      return `// Effect: unsupported`;
  }
}

function toastMessageToRuntimeSource(message: ToastMessageNode, context?: ToastMessageContext): string {
  if (typeof message === 'string') {
    return JSON.stringify(message);
  }

  const lines: string[] = ['{'];
  lines.push(`key: ${JSON.stringify(message.key)},`);
  if (message.defaultMessage !== undefined) {
    lines.push(`defaultMessage: ${JSON.stringify(message.defaultMessage)},`);
  }
  if (message.values && Object.keys(message.values).length > 0) {
    lines.push(`values: {`);
    for (const [name, value] of Object.entries(message.values)) {
      lines.push(`${JSON.stringify(name)}: ${toastMessageValueToRuntimeSource(value, context)},`);
    }
    lines.push(`},`);
  }
  lines.push('}');
  return lines.join(' ');
}

function messageLikeNeedsRuntimeResolver(message: MessageLikeNode): boolean {
  return typeof message !== 'string';
}

function messageLikeToRuntimeTextSource(message: MessageLikeNode): string {
  if (typeof message === 'string') {
    return JSON.stringify(message);
  }
  return `resolveMessageText(${messageDescriptorToRuntimeSource(message)})`;
}

function messageDescriptorToRuntimeSource(message: Exclude<MessageLikeNode, string>): string {
  const lines: string[] = ['{'];
  if (message.key !== undefined) {
    lines.push(`key: ${JSON.stringify(message.key)},`);
  }
  if (message.defaultMessage !== undefined) {
    lines.push(`defaultMessage: ${JSON.stringify(message.defaultMessage)},`);
  }
  if (message.values && Object.keys(message.values).length > 0) {
    lines.push(`values: {`);
    for (const [name, value] of Object.entries(message.values)) {
      lines.push(`${JSON.stringify(name)}: ${toastMessageValueToRuntimeSource(value)},`);
    }
    lines.push('},');
  }
  lines.push('}');
  return lines.join(' ');
}

function toastMessageValueToRuntimeSource(value: MessageValueNode, context?: ToastMessageContext): string {
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  ) {
    return JSON.stringify(value);
  }

  return `(${toastRefToRuntimeSource(value.ref, context)} as string | number | boolean | null | undefined)`;
}

function toastRefToRuntimeSource(ref: string, context?: ToastMessageContext): string {
  const [root, ...segments] = ref.split('.');
  if (!context) {
    return 'undefined';
  }

  switch (root) {
    case 'form':
      return buildOptionalAccessExpression(context.form, segments);
    case 'record':
      return buildOptionalAccessExpression(context.record, segments);
    case 'user':
      return buildOptionalAccessExpression(context.user, segments);
    case 'params':
      if (segments.length === 1 && context.params?.[segments[0]]) {
        return context.params[segments[0]];
      }
      return 'undefined';
    default:
      return 'undefined';
  }
}

function buildOptionalAccessExpression(base: string | undefined, segments: string[]): string {
  if (!base) {
    return 'undefined';
  }
  if (segments.length === 0) {
    return base;
  }
  const accessor = segments.map((segment) => `?.${segment}`).join('');
  return `${base}${accessor}`;
}

function exprToString(expr: ExprNode): string {
  switch (expr.type) {
    case 'literal':
      return typeof expr.value === 'string' ? `"${expr.value}"` : String(expr.value);
    case 'identifier':
      return expr.path.join('.');
    case 'binary':
      return `${exprToString(expr.left)} ${expr.op} ${exprToString(expr.right)}`;
    case 'unary':
      return `not ${exprToString(expr.operand)}`;
    case 'call':
      return `${expr.fn}(${expr.args.map(exprToString).join(', ')})`;
    case 'in':
      return `${exprToString(expr.value)} in (${expr.list.map(exprToString).join(', ')})`;
    case 'member':
      return `${exprToString(expr.object)}.${expr.property}`;
    default:
      return '?';
  }
}

function ruleValueToComment(rule: RuleValue): string {
  switch (rule.source) {
    case 'builtin':
      return `[tier 0] Expression: ${exprToString(rule.expr)}`;
    case 'escape-expr':
      return `[tier 1 @expr] ${rule.escape.raw}`;
    case 'escape-fn':
      return `[tier 2 @fn] ${formatEscapeFnDebugLabel(rule.escape)}`;
  }
}

function ruleValueToRuntimeSource(rule: RuleValue, contextExpression: string): string {
  switch (rule.source) {
    case 'builtin':
      return `can(${JSON.stringify(rule)}, ${contextExpression})`;
    case 'escape-expr':
      return `(${rule.escape.raw})`;
    case 'escape-fn':
      return `${getFunctionName(rule.escape.path)}(${contextExpression})`;
  }
}

function hasAnyRules(rules?: IRRules): boolean {
  return Boolean(rules && (rules.visibleIf || rules.enabledIf || rules.allowIf || rules.enforce));
}

function effectRefsRequireUser(effects: EffectNode[]): boolean {
  return effects.some((effect) =>
    effect.type === 'toast'
    && typeof effect.message !== 'string'
    && descriptorUsesRefRoot(effect.message, 'user')
  );
}

function descriptorUsesRefRoot(descriptor: Exclude<ToastMessageNode, string>, root: string): boolean {
  if (!descriptor.values) {
    return false;
  }

  return Object.values(descriptor.values).some((value) =>
    typeof value === 'object'
    && value !== null
    && 'ref' in value
    && value.ref.split('.')[0] === root,
  );
}

function formatEscapeFnDebugLabel(escape: EscapeFn): string {
  if (escape.lockIn === 'neutral' && escape.logicalPath) {
    return `${escape.logicalPath} -> ${escape.path} (neutral)`;
  }
  return `${escape.path} (${escape.lockIn})`;
}

/**
 * Collect @fn() import paths from rules in a view.
 * These need to be imported at the top of the generated file.
 */
function collectFnImportsFromRules(rules?: IRRules): CustomImport[] {
  if (!rules) return [];
  const imports: CustomImport[] = [];
  for (const rule of [rules.visibleIf, rules.enabledIf, rules.allowIf, rules.enforce]) {
    if (rule?.source === 'escape-fn') {
      imports.push({
        path: rule.escape.path,
        componentName: getFunctionName(rule.escape.path),
      });
    }
  }
  return imports;
}

function collectFnImportsFromFormFields(fields: IRFormField[]): CustomImport[] {
  const imports: CustomImport[] = [];
  for (const field of fields) {
    for (const rule of [field.visibleWhen, field.enabledWhen]) {
      if (rule?.source === 'escape-fn') {
        imports.push({
          path: rule.escape.path,
          componentName: getFunctionName(rule.escape.path),
        });
      }
    }
  }
  return imports;
}

function hasFormFieldReactions(fields: IRFormField[]): boolean {
  return fields.some((field) => Boolean(field.visibleWhen || field.enabledWhen));
}

function formFieldVisibleExpression(field: IRFormField, contextExpression: string): string {
  return field.visibleWhen ? ruleValueToRuntimeSource(field.visibleWhen, contextExpression) : 'true';
}

function formFieldEnabledExpression(field: IRFormField, baseEnabledExpression: string, contextExpression: string): string {
  if (!field.enabledWhen) {
    return baseEnabledExpression;
  }
  return `(${baseEnabledExpression}) && (${ruleValueToRuntimeSource(field.enabledWhen, contextExpression)})`;
}

function collectFnImportsFromNavGroups(groups: IRNavGroup[]): CustomImport[] {
  const imports: CustomImport[] = [];
  for (const group of groups) {
    if (group.visibleIf?.source === 'escape-fn') {
      imports.push({
        path: group.visibleIf.escape.path,
        componentName: getFunctionName(group.visibleIf.escape.path),
      });
    }
  }
  return imports;
}

function routeTargetToPath(target: string): string {
  const parts = target.split('.');
  if (parts[0] === 'page' && parts.length >= 2) {
    return `/${parts[1]}`;
  }
  if (parts[0] === 'resource' && parts.length >= 3) {
    return routeTargetToPath(`${parts[1]}.${parts[2]}`);
  }
  if (parts.length >= 2) {
    const [resourceName, viewName] = parts;
    if (viewName === 'list') return `/${resourceName}`;
    if (viewName === 'create') return `/${resourceName}/create`;
    if (viewName === 'edit') return `/${resourceName}/edit`;
  }
  return `/${target.replace(/\./g, '/')}`;
}

function routeTargetToHrefExpression(target: string): string {
  return `prefixAppBasePath(${JSON.stringify(routeTargetToPath(target))})`;
}

function appLocalHrefExpression(pathExpr: string): string {
  return `prefixAppBasePath(${pathExpr})`;
}

function pathWithReturnToExpression(basePathExpr: string, returnToExpr?: string): string {
  const hrefExpr = appLocalHrefExpression(basePathExpr);
  if (!returnToExpr) {
    return hrefExpr;
  }
  return `${hrefExpr} + ${JSON.stringify('?')} + ${JSON.stringify('returnTo=')} + encodeURIComponent(${returnToExpr})`;
}

function pathWithOptionalReturnToExpression(basePathExpr: string, returnToExpr: string): string {
  const hrefExpr = appLocalHrefExpression(basePathExpr);
  return `(${returnToExpr} ? ${hrefExpr} + ${JSON.stringify('?')} + ${JSON.stringify('returnTo=')} + encodeURIComponent(${returnToExpr}) : ${hrefExpr})`;
}

function pathWithWorkflowStepAndOptionalReturnToExpression(
  basePathExpr: string,
  workflowStepExpr: string,
  returnToExpr: string,
): string {
  const hrefExpr = appLocalHrefExpression(basePathExpr);
  return `(() => {
    const params = [
      ${JSON.stringify('workflowStep=')} + encodeURIComponent(${workflowStepExpr}),
      ${returnToExpr} ? ${JSON.stringify('returnTo=')} + encodeURIComponent(${returnToExpr}) : null,
    ].filter((value): value is string => Boolean(value));
    return params.length > 0 ? ${hrefExpr} + ${JSON.stringify('?')} + params.join(${JSON.stringify('&')}) : ${hrefExpr};
  })()`;
}

function resourceRecordHrefExpression(
  resourceName: string,
  recordExpr: string,
  viewName: 'read' | 'edit',
  options: { returnToExpr?: string } = {},
): string {
  const basePathExpr = viewName === 'read'
    ? `\`/${resourceName}/\${${recordExpr}.id}\``
    : `\`/${resourceName}/\${${recordExpr}.id}/edit\``;
  return pathWithReturnToExpression(basePathExpr, options.returnToExpr);
}

function workflowViewHrefExpression(
  resourceName: string,
  recordExpr: string,
  options: { returnToExpr?: string } = {},
): string {
  const basePathExpr = `\`/${resourceName}/\${${recordExpr}.id}/workflow\``;
  return pathWithReturnToExpression(basePathExpr, options.returnToExpr);
}

function workflowStepSurfaceHrefExpression(
  resource: IRResource,
  stepExpr: string,
  recordIdExpr: string,
  options: { returnToExpr?: string } = {},
): string {
  const workflowHref = pathWithReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/workflow\``, options.returnToExpr);
  const readHref = resource.views.read
    ? pathWithReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}\``, options.returnToExpr)
    : workflowHref;
  const formHref = resource.views.edit
    ? pathWithReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/edit\``, options.returnToExpr)
    : readHref;
  return `(${stepExpr}.surface === 'form' ? ${formHref} : ${stepExpr}.surface === 'read' ? ${readHref} : ${workflowHref})`;
}

function workflowStepSurfaceHrefWithOptionalReturnToExpression(
  resource: IRResource,
  stepExpr: string,
  recordIdExpr: string,
  returnToExpr: string,
): string {
  const workflowHref = pathWithOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/workflow\``, returnToExpr);
  const readHref = resource.views.read
    ? pathWithOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}\``, returnToExpr)
    : workflowHref;
  const formHref = resource.views.edit
    ? pathWithOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/edit\``, returnToExpr)
    : readHref;
  return `(${stepExpr}.surface === 'form' ? ${formHref} : ${stepExpr}.surface === 'read' ? ${readHref} : ${workflowHref})`;
}

function workflowStepSurfaceHandoffHrefExpression(
  resource: IRResource,
  stepExpr: string,
  recordIdExpr: string,
  returnToExpr: string,
): string {
  const workflowHref = pathWithWorkflowStepAndOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/workflow\``, `${stepExpr}.name`, returnToExpr);
  const readHref = resource.views.read
    ? pathWithWorkflowStepAndOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}\``, `${stepExpr}.name`, returnToExpr)
    : workflowHref;
  const formHref = resource.views.edit
    ? pathWithWorkflowStepAndOptionalReturnToExpression(`\`/${resource.name}/\${${recordIdExpr}}/edit\``, `${stepExpr}.name`, returnToExpr)
    : readHref;
  return `(${stepExpr}.surface === 'form' ? ${formHref} : ${stepExpr}.surface === 'read' ? ${readHref} : ${workflowHref})`;
}

function fallbackRecordHrefExpression(
  resource: IRResource,
  recordExpr: string,
  options: { returnToExpr?: string } = {},
): string | null {
  if (resource.views.read) {
    return resourceRecordHrefExpression(resource.name, recordExpr, 'read', options);
  }
  if (resource.views.edit) {
    return resourceRecordHrefExpression(resource.name, recordExpr, 'edit', options);
  }
  if (resource.workflow) {
    return workflowViewHrefExpression(resource.name, recordExpr, options);
  }
  return null;
}

function fallbackRecordWorkflowStateExpression(
  resource: IRResource,
  recordExpr: string,
): string | null {
  if (!resource.workflow) {
    return null;
  }
  return workflowStateValueExpression(`${recordExpr}.${resource.workflow.program.field}`, resource.workflow);
}

function createViewHrefExpression(
  resourceName: string,
  options: {
    inverseFieldName?: string;
    parentIdExpr?: string;
    returnToExpr?: string;
    seedParams?: Array<{ name: string; valueExpr: string }>;
  } = {},
): string {
  const params: string[] = [];
  if (options.inverseFieldName && options.parentIdExpr) {
    params.push(`${JSON.stringify(`${encodeURIComponent(options.inverseFieldName)}=`)} + encodeURIComponent(String(${options.parentIdExpr}))`);
  }
  for (const seedParam of options.seedParams ?? []) {
    params.push(`${JSON.stringify(`${encodeURIComponent(seedParam.name)}=`)} + encodeURIComponent(String(${seedParam.valueExpr}))`);
  }
  if (options.returnToExpr) {
    params.push(`${JSON.stringify('returnTo=')} + encodeURIComponent(${options.returnToExpr})`);
  }
  if (params.length === 0) {
    return appLocalHrefExpression(JSON.stringify(`/${resourceName}/create`));
  }
  return `${appLocalHrefExpression(JSON.stringify(`/${resourceName}/create`))} + ${JSON.stringify('?')} + ${params.join(` + ${JSON.stringify('&')} + `)}`;
}

function dashboardRowSeedValueExpression(
  value: ReadModelRowActionBinding['seed'][number]['value'],
  rowExpr: string,
  queryStateExpr: string,
): string {
  switch (value.kind) {
    case 'literal':
      return JSON.stringify(value.value);
    case 'rowField':
      return `${rowExpr}.${value.field}`;
    case 'inputField':
      return `${queryStateExpr}.${value.field}`;
    default:
      return '""';
  }
}

function pageActionSeedValueExpression(
  value: PageCreateActionBinding['seed'][number]['value'],
): string {
  switch (value.kind) {
    case 'literal':
      return JSON.stringify(value.value);
    case 'inputField':
      return `${value.queryStateName}.${value.field}`;
    case 'selectionField':
      return `${value.selectedRowName}!.${value.field}`;
    default:
      return '""';
  }
}

function pageCreateActionHrefExpression(
  action: PageCreateActionBinding,
  returnToExpr: string,
): string {
  return createViewHrefExpression(action.targetResource.name, {
    seedParams: action.seed.map((entry) => ({
      name: entry.fieldName,
      valueExpr: pageActionSeedValueExpression(entry.value),
    })),
    returnToExpr,
  });
}

function readModelRowActionHrefExpression(
  action: ReadModelRowActionBinding,
  rowExpr: string,
  queryStateExpr: string,
  returnToExpr: string,
): string {
  return createViewHrefExpression(action.targetResource.name, {
    seedParams: action.seed.map((entry) => ({
      name: entry.fieldName,
      valueExpr: dashboardRowSeedValueExpression(entry.value, rowExpr, queryStateExpr),
    })),
    returnToExpr,
  });
}

function routeTargetToRuntimeExpression(target: string, options: { routeIdExpr?: string } = {}): string {
  const parts = target.split('.');
  if (parts[0] === 'page' && parts.length >= 2) {
    return appLocalHrefExpression(JSON.stringify(`/${parts[1]}`));
  }
  if (parts[0] === 'resource' && parts.length >= 3) {
    return routeTargetToRuntimeExpression(`${parts[1]}.${parts[2]}`, options);
  }
  if (parts.length >= 2) {
    const [resourceName, viewName] = parts;
    if (viewName === 'list') return appLocalHrefExpression(JSON.stringify(`/${resourceName}`));
    if (viewName === 'create') return appLocalHrefExpression(JSON.stringify(`/${resourceName}/create`));
    if (viewName === 'edit' && options.routeIdExpr) {
      return appLocalHrefExpression(`\`/${resourceName}/\${${options.routeIdExpr}}/edit\``);
    }
  }
  return routeTargetToHrefExpression(target);
}
