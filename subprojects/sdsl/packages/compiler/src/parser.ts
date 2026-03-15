import {
  Document,
  LineCounter,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from 'yaml';
import type { SourceSpan } from './ir.js';
import {
  CANONICAL_SDSL_SOURCE_SUFFIX,
  describeSdslSourceSuffixes,
  isSdslImportPath,
} from './source-files.js';

export interface ParseError {
  message: string;
  file?: string;
  line?: number;
  col?: number;
}

export interface RawDecorator {
  name: string;
  args?: string;
  sourceSpan?: SourceSpan;
}

export interface RawModelField {
  name: string;
  typeExpr: string;
  decorators: RawDecorator[];
  sourceSpan?: SourceSpan;
}

export interface RawModel {
  name: string;
  fields: RawModelField[];
  sourceSpan?: SourceSpan;
}

export interface RawCompiler {
  target?: string;
  language?: string;
  profile?: string;
  sourceSpan?: SourceSpan;
}

export interface RawApp {
  name?: string;
  packageName?: string;
  sourceSpan?: SourceSpan;
}

export interface RawResourceAuth {
  mode?: string;
  roles?: string[];
  policy?: string;
  sourceSpan?: SourceSpan;
}

export interface RawResourceOperations {
  list?: boolean;
  get?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
  sourceSpan?: SourceSpan;
}

export interface RawResource {
  name: string;
  model?: string;
  api?: string;
  auth?: RawResourceAuth;
  operations?: RawResourceOperations;
  create?: RawResourceCreate;
  update?: RawResourceUpdate;
  workflow?: string;
  sourceSpan?: SourceSpan;
}

export interface RawResourceCreate {
  includes: RawResourceCreateInclude[];
  rules?: string;
  sourceSpan?: SourceSpan;
}

export interface RawResourceUpdate {
  includes: RawResourceCreateInclude[];
  sourceSpan?: SourceSpan;
}

export interface RawResourceCreateInclude {
  field: string;
  fields: string[];
  sourceSpan?: SourceSpan;
}

export interface RawReadModel {
  name: string;
  api?: string;
  auth?: RawResourceAuth;
  inputs: RawModelField[];
  result: RawModelField[];
  handler?: string;
  rules?: string;
  sourceSpan?: SourceSpan;
}

export interface RawAST {
  app?: RawApp;
  compiler?: RawCompiler;
  imports: string[];
  models: RawModel[];
  resources: RawResource[];
  readModels: RawReadModel[];
}

export interface ParseResult {
  ast: RawAST;
  errors: ParseError[];
}

const DECORATOR_REGEX = /@(\w+)(?:\(([^)]*)\))?/g;

export function parseDecorators(input: string): { baseName: string; decorators: RawDecorator[] } {
  const decorators: RawDecorator[] = [];
  let baseName = input;
  const firstAt = input.indexOf('@');
  if (firstAt >= 0) {
    baseName = input.slice(0, firstAt).trim();
    const decoratorPart = input.slice(firstAt);
    let match: RegExpExecArray | null;
    DECORATOR_REGEX.lastIndex = 0;
    while ((match = DECORATOR_REGEX.exec(decoratorPart)) !== null) {
      decorators.push({
        name: match[1],
        args: match[2] || undefined,
      });
    }
  }
  return { baseName: baseName.trim(), decorators };
}

export function parse(source: string, fileName: string = `app${CANONICAL_SDSL_SOURCE_SUFFIX}`): ParseResult {
  const ast: RawAST = {
    imports: [],
    models: [],
    resources: [],
    readModels: [],
  };
  const errors: ParseError[] = [];

  let doc: Document;
  const lineCounter = new LineCounter();
  const normalizedSource = preprocessRelationTypeExprs(source);
  try {
    doc = parseDocument(normalizedSource, {
      merge: false,
      uniqueKeys: true,
      lineCounter,
    });
  } catch (error) {
    errors.push({
      message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`,
      file: fileName,
    });
    return { ast, errors };
  }

  for (const error of doc.errors) {
    errors.push({
      message: error.message,
      file: fileName,
    });
  }

  const root = doc.contents;
  detectUnsupportedYamlFeatures(root, fileName, errors);
  if (errors.length > 0) {
    return { ast, errors };
  }
  if (!isMap(root)) {
    errors.push({ message: 'Root document must be a YAML mapping', file: fileName });
    return { ast, errors };
  }

  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const sourceSpan = getPairSpan(pair, fileName, lineCounter);

    if (key === 'app') {
      ast.app = parseAppBlock(pair.value, fileName, lineCounter, errors, sourceSpan);
      continue;
    }
    if (key === 'compiler') {
      ast.compiler = parseCompilerBlock(pair.value, fileName, lineCounter, errors, sourceSpan);
      continue;
    }
    if (key === 'imports') {
      ast.imports = parseImportsBlock(pair.value, fileName, lineCounter, errors, sourceSpan);
      continue;
    }
    if (key.startsWith('model ')) {
      const model = parseModelBlock(key.slice(6).trim(), pair.value, fileName, lineCounter, errors, sourceSpan);
      if (model) ast.models.push(model);
      continue;
    }
    if (key.startsWith('resource ')) {
      const resource = parseResourceBlock(key.slice(9).trim(), pair.value, fileName, lineCounter, errors, sourceSpan);
      if (resource) ast.resources.push(resource);
      continue;
    }
    if (key.startsWith('readModel ')) {
      const readModel = parseReadModelBlock(key.slice(10).trim(), pair.value, fileName, lineCounter, errors, sourceSpan);
      if (readModel) ast.readModels.push(readModel);
      continue;
    }

    errors.push({
      message: `Unknown top-level key: "${key}"`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
  }

  return { ast, errors };
}

function preprocessRelationTypeExprs(source: string): string {
  return source.replace(
    /^(\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*)(hasMany\([^#\n]*\)(?:\s+@\w+(?:\([^)]*\))?)*)((?:\s+#.*)?)$/gm,
    (_match, prefix: string, expr: string, suffix: string) => {
      const trimmed = expr.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith('\'')) {
        return `${prefix}${expr}${suffix}`;
      }
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      return `${prefix}"${escaped}"${suffix}`;
    },
  );
}

function detectUnsupportedYamlFeatures(node: unknown, fileName: string, errors: ParseError[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (isAlias(node)) {
    errors.push({
      message: `YAML aliases are not supported in ${describeSdslSourceSuffixes()} files`,
      file: fileName,
    });
    return;
  }

  const maybeAnchored = node as { anchor?: string | null };
  if (maybeAnchored.anchor) {
    errors.push({
      message: `YAML anchors are not supported in ${describeSdslSourceSuffixes()} files`,
      file: fileName,
    });
  }

  if (isPair(node)) {
    detectUnsupportedYamlFeatures(node.key, fileName, errors);
    detectUnsupportedYamlFeatures(node.value, fileName, errors);
    return;
  }
  if (isMap(node) || isSeq(node)) {
    for (const item of node.items) {
      detectUnsupportedYamlFeatures(item, fileName, errors);
    }
  }
}

function parseAppBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawApp | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'app must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const app: RawApp = { sourceSpan };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const value = getScalarValue(pair.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'name') {
      app.name = value;
      continue;
    }
    if (key === 'package') {
      app.packageName = value;
      continue;
    }
    errors.push({
      message: `Unknown app key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return app;
}

function parseCompilerBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawCompiler | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'compiler must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const compiler: RawCompiler = { sourceSpan };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const value = getScalarValue(pair.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'target') {
      compiler.target = value;
      continue;
    }
    if (key === 'language') {
      compiler.language = value;
      continue;
    }
    if (key === 'profile') {
      compiler.profile = value;
      continue;
    }
    errors.push({
      message: `Unknown compiler key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return compiler;
}

function parseImportsBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): string[] {
  if (!isSeq(node)) {
    errors.push({
      message: `imports must be a YAML sequence of relative ${describeSdslSourceSuffixes()} paths or directories`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return [];
  }

  const imports: string[] = [];
  for (const item of node.items) {
    const value = getScalarValue(item);
    const itemSpan = getNodeSpan(item, fileName, lineCounter);
    if (!value) {
      errors.push({
        message: 'imports entries must be non-empty strings',
        file: fileName,
        line: itemSpan?.startLine,
        col: itemSpan?.startCol,
      });
      continue;
    }
    if (!value.startsWith('./') && !value.startsWith('../')) {
      errors.push({
        message: `imports entry must be relative: "${value}"`,
        file: fileName,
        line: itemSpan?.startLine,
        col: itemSpan?.startCol,
      });
      continue;
    }
    if (!isSdslImportPath(value)) {
      errors.push({
        message: `imports entry must end with ${describeSdslSourceSuffixes()} or "/": "${value}"`,
        file: fileName,
        line: itemSpan?.startLine,
        col: itemSpan?.startCol,
      });
      continue;
    }
    imports.push(value);
  }
  return imports;
}

function parseModelBlock(
  modelName: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawModel | undefined {
  if (!isMap(node)) {
    errors.push({
      message: `model ${modelName} must be a YAML mapping`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const model: RawModel = {
    name: modelName,
    fields: [],
    sourceSpan,
  };

  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const fieldName = String(pair.key.value);
    const typeExprValue = getScalarValue(pair.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!typeExprValue) {
      errors.push({
        message: `model ${modelName} field "${fieldName}" must have a scalar type expression`,
        file: fileName,
        line: pairSpan?.startLine,
        col: pairSpan?.startCol,
      });
      continue;
    }

    const { baseName, decorators } = parseDecorators(typeExprValue);
    model.fields.push({
      name: fieldName,
      typeExpr: baseName,
      decorators: decorators.map((decorator) => ({ ...decorator, sourceSpan: pairSpan })),
      sourceSpan: pairSpan,
    });
  }

  return model;
}

function parseFieldMapBlock(
  ownerLabel: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawModelField[] | undefined {
  if (!isMap(node)) {
    errors.push({
      message: `${ownerLabel} must be a YAML mapping`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const fields: RawModelField[] = [];
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const fieldName = String(pair.key.value);
    const typeExprValue = getScalarValue(pair.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!typeExprValue) {
      errors.push({
        message: `${ownerLabel} field "${fieldName}" must have a scalar type expression`,
        file: fileName,
        line: pairSpan?.startLine,
        col: pairSpan?.startCol,
      });
      continue;
    }

    const { baseName, decorators } = parseDecorators(typeExprValue);
    fields.push({
      name: fieldName,
      typeExpr: baseName,
      decorators: decorators.map((decorator) => ({ ...decorator, sourceSpan: pairSpan })),
      sourceSpan: pairSpan,
    });
  }

  return fields;
}

function parseResourceBlock(
  resourceName: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResource | undefined {
  if (!isMap(node)) {
    errors.push({
      message: `resource ${resourceName} must be a YAML mapping`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const resource: RawResource = {
    name: resourceName,
    sourceSpan,
  };

  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'model') {
      resource.model = getScalarValue(pair.value);
      continue;
    }
    if (key === 'api') {
      resource.api = getScalarValue(pair.value);
      continue;
    }
    if (key === 'auth') {
      resource.auth = parseResourceAuthBlock(pair.value, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key === 'operations') {
      resource.operations = parseResourceOperationsBlock(pair.value, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key === 'create') {
      resource.create = parseResourceCreateBlock(pair.value, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key === 'update') {
      resource.update = parseResourceUpdateBlock(pair.value, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key === 'workflow') {
      resource.workflow = getScalarValue(pair.value);
      continue;
    }
    errors.push({
      message: `Unknown resource key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return resource;
}

function parseReadModelBlock(
  readModelName: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawReadModel | undefined {
  if (!isMap(node)) {
    errors.push({
      message: `readModel ${readModelName} must be a YAML mapping`,
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const readModel: RawReadModel = {
    name: readModelName,
    inputs: [],
    result: [],
    sourceSpan,
  };

  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'api') {
      readModel.api = getScalarValue(pair.value);
      continue;
    }
    if (key === 'auth') {
      readModel.auth = parseResourceAuthBlock(pair.value, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key === 'inputs') {
      readModel.inputs = parseFieldMapBlock(`readModel ${readModelName} inputs`, pair.value, fileName, lineCounter, errors, pairSpan) ?? [];
      continue;
    }
    if (key === 'result') {
      readModel.result = parseFieldMapBlock(`readModel ${readModelName} result`, pair.value, fileName, lineCounter, errors, pairSpan) ?? [];
      continue;
    }
    if (key === 'handler') {
      readModel.handler = getScalarValue(pair.value);
      continue;
    }
    if (key === 'rules') {
      readModel.rules = getScalarValue(pair.value);
      continue;
    }
    errors.push({
      message: `Unknown readModel key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return readModel;
}

function parseResourceAuthBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResourceAuth | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'resource auth must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const auth: RawResourceAuth = { sourceSpan };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'mode') {
      auth.mode = getScalarValue(pair.value);
      continue;
    }
    if (key === 'roles') {
      if (!isSeq(pair.value)) {
        errors.push({
          message: 'resource auth roles must be a YAML sequence',
          file: fileName,
          line: pairSpan?.startLine,
          col: pairSpan?.startCol,
        });
        continue;
      }
      auth.roles = pair.value.items
        .map((item) => getScalarValue(item))
        .filter((value): value is string => Boolean(value));
      continue;
    }
    if (key === 'policy') {
      auth.policy = getScalarValue(pair.value);
      continue;
    }
    errors.push({
      message: `Unknown auth key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }
  return auth;
}

function parseResourceOperationsBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResourceOperations | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'resource operations must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const operations: RawResourceOperations = { sourceSpan };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    const boolValue = getBooleanValue(pair.value);
    if (boolValue === undefined) {
      errors.push({
        message: `resource operations "${key}" must be boolean`,
        file: fileName,
        line: pairSpan?.startLine,
        col: pairSpan?.startCol,
      });
      continue;
    }

    if (key === 'list') {
      operations.list = boolValue;
      continue;
    }
    if (key === 'get') {
      operations.get = boolValue;
      continue;
    }
    if (key === 'create') {
      operations.create = boolValue;
      continue;
    }
    if (key === 'update') {
      operations.update = boolValue;
      continue;
    }
    if (key === 'delete') {
      operations.delete = boolValue;
      continue;
    }
    errors.push({
      message: `Unknown operations key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }
  return operations;
}

function parseResourceCreateBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResourceCreate | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'resource create must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const create: RawResourceCreate = {
    includes: [],
    sourceSpan,
  };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'includes') {
      if (!isSeq(pair.value)) {
        errors.push({
          message: 'resource create includes must be a YAML sequence',
          file: fileName,
          line: pairSpan?.startLine,
          col: pairSpan?.startCol,
        });
        continue;
      }
      create.includes = pair.value.items
        .map((item) => parseResourceCreateInclude(item, fileName, lineCounter))
        .filter((entry): entry is RawResourceCreateInclude => Boolean(entry));
      continue;
    }
    if (key === 'rules') {
      create.rules = getScalarValue(pair.value);
      continue;
    }
    errors.push({
      message: `Unknown create key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return create;
}

function parseResourceUpdateBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResourceUpdate | undefined {
  if (!isMap(node)) {
    errors.push({
      message: 'resource update must be a YAML mapping',
      file: fileName,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const update: RawResourceUpdate = {
    includes: [],
    sourceSpan,
  };
  for (const pair of node.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'includes') {
      if (!isSeq(pair.value)) {
        errors.push({
          message: 'resource update includes must be a YAML sequence',
          file: fileName,
          line: pairSpan?.startLine,
          col: pairSpan?.startCol,
        });
        continue;
      }
      update.includes = pair.value.items
        .map((item) => parseResourceCreateInclude(item, fileName, lineCounter))
        .filter((entry): entry is RawResourceCreateInclude => Boolean(entry));
      continue;
    }
    errors.push({
      message: `Unknown update key: "${key}"`,
      file: fileName,
      line: pairSpan?.startLine,
      col: pairSpan?.startCol,
    });
  }

  return update;
}

function parseResourceCreateInclude(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawResourceCreateInclude | null {
  if (!isMap(node)) {
    return null;
  }
  const field = getScalarValue(getMapValue(node as YAMLMap, 'field'));
  if (!field) {
    return null;
  }
  const fieldsNode = getMapValue(node as YAMLMap, 'fields');
  const fields = isSeq(fieldsNode)
    ? fieldsNode.items
      .map((item) => getScalarValue(item))
      .filter((value): value is string => Boolean(value))
    : [];
  return {
    field,
    fields,
    sourceSpan: getNodeSpan(node, fileName, lineCounter),
  };
}

function getScalarValue(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  const value = node.value;
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function getBooleanValue(node: unknown): boolean | undefined {
  if (!isScalar(node)) return undefined;
  return typeof node.value === 'boolean' ? node.value : undefined;
}

function getMapValue(map: YAMLMap, key: string): unknown {
  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    if (String(pair.key.value) === key) {
      return pair.value;
    }
  }
  return undefined;
}

function getNodeSpan(node: unknown, fileName: string, lineCounter: LineCounter): SourceSpan | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const rangedNode = node as { range?: [number, number, number?] | null };
  if (!rangedNode.range) return undefined;
  return rangeToSourceSpan(rangedNode.range, fileName, lineCounter);
}

function getPairSpan(pair: Pair | undefined, fileName: string, lineCounter: LineCounter): SourceSpan | undefined {
  if (!pair) return undefined;
  const keyRange = pair.key && typeof pair.key === 'object' && 'range' in pair.key
    ? (pair.key as { range?: [number, number, number?] | null }).range
    : undefined;
  const valueRange = pair.value && typeof pair.value === 'object' && 'range' in pair.value
    ? (pair.value as { range?: [number, number, number?] | null }).range
    : undefined;
  if (keyRange && valueRange) {
    return rangeToSourceSpan([keyRange[0], valueRange[1]], fileName, lineCounter);
  }
  if (valueRange) {
    return rangeToSourceSpan(valueRange, fileName, lineCounter);
  }
  if (keyRange) {
    return rangeToSourceSpan(keyRange, fileName, lineCounter);
  }
  return undefined;
}

function rangeToSourceSpan(
  range: readonly [number, number] | readonly [number, number, number?],
  file: string,
  lineCounter: LineCounter,
): SourceSpan {
  const start = lineCounter.linePos(range[0]);
  const end = lineCounter.linePos(range[1]);
  return {
    file,
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
  };
}
