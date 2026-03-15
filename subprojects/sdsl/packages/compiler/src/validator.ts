import type { IRModel, IRReadModel, IRReadModelField, IRResource, IRSdslProgram } from './ir.js';
import type { ExprNode } from '@loj-lang/rdsl-compiler/ir';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

export interface ValidateResult {
  issues: ValidationIssue[];
}

export function validate(ir: IRSdslProgram): ValidateResult {
  const issues: ValidationIssue[] = [];
  const modelByName = new Map(ir.models.map((model) => [model.name, model]));

  if (ir.models.length === 0 && ir.readModels.length === 0) {
    issues.push({
      severity: 'error',
      message: 'Program must define at least one model or readModel',
      nodeId: 'program',
    });
  }

  if (ir.resources.length === 0 && ir.readModels.length === 0) {
    issues.push({
      severity: 'error',
      message: 'Program must define at least one resource or readModel',
      nodeId: 'program',
    });
  }

  const seenApiPaths = new Map<string, string>();
  for (const resource of ir.resources) {
    const previous = seenApiPaths.get(resource.api);
    if (previous) {
      issues.push({
        severity: 'error',
        message: `Duplicate resource api path "${resource.api}" between ${previous} and ${resource.id}`,
        nodeId: resource.id,
      });
    } else {
      seenApiPaths.set(resource.api, resource.id);
    }

    if (!resource.operations.list
      && !resource.operations.get
      && !resource.operations.create
      && !resource.operations.update
      && !resource.operations.delete) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} must enable at least one CRUD operation`,
        nodeId: resource.id,
      });
    }

    validateResourceCreate(resource, modelByName, issues);
    validateResourceUpdate(resource, modelByName, issues);
    validateResourceCreateRules(resource, modelByName, issues);
    validateResourceWorkflow(resource, modelByName, issues);

    if (resource.auth.policy?.source === 'rules') {
      const model = modelByName.get(resource.model);
      if (!model) {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} linked rules policy requires known model "${resource.model}"`,
          nodeId: resource.id,
        });
      } else {
        validateLinkedRulesPolicy(resource.name, model, resource.auth.policy.program?.rules ?? [], issues, resource.id);
      }
    }
  }
  for (const readModel of ir.readModels) {
    const previous = seenApiPaths.get(readModel.api);
    if (previous) {
      issues.push({
        severity: 'error',
        message: `Duplicate api path "${readModel.api}" between ${previous} and ${readModel.id}`,
        nodeId: readModel.id,
      });
    } else {
      seenApiPaths.set(readModel.api, readModel.id);
    }
    validateReadModel(readModel, issues);
    validateReadModelRules(readModel, issues);
  }

  for (const model of ir.models) {
    validateModel(model, issues);
  }

  return { issues };
}

function validateResourceWorkflow(
  resource: IRResource,
  modelByName: Map<string, IRModel>,
  issues: ValidationIssue[],
): void {
  const workflow = resource.workflow;
  if (!workflow) {
    return;
  }

  const model = modelByName.get(resource.model);
  if (!model) {
    return;
  }
  if (workflow.program.model !== model.name) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} workflow model "${workflow.program.model}" must match resource model "${model.name}"`,
      nodeId: workflow.id,
    });
  }

  const stateField = model.fields.find((field) => field.name === workflow.program.field);
  if (!stateField) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} workflow field "${workflow.program.field}" not found in model "${model.name}"`,
      nodeId: workflow.id,
    });
    return;
  }
  if (stateField.fieldType.type !== 'enum') {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} workflow field "${workflow.program.field}" in model "${model.name}" must be an enum(...) field`,
      nodeId: workflow.id,
    });
    return;
  }

  const enumValues = new Set(stateField.fieldType.values);
  const workflowStates = new Set(workflow.program.states.map((state) => state.name));
  for (const state of workflow.program.states) {
    if (!enumValues.has(state.name)) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} workflow state "${state.name}" is not declared in model ${model.name}.${stateField.name}`,
        nodeId: workflow.id,
      });
    }
  }
  for (const enumValue of stateField.fieldType.values) {
    if (!workflowStates.has(enumValue)) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} workflow must declare enum state "${enumValue}" from model ${model.name}.${stateField.name}`,
        nodeId: workflow.id,
      });
    }
  }

  const modelFieldNames = new Set(model.fields.map((field) => field.name));
  for (const step of workflow.program.wizard?.steps ?? []) {
    if (step.allow) {
      validateRulesExpr(
        step.allow,
        `resource ${resource.name} workflow wizard step "${step.name}"`,
        issues,
        workflow.id,
        (path) => validateWorkflowStepIdentifier(path, resource.name, modelFieldNames),
      );
    }
  }
  for (const transition of workflow.program.transitions) {
    if (!transition.allow) {
      continue;
    }
    validateRulesExpr(
      transition.allow,
      `resource ${resource.name} workflow transition "${transition.name}"`,
      issues,
      workflow.id,
      (path) => validateWorkflowTransitionIdentifier(path, resource.name, modelFieldNames),
    );
  }
}

function validateResourceCreate(
  resource: IRSdslProgram['resources'][number],
  modelByName: Map<string, IRModel>,
  issues: ValidationIssue[],
): void {
  if (!resource.create) {
    return;
  }
  if (!resource.operations.create) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} uses create.includes or create.rules but create operation is disabled`,
      nodeId: resource.create.id,
    });
  }

  const model = modelByName.get(resource.model);
  if (!model) {
    return;
  }
  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));

  for (const include of resource.create.includes) {
    const relationField = fieldMap.get(include.field);
    if (!relationField) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create include "${include.field}" not found in model "${resource.model}"`,
        nodeId: include.id,
      });
      continue;
    }
    if (relationField.fieldType.type !== 'relation' || relationField.fieldType.kind !== 'hasMany') {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create include "${include.field}" must reference a hasMany(..., by: ...) field`,
        nodeId: include.id,
      });
      continue;
    }
    if (include.fields.length === 0) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create include "${include.field}" must list at least one child field`,
        nodeId: include.id,
      });
      continue;
    }

    const targetModel = modelByName.get(relationField.fieldType.target);
    if (!targetModel) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create include "${include.field}" references unknown target model "${relationField.fieldType.target}"`,
        nodeId: include.id,
      });
      continue;
    }
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
    for (const fieldName of include.fields) {
      const targetField = targetFieldMap.get(fieldName);
      if (!targetField) {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} create include field "${fieldName}" not found in related model "${targetModel.name}"`,
          nodeId: include.id,
        });
        continue;
      }
      if (targetField.name === relationField.fieldType.by) {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} create include field "${fieldName}" is the inverse belongsTo(${model.name}) field and is seeded automatically`,
          nodeId: include.id,
        });
        continue;
      }
      if (targetField.fieldType.type === 'relation' && targetField.fieldType.kind === 'hasMany') {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} create include field "${fieldName}" in model "${targetModel.name}" is a hasMany() inverse relation and cannot be nested again in the current slice`,
          nodeId: include.id,
        });
      }
    }
  }
}

function validateResourceUpdate(
  resource: IRSdslProgram['resources'][number],
  modelByName: Map<string, IRModel>,
  issues: ValidationIssue[],
): void {
  if (!resource.update) {
    return;
  }
  if (!resource.operations.update) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} uses update.includes but update operation is disabled`,
      nodeId: resource.update.id,
    });
  }

  const model = modelByName.get(resource.model);
  if (!model) {
    return;
  }
  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));

  for (const include of resource.update.includes) {
    const relationField = fieldMap.get(include.field);
    if (!relationField) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} update include "${include.field}" not found in model "${resource.model}"`,
        nodeId: include.id,
      });
      continue;
    }
    if (relationField.fieldType.type !== 'relation' || relationField.fieldType.kind !== 'hasMany') {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} update include "${include.field}" must reference a hasMany(..., by: ...) field`,
        nodeId: include.id,
      });
      continue;
    }
    if (include.fields.length === 0) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} update include "${include.field}" must list at least one child field`,
        nodeId: include.id,
      });
      continue;
    }

    const targetModel = modelByName.get(relationField.fieldType.target);
    if (!targetModel) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} update include "${include.field}" references unknown target model "${relationField.fieldType.target}"`,
        nodeId: include.id,
      });
      continue;
    }
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
    for (const fieldName of include.fields) {
      const targetField = targetFieldMap.get(fieldName);
      if (!targetField) {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} update include field "${fieldName}" not found in related model "${targetModel.name}"`,
          nodeId: include.id,
        });
        continue;
      }
      if (targetField.name === relationField.fieldType.by) {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} update include field "${fieldName}" is the inverse belongsTo(${model.name}) field and is seeded automatically`,
          nodeId: include.id,
        });
        continue;
      }
      if (targetField.fieldType.type === 'relation' && targetField.fieldType.kind === 'hasMany') {
        issues.push({
          severity: 'error',
          message: `resource ${resource.name} update include field "${fieldName}" references inverse relation metadata and cannot be nested again in the current slice`,
          nodeId: include.id,
        });
      }
    }
  }
}

function validateResourceCreateRules(
  resource: IRSdslProgram['resources'][number],
  modelByName: Map<string, IRModel>,
  issues: ValidationIssue[],
): void {
  const rules = resource.create?.rules;
  if (!rules) {
    return;
  }
  const model = modelByName.get(resource.model);
  if (!model) {
    return;
  }
  const modelFieldNames = new Set(model.fields.map((field) => field.name));

  if (rules.program.rules.length > 0) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} create.rules does not support allow/deny auth entries; use resource auth.policy for that slice`,
      nodeId: rules.id,
    });
  }
  if (rules.program.derivations.length > 0) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} create.rules does not support derive entries in the current slice`,
      nodeId: rules.id,
    });
  }
  if (rules.program.eligibility.length === 0 && rules.program.validation.length === 0) {
    issues.push({
      severity: 'error',
      message: `resource ${resource.name} create.rules must define at least one eligibility or validate entry`,
      nodeId: rules.id,
    });
  }

  const seenEligibility = new Set<string>();
  for (const entry of rules.program.eligibility) {
    if (seenEligibility.has(entry.name)) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create.rules has duplicate eligibility entry "${entry.name}"`,
        nodeId: rules.id,
      });
    }
    seenEligibility.add(entry.name);
    validateRulesExpr(
      entry.when,
      `resource ${resource.name} create.rules eligibility "${entry.name}"`,
      issues,
      rules.id,
      (path) => validateCreateRulesIdentifier(path, resource.name, modelFieldNames),
    );
    for (const expr of entry.or) {
      validateRulesExpr(
        expr,
        `resource ${resource.name} create.rules eligibility "${entry.name}"`,
        issues,
        rules.id,
        (path) => validateCreateRulesIdentifier(path, resource.name, modelFieldNames),
      );
    }
  }

  const seenValidation = new Set<string>();
  for (const entry of rules.program.validation) {
    if (seenValidation.has(entry.name)) {
      issues.push({
        severity: 'error',
        message: `resource ${resource.name} create.rules has duplicate validate entry "${entry.name}"`,
        nodeId: rules.id,
      });
    }
    seenValidation.add(entry.name);
    validateRulesExpr(
      entry.when,
      `resource ${resource.name} create.rules validate "${entry.name}"`,
      issues,
      rules.id,
      (path) => validateCreateRulesIdentifier(path, resource.name, modelFieldNames),
    );
    for (const expr of entry.or) {
      validateRulesExpr(
        expr,
        `resource ${resource.name} create.rules validate "${entry.name}"`,
        issues,
        rules.id,
        (path) => validateCreateRulesIdentifier(path, resource.name, modelFieldNames),
      );
    }
  }
}

function validateLinkedRulesPolicy(
  resourceName: string,
  model: IRModel,
  rules: Array<{
    effect: 'allow' | 'deny';
    operation: 'list' | 'get' | 'create' | 'update' | 'delete';
    when: ExprNode;
    or: ExprNode[];
    scopeWhen?: ExprNode;
    scope?: ExprNode;
  }>,
  issues: ValidationIssue[],
  nodeId: string,
): void {
  const modelFieldNames = new Set(model.fields.map((field) => field.name));
  for (const rule of rules) {
    if (rule.effect !== 'allow' && (rule.scopeWhen || rule.scope)) {
      issues.push({
        severity: 'error',
        message: `resource ${resourceName} linked rules policy may use scopeWhen/scope only on allow list entries`,
        nodeId,
      });
    }
    validateBackendRulesExpr(rule.when, resourceName, modelFieldNames, issues, nodeId);
    for (const expr of rule.or) {
      validateBackendRulesExpr(expr, resourceName, modelFieldNames, issues, nodeId);
    }
    if (rule.scopeWhen) {
      validateBackendRulesExpr(rule.scopeWhen, resourceName, modelFieldNames, issues, nodeId);
    }
    if (rule.scope) {
      validateBackendRulesExpr(rule.scope, resourceName, modelFieldNames, issues, nodeId);
    }
  }
}

function validateReadModelRules(
  readModel: IRReadModel,
  issues: ValidationIssue[],
): void {
  const rules = readModel.rules;
  if (!rules) {
    return;
  }
  const inputFieldNames = new Set(readModel.inputs.map((field) => field.name));
  const resultFieldMap = new Map(readModel.result.map((field) => [field.name, field]));

  if (rules.program.rules.length > 0) {
    issues.push({
      severity: 'error',
      message: `readModel ${readModel.name} rules does not support allow/deny auth entries; keep readModel auth at mode/roles in the current slice`,
      nodeId: rules.id,
    });
  }
  if (rules.program.eligibility.length === 0 && rules.program.validation.length === 0 && rules.program.derivations.length === 0) {
    issues.push({
      severity: 'error',
      message: `readModel ${readModel.name} rules must define at least one eligibility, validate, or derive entry`,
      nodeId: rules.id,
    });
  }

  const seenEligibility = new Set<string>();
  for (const entry of rules.program.eligibility) {
    if (seenEligibility.has(entry.name)) {
      issues.push({
        severity: 'error',
        message: `readModel ${readModel.name} rules has duplicate eligibility entry "${entry.name}"`,
        nodeId: rules.id,
      });
    }
    seenEligibility.add(entry.name);
    validateRulesExpr(
      entry.when,
      `readModel ${readModel.name} rules eligibility "${entry.name}"`,
      issues,
      rules.id,
      (path) => validateReadModelEligibilityIdentifier(path, readModel.name, inputFieldNames),
    );
    for (const expr of entry.or) {
      validateRulesExpr(
        expr,
        `readModel ${readModel.name} rules eligibility "${entry.name}"`,
        issues,
        rules.id,
        (path) => validateReadModelEligibilityIdentifier(path, readModel.name, inputFieldNames),
      );
    }
  }

  const seenValidation = new Set<string>();
  for (const entry of rules.program.validation) {
    if (seenValidation.has(entry.name)) {
      issues.push({
        severity: 'error',
        message: `readModel ${readModel.name} rules has duplicate validate entry "${entry.name}"`,
        nodeId: rules.id,
      });
    }
    seenValidation.add(entry.name);
    validateRulesExpr(
      entry.when,
      `readModel ${readModel.name} rules validate "${entry.name}"`,
      issues,
      rules.id,
      (path) => validateReadModelEligibilityIdentifier(path, readModel.name, inputFieldNames),
    );
    for (const expr of entry.or) {
      validateRulesExpr(
        expr,
        `readModel ${readModel.name} rules validate "${entry.name}"`,
        issues,
        rules.id,
        (path) => validateReadModelEligibilityIdentifier(path, readModel.name, inputFieldNames),
      );
    }
  }

  const seenDerivations = new Set<string>();
  for (const entry of rules.program.derivations) {
    if (seenDerivations.has(entry.field)) {
      issues.push({
        severity: 'error',
        message: `readModel ${readModel.name} rules has duplicate derive entry for "${entry.field}"`,
        nodeId: rules.id,
      });
      continue;
    }
    seenDerivations.add(entry.field);
    const resultField = resultFieldMap.get(entry.field);
    if (!resultField) {
      issues.push({
        severity: 'error',
        message: `readModel ${readModel.name} rules derive entry "${entry.field}" must target an existing result field`,
        nodeId: rules.id,
      });
      continue;
    }
    if (
      resultField.fieldType.type !== 'scalar'
      || ['date', 'datetime'].includes(resultField.fieldType.name)
    ) {
      issues.push({
        severity: 'error',
        message: `readModel ${readModel.name} rules derive entry "${entry.field}" currently supports only string, text, integer, long, decimal, or boolean result fields`,
        nodeId: rules.id,
      });
    }
    if (entry.when) {
      validateRulesExpr(
        entry.when,
        `readModel ${readModel.name} rules derive "${entry.field}"`,
        issues,
        rules.id,
        (path) => validateReadModelDerivationIdentifier(path, readModel.name, inputFieldNames, resultFieldMap),
      );
    }
    validateRulesExpr(
      entry.value,
      `readModel ${readModel.name} rules derive "${entry.field}"`,
      issues,
      rules.id,
      (path) => validateReadModelDerivationIdentifier(path, readModel.name, inputFieldNames, resultFieldMap),
    );
  }
}

function validateBackendRulesExpr(
  expr: ExprNode,
  resourceName: string,
  modelFieldNames: Set<string>,
  issues: ValidationIssue[],
  nodeId: string,
): void {
  validateRulesExpr(
    expr,
    `resource ${resourceName} linked rules policy`,
    issues,
    nodeId,
    (path) => validateBackendRulesIdentifier(path, resourceName, modelFieldNames),
  );
}

function validateRulesExpr(
  expr: ExprNode,
  surfaceLabel: string,
  issues: ValidationIssue[],
  nodeId: string,
  validateIdentifier: (path: string[]) => string | undefined,
): void {
  visitExpr(expr, (node) => {
    if (node.type === 'identifier') {
      const error = validateIdentifier(node.path);
      if (error) {
        issues.push({
          severity: 'error',
          message: error,
          nodeId,
        });
      }
      return;
    }
    if (node.type === 'call' && node.fn === 'isOwner') {
      issues.push({
        severity: 'error',
        message: `${surfaceLabel} does not support builtin isOwner(); use explicit currentUser / record / payload / input / item field comparisons instead`,
        nodeId,
      });
    }
  });
}

function validateBackendRulesIdentifier(
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
    return `resource ${resourceName} linked rules policy supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `resource ${resourceName} linked rules policy does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'record') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `resource ${resourceName} linked rules policy references unknown record field "${property}"`;
    }
    return undefined;
  }
  if (root === 'payload') {
    if (!property) {
      return undefined;
    }
    if (!modelFieldNames.has(property)) {
      return `resource ${resourceName} linked rules policy references unknown payload field "${property}"`;
    }
    return undefined;
  }
  if (root === 'params') {
    if (!property) {
      return undefined;
    }
    return undefined;
  }

  return `resource ${resourceName} linked rules policy uses unsupported identifier root "${root}"; use currentUser, record, payload, or params`;
}

function validateCreateRulesIdentifier(
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
    return `resource ${resourceName} create.rules supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `resource ${resourceName} create.rules does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'payload') {
    if (!property) {
      return undefined;
    }
    if (!modelFieldNames.has(property)) {
      return `resource ${resourceName} create.rules references unknown payload field "${property}"`;
    }
    return undefined;
  }
  if (root === 'params') {
    if (!property) {
      return undefined;
    }
    return undefined;
  }
  return `resource ${resourceName} create.rules uses unsupported identifier root "${root}"; use currentUser, payload, or params`;
}

function validateReadModelEligibilityIdentifier(
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
    return `readModel ${readModelName} rules eligibility supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `readModel ${readModelName} rules eligibility does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'input') {
    if (!property) {
      return undefined;
    }
    if (!inputFieldNames.has(property)) {
      return `readModel ${readModelName} rules eligibility references unknown input field "${property}"`;
    }
    return undefined;
  }
  return `readModel ${readModelName} rules eligibility uses unsupported identifier root "${root}"; use currentUser or input`;
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
    return `resource ${resourceName} workflow transition rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `resource ${resourceName} workflow transition rules do not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'record') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `resource ${resourceName} workflow transition rules reference unknown record field "${property}"`;
    }
    return undefined;
  }
  return `resource ${resourceName} workflow transition rules use unsupported identifier root "${root}"; use currentUser, record, or bare enum-like literals`;
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
    return `resource ${resourceName} workflow wizard step rules support only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `resource ${resourceName} workflow wizard step rules do not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'record' || root === 'formData') {
    if (!property) {
      return undefined;
    }
    if (property !== 'id' && !modelFieldNames.has(property)) {
      return `resource ${resourceName} workflow wizard step rules reference unknown ${root} field "${property}"`;
    }
    return undefined;
  }
  return `resource ${resourceName} workflow wizard step rules use unsupported identifier root "${root}"; use currentUser, record, formData, or bare enum-like literals`;
}

function validateReadModelDerivationIdentifier(
  path: string[],
  readModelName: string,
  inputFieldNames: Set<string>,
  resultFieldMap: Map<string, IRReadModelField>,
): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  const [root, property, ...rest] = path;
  if (path.length === 1 && /^[A-Z][A-Z0-9_]*$/.test(root)) {
    return undefined;
  }
  if (rest.length > 0) {
    return `readModel ${readModelName} rules derive supports only one-level property access; got "${path.join('.')}"`;
  }
  if (root === 'currentUser') {
    if (!property) {
      return undefined;
    }
    if (!['id', 'username', 'role', 'roles'].includes(property)) {
      return `readModel ${readModelName} rules derive does not support currentUser.${property}; use currentUser.id, currentUser.username, currentUser.role, or currentUser.roles`;
    }
    return undefined;
  }
  if (root === 'input') {
    if (!property) {
      return undefined;
    }
    if (!inputFieldNames.has(property)) {
      return `readModel ${readModelName} rules derive references unknown input field "${property}"`;
    }
    return undefined;
  }
  if (root === 'item') {
    if (!property) {
      return undefined;
    }
    if (!resultFieldMap.has(property)) {
      return `readModel ${readModelName} rules derive references unknown item field "${property}"`;
    }
    return undefined;
  }
  return `readModel ${readModelName} rules derive uses unsupported identifier root "${root}"; use currentUser, input, or item`;
}

function visitExpr(expr: ExprNode, visit: (expr: ExprNode) => void): void {
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

function validateModel(model: IRModel, issues: ValidationIssue[]): void {
  const seenFields = new Set<string>();
  let createdAtCount = 0;
  let updatedAtCount = 0;

  for (const field of model.fields) {
    if (seenFields.has(field.name)) {
      issues.push({
        severity: 'error',
        message: `Duplicate field name "${field.name}" in model ${model.name}`,
        nodeId: field.id,
      });
      continue;
    }
    seenFields.add(field.name);

    if (field.name === 'id') {
      issues.push({
        severity: 'error',
        message: `model ${model.name} must not define "id"; persistence identity is generated implicitly`,
        nodeId: field.id,
      });
    }

    for (const decorator of field.decorators) {
      if (decorator.name === 'createdAt') {
        createdAtCount += 1;
      }
      if (decorator.name === 'updatedAt') {
        updatedAtCount += 1;
      }
    }
  }

  if (createdAtCount > 1) {
    issues.push({
      severity: 'error',
      message: `model ${model.name} may declare at most one @createdAt field`,
      nodeId: model.id,
    });
  }
  if (updatedAtCount > 1) {
    issues.push({
      severity: 'error',
      message: `model ${model.name} may declare at most one @updatedAt field`,
      nodeId: model.id,
    });
  }
}

function validateReadModel(readModel: IRReadModel, issues: ValidationIssue[]): void {
  const seenInputFields = new Set<string>();
  const seenResultFields = new Set<string>();

  for (const field of readModel.inputs) {
    validateReadModelField(readModel, field, seenInputFields, issues);
  }
  for (const field of readModel.result) {
    validateReadModelField(readModel, field, seenResultFields, issues);
  }
}

function validateReadModelField(
  readModel: IRReadModel,
  field: IRReadModelField,
  seen: Set<string>,
  issues: ValidationIssue[],
): void {
  if (seen.has(field.name)) {
    issues.push({
      severity: 'error',
      message: `Duplicate ${field.section} field name "${field.name}" in readModel ${readModel.name}`,
      nodeId: field.id,
    });
    return;
  }
  seen.add(field.name);
}
