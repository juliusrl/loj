import type {
  EscapeHatchStats,
  IRAppConfig,
  IRAuthPolicyEscape,
  IRCompilerConfig,
  IRFieldDecorator,
  IRFieldType,
  IRFlowLink,
  IRModel,
  IRModelField,
  IRReadModel,
  IRReadModelAuth,
  IRReadModelField,
  IRReadModelHandlerEscape,
  IRRulesLink,
  IRResource,
  IRResourceAuth,
  IRResourceCreate,
  IRResourceCreateInclude,
  IRResourceOperations,
  IRResourceUpdate,
  IRSdslProgram,
} from './ir.js';
import { compileFlowSource, isFlowSourceFile } from './flow-proof.js';
import { compileRulesSource, isRulesSourceFile } from './rules-proof.js';
import type {
  RawAST,
  RawDecorator,
  RawModel,
  RawModelField,
  RawReadModel,
  RawResource,
  RawResourceCreate,
} from './parser.js';
import {
  dirnameProjectPath,
  resolveProjectPath,
  toProjectRelativePath,
} from './project-paths.js';
import {
  formatBackendTargetTriple,
  isImplementedBackendTargetDescriptor,
  listImplementedBackendTargetTriples,
  listKnownBackendTargetTriples,
  listKnownBackendTargets,
  resolveBackendCompilerInput,
} from './targets.js';
import { CANONICAL_SDSL_SOURCE_SUFFIX } from './source-files.js';

export interface NormalizeError {
  message: string;
  nodeId?: string;
}

export interface NormalizeOptions {
  entryFile?: string;
  sourceFiles?: string[];
  moduleGraph?: Record<string, string[]>;
  projectRoot?: string;
  readFile?: (fileName: string) => string | undefined;
}

export interface NormalizeResult {
  ir?: IRSdslProgram;
  errors: NormalizeError[];
}

const JAVA_PACKAGE_REGEX = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ROLE_REGEX = /^[A-Z][A-Z0-9_]*$/;
const BACKEND_POLICY_FN_REGEX = /^@fn\(["'](.+?)["']\)$/;
const BACKEND_POLICY_SQL_REGEX = /^@sql\(["'](.+?)["']\)$/;
const BACKEND_POLICY_RULES_REGEX = /^@rules\(["'](.+?)["']\)$/;
const BACKEND_POLICY_FLOW_REGEX = /^@flow\(["'](.+?)["']\)$/;
const ESCAPE_BUDGET_PERCENT = 20;

export function normalize(ast: RawAST, options: NormalizeOptions = {}): NormalizeResult {
  const errors: NormalizeError[] = [];
  if (!ast.app) {
    errors.push({ message: 'Root app block is required', nodeId: 'app' });
  }

  const app = normalizeApp(ast, errors);
  const compiler = normalizeCompiler(ast, errors);
  const models = normalizeModels(ast.models, errors);
  const modelMap = new Map(models.map((model) => [model.name, model]));
  const modelNames = new Set(models.map((model) => model.name));
  validateRelations(models, modelNames, errors);
  const resources = compiler
    ? normalizeResources(ast.resources, modelNames, modelMap, compiler, errors, options.projectRoot, options.readFile)
    : [];
  const readModels = compiler
    ? normalizeReadModels(ast.readModels, compiler, errors, options.projectRoot, options.readFile)
    : [];

  if (errors.length > 0 || !app || !compiler) {
    return { errors };
  }

  const ir: IRSdslProgram = {
      id: 'program',
      kind: 'program',
      schemaVersion: '0.1.0',
      entryFile: options.entryFile ?? `app${CANONICAL_SDSL_SOURCE_SUFFIX}`,
      sourceFiles: options.sourceFiles ?? [options.entryFile ?? `app${CANONICAL_SDSL_SOURCE_SUFFIX}`],
      moduleGraph: options.moduleGraph ?? {},
      app,
      compiler,
      models,
      resources,
      readModels,
      sourceSpan: ast.app?.sourceSpan,
  };
  ir.escapeStats = computeEscapeStats(ir);

  return {
    ir,
    errors,
  };
}

function computeEscapeStats(ir: IRSdslProgram): EscapeHatchStats {
  let totalNodes = 0;
  let fnCount = 0;
  let sqlCount = 0;

  for (const model of ir.models) {
    totalNodes += model.fields.length;
  }

  for (const resource of ir.resources) {
    totalNodes += 1;
    if (resource.auth.policy) {
      totalNodes += 1;
      if (resource.auth.policy.source === 'fn') {
        fnCount += 1;
      }
    }
    if (resource.create) {
      totalNodes += 1;
      totalNodes += resource.create.includes.length;
      if (resource.create.rules) {
        totalNodes += 1;
      }
    }
    if (resource.update) {
      totalNodes += 1;
      totalNodes += resource.update.includes.length;
    }
    if (resource.workflow) {
      totalNodes += 1;
    }
  }

  for (const readModel of ir.readModels) {
    totalNodes += 1;
    totalNodes += readModel.inputs.length;
    totalNodes += readModel.result.length;
    totalNodes += 1;
    if (readModel.handler.source === 'fn') {
      fnCount += 1;
    } else if (readModel.handler.source === 'sql') {
      sqlCount += 1;
    }
    if (readModel.rules) {
      totalNodes += 1;
    }
  }

  totalNodes = Math.max(totalNodes, 1);
  const escapePercent = Math.round(((fnCount + sqlCount) / totalNodes) * 100);
  return {
    totalNodes,
    exprCount: 0,
    fnCount,
    sqlCount,
    customCount: 0,
    escapePercent,
    overBudget: escapePercent > ESCAPE_BUDGET_PERCENT,
  };
}

function normalizeApp(ast: RawAST, errors: NormalizeError[]): IRAppConfig | undefined {
  const raw = ast.app;
  if (!raw) return undefined;

  if (!raw.name) {
    errors.push({ message: 'app.name is required', nodeId: 'app' });
  }
  if (!raw.packageName) {
    errors.push({ message: 'app.package is required', nodeId: 'app' });
  } else if (!JAVA_PACKAGE_REGEX.test(raw.packageName)) {
    errors.push({ message: `app.package must be a valid dotted Java package: "${raw.packageName}"`, nodeId: 'app' });
  }

  if (!raw.name || !raw.packageName || !JAVA_PACKAGE_REGEX.test(raw.packageName)) {
    return undefined;
  }

  return {
    id: 'app',
    kind: 'app',
    name: raw.name,
    packageName: raw.packageName,
    sourceSpan: raw.sourceSpan,
  };
}

function normalizeCompiler(ast: RawAST, errors: NormalizeError[]): IRCompilerConfig | undefined {
  const resolved = resolveBackendCompilerInput(ast.compiler);
  if (ast.compiler?.target && !resolved.targetDescriptor) {
    errors.push({
      message: `compiler.target must be one of ${listKnownBackendTargets().map((value) => `"${value}"`).join(', ')}`,
      nodeId: 'compiler',
    });
  }
  if (!resolved.descriptor) {
    errors.push({
      message: `Unsupported compiler combination "${formatBackendTargetTriple(resolved)}". Known backend-family targets: ${listKnownBackendTargetTriples().join(', ')}`,
      nodeId: 'compiler',
    });
  } else if (!isImplementedBackendTargetDescriptor(resolved.descriptor)) {
    errors.push({
      message: `compiler target "${resolved.descriptor.key}" is planned but not implemented yet; current generated backend target is ${listImplementedBackendTargetTriples().join(', ')}`,
      nodeId: 'compiler',
    });
  }
  if (errors.some((error) => error.nodeId === 'compiler') || !resolved.descriptor) {
    return undefined;
  }

  return {
    id: 'compiler',
    kind: 'compiler',
    target: resolved.descriptor.target,
    language: resolved.descriptor.language,
    profile: resolved.descriptor.profile,
    sourceSpan: ast.compiler?.sourceSpan,
  };
}

function normalizeModels(rawModels: RawModel[], errors: NormalizeError[]): IRModel[] {
  const seen = new Set<string>();
  const models: IRModel[] = [];
  for (const rawModel of rawModels) {
    const nodeId = `model.${rawModel.name}`;
    if (seen.has(rawModel.name)) {
      errors.push({ message: `Duplicate model name: "${rawModel.name}"`, nodeId });
      continue;
    }
    seen.add(rawModel.name);
    if (rawModel.fields.length === 0) {
      errors.push({ message: `model ${rawModel.name} must define at least one field`, nodeId });
      continue;
    }
    const fields = rawModel.fields
      .map((rawField) => normalizeModelField(rawModel.name, rawField, errors))
      .filter((field): field is IRModelField => Boolean(field));
    models.push({
      id: nodeId,
      kind: 'model',
      name: rawModel.name,
      fields,
      sourceSpan: rawModel.sourceSpan,
    });
  }
  return models;
}

function normalizeModelField(modelName: string, rawField: RawModelField, errors: NormalizeError[]): IRModelField | undefined {
  const nodeId = `model.${modelName}.field.${rawField.name}`;
  const fieldType = normalizeFieldType(rawField.typeExpr, nodeId, errors);
  if (!fieldType) {
    return undefined;
  }
  const decorators = rawField.decorators
    .map((decorator) => normalizeDecorator(nodeId, fieldType, decorator, errors))
    .filter((decorator): decorator is IRFieldDecorator => Boolean(decorator));

  return {
    id: nodeId,
    kind: 'field',
    name: rawField.name,
    fieldType,
    decorators,
    sourceSpan: rawField.sourceSpan,
  };
}

function validateRelations(models: IRModel[], modelNames: Set<string>, errors: NormalizeError[]): void {
  const modelMap = new Map(models.map((model) => [model.name, model]));
  for (const model of models) {
    for (const field of model.fields) {
      if (field.fieldType.type !== 'relation') {
        continue;
      }
      if (!modelNames.has(field.fieldType.target)) {
        errors.push({
          message: `model ${model.name} field ${field.name} references unknown relation target "${field.fieldType.target}"`,
          nodeId: field.id,
        });
        continue;
      }
      const relationField = field.fieldType;
      if (relationField.kind !== 'hasMany') {
        continue;
      }
      if (field.decorators.length > 0) {
        errors.push({
          message: `model ${model.name} field ${field.name} is a hasMany() inverse relation and does not support field decorators`,
          nodeId: field.id,
        });
      }
      const targetModel = modelMap.get(field.fieldType.target);
      if (!targetModel) {
        continue;
      }
      const inverseField = targetModel.fields.find((candidate) => candidate.name === relationField.by);
      if (!inverseField) {
        errors.push({
          message: `model ${model.name} field ${field.name} references missing inverse field "${relationField.by}" on model "${targetModel.name}"`,
          nodeId: field.id,
        });
        continue;
      }
      if (
        inverseField.fieldType.type !== 'relation'
        || inverseField.fieldType.kind !== 'belongsTo'
        || inverseField.fieldType.target !== model.name
      ) {
        errors.push({
          message: `model ${model.name} field ${field.name} must reference a belongsTo(${model.name}) field via by: "${relationField.by}" on model "${targetModel.name}"`,
          nodeId: field.id,
        });
      }
    }
  }
}

function normalizeFieldType(typeExpr: string, nodeId: string, errors: NormalizeError[]): IRFieldType | undefined {
  const relationMatch = typeExpr.match(/^belongsTo\(\s*([^)]+?)\s*\)$/);
  if (relationMatch) {
    const target = relationMatch[1].trim();
    if (!target) {
      errors.push({ message: 'belongsTo() must reference a target model', nodeId });
      return undefined;
    }
    return { type: 'relation', kind: 'belongsTo', target };
  }
  if (typeExpr.startsWith('belongsTo(')) {
    errors.push({ message: 'belongsTo() must use the form belongsTo(Target)', nodeId });
    return undefined;
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
    errors.push({ message: 'hasMany() must use the form hasMany(Target, by: relationField)', nodeId });
    return undefined;
  }

  const enumMatch = typeExpr.match(/^enum\(([^)]+)\)$/);
  if (enumMatch) {
    const values = enumMatch[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) {
      errors.push({ message: 'enum type must declare at least one value', nodeId });
      return undefined;
    }
    return { type: 'enum', values };
  }

  if (
    typeExpr === 'string' ||
    typeExpr === 'text' ||
    typeExpr === 'integer' ||
    typeExpr === 'long' ||
    typeExpr === 'decimal' ||
    typeExpr === 'boolean' ||
    typeExpr === 'datetime' ||
    typeExpr === 'date'
  ) {
    return { type: 'scalar', name: typeExpr };
  }

  errors.push({ message: `Unsupported field type: "${typeExpr}"`, nodeId });
  return undefined;
}

function normalizeDecorator(
  nodeId: string,
  fieldType: IRFieldType,
  decorator: RawDecorator,
  errors: NormalizeError[],
): IRFieldDecorator | undefined {
  if (decorator.name === 'email') {
    if (fieldType.type !== 'scalar' || fieldType.name !== 'string') {
      errors.push({ message: '@email only applies to string fields', nodeId });
      return undefined;
    }
    return { name: 'email', sourceSpan: decorator.sourceSpan };
  }

  if (decorator.name === 'minLen' || decorator.name === 'maxLen') {
    if (fieldType.type !== 'scalar' || (fieldType.name !== 'string' && fieldType.name !== 'text')) {
      errors.push({ message: `@${decorator.name} only applies to string or text fields`, nodeId });
      return undefined;
    }
    const value = decorator.args ? Number.parseInt(decorator.args, 10) : Number.NaN;
    if (!Number.isInteger(value)) {
      errors.push({ message: `@${decorator.name} requires one integer argument`, nodeId });
      return undefined;
    }
    return { name: decorator.name, args: [value], sourceSpan: decorator.sourceSpan };
  }

  if (decorator.name === 'createdAt' || decorator.name === 'updatedAt') {
    if (fieldType.type !== 'scalar' || fieldType.name !== 'datetime') {
      errors.push({ message: `@${decorator.name} only applies to datetime fields`, nodeId });
      return undefined;
    }
    return { name: decorator.name, sourceSpan: decorator.sourceSpan };
  }

  if (
    decorator.name === 'required' ||
    decorator.name === 'unique'
  ) {
    return { name: decorator.name, sourceSpan: decorator.sourceSpan };
  }

  errors.push({ message: `Unsupported decorator: "@${decorator.name}"`, nodeId });
  return undefined;
}

function normalizeResources(
  rawResources: RawResource[],
  modelNames: Set<string>,
  modelMap: Map<string, IRModel>,
  compiler: IRCompilerConfig,
  errors: NormalizeError[],
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRResource[] {
  const seen = new Set<string>();
  const resources: IRResource[] = [];
  for (const rawResource of rawResources) {
    const nodeId = `resource.${rawResource.name}`;
    if (seen.has(rawResource.name)) {
      errors.push({ message: `Duplicate resource name: "${rawResource.name}"`, nodeId });
      continue;
    }
    seen.add(rawResource.name);
    if (!rawResource.model) {
      errors.push({ message: `resource ${rawResource.name} requires model`, nodeId });
      continue;
    }
    if (!modelNames.has(rawResource.model)) {
      errors.push({ message: `resource ${rawResource.name} references unknown model "${rawResource.model}"`, nodeId });
      continue;
    }
    if (!rawResource.api) {
      errors.push({ message: `resource ${rawResource.name} requires api`, nodeId });
      continue;
    }
    if (!rawResource.api.startsWith('/')) {
      errors.push({ message: `resource ${rawResource.name} api must start with "/"`, nodeId });
      continue;
    }

    const auth = normalizeResourceAuth(nodeId, rawResource, modelMap, compiler, errors, projectRoot, readFile);
    const operations = normalizeResourceOperations(nodeId, rawResource);
    const create = normalizeResourceCreate(
      nodeId,
      rawResource,
      errors,
      projectRoot,
      readFile,
    );
    const update = normalizeResourceUpdate(
      nodeId,
      rawResource,
    );
    const workflow = rawResource.workflow
      ? normalizeFlowLink(
        rawResource.workflow,
        rawResource.sourceSpan?.file,
        errors,
        nodeId,
        'resource workflow',
        projectRoot,
        readFile,
      )
      : undefined;
    resources.push({
      id: nodeId,
      kind: 'resource',
      name: rawResource.name,
      model: rawResource.model,
      api: rawResource.api,
      auth,
      operations,
      create,
      update,
      workflow,
      sourceSpan: rawResource.sourceSpan,
    });
  }
  return resources;
}

function normalizeResourceAuth(
  nodeId: string,
  rawResource: RawResource,
  modelMap: Map<string, IRModel>,
  compiler: IRCompilerConfig,
  errors: NormalizeError[],
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRResourceAuth {
  const mode = rawResource.auth?.mode === 'public' ? 'public' : 'authenticated';
  const roles = rawResource.auth?.roles ?? [];
  const policy = rawResource.auth?.policy
    ? normalizeAuthPolicy(
      rawResource.auth.policy,
      rawResource.sourceSpan?.file,
      rawResource.model ? modelMap.get(rawResource.model) : undefined,
      compiler,
      errors,
      nodeId,
      projectRoot,
      readFile,
    )
    : undefined;
  if (mode === 'public' && roles.length > 0) {
    errors.push({ message: 'resource auth.roles must be omitted when auth.mode is public', nodeId });
  }
  if (mode === 'public' && policy) {
    errors.push({ message: 'resource auth.policy must be omitted when auth.mode is public', nodeId });
  }
  for (const role of roles) {
    if (!ROLE_REGEX.test(role)) {
      errors.push({ message: `resource auth role must be an uppercase identifier: "${role}"`, nodeId });
    }
  }
  if (rawResource.auth?.mode && rawResource.auth.mode !== 'public' && rawResource.auth.mode !== 'authenticated') {
    errors.push({ message: `resource auth.mode must be "public" or "authenticated": "${rawResource.auth.mode}"`, nodeId });
  }
  return {
    id: `${nodeId}.auth`,
    kind: 'resource.auth',
    mode,
    roles,
    policy,
    sourceSpan: rawResource.auth?.sourceSpan ?? rawResource.sourceSpan,
  };
}

function normalizeReadModels(
  rawReadModels: RawReadModel[],
  compiler: IRCompilerConfig,
  errors: NormalizeError[],
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRReadModel[] {
  const seen = new Set<string>();
  const readModels: IRReadModel[] = [];
  for (const rawReadModel of rawReadModels) {
    const nodeId = `readModel.${rawReadModel.name}`;
    if (seen.has(rawReadModel.name)) {
      errors.push({ message: `Duplicate readModel name: "${rawReadModel.name}"`, nodeId });
      continue;
    }
    seen.add(rawReadModel.name);
    if (!rawReadModel.api) {
      errors.push({ message: `readModel ${rawReadModel.name} requires api`, nodeId });
      continue;
    }
    if (!rawReadModel.api.startsWith('/')) {
      errors.push({ message: `readModel ${rawReadModel.name} api must start with "/"`, nodeId });
      continue;
    }
    if (!rawReadModel.handler) {
      errors.push({ message: `readModel ${rawReadModel.name} requires handler`, nodeId });
      continue;
    }
    if (rawReadModel.result.length === 0) {
      errors.push({ message: `readModel ${rawReadModel.name} must define at least one result field`, nodeId });
      continue;
    }

    const inputs = rawReadModel.inputs
      .map((rawField) => normalizeReadModelField(rawReadModel.name, rawField, 'input', errors))
      .filter((field): field is IRReadModelField => Boolean(field));
    const result = rawReadModel.result
      .map((rawField) => normalizeReadModelField(rawReadModel.name, rawField, 'result', errors))
      .filter((field): field is IRReadModelField => Boolean(field));
    const auth = normalizeReadModelAuth(nodeId, rawReadModel, errors);
    const handler = normalizeReadModelHandler(
      rawReadModel.handler,
      rawReadModel.sourceSpan?.file,
      compiler,
      errors,
      nodeId,
      projectRoot,
      readFile,
    );
    if (!handler) {
      continue;
    }
    const rules = rawReadModel.rules
      ? normalizeRulesLink(
        rawReadModel.rules,
        rawReadModel.sourceSpan?.file,
        errors,
        nodeId,
        'readModel rules',
        projectRoot,
        readFile,
      )
      : undefined;

    readModels.push({
      id: nodeId,
      kind: 'readModel',
      name: rawReadModel.name,
      api: rawReadModel.api,
      auth,
      inputs,
      result,
      handler,
      rules,
      sourceSpan: rawReadModel.sourceSpan,
    });
  }
  return readModels;
}

function normalizeReadModelField(
  readModelName: string,
  rawField: RawModelField,
  section: 'input' | 'result',
  errors: NormalizeError[],
): IRReadModelField | undefined {
  const nodeId = `readModel.${readModelName}.${section}.${rawField.name}`;
  const fieldType = normalizeFieldType(rawField.typeExpr, nodeId, errors);
  if (!fieldType) {
    return undefined;
  }
  if (fieldType.type !== 'scalar') {
    errors.push({
      message: `readModel ${readModelName} ${section} field ${rawField.name} currently supports only scalar field types`,
      nodeId,
    });
    return undefined;
  }
  if (section === 'input' && fieldType.name === 'datetime') {
    errors.push({
      message: `readModel ${readModelName} input field ${rawField.name} does not support datetime yet; use date or string in the current slice`,
      nodeId,
    });
    return undefined;
  }

  const decorators = rawField.decorators
    .map((decorator) => normalizeDecorator(nodeId, fieldType, decorator, errors))
    .filter((decorator): decorator is IRFieldDecorator => Boolean(decorator));

  if (section === 'result' && decorators.length > 0) {
    errors.push({
      message: `readModel ${readModelName} result field ${rawField.name} does not support decorators`,
      nodeId,
    });
    return undefined;
  }
  if (section === 'input') {
    for (const decorator of decorators) {
      if (decorator.name !== 'required') {
        errors.push({
          message: `readModel ${readModelName} input field ${rawField.name} currently supports only @required`,
          nodeId,
        });
        return undefined;
      }
    }
  }

  return {
    id: nodeId,
    kind: 'readModel.field',
    name: rawField.name,
    fieldType,
    decorators,
    section,
    sourceSpan: rawField.sourceSpan,
  };
}

function normalizeReadModelAuth(
  nodeId: string,
  rawReadModel: RawReadModel,
  errors: NormalizeError[],
): IRReadModelAuth {
  const mode = rawReadModel.auth?.mode === 'public' ? 'public' : 'authenticated';
  const roles = rawReadModel.auth?.roles ?? [];
  if (mode === 'public' && roles.length > 0) {
    errors.push({ message: 'readModel auth.roles must be omitted when auth.mode is public', nodeId });
  }
  if (rawReadModel.auth?.policy) {
    errors.push({
      message: 'readModel auth.policy is not supported yet; keep read-model access control to mode/roles and local handler logic in the current slice',
      nodeId,
    });
  }
  for (const role of roles) {
    if (!ROLE_REGEX.test(role)) {
      errors.push({ message: `readModel auth role must be an uppercase identifier: "${role}"`, nodeId });
    }
  }
  if (rawReadModel.auth?.mode && rawReadModel.auth.mode !== 'public' && rawReadModel.auth.mode !== 'authenticated') {
    errors.push({ message: `readModel auth.mode must be "public" or "authenticated": "${rawReadModel.auth.mode}"`, nodeId });
  }
  return {
    id: `${nodeId}.auth`,
    kind: 'readModel.auth',
    mode,
    roles,
    sourceSpan: rawReadModel.auth?.sourceSpan ?? rawReadModel.sourceSpan,
  };
}

function normalizeReadModelHandler(
  input: string,
  sourceFile: string | undefined,
  compiler: IRCompilerConfig,
  errors: NormalizeError[],
  nodeId: string,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRReadModelHandlerEscape | undefined {
  const trimmed = input.trim();
  const fnMatch = trimmed.match(BACKEND_POLICY_FN_REGEX);
  if (fnMatch) {
    const rawPath = fnMatch[1];
    if (hasExplicitBackendExtension(rawPath)) {
      const explicitExtension = rawPath.slice(rawPath.lastIndexOf('.'));
      const expectedExtension = backendPolicyExtension(compiler);
      if (explicitExtension !== expectedExtension) {
        errors.push({
          message: `readModel handler "${rawPath}" is locked to ${explicitExtension}, but current target expects ${expectedExtension}`,
          nodeId,
        });
      }
      const resolvedPath = normalizeBackendPolicyPath(rawPath, sourceFile, projectRoot, errors, nodeId, 'readModel handler');
      if (readFile && !backendHostFileExists(resolvedPath, readFile)) {
        errors.push({
          message: `readModel handler "${rawPath}" did not resolve; expected ${resolvedPath}`,
          nodeId,
        });
      }
      return {
        kind: 'readModel.handler',
        source: 'fn',
        resolvedPath,
        lockIn: 'explicit',
      };
    }

    const basePath = normalizeBackendPolicyPath(rawPath, sourceFile, projectRoot, errors, nodeId, 'readModel handler');
    const candidates = [(`${basePath}${backendPolicyExtension(compiler)}`)];
    const matches = readFile
      ? candidates.filter((candidate) => backendHostFileExists(candidate, readFile))
      : candidates;
    if (readFile && matches.length === 0) {
      errors.push({
        message: `readModel handler "@fn(\\"${rawPath}\\")" did not resolve for ${compiler.target}/${compiler.language}; expected ${candidates.join(' or ')}`,
        nodeId,
      });
    }
    return {
      kind: 'readModel.handler',
      source: 'fn',
      logicalPath: rawPath,
      resolvedPath: matches[0] ?? candidates[0] ?? basePath,
      lockIn: 'neutral',
    };
  }

  const sqlMatch = trimmed.match(BACKEND_POLICY_SQL_REGEX);
  if (!sqlMatch) {
    errors.push({
      message: 'readModel handler must use @fn("./path") or @sql("./path") syntax',
      nodeId,
    });
    return undefined;
  }

  const rawPath = sqlMatch[1];
  if (hasExplicitBackendExtension(rawPath) && !rawPath.endsWith('.sql')) {
    errors.push({
      message: `readModel handler "@sql(\\"${rawPath}\\")" must use an extensionless path or explicit .sql suffix`,
      nodeId,
    });
    return undefined;
  }
  const explicitSqlPath = rawPath.endsWith('.sql');
  const requestedPath = explicitSqlPath ? rawPath : `${rawPath}.sql`;
  const resolvedPath = normalizeBackendPolicyPath(requestedPath, sourceFile, projectRoot, errors, nodeId, 'readModel handler');
  if (readFile) {
    const sqlSource = readFile(resolvedPath);
    if (sqlSource === undefined) {
      errors.push({
        message: `readModel handler "@sql(\\"${rawPath}\\")" did not resolve; expected ${resolvedPath}`,
        nodeId,
      });
      return undefined;
    }
    const sqlKeyword = firstSqlStatementKeyword(sqlSource);
    if (sqlKeyword !== 'select' && sqlKeyword !== 'with') {
      errors.push({
        message: `readModel handler "@sql(\\"${rawPath}\\")" currently supports only SELECT/WITH queries; keep procedures and write-oriented SQL in @fn handlers`,
        nodeId,
      });
      return undefined;
    }
  }
  return {
    kind: 'readModel.handler',
    source: 'sql',
    logicalPath: explicitSqlPath ? undefined : rawPath,
    resolvedPath,
    lockIn: explicitSqlPath ? 'explicit' : 'neutral',
  };
}

function normalizeRulesLink(
  input: string,
  sourceFile: string | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRRulesLink | undefined {
  const trimmed = input.trim();
  const rulesMatch = trimmed.match(BACKEND_POLICY_RULES_REGEX);
  if (!rulesMatch) {
    errors.push({
      message: `${label} must use @rules("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = rulesMatch[1];
  const explicitRulesPath = isRulesSourceFile(rawPath);
  if (!explicitRulesPath && hasExplicitBackendExtension(rawPath)) {
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" must use an extensionless path or explicit .rules.loj suffix`,
      nodeId,
    });
    return undefined;
  }

  const requestedPath = explicitRulesPath ? rawPath : `${rawPath}.rules.loj`;
  const resolvedPath = normalizeBackendPolicyPath(rawPath === requestedPath ? rawPath : requestedPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@rules(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!backendHostFileExists(resolvedPath, readFile)) {
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
  };
}

function normalizeFlowLink(
  input: string,
  sourceFile: string | undefined,
  errors: NormalizeError[],
  nodeId: string,
  label: string,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRFlowLink | undefined {
  const trimmed = input.trim();
  const flowMatch = trimmed.match(BACKEND_POLICY_FLOW_REGEX);
  if (!flowMatch) {
    errors.push({
      message: `${label} must use @flow("./path") syntax`,
      nodeId,
    });
    return undefined;
  }

  const rawPath = flowMatch[1];
  const explicitFlowPath = isFlowSourceFile(rawPath);
  if (!explicitFlowPath && hasExplicitBackendExtension(rawPath)) {
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" must use an extensionless path or explicit .flow.loj suffix`,
      nodeId,
    });
    return undefined;
  }

  const requestedPath = explicitFlowPath ? rawPath : `${rawPath}.flow.loj`;
  const resolvedPath = normalizeBackendPolicyPath(rawPath === requestedPath ? rawPath : requestedPath, sourceFile, projectRoot, errors, nodeId, label);
  if (!readFile) {
    errors.push({
      message: `${label} "@flow(\\"${rawPath}\\")" cannot be resolved because file loading is unavailable`,
      nodeId,
    });
    return undefined;
  }
  if (!backendHostFileExists(resolvedPath, readFile)) {
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
  };
}

function normalizeAuthPolicy(
  input: string,
  sourceFile: string | undefined,
  model: IRModel | undefined,
  compiler: IRCompilerConfig,
  errors: NormalizeError[],
  nodeId: string,
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRAuthPolicyEscape | undefined {
  const trimmed = input.trim();
  const fnMatch = trimmed.match(BACKEND_POLICY_FN_REGEX);
  if (fnMatch) {
    const rawPath = fnMatch[1];
    if (hasExplicitBackendExtension(rawPath)) {
      const explicitExtension = rawPath.slice(rawPath.lastIndexOf('.'));
      const expectedExtension = backendPolicyExtension(compiler);
      if (explicitExtension !== expectedExtension) {
        errors.push({
          message: `resource auth.policy "${rawPath}" is locked to ${explicitExtension}, but current target expects ${expectedExtension}`,
          nodeId,
        });
      }
      const resolvedPath = normalizeBackendPolicyPath(rawPath, sourceFile, projectRoot, errors, nodeId, 'resource auth.policy');
      if (readFile && !backendHostFileExists(resolvedPath, readFile)) {
        errors.push({
          message: `resource auth.policy "${rawPath}" did not resolve; expected ${resolvedPath}`,
          nodeId,
        });
      }
      return {
        kind: 'auth.policy',
        source: 'fn',
        resolvedPath,
        lockIn: 'explicit',
      };
    }

    const basePath = normalizeBackendPolicyPath(rawPath, sourceFile, projectRoot, errors, nodeId, 'resource auth.policy');
    const candidates = [(`${basePath}${backendPolicyExtension(compiler)}`)];
    const matches = readFile
      ? candidates.filter((candidate) => backendHostFileExists(candidate, readFile))
      : candidates;
    if (readFile && matches.length === 0) {
      errors.push({
        message: `resource auth.policy "@fn(\\"${rawPath}\\")" did not resolve for ${compiler.target}/${compiler.language}; expected ${candidates.join(' or ')}`,
        nodeId,
      });
    }
    return {
      kind: 'auth.policy',
      source: 'fn',
      logicalPath: rawPath,
      resolvedPath: matches[0] ?? candidates[0] ?? basePath,
      lockIn: 'neutral',
    };
  }

  const rulesMatch = trimmed.match(BACKEND_POLICY_RULES_REGEX);
  if (!rulesMatch) {
    errors.push({
      message: 'resource auth.policy must use @fn("./path") or @rules("./path") syntax',
      nodeId,
    });
    return undefined;
  }

  if (!model) {
    errors.push({
      message: 'resource auth.policy @rules(...) requires a known resource model',
      nodeId,
    });
    return undefined;
  }
  const rulesLink = normalizeRulesLink(
    input,
    sourceFile,
    errors,
    nodeId,
    'resource auth.policy',
    projectRoot,
    readFile,
  );
  if (!rulesLink) {
    return undefined;
  }

  return {
    kind: 'auth.policy',
    source: 'rules',
    logicalPath: rulesLink.logicalPath,
    resolvedPath: rulesLink.resolvedPath,
    lockIn: rulesLink.lockIn,
    program: rulesLink.program,
    manifest: rulesLink.manifest,
  };
}

function normalizeBackendPolicyPath(
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
  return resolved;
}

function backendPolicyExtension(compiler: IRCompilerConfig): string {
  if (compiler.target === 'fastapi' && compiler.language === 'python') {
    return '.py';
  }
  return compiler.language === 'java' ? '.java' : '.kt';
}

function hasExplicitBackendExtension(rawPath: string): boolean {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  return /\.[A-Za-z0-9]+$/.test(fileName);
}

function backendHostFileExists(
  fileName: string,
  readFile: (fileName: string) => string | undefined,
): boolean {
  try {
    return readFile(fileName) !== undefined;
  } catch {
    return false;
  }
}

function firstSqlStatementKeyword(source: string): string | null {
  const normalized = source
    .replace(/\r\n/g, '\n')
    .replace(/^\s*--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trimStart();
  const match = normalized.match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeResourceOperations(
  nodeId: string,
  rawResource: RawResource,
): IRResourceOperations {
  return {
    id: `${nodeId}.operations`,
    kind: 'resource.operations',
    list: rawResource.operations?.list ?? true,
    get: rawResource.operations?.get ?? true,
    create: rawResource.operations?.create ?? true,
    update: rawResource.operations?.update ?? true,
    delete: rawResource.operations?.delete ?? true,
    sourceSpan: rawResource.operations?.sourceSpan ?? rawResource.sourceSpan,
  };
}

function normalizeResourceCreate(
  nodeId: string,
  rawResource: RawResource,
  errors: NormalizeError[],
  projectRoot?: string,
  readFile?: (fileName: string) => string | undefined,
): IRResourceCreate | undefined {
  if (!rawResource.create) {
    return undefined;
  }
  const rules = rawResource.create.rules
    ? normalizeRulesLink(
      rawResource.create.rules,
      rawResource.sourceSpan?.file,
      errors,
      `${nodeId}.create`,
      'resource create.rules',
      projectRoot,
      readFile,
    )
    : undefined;
  return {
    id: `${nodeId}.create`,
    kind: 'resource.create',
    includes: normalizeResourceCreateIncludes(nodeId, rawResource.create),
    rules,
    sourceSpan: rawResource.create.sourceSpan ?? rawResource.sourceSpan,
  };
}

function normalizeResourceCreateIncludes(
  nodeId: string,
  rawCreate: RawResourceCreate,
): IRResourceCreateInclude[] {
  return rawCreate.includes.map((include, index) => ({
    id: `${nodeId}.create.include.${index}`,
    kind: 'resource.create.include',
    field: include.field,
    fields: include.fields,
    sourceSpan: include.sourceSpan ?? rawCreate.sourceSpan,
  }));
}

function normalizeResourceUpdate(
  nodeId: string,
  rawResource: RawResource,
): IRResourceUpdate | undefined {
  if (!rawResource.update) {
    return undefined;
  }
  return {
    id: `${nodeId}.update`,
    kind: 'resource.update',
    includes: rawResource.update.includes.map((include, index) => ({
      id: `${nodeId}.update.include.${index}`,
      kind: 'resource.create.include',
      field: include.field,
      fields: include.fields,
      sourceSpan: include.sourceSpan ?? rawResource.update!.sourceSpan,
    })),
    sourceSpan: rawResource.update.sourceSpan ?? rawResource.sourceSpan,
  };
}
