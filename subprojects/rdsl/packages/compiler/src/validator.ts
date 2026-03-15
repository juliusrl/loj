/**
 * ReactDSL Validator
 *
 * Performs semantic validation on the IR:
 *  - Model references exist
 *  - Column fields exist in referenced model
 *  - Filter fields exist in referenced model
 *  - Form fields exist in referenced model
 *  - Navigation targets point to valid resources/pages
 *  - Effect targets reference known resources
 *  - Required fields are present
 */

import type { ExprNode, IRApp, IRResource, IRModel, IRRules, IRRulesLink, IREditView, IRCreateView, IRCreateInclude, IRFormField, RuleValue, EffectNode, MessageValueNode, ToastMessageDescriptorNode, IRReadModel } from './ir.js';
import { analyzePageBlockData } from './page-table-block.js';
import { analyzeRelationProjection } from './relation-projection.js';

export interface ValidationError {
  message: string;
  nodeId: string;
  severity: 'error' | 'warning';
}

export interface ValidationCacheEntry {
  signature: string;
  errors: ValidationError[];
}

export interface ValidationGlobalCacheSnapshot {
  core?: ValidationCacheEntry;
  navigation: Record<string, ValidationCacheEntry>;
}

export interface ValidationResourceCacheSnapshot {
  resource?: ValidationCacheEntry;
  list?: ValidationCacheEntry;
  edit?: ValidationCacheEntry;
  create?: ValidationCacheEntry;
  read?: ValidationCacheEntry;
}

export interface ValidationCacheSnapshot {
  version: string;
  global?: ValidationGlobalCacheSnapshot;
  resources: Record<string, ValidationResourceCacheSnapshot>;
  readModels: Record<string, ValidationCacheEntry>;
  pages: Record<string, ValidationCacheEntry>;
}

export interface ValidateOptions {
  cache?: ValidationCacheSnapshot;
  affectedNodeIds?: ReadonlySet<string>;
}

export interface ValidationResult {
  errors: ValidationError[];
  cacheSnapshot: ValidationCacheSnapshot;
}

const ROUTE_PATH_SEGMENT_PATTERN = /^(?:[A-Za-z0-9_-]+|:[A-Za-z_][A-Za-z0-9_]*)$/;

interface ValidationModelFieldSummary {
  name: string;
  fieldType: IRModel['fields'][number]['fieldType'];
}

const VALIDATION_CACHE_VERSION = '0.1.13';

export function validate(ir: IRApp): ValidationError[];
export function validate(ir: IRApp, options: ValidateOptions): ValidationResult;
export function validate(ir: IRApp, options?: ValidateOptions): ValidationError[] | ValidationResult {
  const errors: ValidationError[] = [];
  const previousCache = options?.cache?.version === VALIDATION_CACHE_VERSION
    ? options.cache
    : undefined;

  // Build lookup maps
  const modelMap = new Map<string, IRModel>();
  for (const model of ir.models) {
    modelMap.set(model.name, model);
  }

  const resourceMap = new Map<string, IRResource>();
  for (const resource of ir.resources) {
    resourceMap.set(resource.name, resource);
  }
  const readModelMap = new Map<string, IRReadModel>();
  for (const readModel of ir.readModels) {
    readModelMap.set(readModel.name, readModel);
  }

  const modelNames = ir.models.map((model) => model.name);
  const resourceNames = ir.resources.map((resource) => resource.name);
  const readModelNames = ir.readModels.map((readModel) => readModel.name);
  const pageNameList = ir.pages.map((page) => page.name);
  const pageNames = new Set(ir.pages.map(p => p.name));
  const pageMap = new Map(ir.pages.map((page) => [page.name, page]));
  const modelFieldContext = Object.fromEntries(
    ir.models.map((model) => [model.name, model.fields.map((field) => ({
      name: field.name,
      fieldType: field.fieldType,
    }))]),
  );
  const resourceContext = ir.resources.map((resource) => ({
    name: resource.name,
    model: resource.model,
    api: resource.api,
  }));

  const globalEntry = resolveValidationSegment(
    createValidationSignature({
      modelNames,
      resourceNames,
      readModelNames,
      pageNames: pageNameList,
      escapeStats: ir.escapeStats,
    }),
    previousCache?.global?.core,
    () => validateGlobal(ir),
  );
  errors.push(...globalEntry.errors);

  const navigationEntries = ir.navigation.map((group) =>
    resolveValidationSegment(
      createValidationSignature({
        targets: group.items.map((item) => item.target),
        resourceNames,
        pages: ir.pages.map((page) => ({ name: page.name, path: page.path })),
      }),
      previousCache?.global?.navigation[group.id],
      () => validateNavigationGroup(group, resourceMap, pageMap),
    )
  );
  errors.push(...navigationEntries.flatMap((entry) => entry.errors));

  const resourceEntries = ir.resources.map((resource) =>
    resolveResourceValidation(
      resource,
      modelMap,
      modelNames,
      resourceMap,
      resourceNames,
      pageNames,
      pageMap,
      pageNameList,
      modelFieldContext,
      resourceContext,
      previousCache?.resources[resource.name],
    )
  );
  errors.push(...resourceEntries.flatMap((entry) => entry.errors));

  const readModelEntries = ir.readModels.map((readModel) =>
    resolveValidationSegment(
      createValidationSignature({
        name: readModel.name,
        api: readModel.api,
        rules: readModel.rules
          ? {
            resolvedPath: readModel.rules.resolvedPath,
            program: readModel.rules.program,
          }
          : null,
        inputs: readModel.inputs.map((field) => ({
          name: field.name,
          fieldType: field.fieldType,
          decorators: field.decorators,
        })),
        result: readModel.result.map((field) => ({
          name: field.name,
          fieldType: field.fieldType,
          decorators: field.decorators,
        })),
        list: readModel.list
          ? {
            columns: readModel.list.columns.map((column) => ({
              field: column.field,
              decorators: column.decorators,
              customRenderer: Boolean(column.customRenderer),
              displayFn: Boolean(column.displayFn),
            })),
            groupBy: readModel.list.groupBy,
            pagination: readModel.list.pagination ?? null,
          }
          : null,
      }),
      previousCache?.readModels[readModel.name],
      () => validateReadModel(readModel),
    )
  );
  errors.push(...readModelEntries.flatMap((entry) => entry.errors));

  const pageEntries = ir.pages.map((page) =>
    resolveValidationSegment(
      createValidationSignature({
        name: page.name,
        title: page.title,
        path: page.path,
        blocks: page.blocks.map((block) => ({
          id: block.id,
          blockType: block.blockType,
          title: block.title,
          data: block.data,
          customBlock: block.customBlock,
        })),
        models: ir.models.map((model) => ({
          name: model.name,
          fields: model.fields.map((field) => ({
            name: field.name,
            fieldType: field.fieldType,
          })),
        })),
        resources: ir.resources.map((resource) => ({
          name: resource.name,
          model: resource.model,
          hasList: Boolean(resource.views.list),
          hasRead: Boolean(resource.views.read),
        })),
        readModels: ir.readModels.map((readModel) => ({
          name: readModel.name,
          api: readModel.api,
          hasList: Boolean(readModel.list),
          rules: readModel.rules
            ? {
              resolvedPath: readModel.rules.resolvedPath,
              program: readModel.rules.program,
            }
            : null,
          inputs: readModel.inputs.map((field) => ({
            name: field.name,
            fieldType: field.fieldType,
          })),
          result: readModel.result.map((field) => ({
            name: field.name,
            fieldType: field.fieldType,
          })),
        })),
      }),
      previousCache?.pages[page.name],
      () => validatePage(page, Array.from(resourceMap.values()), Array.from(modelMap.values()), Array.from(readModelMap.values())),
    )
  );
  errors.push(...pageEntries.flatMap((entry) => entry.errors));

  if (!options) {
    return errors;
  }

  return {
    errors,
    cacheSnapshot: {
      version: VALIDATION_CACHE_VERSION,
      global: {
        core: globalEntry.cacheEntry,
        navigation: Object.fromEntries(ir.navigation.map((group, index) => [group.id, navigationEntries[index].cacheEntry])),
      },
      resources: Object.fromEntries(ir.resources.map((resource, index) => [resource.name, resourceEntries[index].cacheSnapshot])),
      readModels: Object.fromEntries(ir.readModels.map((readModel, index) => [readModel.name, readModelEntries[index].cacheEntry])),
      pages: Object.fromEntries(ir.pages.map((page, index) => [page.name, pageEntries[index].cacheEntry])),
    },
  };
}

function resolveValidationSegment(
  signature: string,
  previous: ValidationCacheEntry | undefined,
  emit: () => ValidationError[],
): { errors: ValidationError[]; cacheEntry: ValidationCacheEntry } {
  if (previous && previous.signature === signature) {
    return {
      errors: previous.errors,
      cacheEntry: previous,
    };
  }

  const errors = emit();
  return {
    errors,
    cacheEntry: {
      signature,
      errors,
    },
  };
}

function createValidationSignature(value: unknown): string {
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

function validateGlobal(
  ir: IRApp,
): ValidationError[] {
  const errors: ValidationError[] = [];

  errors.push(...collectDuplicateErrors(ir.models, 'model'));
  errors.push(...collectDuplicateErrors(ir.resources, 'resource'));
  errors.push(...collectDuplicateErrors(ir.readModels, 'readModel'));
  errors.push(...collectDuplicateErrors(ir.pages, 'page'));
  errors.push(...collectRelationErrors(ir.models));

  if (ir.escapeStats) {
    if (ir.escapeStats.overBudget) {
      errors.push({
        message: `Escape hatch budget exceeded: ${ir.escapeStats.escapePercent}% of nodes use escape hatches (threshold: 20%). ` +
          `@expr: ${ir.escapeStats.exprCount}, @fn: ${ir.escapeStats.fnCount}, @custom: ${ir.escapeStats.customCount}. ` +
          `Consider extending the DSL schema instead.`,
        nodeId: ir.id,
        severity: 'warning',
      });
    }
  }

  return errors;
}

function validateReadModel(readModel: IRReadModel): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!readModel.api) {
    errors.push({
      message: `Read-model "${readModel.name}" has no API endpoint defined`,
      nodeId: readModel.id,
      severity: 'error',
    });
  }

  const inputNames = new Set<string>();
  for (const field of readModel.inputs) {
    validateReadModelField(readModel, field, inputNames, errors);
  }

  const resultNames = new Set<string>();
  for (const field of readModel.result) {
    validateReadModelField(readModel, field, resultNames, errors);
  }

  if (readModel.list) {
    if (readModel.list.columns.length === 0) {
      errors.push({
        message: `Read-model "${readModel.name}" list must define at least one column`,
        nodeId: readModel.list.id,
        severity: 'error',
      });
    }
    for (const column of readModel.list.columns) {
      const resultField = readModel.result.find((field) => field.name === column.field);
      if (!resultField) {
        errors.push({
          message: `Read-model "${readModel.name}" list column "${column.field}" must reference a result field`,
          nodeId: column.id,
          severity: 'error',
        });
      }
      if (column.field.includes('.')) {
        errors.push({
          message: `Read-model "${readModel.name}" list column "${column.field}" does not support relation-style projections in the current slice`,
          nodeId: column.id,
          severity: 'error',
        });
      }
      if (column.customRenderer || column.displayFn || column.dynamicLabel) {
        errors.push({
          message: `Read-model "${readModel.name}" list column "${column.field}" does not support @custom, @fn, or @expr in the current slice`,
          nodeId: column.id,
          severity: 'error',
        });
      }
    }

    if (readModel.list.groupBy.length > 0) {
      const resultFieldNames = new Set(readModel.result.map((field) => field.name));
      const columnsByField = new Map(readModel.list.columns.map((column) => [column.field, column]));
      for (const fieldName of readModel.list.groupBy) {
        if (!resultFieldNames.has(fieldName)) {
          errors.push({
            message: `Read-model "${readModel.name}" list groupBy field "${fieldName}" must reference a result field`,
            nodeId: readModel.list.id,
            severity: 'error',
          });
        }
        if (fieldName.includes('.')) {
          errors.push({
            message: `Read-model "${readModel.name}" list groupBy field "${fieldName}" does not support relation-style projections in the current slice`,
            nodeId: readModel.list.id,
            severity: 'error',
          });
        }
        const column = columnsByField.get(fieldName);
        if (!column) {
          errors.push({
            message: `Read-model "${readModel.name}" list groupBy field "${fieldName}" must also appear in list.columns`,
            nodeId: readModel.list.id,
            severity: 'error',
          });
          continue;
        }
        if (column.decorators.some((decorator) => decorator.name === 'sortable')) {
          errors.push({
            message: `Read-model "${readModel.name}" list groupBy field "${fieldName}" cannot also be @sortable in the current grouped-table slice`,
            nodeId: column.id,
            severity: 'error',
          });
        }
      }
      const nonGroupedColumns = readModel.list.columns.filter((column) => !readModel.list!.groupBy.includes(column.field));
      if (nonGroupedColumns.length === 0) {
        errors.push({
          message: `Read-model "${readModel.name}" grouped list must leave at least one non-grouped offer column`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      }
    }

    if (readModel.list.pivotBy) {
      const resultFieldNames = new Set(readModel.result.map((field) => field.name));
      const columnsByField = new Map(readModel.list.columns.map((column) => [column.field, column]));
      if (readModel.list.groupBy.length === 0) {
        errors.push({
          message: `Read-model "${readModel.name}" list pivotBy requires groupBy in the current grouped-matrix slice`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      }
      if (!resultFieldNames.has(readModel.list.pivotBy)) {
        errors.push({
          message: `Read-model "${readModel.name}" list pivotBy field "${readModel.list.pivotBy}" must reference a result field`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      }
      if (readModel.list.pivotBy.includes('.')) {
        errors.push({
          message: `Read-model "${readModel.name}" list pivotBy field "${readModel.list.pivotBy}" does not support relation-style projections in the current slice`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      }
      const pivotColumn = columnsByField.get(readModel.list.pivotBy);
      if (!pivotColumn) {
        errors.push({
          message: `Read-model "${readModel.name}" list pivotBy field "${readModel.list.pivotBy}" must also appear in list.columns`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      } else if (pivotColumn.decorators.some((decorator) => decorator.name === 'sortable')) {
        errors.push({
          message: `Read-model "${readModel.name}" list pivotBy field "${readModel.list.pivotBy}" cannot also be @sortable in the current grouped-matrix slice`,
          nodeId: pivotColumn.id,
          severity: 'error',
        });
      }
      const sortableColumns = readModel.list.columns.filter((column) => column.decorators.some((decorator) => decorator.name === 'sortable'));
      for (const column of sortableColumns) {
        errors.push({
          message: `Read-model "${readModel.name}" pivoted list column "${column.field}" cannot use @sortable in the current grouped-matrix slice`,
          nodeId: column.id,
          severity: 'error',
        });
      }
      const nonPivotColumns = readModel.list.columns.filter((column) => !readModel.list!.groupBy.includes(column.field) && column.field !== readModel.list!.pivotBy);
      if (nonPivotColumns.length === 0) {
        errors.push({
          message: `Read-model "${readModel.name}" pivoted list must leave at least one non-grouped, non-pivot offer column`,
          nodeId: readModel.list.id,
          severity: 'error',
        });
      }
    }
  }

  validateReadModelRules(readModel, errors);

  return errors;
}

function validateReadModelRules(
  readModel: IRReadModel,
  errors: ValidationError[],
): void {
  const rules = readModel.rules;
  if (!rules) {
    return;
  }

  const inputFieldNames = new Set(readModel.inputs.map((field) => field.name));
  const resultFieldMap = new Map(readModel.result.map((field) => [field.name, field]));

  if (rules.program.rules.length > 0) {
    errors.push({
      message: `Read-model "${readModel.name}" rules do not support allow/deny auth entries; keep readModel access control to local page gating in the current frontend slice`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  if (rules.program.eligibility.length === 0 && rules.program.validation.length === 0 && rules.program.derivations.length === 0) {
    errors.push({
      message: `Read-model "${readModel.name}" rules must define at least one eligibility, validate, or derive entry`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  const seenEligibility = new Set<string>();
  for (const entry of rules.program.eligibility) {
    if (seenEligibility.has(entry.name)) {
      errors.push({
        message: `Read-model "${readModel.name}" rules have duplicate eligibility entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenEligibility.add(entry.name);
    validateWorkflowExpr(
      entry.when,
      rules.id,
      errors,
      (path) => validateReadModelRulesEligibilityIdentifier(path, readModel.name, inputFieldNames),
    );
    for (const expr of entry.or) {
      validateWorkflowExpr(
        expr,
        rules.id,
        errors,
        (path) => validateReadModelRulesEligibilityIdentifier(path, readModel.name, inputFieldNames),
      );
    }
  }

  const seenValidation = new Set<string>();
  for (const entry of rules.program.validation) {
    if (seenValidation.has(entry.name)) {
      errors.push({
        message: `Read-model "${readModel.name}" rules have duplicate validate entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenValidation.add(entry.name);
    validateWorkflowExpr(
      entry.when,
      rules.id,
      errors,
      (path) => validateReadModelRulesEligibilityIdentifier(path, readModel.name, inputFieldNames),
    );
    for (const expr of entry.or) {
      validateWorkflowExpr(
        expr,
        rules.id,
        errors,
        (path) => validateReadModelRulesEligibilityIdentifier(path, readModel.name, inputFieldNames),
      );
    }
  }

  const seenDerivations = new Set<string>();
  for (const entry of rules.program.derivations) {
    if (seenDerivations.has(entry.field)) {
      errors.push({
        message: `Read-model "${readModel.name}" rules have duplicate derive entry for "${entry.field}"`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    seenDerivations.add(entry.field);
    const resultField = resultFieldMap.get(entry.field);
    if (!resultField) {
      errors.push({
        message: `Read-model "${readModel.name}" rules derive entry "${entry.field}" must target an existing result field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (resultField.fieldType.type !== 'scalar' || ['date', 'datetime'].includes(resultField.fieldType.name)) {
      errors.push({
        message: `Read-model "${readModel.name}" rules derive entry "${entry.field}" currently supports only string, text, integer, long, decimal, or boolean result fields`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    if (entry.when) {
      validateWorkflowExpr(
        entry.when,
        rules.id,
        errors,
        (path) => validateReadModelRulesDerivationIdentifier(path, readModel.name, inputFieldNames, resultFieldMap),
      );
    }
    validateWorkflowExpr(
      entry.value,
      rules.id,
      errors,
      (path) => validateReadModelRulesDerivationIdentifier(path, readModel.name, inputFieldNames, resultFieldMap),
    );
  }
}

function validateLinkedFormRules(
  resource: IRResource,
  model: IRModel | undefined,
  view: IRCreateView | IREditView,
  errors: ValidationError[],
  mode: 'create' | 'edit',
): void {
  const rules = view.rulesLink;
  if (!rules) {
    return;
  }
  if (!model) {
    return;
  }

  const viewFieldNames = new Set(view.fields.filter((field) => !field.customField).map((field) => field.field));
  const modelFieldMap = new Map(model.fields.map((field) => [field.name, field]));
  const modelFieldNames = new Set(model.fields.map((field) => field.name));
  const stateFieldName = resource.workflow?.program.field ?? null;

  if (rules.program.rules.length > 0) {
    errors.push({
      message: `Resource "${resource.name}" ${mode}.rules do not support allow/deny auth entries; keep generated form rules to eligibility, validate, and derive in the current frontend slice`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  if (rules.program.eligibility.length === 0 && rules.program.validation.length === 0 && rules.program.derivations.length === 0) {
    errors.push({
      message: `Resource "${resource.name}" ${mode}.rules must define at least one eligibility, validate, or derive entry`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  const seenEligibility = new Set<string>();
  for (const entry of rules.program.eligibility) {
    if (seenEligibility.has(entry.name)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules have duplicate eligibility entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenEligibility.add(entry.name);
    validateWorkflowExpr(
      entry.when,
      rules.id,
      errors,
      (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
    );
    for (const expr of entry.or) {
      validateWorkflowExpr(
        expr,
        rules.id,
        errors,
        (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
      );
    }
  }

  const seenValidation = new Set<string>();
  for (const entry of rules.program.validation) {
    if (seenValidation.has(entry.name)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules have duplicate validate entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenValidation.add(entry.name);
    validateWorkflowExpr(
      entry.when,
      rules.id,
      errors,
      (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
    );
    for (const expr of entry.or) {
      validateWorkflowExpr(
        expr,
        rules.id,
        errors,
        (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
      );
    }
  }

  const seenDerivations = new Set<string>();
  for (const entry of rules.program.derivations) {
    if (seenDerivations.has(entry.field)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules have duplicate derive entry for "${entry.field}"`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    seenDerivations.add(entry.field);

    const targetField = modelFieldMap.get(entry.field);
    if (!targetField) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules derive entry "${entry.field}" must target an existing model field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (!viewFieldNames.has(entry.field)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules derive entry "${entry.field}" must target a top-level generated ${mode} field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (targetField.fieldType.type !== 'scalar') {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules derive entry "${entry.field}" currently supports only scalar generated form fields`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (stateFieldName && entry.field === stateFieldName) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.rules derive entry "${entry.field}" cannot target the workflow-controlled state field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (entry.when) {
      validateWorkflowExpr(
        entry.when,
        rules.id,
        errors,
        (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
      );
    }
    validateWorkflowExpr(
      entry.value,
      rules.id,
      errors,
      (path) => validateLinkedFormRulesIdentifier(path, resource.name, mode, modelFieldNames),
    );
  }
}

function validateLinkedFormIncludeRules(
  resource: IRResource,
  parentModel: IRModel,
  include: IRCreateInclude,
  targetModel: IRModel,
  errors: ValidationError[],
  mode: 'create' | 'edit',
): void {
  const rules = include.rulesLink;
  if (!rules) {
    return;
  }

  const parentModelFieldNames = new Set<string>(parentModel.fields.map((field) => field.name));
  const includeFieldNames = new Set<string>(include.fields.filter((field) => !field.customField).map((field) => field.field));
  const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));

  if (rules.program.rules.length > 0) {
    errors.push({
      message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules do not support allow/deny auth entries; keep repeated-child generated rules to eligibility, validate, and derive in the current frontend slice`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  if (rules.program.eligibility.length === 0 && rules.program.validation.length === 0 && rules.program.derivations.length === 0) {
    errors.push({
      message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules must define at least one eligibility, validate, or derive entry`,
      nodeId: rules.id,
      severity: 'error',
    });
  }

  const validateIdentifier = (path: string[]) =>
    validateLinkedFormIncludeRulesIdentifier(path, resource.name, include.field, mode, parentModelFieldNames, includeFieldNames);

  const seenEligibility = new Set<string>();
  for (const entry of rules.program.eligibility) {
    if (seenEligibility.has(entry.name)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules have duplicate eligibility entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenEligibility.add(entry.name);
    validateWorkflowExpr(entry.when, rules.id, errors, validateIdentifier);
    for (const expr of entry.or) {
      validateWorkflowExpr(expr, rules.id, errors, validateIdentifier);
    }
  }

  const seenValidation = new Set<string>();
  for (const entry of rules.program.validation) {
    if (seenValidation.has(entry.name)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules have duplicate validate entry "${entry.name}"`,
        nodeId: rules.id,
        severity: 'error',
      });
    }
    seenValidation.add(entry.name);
    validateWorkflowExpr(entry.when, rules.id, errors, validateIdentifier);
    for (const expr of entry.or) {
      validateWorkflowExpr(expr, rules.id, errors, validateIdentifier);
    }
  }

  const seenDerivations = new Set<string>();
  for (const entry of rules.program.derivations) {
    if (seenDerivations.has(entry.field)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules have duplicate derive entry for "${entry.field}"`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    seenDerivations.add(entry.field);

    const targetField = targetFieldMap.get(entry.field);
    if (!targetField) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules derive entry "${entry.field}" must target an existing related model field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (!includeFieldNames.has(entry.field)) {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules derive entry "${entry.field}" must target a generated repeated-child field`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (targetField.fieldType.type !== 'scalar') {
      errors.push({
        message: `Resource "${resource.name}" ${mode}.includes.${include.field}.rules derive entry "${entry.field}" currently supports only scalar repeated-child fields`,
        nodeId: rules.id,
        severity: 'error',
      });
      continue;
    }
    if (entry.when) {
      validateWorkflowExpr(entry.when, rules.id, errors, validateIdentifier);
    }
    validateWorkflowExpr(entry.value, rules.id, errors, validateIdentifier);
  }
}

function validateReadModelField(
  readModel: IRReadModel,
  field: IRReadModel['inputs'][number] | IRReadModel['result'][number],
  seen: Set<string>,
  errors: ValidationError[],
): void {
  if (seen.has(field.name)) {
    errors.push({
      message: `Duplicate ${field.section} field "${field.name}" in read-model "${readModel.name}"`,
      nodeId: field.id,
      severity: 'error',
    });
    return;
  }
  seen.add(field.name);

  if (field.fieldType.type === 'relation') {
    errors.push({
      message: `Read-model "${readModel.name}" ${field.section} field "${field.name}" currently supports only scalar or enum types`,
      nodeId: field.id,
      severity: 'error',
    });
  }
}

function collectRelationErrors(models: IRModel[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const modelMap = new Map(models.map((model) => [model.name, model]));
  for (const model of models) {
    for (const field of model.fields) {
      if (field.fieldType.type !== 'relation') {
        continue;
      }
      const targetModel = modelMap.get(field.fieldType.target);
      if (!targetModel) {
        errors.push({
          message: `Field "${field.name}" in model "${model.name}" references unknown relation target "${field.fieldType.target}"`,
          nodeId: field.id,
          severity: 'error',
        });
        continue;
      }
      const relationField = field.fieldType;
      if (relationField.kind !== 'hasMany') {
        continue;
      }
      if (field.decorators.length > 0) {
        errors.push({
          message: `Field "${field.name}" in model "${model.name}" is a hasMany() inverse relation and does not support field decorators`,
          nodeId: field.id,
          severity: 'error',
        });
      }
      const inverseField = targetModel.fields.find((candidate) => candidate.name === relationField.by);
      if (!inverseField) {
        errors.push({
          message: `Field "${field.name}" in model "${model.name}" references missing inverse field "${relationField.by}" on model "${targetModel.name}"`,
          nodeId: field.id,
          severity: 'error',
        });
        continue;
      }
      if (
        inverseField.fieldType.type !== 'relation'
        || inverseField.fieldType.kind !== 'belongsTo'
        || inverseField.fieldType.target !== model.name
      ) {
        errors.push({
          message: `Field "${field.name}" in model "${model.name}" must reference a belongsTo(${model.name}) field via by: "${relationField.by}" on model "${targetModel.name}"`,
          nodeId: field.id,
          severity: 'error',
        });
      }
    }
  }
  return errors;
}

function resolveResourceValidation(
  resource: IRResource,
  modelMap: Map<string, IRModel>,
  modelNames: string[],
  resourceMap: Map<string, IRResource>,
  resourceNames: string[],
  pageNames: Set<string>,
  pageMap: Map<string, IRApp['pages'][number]>,
  pageNameList: string[],
  modelFieldContext: Record<string, ValidationModelFieldSummary[]>,
  resourceContext: Array<{ name: string; model: string; api: string }>,
  previous: ValidationResourceCacheSnapshot | undefined,
): {
  errors: ValidationError[];
  cacheSnapshot: ValidationResourceCacheSnapshot;
} {
  const resourceEntry = resolveValidationSegment(
      createValidationSignature({
        name: resource.name,
        model: resource.model,
        api: resource.api,
        workflow: resource.workflow ? {
          model: resource.workflow.program.model,
          field: resource.workflow.program.field,
          states: resource.workflow.program.states,
          wizard: resource.workflow.program.wizard,
          transitions: resource.workflow.program.transitions,
        } : null,
        modelNames,
      }),
    previous?.resource,
    () => validateResourceBase(resource, modelMap),
  );
  const listEntry = resource.views.list
    ? resolveValidationSegment(
      createValidationSignature({
        modelFields: modelFieldContext[resource.model] ?? null,
        relationModelFields: resource.views.list.columns.some((column) => column.field.includes('.'))
          ? modelFieldContext
          : null,
        resources: resource.views.list.columns.some((column) => column.field.includes('.'))
          ? resourceContext
          : null,
        filters: resource.views.list.filters.map((filter) => filter.field),
        columns: resource.views.list.columns.map((column) => ({
          field: column.field,
          customRenderer: Boolean(column.customRenderer),
        })),
        rules: resource.views.list.rules ?? null,
      }),
      previous?.list,
      () => validateListView(resource, modelMap.get(resource.model), resource.views.list!, Array.from(modelMap.values()), Array.from(resourceMap.values())),
    )
    : undefined;
  const editEntry = resource.views.edit
    ? resolveValidationSegment(
      createValidationSignature({
        modelFields: modelFieldContext[resource.model] ?? null,
        fields: resource.views.edit.fields.map((field) => ({
          field: field.field,
          customField: Boolean(field.customField),
          visibleWhen: field.visibleWhen ?? null,
          enabledWhen: field.enabledWhen ?? null,
        })),
        includes: resource.views.edit.includes.map((include) => ({
          field: include.field,
          minItems: include.minItems,
          rulesLink: include.rulesLink
            ? {
              resolvedPath: include.rulesLink.resolvedPath,
              program: include.rulesLink.program,
            }
            : null,
          fields: include.fields.map((field) => ({
            field: field.field,
            customField: Boolean(field.customField),
            visibleWhen: field.visibleWhen ?? null,
            enabledWhen: field.enabledWhen ?? null,
          })),
        })),
        rules: resource.views.edit.rules ?? null,
        rulesLink: resource.views.edit.rulesLink
          ? {
            resolvedPath: resource.views.edit.rulesLink.resolvedPath,
            program: resource.views.edit.rulesLink.program,
          }
          : null,
        onSuccess: resource.views.edit.onSuccess,
        resourceNames,
        pageNames: pageNameList,
      }),
      previous?.edit,
      () => validateEditView(resource, modelMap.get(resource.model), modelMap, resourceMap, pageMap),
    )
    : undefined;
  const createEntry = resource.views.create
    ? resolveValidationSegment(
      createValidationSignature({
        modelFields: modelFieldContext[resource.model] ?? null,
        fields: resource.views.create.fields.map((field) => ({
          field: field.field,
          customField: Boolean(field.customField),
          visibleWhen: field.visibleWhen ?? null,
          enabledWhen: field.enabledWhen ?? null,
        })),
        includes: resource.views.create.includes.map((include) => ({
          field: include.field,
          minItems: include.minItems,
          rulesLink: include.rulesLink
            ? {
              resolvedPath: include.rulesLink.resolvedPath,
              program: include.rulesLink.program,
            }
            : null,
          fields: include.fields.map((field) => ({
            field: field.field,
            customField: Boolean(field.customField),
            visibleWhen: field.visibleWhen ?? null,
            enabledWhen: field.enabledWhen ?? null,
          })),
        })),
        rules: resource.views.create.rules ?? null,
        rulesLink: resource.views.create.rulesLink
          ? {
            resolvedPath: resource.views.create.rulesLink.resolvedPath,
            program: resource.views.create.rulesLink.program,
          }
          : null,
        onSuccess: resource.views.create.onSuccess,
        resourceNames,
        pageNames: pageNameList,
      }),
      previous?.create,
      () => validateCreateView(resource, modelMap.get(resource.model), modelMap, resourceMap, pageMap),
    )
    : undefined;
  const readEntry = resource.views.read
    ? resolveValidationSegment(
      createValidationSignature({
        modelFields: modelFieldContext[resource.model] ?? null,
        relationModelFields: resource.views.read.fields.some((field) => field.field.includes('.'))
          ? modelFieldContext
          : null,
        resources: resourceContext,
        fields: resource.views.read.fields.map((field) => ({
          field: field.field,
          decorators: field.decorators.map((decorator) => decorator.name),
          customRenderer: Boolean(field.customRenderer),
        })),
        related: resource.views.read.related.map((panel) => panel.field),
      }),
      previous?.read,
      () => validateReadView(resource, modelMap.get(resource.model), Array.from(modelMap.values()), Array.from(resourceMap.values())),
    )
    : undefined;

  return {
    errors: [
      ...resourceEntry.errors,
      ...(listEntry?.errors ?? []),
      ...(editEntry?.errors ?? []),
      ...(createEntry?.errors ?? []),
      ...(readEntry?.errors ?? []),
    ],
    cacheSnapshot: {
      resource: resourceEntry.cacheEntry,
      list: listEntry?.cacheEntry,
      edit: editEntry?.cacheEntry,
      create: createEntry?.cacheEntry,
      read: readEntry?.cacheEntry,
    },
  };
}

function validateNavigationGroup(
  group: IRApp['navigation'][number],
  resourceMap: Map<string, IRResource>,
  pageMap: Map<string, IRApp['pages'][number]>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const item of group.items) {
    validateNavTarget(item.target, item.id, resourceMap, pageMap, errors);
  }
  return errors;
}

function validateResourceBase(
  resource: IRResource,
  modelMap: Map<string, IRModel>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const model = modelMap.get(resource.model);
  if (!model) {
    errors.push({
      message: `Resource "${resource.name}" references unknown model "${resource.model}"`,
      nodeId: resource.id,
      severity: 'error',
    });
  }

  if (!resource.api) {
    errors.push({
      message: `Resource "${resource.name}" has no API endpoint defined`,
      nodeId: resource.id,
      severity: 'error',
    });
  }

  if (model && resource.workflow) {
    if (resource.workflow.program.model !== model.name) {
      errors.push({
        message: `Resource "${resource.name}" workflow model "${resource.workflow.program.model}" must match resource model "${model.name}"`,
        nodeId: resource.workflow.id,
        severity: 'error',
      });
    }

    const stateField = model.fields.find((field) => field.name === resource.workflow!.program.field);
    if (!stateField) {
      errors.push({
        message: `Resource "${resource.name}" workflow field "${resource.workflow.program.field}" not found in model "${model.name}"`,
        nodeId: resource.workflow.id,
        severity: 'error',
      });
      return errors;
    }
    if (stateField.fieldType.type !== 'enum') {
      errors.push({
        message: `Resource "${resource.name}" workflow field "${resource.workflow.program.field}" in model "${model.name}" must be an enum(...) field`,
        nodeId: resource.workflow.id,
        severity: 'error',
      });
      return errors;
    }

    const enumValues = new Set(stateField.fieldType.values);
    const workflowStates = new Set(resource.workflow.program.states.map((state) => state.name));
    for (const state of resource.workflow.program.states) {
      if (!enumValues.has(state.name)) {
        errors.push({
          message: `Resource "${resource.name}" workflow state "${state.name}" is not declared in model ${model.name}.${stateField.name}`,
          nodeId: resource.workflow.id,
          severity: 'error',
        });
      }
    }
    for (const enumValue of stateField.fieldType.values) {
      if (!workflowStates.has(enumValue)) {
        errors.push({
          message: `Resource "${resource.name}" workflow must declare enum state "${enumValue}" from model ${model.name}.${stateField.name}`,
          nodeId: resource.workflow.id,
          severity: 'error',
        });
      }
    }

    const modelFieldNames = new Set(model.fields.map((field) => field.name));
    for (const step of resource.workflow.program.wizard?.steps ?? []) {
      if (!step.allow) {
        continue;
      }
      validateWorkflowExpr(
        step.allow,
        resource.workflow.id,
        errors,
        (path) => validateWorkflowStepIdentifier(path, resource.name, modelFieldNames),
      );
    }
    for (const transition of resource.workflow.program.transitions) {
      if (!transition.allow) {
        continue;
      }
      validateWorkflowExpr(
        transition.allow,
        resource.workflow.id,
        errors,
        (path) => validateWorkflowTransitionIdentifier(path, resource.name, modelFieldNames),
      );
    }
  }

  return errors;
}

function validateListView(
  resource: IRResource,
  model: IRModel | undefined,
  view: NonNullable<IRResource['views']['list']>,
  models: IRModel[],
  resources: IRResource[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!model) {
    validateViewRulePaths(view.id, view.rules, errors);
    return errors;
  }

  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
  for (const col of view.columns) {
    const relationProjection = analyzeRelationProjection(col.field, model, models, resources);
    if (relationProjection.kind !== 'none') {
      if (relationProjection.kind === 'invalid' && !col.customRenderer) {
        errors.push({
          message: formatRelationProjectionError('Column', resource, relationProjection),
          nodeId: col.id,
          severity: 'error',
        });
      }
      continue;
    }
    const modelField = fieldMap.get(col.field);
    if (!modelField && !col.customRenderer) {
      errors.push({
        message: `Column "${col.field}" not found in model "${resource.model}"`,
        nodeId: col.id,
        severity: 'error',
      });
    } else if (modelField && isInverseRelationField(modelField) && !col.customRenderer) {
      errors.push({
        message: `Column "${col.field}" in model "${resource.model}" references inverse relation metadata directly; use "${col.field}.count" for a read-only projection`,
        nodeId: col.id,
        severity: 'error',
      });
    }
  }

  for (const filter of view.filters) {
    const relationProjection = analyzeRelationProjection(filter.field, model, models, resources);
    if (relationProjection.kind !== 'none') {
      if (relationProjection.kind === 'invalid') {
        errors.push({
          message: formatRelationProjectionError('Filter field', resource, relationProjection),
          nodeId: filter.id,
          severity: 'error',
        });
      }
      continue;
    }
    const modelField = fieldMap.get(filter.field);
    if (!modelField) {
      errors.push({
        message: `Filter field "${filter.field}" not found in model "${resource.model}"`,
        nodeId: filter.id,
        severity: 'error',
      });
    } else if (isInverseRelationField(modelField)) {
      errors.push({
        message: `Filter field "${filter.field}" in model "${resource.model}" references inverse relation metadata directly; use "${filter.field}.count" for a relation-derived filter`,
        nodeId: filter.id,
        severity: 'error',
      });
    }
  }

  for (const action of view.actions) {
    if (action.name === 'view' && !resource.views.read) {
      errors.push({
        message: `List action "view" in resource "${resource.name}" requires a read: view`,
        nodeId: action.id,
        severity: 'error',
      });
    }
  }

  validateViewRulePaths(view.id, view.rules, errors);
  return errors;
}

function validateEditView(
  resource: IRResource,
  model: IRModel | undefined,
  modelMap: Map<string, IRModel>,
  resourceMap: Map<string, IRResource>,
  pageMap: Map<string, IRApp['pages'][number]>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const view = resource.views.edit;
  if (!view) {
    return errors;
  }

  if (model) {
    const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
    const modelFieldNames = new Set(model.fields.map((field) => field.name));
    for (const field of view.fields) {
      const modelField = fieldMap.get(field.field);
      if (!modelField && !field.customField) {
        errors.push({
          message: `Edit field "${field.field}" not found in model "${resource.model}"`,
          nodeId: field.id,
          severity: 'error',
        });
      } else if (modelField && isInverseRelationField(modelField) && !field.customField) {
        errors.push({
          message: `Edit field "${field.field}" in model "${resource.model}" references inverse relation metadata and cannot be used in generated forms yet`,
          nodeId: field.id,
          severity: 'error',
        });
      } else if (resource.workflow && modelField?.name === resource.workflow.program.field && !field.customField) {
        errors.push({
          message: `Edit field "${field.field}" in model "${resource.model}" is controlled by resource workflow and cannot be edited directly in generated forms`,
          nodeId: field.id,
          severity: 'error',
        });
      }
      validateFormFieldRulePaths(field, errors);
      validateFormFieldRules(
        field,
        errors,
        (path) => validateEditFieldIdentifier(path, resource.name, modelFieldNames),
      );
    }

    for (const include of view.includes) {
      if (!Number.isInteger(include.minItems) || include.minItems < 0) {
        errors.push({
          message: `Edit include "${include.field}" in model "${resource.model}" minItems must be a non-negative integer`,
          nodeId: include.id,
          severity: 'error',
        });
      }
      const relationField = fieldMap.get(include.field);
      if (!relationField) {
        errors.push({
          message: `Edit include "${include.field}" not found in model "${resource.model}"`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }
      if (!isInverseRelationField(relationField)) {
        errors.push({
          message: `Edit include "${include.field}" in model "${resource.model}" must reference a hasMany(..., by: ...) field`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }

      const targetModel = modelMap.get(relationField.fieldType.target);
      if (!targetModel) {
        errors.push({
          message: `Edit include "${include.field}" in model "${resource.model}" references unknown related model "${relationField.fieldType.target}"`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }

      const targetResource = Array.from(resourceMap.values()).find((candidate) => candidate.model === targetModel.name);
      if (!targetResource) {
        errors.push({
          message: `Edit include "${include.field}" in model "${resource.model}" requires a generated resource for related model "${targetModel.name}"`,
          nodeId: include.id,
          severity: 'error',
        });
      }

      const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
      const targetFieldNames = new Set(targetModel.fields.map((field) => field.name));
      for (const nestedField of include.fields) {
        const targetField = targetFieldMap.get(nestedField.field);
        if (!targetField && !nestedField.customField) {
          errors.push({
            message: `Edit include field "${nestedField.field}" not found in related model "${targetModel.name}"`,
            nodeId: nestedField.id,
            severity: 'error',
          });
          continue;
        }
        if (!targetField || nestedField.customField) {
          continue;
        }
        if (targetField.name === relationField.fieldType.by) {
          errors.push({
            message: `Edit include field "${nestedField.field}" in related model "${targetModel.name}" is the inverse belongsTo(${model.name}) field and is seeded automatically`,
            nodeId: nestedField.id,
            severity: 'error',
          });
          continue;
        }
        if (isInverseRelationField(targetField)) {
          errors.push({
            message: `Edit include field "${nestedField.field}" in related model "${targetModel.name}" references inverse relation metadata and cannot be nested again in the current slice`,
            nodeId: nestedField.id,
            severity: 'error',
          });
        }
        validateFormFieldRulePaths(nestedField, errors);
        validateFormFieldRules(
          nestedField,
          errors,
          (path) => validateEditIncludeFieldIdentifier(path, resource.name, targetFieldNames),
        );
      }
      validateLinkedFormIncludeRules(resource, model, include, targetModel, errors, 'edit');
    }
  }

  for (const effect of view.onSuccess) {
    if (effect.type === 'refresh' && !resourceMap.has(effect.target)) {
      errors.push({
        message: `Refresh target "${effect.target}" is not a known resource`,
        nodeId: view.id,
        severity: 'warning',
      });
    }
    if (effect.type === 'redirect') {
      validateRouteTarget(effect.target, view.id, resourceMap, pageMap, errors);
    }
    validateToastEffect(effect, {
      nodeId: view.id,
      viewName: 'edit',
      model,
      allowRecord: true,
      allowForm: true,
      allowUser: true,
      allowedParams: new Set(['id']),
    }, errors);
  }

  validateViewRulePaths(view.id, view.rules, errors);
  validateLinkedFormRules(resource, model, view, errors, 'edit');
  return errors;
}

function validateCreateView(
  resource: IRResource,
  model: IRModel | undefined,
  modelMap: Map<string, IRModel>,
  resourceMap: Map<string, IRResource>,
  pageMap: Map<string, IRApp['pages'][number]>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const view = resource.views.create;
  if (!view) {
    return errors;
  }

  if (model) {
    const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
    const modelFieldNames = new Set(model.fields.map((field) => field.name));
    for (const field of view.fields) {
      const modelField = fieldMap.get(field.field);
      if (!modelField && !field.customField) {
        errors.push({
          message: `Create field "${field.field}" not found in model "${resource.model}"`,
          nodeId: field.id,
          severity: 'error',
        });
      } else if (modelField && isInverseRelationField(modelField) && !field.customField) {
        errors.push({
          message: `Create field "${field.field}" in model "${resource.model}" references inverse relation metadata and cannot be used in generated forms yet`,
          nodeId: field.id,
          severity: 'error',
        });
      } else if (resource.workflow && modelField?.name === resource.workflow.program.field && !field.customField) {
        errors.push({
          message: `Create field "${field.field}" in model "${resource.model}" is controlled by resource workflow and cannot be edited directly in generated forms`,
          nodeId: field.id,
          severity: 'error',
        });
      }
      validateFormFieldRulePaths(field, errors);
      validateFormFieldRules(
        field,
        errors,
        (path) => validateCreateFieldIdentifier(path, resource.name, modelFieldNames),
      );
    }

    for (const include of view.includes) {
      if (!Number.isInteger(include.minItems) || include.minItems < 0) {
        errors.push({
          message: `Create include "${include.field}" in model "${resource.model}" minItems must be a non-negative integer`,
          nodeId: include.id,
          severity: 'error',
        });
      }
      const relationField = fieldMap.get(include.field);
      if (!relationField) {
        errors.push({
          message: `Create include "${include.field}" not found in model "${resource.model}"`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }
      if (!isInverseRelationField(relationField)) {
        errors.push({
          message: `Create include "${include.field}" in model "${resource.model}" must reference a hasMany(..., by: ...) field`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }

      const targetModel = modelMap.get(relationField.fieldType.target);
      if (!targetModel) {
        errors.push({
          message: `Create include "${include.field}" in model "${resource.model}" references unknown related model "${relationField.fieldType.target}"`,
          nodeId: include.id,
          severity: 'error',
        });
        continue;
      }

      const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
      const targetFieldNames = new Set(targetModel.fields.map((field) => field.name));
      for (const nestedField of include.fields) {
        const targetField = targetFieldMap.get(nestedField.field);
        if (!targetField && !nestedField.customField) {
          errors.push({
            message: `Create include field "${nestedField.field}" not found in related model "${targetModel.name}"`,
            nodeId: nestedField.id,
            severity: 'error',
          });
          continue;
        }
        if (!targetField || nestedField.customField) {
          continue;
        }
        if (targetField.name === relationField.fieldType.by) {
          errors.push({
            message: `Create include field "${nestedField.field}" in related model "${targetModel.name}" is the inverse belongsTo(${model.name}) field and is seeded automatically`,
            nodeId: nestedField.id,
            severity: 'error',
          });
          continue;
        }
        if (isInverseRelationField(targetField)) {
          errors.push({
            message: `Create include field "${nestedField.field}" in related model "${targetModel.name}" references inverse relation metadata and cannot be nested again in the current slice`,
            nodeId: nestedField.id,
            severity: 'error',
          });
        }
        validateFormFieldRulePaths(nestedField, errors);
        validateFormFieldRules(
          nestedField,
          errors,
          (path) => validateCreateIncludeFieldIdentifier(path, resource.name, targetFieldNames),
        );
      }
      validateLinkedFormIncludeRules(resource, model, include, targetModel, errors, 'create');
    }
  }

  for (const effect of view.onSuccess) {
    if (effect.type === 'redirect') {
      validateRouteTarget(effect.target, view.id, resourceMap, pageMap, errors);
    }
    validateToastEffect(effect, {
      nodeId: view.id,
      viewName: 'create',
      model,
      allowRecord: false,
      allowForm: true,
      allowUser: true,
      allowedParams: new Set<string>(),
    }, errors);
  }

  validateViewRulePaths(view.id, view.rules, errors);
  validateLinkedFormRules(resource, model, view, errors, 'create');
  return errors;
}

function validateReadView(
  resource: IRResource,
  model: IRModel | undefined,
  models: IRModel[],
  resources: IRResource[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const view = resource.views.read;
  if (!view || !model) {
    return errors;
  }

  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
  for (const field of view.fields) {
    if (field.decorators.some((decorator) => decorator.name === 'sortable')) {
      errors.push({
        message: `Read field "${field.field}" in model "${resource.model}" cannot use @sortable`,
        nodeId: field.id,
        severity: 'error',
      });
    }

    const relationProjection = analyzeRelationProjection(field.field, model, models, resources);
    if (relationProjection.kind !== 'none') {
      if (relationProjection.kind === 'invalid' && !field.customRenderer) {
        errors.push({
          message: formatRelationProjectionError('Read field', resource, relationProjection),
          nodeId: field.id,
          severity: 'error',
        });
      }
      continue;
    }

    const modelField = fieldMap.get(field.field);
    if (!modelField && !field.customRenderer) {
      errors.push({
        message: `Read field "${field.field}" not found in model "${resource.model}"`,
        nodeId: field.id,
        severity: 'error',
      });
    } else if (modelField && isInverseRelationField(modelField) && !field.customRenderer) {
      errors.push({
        message: `Read field "${field.field}" in model "${resource.model}" references inverse relation metadata directly; use "${field.field}.count" or move it under related:`,
        nodeId: field.id,
        severity: 'error',
      });
    }
  }

  for (const panel of view.related) {
    const modelField = fieldMap.get(panel.field);
    if (!modelField) {
      errors.push({
        message: `Related panel "${panel.field}" not found in model "${resource.model}"`,
        nodeId: panel.id,
        severity: 'error',
      });
      continue;
    }
    if (!isInverseRelationField(modelField)) {
      errors.push({
        message: `Related panel "${panel.field}" in model "${resource.model}" must reference a hasMany(..., by: ...) field`,
        nodeId: panel.id,
        severity: 'error',
      });
      continue;
    }
    const relationField = modelField.fieldType;
    const targetResource = resources.find((candidate) => candidate.model === relationField.target);
    if (!targetResource) {
      errors.push({
        message: `Related panel "${panel.field}" in model "${resource.model}" requires a resource for related model "${relationField.target}"`,
        nodeId: panel.id,
        severity: 'error',
      });
    }
  }

  return errors;
}

interface ToastValidationContext {
  nodeId: string;
  viewName: 'edit' | 'create';
  model: IRModel | undefined;
  allowRecord: boolean;
  allowForm: boolean;
  allowUser: boolean;
  allowedParams: ReadonlySet<string>;
}

function validateToastEffect(
  effect: EffectNode,
  context: ToastValidationContext,
  errors: ValidationError[],
): void {
  if (effect.type !== 'toast' || typeof effect.message === 'string') {
    return;
  }

  validateToastDescriptor(effect.message, context, errors);
}

function isInverseRelationField(
  field: IRModel['fields'][number],
): field is IRModel['fields'][number] & { fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string } } {
  return field.fieldType.type === 'relation' && field.fieldType.kind === 'hasMany';
}

function formatRelationProjectionError(
  subject: 'Column' | 'Filter field' | 'Read field',
  resource: IRResource,
  analysis: Exclude<ReturnType<typeof analyzeRelationProjection>, { kind: 'none' | 'belongsToField' | 'hasManyCount' }>,
): string {
  switch (analysis.reason) {
    case 'unsupportedPathShape':
      return `${subject} "${analysis.field}" in model "${resource.model}" must use a single relation hop like "team.name" or "members.count"`;
    case 'unknownRootField':
      return `${subject} "${analysis.field}" not found in model "${resource.model}"; relation projections must start from a declared relation field`;
    case 'rootFieldNotRelation':
      return `${subject} "${analysis.field}" in model "${resource.model}" must start from a relation field before projecting`;
    case 'targetModelMissing':
      return `${subject} "${analysis.field}" in model "${resource.model}" references unknown relation target "${analysis.rootField?.fieldType.type === 'relation' ? analysis.rootField.fieldType.target : analysis.rootFieldName}"`;
    case 'targetResourceMissing':
      return `${subject} "${analysis.field}" in model "${resource.model}" requires a resource for related model "${analysis.targetModel?.name}" to drive relation projection`;
    case 'unsupportedHasManyLeaf':
      return `${subject} "${analysis.field}" in model "${resource.model}" only supports hasMany(...).count projections in generated ${subject === 'Read field' ? 'read surfaces' : 'lists'}`;
    case 'unknownTargetField':
      return `${subject} "${analysis.field}" in model "${resource.model}" references unknown field "${analysis.leafFieldName}" on related model "${analysis.targetModel?.name}"`;
    case 'unsupportedTargetField':
      return `${subject} "${analysis.field}" in model "${resource.model}" can only project scalar or enum fields from belongsTo(${analysis.targetModel?.name}); nested relation chains are not supported`;
  }
}

function validateToastDescriptor(
  descriptor: ToastMessageDescriptorNode,
  context: ToastValidationContext,
  errors: ValidationError[],
): void {
  if (!descriptor.key || descriptor.key.trim().length === 0) {
    errors.push({
      message: 'toast descriptor key must be a non-empty string',
      nodeId: context.nodeId,
      severity: 'error',
    });
  }

  if (!descriptor.values) {
    return;
  }

  for (const [name, value] of Object.entries(descriptor.values)) {
    validateToastMessageValue(name, value, context, errors);
  }
}

function validateToastMessageValue(
  name: string,
  value: MessageValueNode,
  context: ToastValidationContext,
  errors: ValidationError[],
): void {
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  ) {
    return;
  }

  const ref = value.ref.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(ref)) {
    errors.push({
      message: `toast.values.${name} ref "${value.ref}" must be a dotted path like form.name`,
      nodeId: context.nodeId,
      severity: 'error',
    });
    return;
  }

  const [root, ...segments] = ref.split('.');
  switch (root) {
    case 'form':
      if (!context.allowForm) {
        errors.push({
          message: `toast.values.${name} ref "${value.ref}" is not available in ${context.viewName} views; allowed refs here are ${formatAllowedToastRoots(context)}`,
          nodeId: context.nodeId,
          severity: 'error',
        });
        return;
      }
      validateModelBackedToastRef(name, value.ref, segments, context.model, context.nodeId, errors, 'form');
      return;
    case 'record':
      if (!context.allowRecord) {
        const suggestedRef = segments.length > 0 ? `form.${segments.join('.')}` : 'form.<field>';
        errors.push({
          message: `toast.values.${name} ref "${value.ref}" is not available in ${context.viewName} views; create views do not expose record.* values, use ${suggestedRef} instead`,
          nodeId: context.nodeId,
          severity: 'error',
        });
        return;
      }
      validateModelBackedToastRef(name, value.ref, segments, context.model, context.nodeId, errors, 'record');
      return;
    case 'user':
      if (!context.allowUser) {
        errors.push({
          message: `toast.values.${name} ref "${value.ref}" is not available in ${context.viewName} views; allowed refs here are ${formatAllowedToastRoots(context)}`,
          nodeId: context.nodeId,
          severity: 'error',
        });
      }
      return;
    case 'params':
      if (context.allowedParams.size === 0) {
        errors.push({
          message: `toast.values.${name} ref "${value.ref}" is not available in ${context.viewName} views; ${context.viewName} views do not expose route params`,
          nodeId: context.nodeId,
          severity: 'error',
        });
        return;
      }
      if (segments.length !== 1 || !context.allowedParams.has(segments[0])) {
        errors.push({
          message: `toast.values.${name} ref "${value.ref}" is not a supported route param in ${context.viewName} views; allowed params: ${Array.from(context.allowedParams).sort().join(', ')}`,
          nodeId: context.nodeId,
          severity: 'error',
        });
      }
      return;
    default:
      errors.push({
        message: `toast.values.${name} ref "${value.ref}" must start with one of: ${formatAllowedToastRoots(context)}`,
        nodeId: context.nodeId,
        severity: 'error',
      });
  }
}

function formatAllowedToastRoots(context: ToastValidationContext): string {
  const roots: string[] = [];
  if (context.allowForm) roots.push('form.<field>');
  if (context.allowRecord) roots.push('record.<field>');
  if (context.allowUser) roots.push('user.<field>');
  if (context.allowedParams.size > 0) {
    for (const param of Array.from(context.allowedParams).sort()) {
      roots.push(`params.${param}`);
    }
  }
  return roots.join(', ');
}

function validateModelBackedToastRef(
  name: string,
  ref: string,
  segments: string[],
  model: IRModel | undefined,
  nodeId: string,
  errors: ValidationError[],
  root: 'form' | 'record',
): void {
  if (segments.length === 0) {
    errors.push({
      message: `toast.values.${name} ref "${ref}" must include a field after ${root}.`,
      nodeId,
      severity: 'error',
    });
    return;
  }

  if (!model) {
    return;
  }

  const fieldNames = new Set(model.fields.map((field) => field.name));
  if (!fieldNames.has(segments[0])) {
    errors.push({
      message: `toast.values.${name} ref "${ref}" references unknown field "${segments[0]}" on model "${model.name}"`,
      nodeId,
      severity: 'error',
    });
  }
}

function validatePage(
  page: IRApp['pages'][number],
  resources: IRResource[],
  models: IRModel[],
  readModels: IRReadModel[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const routePath = page.path;
  const routeParams = routePath ? parseRouteParamNames(routePath) : [];
  const relationBlocks = page.blocks
    .map((block) => ({
      block,
      analysis: analyzePageBlockData(block, resources, models, readModels),
    }))
    .filter((entry): entry is {
      block: IRApp['pages'][number]['blocks'][number];
      analysis: Extract<ReturnType<typeof analyzePageBlockData>, { kind: 'recordRelationList' | 'recordRelationCount' }>;
    } => entry.analysis.kind === 'recordRelationList' || entry.analysis.kind === 'recordRelationCount');

  if (!page.title) {
    errors.push({
      message: `Page "${page.name}" has no title`,
      nodeId: page.id,
      severity: 'warning',
    });
  }

  if (routePath) {
    if (!isSupportedRoutePath(routePath)) {
      errors.push({
        message: `Page "${page.name}" path "${routePath}" must start with "/" and use only static segments or :params`,
        nodeId: page.id,
        severity: 'error',
      });
    }
    if (relationBlocks.length === 0) {
      errors.push({
        message: `Page "${page.name}" uses path: but page-scoped params are currently only supported for relation blocks using data: <resource>.<hasManyField> or data: <resource>.<hasManyField>.count`,
        nodeId: page.id,
        severity: 'error',
      });
    }
  }

  if (relationBlocks.length > 0) {
    const parentResources = Array.from(new Set(relationBlocks.map((entry) => entry.analysis.resourceName)));
    if (parentResources.length > 1) {
      errors.push({
        message: `Page "${page.name}" mixes record-scoped relation blocks from multiple resources (${parentResources.join(', ')}); current page-scoped relation routes must belong to one parent resource`,
        nodeId: page.id,
        severity: 'error',
      });
    }

    const parentResourceName = parentResources[0];
    if (!routePath) {
      errors.push({
        message: `Page "${page.name}" contains record-scoped relation blocks and must set path: /${parentResourceName}/:id/...`,
        nodeId: page.id,
        severity: 'error',
      });
    } else if (isSupportedRoutePath(routePath)) {
      if (!routeParams.includes('id')) {
        errors.push({
          message: `Page "${page.name}" path "${routePath}" must include :id for record-scoped relation blocks`,
          nodeId: page.id,
          severity: 'error',
        });
      }
      const expectedPrefix = `/${parentResourceName}/:id`;
      if (!(routePath === expectedPrefix || routePath.startsWith(`${expectedPrefix}/`))) {
        errors.push({
          message: `Page "${page.name}" path "${routePath}" must start with "${expectedPrefix}" to scope data: ${parentResourceName}.<relation>`,
          nodeId: page.id,
          severity: 'error',
        });
      }
    }
  }

  for (const block of page.blocks) {
    const analysis = analyzePageBlockData(block, resources, models, readModels);
    if (
      analysis.kind === 'none'
      || analysis.kind === 'resourceList'
      || analysis.kind === 'readModelList'
      || analysis.kind === 'readModelCount'
      || analysis.kind === 'recordRelationList'
      || analysis.kind === 'recordRelationCount'
    ) {
      continue;
    }

    const blockLabel = block.title || block.id;
    const blockKindLabel = block.blockType === 'metric' ? 'Metric block' : 'Table block';
    switch (analysis.reason) {
      case 'missingData':
        errors.push({
          message: block.blockType === 'metric'
            ? `Metric block "${blockLabel}" in page "${page.name}" must set data: readModel.<name>.count or data: <resource>.<hasManyField>.count`
            : `Table block "${blockLabel}" in page "${page.name}" must set data: <resource>.list, data: readModel.<name>.list, or data: <resource>.<hasManyField>`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'unsupportedDataRef':
        errors.push({
          message: block.blockType === 'metric'
            ? `Metric block "${blockLabel}" in page "${page.name}" must use data: readModel.<name>.count or data: <resource>.<hasManyField>.count; got "${analysis.data}"`
            : `Table block "${blockLabel}" in page "${page.name}" must use data: <resource>.list, data: readModel.<name>.list, or data: <resource>.<hasManyField>; got "${analysis.data}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'readModelMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references unknown read-model "${analysis.readModelName}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'readModelListMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" requires read-model "${analysis.readModelName}" to define list:`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'resourceMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references unknown resource "${analysis.resourceName}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'resourceListMissing':
        errors.push({
          message: `Table block "${blockLabel}" in page "${page.name}" requires resource "${analysis.resourceName}" to define list:`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'modelMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references resource "${analysis.resourceName}" with missing model "${analysis.resource?.model}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'relationFieldMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references unknown relation field "${analysis.relationFieldName}" on resource "${analysis.resourceName}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'relationFieldNotHasMany':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" must reference a hasMany(..., by: ...) field; "${analysis.relationFieldName}" on resource "${analysis.resourceName}" is not one`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'targetModelMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references relation "${analysis.relationFieldName}" on resource "${analysis.resourceName}" with missing target model "${analysis.relationField?.fieldType.type === 'relation' ? analysis.relationField.fieldType.target : '<unknown>'}"`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'targetResourceMissing':
        errors.push({
          message: `${blockKindLabel} "${blockLabel}" in page "${page.name}" references relation "${analysis.relationFieldName}" on resource "${analysis.resourceName}" but target resource "${analysis.targetModel?.name}" does not exist`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
      case 'targetResourceListMissing':
        errors.push({
          message: `Table block "${blockLabel}" in page "${page.name}" requires related resource "${analysis.targetResource?.name ?? analysis.targetModel?.name}" to define list:`,
          nodeId: block.id,
          severity: 'error',
        });
        break;
    }
  }

  const queryStateGroups = new Map<string, Array<{ block: IRApp['pages'][number]['blocks'][number]; readModel: IRReadModel }>>();
  const selectionStateGroups = new Map<string, { block: IRApp['pages'][number]['blocks'][number]; readModel: IRReadModel }>();

  for (const block of page.blocks) {
    const analysis = analyzePageBlockData(block, resources, models, readModels);
    const blockLabel = block.title || block.id;

    if (block.queryState) {
      if (block.queryState.trim() === '') {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" must not use an empty queryState`,
          nodeId: block.id,
          severity: 'error',
        });
      } else if (analysis.kind !== 'readModelList' && analysis.kind !== 'readModelCount') {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" may only use queryState with data: readModel.<name>.list or data: readModel.<name>.count`,
          nodeId: block.id,
          severity: 'error',
        });
      } else {
        const group = queryStateGroups.get(block.queryState.trim()) ?? [];
        group.push({ block, readModel: analysis.readModel });
        queryStateGroups.set(block.queryState.trim(), group);
      }
    }

    if (block.selectionState) {
      if (block.selectionState.trim() === '') {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" must not use an empty selectionState`,
          nodeId: block.id,
          severity: 'error',
        });
      } else if (analysis.kind !== 'readModelList' || block.blockType !== 'table') {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" may only use selectionState with data: readModel.<name>.list table consumers in the current slice`,
          nodeId: block.id,
          severity: 'error',
        });
      } else {
        const existing = selectionStateGroups.get(block.selectionState.trim());
        if (existing) {
          errors.push({
            message: `Page "${page.name}" may not reuse selectionState "${block.selectionState.trim()}" across multiple table blocks`,
            nodeId: block.id,
            severity: 'error',
          });
        } else {
          selectionStateGroups.set(block.selectionState.trim(), { block, readModel: analysis.readModel });
        }
      }
    }

    if (block.dateNavigation) {
      if (analysis.kind !== 'readModelList') {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" may only use dateNavigation with data: readModel.<name>.list`,
          nodeId: block.id,
          severity: 'error',
        });
        continue;
      }
      const dateNavigation = block.dateNavigation;
      const inputField = analysis.readModel.inputs.find((field) => field.name === dateNavigation.field);
      if (!inputField) {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" dateNavigation field "${dateNavigation.field}" must reference a read-model input`,
          nodeId: block.id,
          severity: 'error',
        });
      } else if (inputField.fieldType.type !== 'scalar' || (inputField.fieldType.name !== 'string' && inputField.fieldType.name !== 'datetime')) {
        errors.push({
          message: `Page block "${blockLabel}" in page "${page.name}" dateNavigation field "${dateNavigation.field}" must be a string/date-like read-model input in the current slice`,
          nodeId: block.id,
          severity: 'error',
        });
      }
    }
  }

  for (const [queryStateName, group] of queryStateGroups.entries()) {
    if (group.length < 2) {
      continue;
    }
    const expectedSignature = serializeReadModelInputSignature(group[0].readModel);
    for (const entry of group.slice(1)) {
      const actualSignature = serializeReadModelInputSignature(entry.readModel);
      if (actualSignature !== expectedSignature) {
        errors.push({
          message: `Page "${page.name}" queryState "${queryStateName}" may only be shared by read-model consumers with identical inputs; "${group[0].readModel.name}" and "${entry.readModel.name}" differ`,
          nodeId: entry.block.id,
          severity: 'error',
        });
      }
    }
  }

  for (const block of page.blocks) {
    errors.push(...validatePageBlockRowActions(page, block, resources, models, readModels));
  }
  errors.push(...validatePageActions(page, resources, models, queryStateGroups, selectionStateGroups));

  return errors;
}

function serializeReadModelInputSignature(readModel: IRReadModel): string {
  return JSON.stringify(
    readModel.inputs.map((field) => ({
      name: field.name,
      fieldType: field.fieldType,
      decorators: field.decorators.map((decorator) => ({ name: decorator.name, args: decorator.args ?? null })),
    })),
  );
}

function validatePageBlockRowActions(
  page: IRApp['pages'][number],
  block: IRApp['pages'][number]['blocks'][number],
  resources: IRResource[],
  models: IRModel[],
  readModels: IRReadModel[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (block.rowActions.length === 0) {
    return errors;
  }

  if (block.blockType !== 'table') {
    errors.push({
      message: `Page block "${block.title || block.id}" in page "${page.name}" may only use rowActions on type: table`,
      nodeId: block.id,
      severity: 'error',
    });
    return errors;
  }

  const analysis = analyzePageBlockData(block, resources, models, readModels);
  if (analysis.kind !== 'readModelList') {
    errors.push({
      message: `Table block "${block.title || block.id}" in page "${page.name}" may only use rowActions with data: readModel.<name>.list in the current slice`,
      nodeId: block.id,
      severity: 'error',
    });
    return errors;
  }

  const readModelInputNames = new Set(analysis.readModel.inputs.map((field) => field.name));
  const readModelResultNames = new Set(analysis.readModel.result.map((field) => field.name));

  for (const action of block.rowActions) {
    const targetResource = resources.find((candidate) => candidate.name === action.resource);
    if (!targetResource) {
      errors.push({
        message: `Row action "${action.label}" in page "${page.name}" references unknown resource "${action.resource}"`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    if (!targetResource.views.create) {
      errors.push({
        message: `Row action "${action.label}" in page "${page.name}" requires resource "${targetResource.name}" to define create:`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    const targetModel = models.find((candidate) => candidate.name === targetResource.model);
    if (!targetModel) {
      errors.push({
        message: `Row action "${action.label}" in page "${page.name}" references resource "${targetResource.name}" with missing model "${targetResource.model}"`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    const createFieldNames = new Set(targetResource.views.create.fields.map((field) => field.field));
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));

    for (const [fieldName, seedValue] of Object.entries(action.seed)) {
      const targetField = targetFieldMap.get(fieldName);
      if (!targetField) {
        errors.push({
          message: `Row action "${action.label}" in page "${page.name}" seeds unknown field "${fieldName}" on model "${targetModel.name}"`,
          nodeId: action.id,
          severity: 'error',
        });
        continue;
      }

      if (!createFieldNames.has(fieldName)) {
        errors.push({
          message: `Row action "${action.label}" in page "${page.name}" may only seed fields already present in resource "${targetResource.name}" create.fields; "${fieldName}" is not included`,
          nodeId: action.id,
          severity: 'error',
        });
      }

      if (targetField.fieldType.type === 'relation' && targetField.fieldType.kind !== 'belongsTo') {
        errors.push({
          message: `Row action "${action.label}" in page "${page.name}" may only seed top-level scalar, enum, or belongsTo fields; "${fieldName}" is not supported`,
          nodeId: action.id,
          severity: 'error',
        });
      }

      if (seedValue.kind === 'rowField' && !readModelResultNames.has(seedValue.field)) {
        errors.push({
          message: `Row action "${action.label}" in page "${page.name}" references unknown read-model result field "${seedValue.field}"`,
          nodeId: action.id,
          severity: 'error',
        });
      }

      if (seedValue.kind === 'inputField' && !readModelInputNames.has(seedValue.field)) {
        errors.push({
          message: `Row action "${action.label}" in page "${page.name}" references unknown read-model input field "${seedValue.field}"`,
          nodeId: action.id,
          severity: 'error',
        });
      }
    }
  }

  return errors;
}

function validatePageActions(
  page: IRApp['pages'][number],
  resources: IRResource[],
  models: IRModel[],
  queryStateGroups: Map<string, Array<{ block: IRApp['pages'][number]['blocks'][number]; readModel: IRReadModel }>>,
  selectionStateGroups: Map<string, { block: IRApp['pages'][number]['blocks'][number]; readModel: IRReadModel }>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const action of page.actions) {
    const targetResource = resources.find((candidate) => candidate.name === action.resource);
    if (!targetResource) {
      errors.push({
        message: `Page action "${action.label}" in page "${page.name}" references unknown resource "${action.resource}"`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    if (!targetResource.views.create) {
      errors.push({
        message: `Page action "${action.label}" in page "${page.name}" requires resource "${targetResource.name}" to define create:`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    const targetModel = models.find((candidate) => candidate.name === targetResource.model);
    if (!targetModel) {
      errors.push({
        message: `Page action "${action.label}" in page "${page.name}" references resource "${targetResource.name}" with missing model "${targetResource.model}"`,
        nodeId: action.id,
        severity: 'error',
      });
      continue;
    }

    const createFieldNames = new Set(targetResource.views.create.fields.map((field) => field.field));
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));

    for (const [fieldName, seedValue] of Object.entries(action.seed)) {
      const targetField = targetFieldMap.get(fieldName);
      if (!targetField) {
        errors.push({
          message: `Page action "${action.label}" in page "${page.name}" seeds unknown field "${fieldName}" on model "${targetModel.name}"`,
          nodeId: action.id,
          severity: 'error',
        });
        continue;
      }

      if (!createFieldNames.has(fieldName)) {
        errors.push({
          message: `Page action "${action.label}" in page "${page.name}" may only seed fields already present in resource "${targetResource.name}" create.fields; "${fieldName}" is not included`,
          nodeId: action.id,
          severity: 'error',
        });
      }

      if (targetField.fieldType.type === 'relation' && targetField.fieldType.kind !== 'belongsTo') {
        errors.push({
          message: `Page action "${action.label}" in page "${page.name}" may only seed top-level scalar, enum, or belongsTo fields; "${fieldName}" is not supported`,
          nodeId: action.id,
          severity: 'error',
        });
      }

      if (seedValue.kind === 'inputField') {
        if (!seedValue.queryState || !seedValue.field) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" must reference input seeds as <queryState>.<field>`,
            nodeId: action.id,
            severity: 'error',
          });
          continue;
        }
        const queryStateGroup = queryStateGroups.get(seedValue.queryState);
        if (!queryStateGroup || queryStateGroup.length === 0) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" references unknown queryState "${seedValue.queryState}"`,
            nodeId: action.id,
            severity: 'error',
          });
          continue;
        }
        const inputNames = new Set(queryStateGroup[0].readModel.inputs.map((field) => field.name));
        if (!inputNames.has(seedValue.field)) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" references unknown input "${seedValue.field}" on queryState "${seedValue.queryState}"`,
            nodeId: action.id,
            severity: 'error',
          });
        }
      }

      if (seedValue.kind === 'selectionField') {
        if (!seedValue.selectionState || !seedValue.field) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" must reference selection seeds as <selectionState>.<field>`,
            nodeId: action.id,
            severity: 'error',
          });
          continue;
        }
        const selectionState = selectionStateGroups.get(seedValue.selectionState);
        if (!selectionState) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" references unknown selectionState "${seedValue.selectionState}"`,
            nodeId: action.id,
            severity: 'error',
          });
          continue;
        }
        const resultNames = new Set(selectionState.readModel.result.map((field) => field.name));
        if (!resultNames.has(seedValue.field)) {
          errors.push({
            message: `Page action "${action.label}" in page "${page.name}" references unknown selected field "${seedValue.field}" on selectionState "${seedValue.selectionState}"`,
            nodeId: action.id,
            severity: 'error',
          });
        }
      }
    }
  }

  return errors;
}

function isSupportedRoutePath(path: string): boolean {
  if (!path.startsWith('/')) {
    return false;
  }
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 && parts.every((part) => ROUTE_PATH_SEGMENT_PATTERN.test(part));
}

function parseRouteParamNames(path: string): string[] {
  if (!isSupportedRoutePath(path)) {
    return [];
  }
  return path
    .split('/')
    .filter(Boolean)
    .filter((part) => part.startsWith(':'))
    .map((part) => part.slice(1));
}

function validateViewRulePaths(
  nodeId: string,
  rules: IRRules | undefined,
  errors: ValidationError[],
): void {
  if (!rules) {
    return;
  }

  for (const [key, rule] of Object.entries(rules)) {
    if (rule?.source !== 'escape-fn') {
      continue;
    }

    const path = rule.escape.path;
    const isAbsolute = path.startsWith('/') || /^[A-Za-z]:/.test(path);
    const escapesProjectRoot = path.startsWith('../');
    if (isAbsolute || escapesProjectRoot || path.length === 0) {
      errors.push({
        message: `@fn() path "${path}" in ${key} must resolve to a project-relative file inside the app root`,
        nodeId,
        severity: 'error',
      });
    }
  }
}

function validateRuleValuePath(
  rule: RuleValue | undefined,
  key: string,
  nodeId: string,
  errors: ValidationError[],
): void {
  if (rule?.source !== 'escape-fn') {
    return;
  }

  const path = rule.escape.path;
  const isAbsolute = path.startsWith('/') || /^[A-Za-z]:/.test(path);
  const escapesProjectRoot = path.startsWith('../');
  if (isAbsolute || escapesProjectRoot || path.length === 0) {
    errors.push({
      message: `@fn() path "${path}" in ${key} must resolve to a project-relative file inside the app root`,
      nodeId,
      severity: 'error',
    });
  }
}

function validateFormFieldRulePaths(
  field: IRFormField,
  errors: ValidationError[],
): void {
  validateRuleValuePath(field.visibleWhen, 'field.visibleIf', field.id, errors);
  validateRuleValuePath(field.enabledWhen, 'field.enabledIf', field.id, errors);
}

function validateFormFieldRules(
  field: IRFormField,
  errors: ValidationError[],
  validateIdentifier: (path: string[]) => string | undefined,
): void {
  if (field.visibleWhen?.source === 'builtin') {
    validateWorkflowExpr(field.visibleWhen.expr, field.id, errors, validateIdentifier);
  }
  if (field.enabledWhen?.source === 'builtin') {
    validateWorkflowExpr(field.enabledWhen.expr, field.id, errors, validateIdentifier);
  }
}

function validateWorkflowExpr(
  expr: ExprNode,
  nodeId: string,
  errors: ValidationError[],
  validateIdentifier: (path: string[]) => string | undefined,
): void {
  visitExpr(expr, (node) => {
    if (node.type === 'identifier') {
      const error = validateIdentifier(node.path);
      if (error) {
        errors.push({
          message: error,
          nodeId,
          severity: 'error',
        });
      }
    }
  });
}

function validateWorkflowTransitionIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Resource "${resourceName}" workflow transition rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'role', 'roles'].includes(property)) {
      return `Resource "${resourceName}" workflow transition rules do not support currentUser.${property}; use currentUser.id, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'record') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `Resource "${resourceName}" workflow transition rules reference unknown record field "${property}"`;
    }
    return undefined;
  }
  return `Resource "${resourceName}" workflow transition rules use unsupported identifier root "${root}"; use currentUser, record, or bare enum-like literals`;
}

function validateReadModelRulesEligibilityIdentifier(
  path: string[],
  readModelName: string,
  inputFieldNames: Set<string>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Read-model "${readModelName}" rules eligibility supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `Read-model "${readModelName}" rules eligibility does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'input') {
    if (!property) {
      return undefined;
    }
    if (!inputFieldNames.has(property)) {
      return `Read-model "${readModelName}" rules eligibility references unknown input field "${property}"`;
    }
    return undefined;
  }
  return `Read-model "${readModelName}" rules eligibility uses unsupported identifier root "${root}"; use currentUser, input, or bare enum-like literals`;
}

function validateLinkedFormRulesIdentifier(
  path: string[],
  resourceName: string,
  mode: 'create' | 'edit',
  modelFieldNames: Set<string>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Resource "${resourceName}" ${mode}.rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `Resource "${resourceName}" ${mode}.rules do not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'formData') {
    if (!property) {
      return undefined;
    }
    if (!modelFieldNames.has(property)) {
      return `Resource "${resourceName}" ${mode}.rules reference unknown formData field "${property}"`;
    }
    return undefined;
  }
  if (root === 'record' && mode === 'edit') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `Resource "${resourceName}" edit.rules reference unknown record field "${property}"`;
    }
    return undefined;
  }
  return `Resource "${resourceName}" ${mode}.rules use unsupported identifier root "${root}"; use currentUser, formData${mode === 'edit' ? ', record' : ''}, or bare enum-like literals`;
}

function validateLinkedFormIncludeRulesIdentifier(
  path: string[],
  resourceName: string,
  includeField: string,
  mode: 'create' | 'edit',
  parentModelFieldNames: Set<string>,
  includeFieldNames: Set<string>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Resource "${resourceName}" ${mode}.includes.${includeField}.rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `Resource "${resourceName}" ${mode}.includes.${includeField}.rules do not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'formData') {
    if (!property) {
      return undefined;
    }
    if (!parentModelFieldNames.has(property)) {
      return `Resource "${resourceName}" ${mode}.includes.${includeField}.rules reference unknown formData field "${property}"`;
    }
    return undefined;
  }
  if (root === 'item') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !includeFieldNames.has(property)) {
      return `Resource "${resourceName}" ${mode}.includes.${includeField}.rules reference unknown item field "${property}"`;
    }
    return undefined;
  }
  if (root === 'record' && mode === 'edit') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !parentModelFieldNames.has(property)) {
      return `Resource "${resourceName}" edit.includes.${includeField}.rules reference unknown record field "${property}"`;
    }
    return undefined;
  }
  return `Resource "${resourceName}" ${mode}.includes.${includeField}.rules use unsupported identifier root "${root}"; use currentUser, formData, item${mode === 'edit' ? ', record' : ''}, or bare enum-like literals`;
}

function validateCreateFieldIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  return validateGeneratedFormFieldIdentifier(path, `resource ${resourceName} create field rules`, modelFieldNames, {
    allowRecord: false,
    allowItem: false,
  });
}

function validateEditFieldIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  return validateGeneratedFormFieldIdentifier(path, `resource ${resourceName} edit field rules`, modelFieldNames, {
    allowRecord: true,
    allowItem: false,
  });
}

function validateCreateIncludeFieldIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  return validateGeneratedFormFieldIdentifier(path, `resource ${resourceName} create include field rules`, modelFieldNames, {
    allowRecord: false,
    allowItem: true,
  });
}

function validateEditIncludeFieldIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  return validateGeneratedFormFieldIdentifier(path, `resource ${resourceName} edit include field rules`, modelFieldNames, {
    allowRecord: true,
    allowItem: true,
  });
}

function validateGeneratedFormFieldIdentifier(
  path: string[],
  surfaceLabel: string,
  modelFieldNames: Set<string>,
  options: { allowRecord: boolean; allowItem: boolean },
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `${surfaceLabel} support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `${surfaceLabel} do not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'formData' || (options.allowRecord && root === 'record') || (options.allowItem && root === 'item')) {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `${surfaceLabel} reference unknown ${root} field "${property}"`;
    }
    return undefined;
  }

  const roots = ['currentUser', 'formData'];
  if (options.allowRecord) {
    roots.push('record');
  }
  if (options.allowItem) {
    roots.push('item');
  }
  return `${surfaceLabel} use unsupported identifier root "${root}"; use ${roots.join(', ')}, or bare enum-like literals`;
}

function validateWorkflowStepIdentifier(
  path: string[],
  resourceName: string,
  modelFieldNames: Set<string>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Resource "${resourceName}" workflow wizard step rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'role', 'roles'].includes(property)) {
      return `Resource "${resourceName}" workflow wizard step rules do not support currentUser.${property}; use currentUser.id, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'record' || root === 'formData') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `Resource "${resourceName}" workflow wizard step rules reference unknown ${root} field "${property}"`;
    }
    return undefined;
  }
  return `Resource "${resourceName}" workflow wizard step rules use unsupported identifier root "${root}"; use currentUser, record, formData, or bare enum-like literals`;
}

function validateReadModelRulesDerivationIdentifier(
  path: string[],
  readModelName: string,
  inputFieldNames: Set<string>,
  resultFieldMap: Map<string, IRReadModel['result'][number]>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `Read-model "${readModelName}" rules derive supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `Read-model "${readModelName}" rules derive does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'input') {
    if (!property) {
      return undefined;
    }
    if (!inputFieldNames.has(property)) {
      return `Read-model "${readModelName}" rules derive references unknown input field "${property}"`;
    }
    return undefined;
  }
  if (root === 'item') {
    if (!property) {
      return undefined;
    }
    if (!resultFieldMap.has(property)) {
      return `Read-model "${readModelName}" rules derive references unknown item field "${property}"`;
    }
    return undefined;
  }
  return `Read-model "${readModelName}" rules derive uses unsupported identifier root "${root}"; use currentUser, input, item, or bare enum-like literals`;
}

function visitExpr(
  expr: ExprNode,
  visit: (expr: ExprNode) => void,
): void {
  visit(expr);
  if (expr.type === 'binary') {
    visitExpr(expr.left, visit);
    visitExpr(expr.right, visit);
    return;
  }
  if (expr.type === 'unary') {
    visitExpr(expr.operand, visit);
    return;
  }
  if (expr.type === 'call') {
    for (const arg of expr.args) {
      visitExpr(arg, visit);
    }
    return;
  }
  if (expr.type === 'member') {
    visitExpr(expr.object, visit);
    return;
  }
  if (expr.type === 'in') {
    visitExpr(expr.value, visit);
    for (const item of expr.list) {
      visitExpr(item, visit);
    }
  }
}

function collectDuplicateErrors<T extends { id: string; name: string; sourceSpan?: IRApp['sourceSpan'] }>(
  nodes: T[],
  kind: 'model' | 'resource' | 'readModel' | 'page',
): ValidationError[] {
  const grouped = new Map<string, T[]>();

  for (const node of nodes) {
    const group = grouped.get(node.name);
    if (group) {
      group.push(node);
    } else {
      grouped.set(node.name, [node]);
    }
  }

  const errors: ValidationError[] = [];
  for (const [name, duplicates] of grouped) {
    if (duplicates.length < 2) continue;
    const locations = duplicates
      .map((node) => formatSourceLocation(node.sourceSpan))
      .join(', ');
    for (const duplicate of duplicates) {
      errors.push({
        message: `Duplicate ${kind} "${name}" defined at ${locations}`,
        nodeId: duplicate.id,
        severity: 'error',
      });
    }
  }

  return errors;
}

function formatSourceLocation(sourceSpan: IRApp['sourceSpan']): string {
  if (!sourceSpan) return '<unknown>';
  return `${sourceSpan.file}:${sourceSpan.startLine}:${sourceSpan.startCol}`;
}

function validateRouteTarget(
  target: string,
  nodeId: string,
  resourceMap: Map<string, IRResource>,
  pageMap: Map<string, IRApp['pages'][number]>,
  errors: ValidationError[],
): void {
  // Target formats: "users.list", "users.edit", "page.dashboard"
  const parts = target.split('.');
  if (parts.length === 2) {
    const [prefix, suffix] = parts;
    if (prefix === 'page') {
      const page = pageMap.get(suffix);
      if (!page) {
        errors.push({
          message: `Redirect target page "${suffix}" does not exist`,
          nodeId,
          severity: 'warning',
        });
      } else if (page.path) {
        errors.push({
          message: `Redirect target page "${suffix}" uses a record-scoped path "${page.path}" and cannot be targeted without explicit route params`,
          nodeId,
          severity: 'warning',
        });
      }
    } else if (resourceMap.has(prefix)) {
      const validViews = ['list', 'edit', 'create'];
      if (!validViews.includes(suffix)) {
        errors.push({
          message: `Redirect target view "${suffix}" is not a valid view type`,
          nodeId,
          severity: 'warning',
        });
      }
    } else {
      errors.push({
        message: `Redirect target "${target}" references unknown resource "${prefix}"`,
        nodeId,
        severity: 'warning',
      });
    }
  }
}

function validateNavTarget(
  target: string,
  nodeId: string,
  resourceMap: Map<string, IRResource>,
  pageMap: Map<string, IRApp['pages'][number]>,
  errors: ValidationError[],
): void {
  // Navigation target formats: "resource.users.list", "page.dashboard"
  const parts = target.split('.');
  if (parts[0] === 'resource' && parts.length >= 3) {
    if (!resourceMap.has(parts[1])) {
      errors.push({
        message: `Navigation target references unknown resource "${parts[1]}"`,
        nodeId,
        severity: 'error',
      });
    }
  } else if (parts[0] === 'page' && parts.length >= 2) {
    const page = pageMap.get(parts[1]);
    if (!page) {
      errors.push({
        message: `Navigation target references unknown page "${parts[1]}"`,
        nodeId,
        severity: 'error',
      });
    } else if (page.path) {
      errors.push({
        message: `Navigation target references page "${parts[1]}" with record-scoped path "${page.path}"; current navigation targets only support static page routes`,
        nodeId,
        severity: 'error',
      });
    }
  }
}
