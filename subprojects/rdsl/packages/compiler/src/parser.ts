/**
 * ReactDSL Parser
 *
 * Parses .rdsl files (strict YAML subset) into a raw AST.
 *
 * Restrictions vs full YAML:
 *  - No anchors/aliases
 *  - No merge keys
 *  - No custom tags
 *  - No implicit bool/date coercions
 */

import { parseDocument, Document, LineCounter, isAlias, isMap, isSeq, isPair, isScalar, Scalar, YAMLMap, YAMLSeq, Pair, Node as YAMLNode } from 'yaml';
import type {
  CreateHandoffDescriptor,
  DateNavigationDescriptor,
  InputFieldSeedSource,
  MessageLike as SharedMessageLike,
  ReadModelListPresentationDescriptor,
  ReadModelPageConsumerDescriptor,
  RowFieldSeedSource,
  SeedScalarValue,
  SelectionFieldSeedSource,
} from '@loj-lang/shared-contracts';
import type { SourceSpan } from './ir.js';
import {
  CANONICAL_RDSL_SOURCE_SUFFIX,
  describeRdslSourceSuffixes,
} from './source-files.js';

// ─── Raw AST Types ───────────────────────────────────────────────

export interface RawDecorator {
  name: string;
  args?: string;
  sourceSpan?: SourceSpan;
}

export interface RawField {
  name: string;
  typeExpr: string;
  decorators: RawDecorator[];
  sourceSpan?: SourceSpan;
}

export interface RawColumnEntry {
  field: string;
  decorators: RawDecorator[];
  sourceSpan?: SourceSpan;
}

export interface RawFormFieldEntry extends RawColumnEntry {
  rules?: RawRules;
}

export interface RawAction {
  name: string;
  decorators: RawDecorator[];
  sourceSpan?: SourceSpan;
}

export interface RawMessageRef {
  ref: string;
  sourceSpan?: SourceSpan;
}

export type RawToastMessageValue = string | number | boolean | null | RawMessageRef;

export interface RawToastMessageDescriptor {
  key?: string;
  defaultMessage?: string;
  values?: Record<string, RawToastMessageValue>;
  sourceSpan?: SourceSpan;
}

export type RawMessageLike = SharedMessageLike<string | number | boolean | null>;

export interface RawEffect {
  type: string;
  value: string | RawToastMessageDescriptor;
  sourceSpan?: SourceSpan;
}

export interface RawRules {
  visibleIf?: string;
  enabledIf?: string;
  allowIf?: string;
  enforce?: string;
  sourceSpan?: SourceSpan;
}

export type RawViewRules = RawRules | string;

export interface RawListView {
  title?: RawMessageLike;
  style?: string;
  filters?: string[];
  columns?: RawColumnEntry[];
  actions?: RawAction[];
  pagination?: { size?: number; style?: string };
  rules?: RawRules;
  sourceSpan?: SourceSpan;
}

export interface RawEditView {
  style?: string;
  fields?: (string | RawFormFieldEntry)[];
  includes?: RawCreateInclude[];
  rules?: RawViewRules;
  onSuccess?: RawEffect[];
  sourceSpan?: SourceSpan;
}

export interface RawCreateView {
  style?: string;
  fields?: (string | RawFormFieldEntry)[];
  includes?: RawCreateInclude[];
  rules?: RawViewRules;
  onSuccess?: RawEffect[];
  sourceSpan?: SourceSpan;
}

export interface RawCreateInclude {
  field: string;
  fields?: (string | RawFormFieldEntry)[];
  minItems?: number;
  rules?: string;
  sourceSpan?: SourceSpan;
}

export type RawReadModelListView =
  ReadModelListPresentationDescriptor & {
  columns?: RawColumnEntry[];
  pagination?: { size?: number; style?: string };
  sourceSpan?: SourceSpan;
};

export interface RawReadModel {
  name: string;
  api?: string;
  rules?: string;
  inputs: RawField[];
  result: RawField[];
  list?: RawReadModelListView;
  sourceSpan?: SourceSpan;
}

export interface RawReadView {
  title?: RawMessageLike;
  style?: string;
  fields?: RawColumnEntry[];
  related?: string[];
  sourceSpan?: SourceSpan;
}

export interface RawAppSeo {
  siteName?: RawMessageLike;
  defaultTitle?: RawMessageLike;
  titleTemplate?: RawMessageLike;
  defaultDescription?: RawMessageLike;
  defaultImage?: string;
  favicon?: string;
  sourceSpan?: SourceSpan;
}

export interface RawPageSeo {
  description?: RawMessageLike;
  canonicalPath?: string;
  image?: string;
  noIndex?: boolean;
  sourceSpan?: SourceSpan;
}

export interface RawResource {
  name: string;
  model: string;
  api: string;
  workflow?: string;
  workflowStyle?: string;
  workflowSourceSpan?: SourceSpan;
  list?: RawListView;
  edit?: RawEditView;
  create?: RawCreateView;
  read?: RawReadView;
  sourceSpan?: SourceSpan;
}

export interface RawModel {
  name: string;
  fields: RawField[];
  sourceSpan?: SourceSpan;
}

export interface RawNavItem {
  label: RawMessageLike;
  icon?: string;
  target: string;
  sourceSpan?: SourceSpan;
}

export interface RawNavGroup {
  group: RawMessageLike;
  visibleIf?: string;
  items: RawNavItem[];
  sourceSpan?: SourceSpan;
}

export type RawDashboardBlock =
  ReadModelPageConsumerDescriptor & {
  type: string;
  title: RawMessageLike;
  style?: string;
  data?: string;
  dateNavigation?: Omit<DateNavigationDescriptor, 'prevLabel' | 'nextLabel'> & {
    prevLabel?: RawMessageLike;
    nextLabel?: RawMessageLike;
    sourceSpan?: SourceSpan;
  };
  custom?: string;
  rowActions?: RawDashboardRowAction[];
  sourceSpan?: SourceSpan;
};

export type RawDashboardRowSeedValue =
  | SeedScalarValue
  | ((RowFieldSeedSource & InputFieldSeedSource) & {
      sourceSpan?: SourceSpan;
    });

export type RawDashboardRowCreateAction =
  CreateHandoffDescriptor<RawDashboardRowSeedValue> & {
    label?: RawMessageLike;
    sourceSpan?: SourceSpan;
  };

export interface RawDashboardRowAction {
  create: RawDashboardRowCreateAction;
  sourceSpan?: SourceSpan;
}

export type RawPageActionSeedValue =
  | SeedScalarValue
  | ((InputFieldSeedSource & SelectionFieldSeedSource) & {
      sourceSpan?: SourceSpan;
    });

export type RawPageCreateAction =
  CreateHandoffDescriptor<RawPageActionSeedValue> & {
    label?: RawMessageLike;
    sourceSpan?: SourceSpan;
  };

export interface RawPageAction {
  create: RawPageCreateAction;
  sourceSpan?: SourceSpan;
}

export interface RawPage {
  name: string;
  title: RawMessageLike;
  type: string;
  path?: string;
  layout?: string;
  style?: string;
  seo?: RawPageSeo;
  actions?: RawPageAction[];
  blocks: RawDashboardBlock[];
  sourceSpan?: SourceSpan;
}

export interface RawApp {
  name: string;
  theme?: string;
  auth?: string;
  style?: string;
  seo?: RawAppSeo;
  navigation?: RawNavGroup[];
  sourceSpan?: SourceSpan;
}

export interface RawCompiler {
  target?: string;
  sourceSpan?: SourceSpan;
}

export interface RawAST {
  app?: RawApp;
  compiler?: RawCompiler;
  imports: string[];
  models: RawModel[];
  resources: RawResource[];
  readModels: RawReadModel[];
  pages: RawPage[];
}

// ─── Decorator Parser ────────────────────────────────────────────

const DECORATOR_REGEX = /@(\w+)(?:\(([^)]*)\))?/g;

export function parseDecorators(input: string): { baseName: string; decorators: RawDecorator[] } {
  const decorators: RawDecorator[] = [];
  let baseName = input;

  // Extract all @decorator(...) patterns
  const firstAt = input.indexOf('@');
  if (firstAt > 0) {
    baseName = input.substring(0, firstAt).trim();
    const decoratorPart = input.substring(firstAt);
    let match: RegExpExecArray | null;
    DECORATOR_REGEX.lastIndex = 0;
    while ((match = DECORATOR_REGEX.exec(decoratorPart)) !== null) {
      decorators.push({
        name: match[1],
        args: match[2] || undefined,
      });
    }
  } else if (firstAt === 0) {
    // Entire string is decorators (shouldn't happen for fields, but handle gracefully)
    baseName = '';
    let match: RegExpExecArray | null;
    DECORATOR_REGEX.lastIndex = 0;
    while ((match = DECORATOR_REGEX.exec(input)) !== null) {
      decorators.push({
        name: match[1],
        args: match[2] || undefined,
      });
    }
  }

  return { baseName, decorators };
}

// ─── Field Type Parser ───────────────────────────────────────────

export function parseFieldType(expr: string): { typeName: string; enumValues?: string[] } {
  const enumMatch = expr.match(/^enum\(([^)]+)\)$/);
  if (enumMatch) {
    const values = enumMatch[1].split(',').map(v => v.trim());
    return { typeName: 'enum', enumValues: values };
  }
  return { typeName: expr.trim() };
}

// ─── Effect Parser ───────────────────────────────────────────────

export function parseEffect(entry: unknown): RawEffect | null {
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const type = keys[0];
      const value = obj[type];
      if (type === 'toast' && value && typeof value === 'object' && !Array.isArray(value)) {
        return {
          type,
          value: parseToastDescriptorObject(value as Record<string, unknown>),
        };
      }
      return { type, value: String(value) };
    }
  }
  return null;
}

// ─── Column/Field Entry Parser ───────────────────────────────────

export function parseColumnEntry(entry: unknown, sourceSpan?: SourceSpan): RawColumnEntry {
  if (typeof entry === 'string') {
    const { baseName, decorators } = parseDecorators(entry);
    return { field: baseName, decorators, sourceSpan };
  }
  // Shouldn't normally happen in valid DSL, but handle object form
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    return {
      field: String(obj['field'] || ''),
      decorators: [],
      sourceSpan,
    };
  }
  return { field: String(entry), decorators: [], sourceSpan };
}

export function parseFormFieldEntry(
  entry: unknown,
  fileName: string,
  lineCounter: LineCounter,
): string | RawFormFieldEntry {
  if (isScalar(entry)) {
    const value = String((entry as Scalar).value);
    if (value.includes('@')) {
      return parseColumnEntry(value, getNodeSpan(entry, fileName, lineCounter));
    }
    return value;
  }

  if (isMap(entry)) {
    const map = entry as YAMLMap;
    const fieldValue = getMapValue(map, 'field');
    const rawField = fieldValue === undefined
      ? ''
      : String(isScalar(fieldValue) ? (fieldValue as Scalar).value : fieldValue);
    const parsed = parseColumnEntry(rawField, getNodeSpan(entry, fileName, lineCounter));
    const rules = parseRules(map, fileName, lineCounter);
    return {
      ...parsed,
      rules,
      sourceSpan: getNodeSpan(entry, fileName, lineCounter),
    };
  }

  return String(entry);
}

// ─── Action Entry Parser ─────────────────────────────────────────

export function parseActionEntry(entry: unknown, sourceSpan?: SourceSpan): RawAction {
  if (typeof entry === 'string') {
    const { baseName, decorators } = parseDecorators(entry);
    return { name: baseName, decorators, sourceSpan };
  }
  return { name: String(entry), decorators: [], sourceSpan };
}

// ─── Main Parser ─────────────────────────────────────────────────

export interface ParseResult {
  ast: RawAST;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line?: number;
  col?: number;
}

export function parse(source: string, fileName: string = `app${CANONICAL_RDSL_SOURCE_SUFFIX}`): ParseResult {
  const errors: ParseError[] = [];
  const ast: RawAST = {
    imports: [],
    models: [],
    resources: [],
    readModels: [],
    pages: [],
  };

  let doc: Document;
  const lineCounter = new LineCounter();
  const normalizedSource = preprocessRelationTypeExprs(source);
  try {
    doc = parseDocument(normalizedSource, {
      // Strict subset: reject YAML features we don't support
      merge: false,
      uniqueKeys: true,
      lineCounter,
    });
  } catch (err) {
    errors.push({
      message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ast, errors };
  }

  // Check for YAML-level errors
  for (const err of doc.errors) {
    errors.push({ message: err.message, line: err.pos?.[0] });
  }

  const root = doc.contents;
  detectUnsupportedYamlFeatures(root, errors);
  if (errors.length > 0) return { ast, errors };
  if (!isMap(root)) {
    errors.push({ message: 'Root document must be a YAML mapping' });
    return { ast, errors };
  }

  // Walk top-level keys
  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);

    if (key === 'app') {
      ast.app = parseAppBlock(pair.value, fileName, lineCounter, getPairSpan(pair, fileName, lineCounter));
    } else if (key === 'compiler') {
      ast.compiler = parseCompilerBlock(pair.value, fileName, lineCounter, errors, getPairSpan(pair, fileName, lineCounter));
    } else if (key === 'imports') {
      ast.imports = parseImportsBlock(pair.value, fileName, lineCounter, errors, getPairSpan(pair, fileName, lineCounter));
    } else if (key.startsWith('model ')) {
      const modelName = key.substring(6).trim();
      const model = parseModelBlock(modelName, pair.value, fileName, lineCounter, getPairSpan(pair, fileName, lineCounter));
      if (model) ast.models.push(model);
    } else if (key.startsWith('resource ')) {
      const resourceName = key.substring(9).trim();
      const resource = parseResourceBlock(resourceName, pair.value, fileName, lineCounter, errors, getPairSpan(pair, fileName, lineCounter));
      if (resource) ast.resources.push(resource);
    } else if (key.startsWith('readModel ')) {
      const readModelName = key.substring('readModel '.length).trim();
      const readModel = parseReadModelBlock(readModelName, pair.value, fileName, lineCounter, errors, getPairSpan(pair, fileName, lineCounter));
      if (readModel) ast.readModels.push(readModel);
    } else if (key.startsWith('page ')) {
      const pageName = key.substring(5).trim();
      const page = parsePageBlock(pageName, pair.value, fileName, lineCounter, getPairSpan(pair, fileName, lineCounter));
      if (page) ast.pages.push(page);
    } else {
      errors.push({ message: `Unknown top-level key: "${key}"` });
    }
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

function detectUnsupportedYamlFeatures(node: unknown, errors: ParseError[]): void {
  if (!node || typeof node !== 'object') return;

  if (isAlias(node)) {
    errors.push({ message: `YAML aliases are not supported in ${describeRdslSourceSuffixes()} files` });
    return;
  }

  const maybeAnchored = node as { anchor?: string | null };
  if (maybeAnchored.anchor) {
    errors.push({ message: `YAML anchors are not supported in ${describeRdslSourceSuffixes()} files` });
  }

  if (isPair(node)) {
    const pair = node as Pair;
    detectUnsupportedYamlFeatures(pair.key, errors);
    detectUnsupportedYamlFeatures(pair.value, errors);
    return;
  }

  if (isMap(node) || isSeq(node)) {
    const coll = node as YAMLMap | YAMLSeq;
    for (const item of coll.items) {
      detectUnsupportedYamlFeatures(item, errors);
    }
  }
}

// ─── Block Parsers ───────────────────────────────────────────────

function getScalarValue(node: unknown): string | undefined {
  if (isScalar(node)) return String((node as Scalar).value);
  return undefined;
}

function getMapValue(map: YAMLMap, key: string): unknown {
  const pair = getMapPair(map, key);
  return pair?.value;
}

function getMapPair(map: YAMLMap, key: string): Pair | undefined {
  for (const pair of map.items) {
    if (isPair(pair) && isScalar(pair.key) && String((pair.key as Scalar).value) === key) {
      return pair;
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
  const keyRange = isScalar(pair.key) || (pair.key && typeof pair.key === 'object' && 'range' in pair.key)
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

function parseAppBlock(node: unknown, fileName: string, lineCounter: LineCounter, sourceSpan?: SourceSpan): RawApp {
  const app: RawApp = { name: 'Untitled', sourceSpan };

  if (!isMap(node)) return app;
  const map = node as YAMLMap;

  const name = getMapValue(map, 'name');
  if (name !== undefined) app.name = String(isScalar(name) ? (name as Scalar).value : name);

  const theme = getMapValue(map, 'theme');
  if (theme !== undefined) app.theme = String(isScalar(theme) ? (theme as Scalar).value : theme);

  const auth = getMapValue(map, 'auth');
  if (auth !== undefined) app.auth = String(isScalar(auth) ? (auth as Scalar).value : auth);

  const style = getMapValue(map, 'style');
  if (style !== undefined) app.style = String(isScalar(style) ? (style as Scalar).value : style);

  const seo = getMapValue(map, 'seo');
  if (isMap(seo)) {
    app.seo = parseAppSeoBlock(seo as YAMLMap, fileName, lineCounter);
  }

  // Parse navigation
  const nav = getMapValue(map, 'navigation');
  if (isSeq(nav)) {
    app.navigation = [];
    for (const item of (nav as YAMLSeq).items) {
      if (isMap(item)) {
        const group = parseNavGroup(item as YAMLMap, fileName, lineCounter);
        if (group) app.navigation.push(group);
      }
    }
  }

  return app;
}

function parseAppSeoBlock(
  map: YAMLMap,
  fileName: string,
  lineCounter: LineCounter,
): RawAppSeo {
  const seo: RawAppSeo = {
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };
  const siteName = getMapValue(map, 'siteName');
  if (siteName !== undefined) seo.siteName = parseMessageLikeNode(siteName, fileName, lineCounter);
  const defaultTitle = getMapValue(map, 'defaultTitle');
  if (defaultTitle !== undefined) seo.defaultTitle = parseMessageLikeNode(defaultTitle, fileName, lineCounter);
  const titleTemplate = getMapValue(map, 'titleTemplate');
  if (titleTemplate !== undefined) seo.titleTemplate = parseMessageLikeNode(titleTemplate, fileName, lineCounter);
  const defaultDescription = getMapValue(map, 'defaultDescription');
  if (defaultDescription !== undefined) seo.defaultDescription = parseMessageLikeNode(defaultDescription, fileName, lineCounter);
  const defaultImage = getMapValue(map, 'defaultImage');
  if (defaultImage !== undefined) seo.defaultImage = String(isScalar(defaultImage) ? (defaultImage as Scalar).value : defaultImage);
  const favicon = getMapValue(map, 'favicon');
  if (favicon !== undefined) seo.favicon = String(isScalar(favicon) ? (favicon as Scalar).value : favicon);
  return seo;
}

function parsePageSeoBlock(
  map: YAMLMap,
  fileName: string,
  lineCounter: LineCounter,
): RawPageSeo {
  const seo: RawPageSeo = {
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };
  const description = getMapValue(map, 'description');
  if (description !== undefined) seo.description = parseMessageLikeNode(description, fileName, lineCounter);
  const canonicalPath = getMapValue(map, 'canonicalPath');
  if (canonicalPath !== undefined) seo.canonicalPath = String(isScalar(canonicalPath) ? (canonicalPath as Scalar).value : canonicalPath);
  const image = getMapValue(map, 'image');
  if (image !== undefined) seo.image = String(isScalar(image) ? (image as Scalar).value : image);
  const noIndex = getMapValue(map, 'noIndex');
  if (isScalar(noIndex)) {
    seo.noIndex = Boolean((noIndex as Scalar).value);
  } else if (typeof noIndex === 'boolean') {
    seo.noIndex = noIndex;
  }
  return seo;
}

function parseCompilerBlock(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawCompiler {
  const compiler: RawCompiler = { sourceSpan };

  if (!isMap(node)) return compiler;
  const map = node as YAMLMap;

  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String((pair.key as Scalar).value);
    if (key !== 'target') {
      const span = getPairSpan(pair, fileName, lineCounter);
      errors.push({
        message: `Unknown compiler key: "${key}"`,
        line: span?.startLine,
        col: span?.startCol,
      });
      continue;
    }

    if (pair.value !== undefined) {
      compiler.target = String(isScalar(pair.value) ? (pair.value as Scalar).value : pair.value);
    }
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
      message: `imports must be a YAML sequence of relative ${describeRdslSourceSuffixes()} file paths`,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return [];
  }

  const imports: string[] = [];
  for (const item of node.items) {
    const value = getScalarValue(item);
    const itemSpan = getNodeSpan(item, fileName, lineCounter);
    if (value === undefined || value.length === 0) {
      errors.push({
        message: 'imports entries must be scalar file paths',
        line: itemSpan?.startLine,
        col: itemSpan?.startCol,
      });
      continue;
    }
    imports.push(value);
  }

  return imports;
}

function parseNavGroup(map: YAMLMap, fileName: string, lineCounter: LineCounter): RawNavGroup | null {
  const groupVal = getMapValue(map, 'group');
  if (!groupVal) return null;
  const parsedGroup = parseMessageLikeNode(groupVal, fileName, lineCounter);
  if (parsedGroup === undefined) {
    return null;
  }

  const group: RawNavGroup = {
    group: parsedGroup,
    items: [],
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };

  const visibleIf = getMapValue(map, 'visibleIf');
  if (visibleIf !== undefined) group.visibleIf = String(isScalar(visibleIf) ? (visibleIf as Scalar).value : visibleIf);

  const items = getMapValue(map, 'items');
  if (isSeq(items)) {
    for (const item of (items as YAMLSeq).items) {
      if (isMap(item)) {
        const navItem = parseNavItem(item as YAMLMap, fileName, lineCounter);
        if (navItem) group.items.push(navItem);
      }
    }
  }

  return group;
}

function parseNavItem(map: YAMLMap, fileName: string, lineCounter: LineCounter): RawNavItem | null {
  const label = getMapValue(map, 'label');
  const target = getMapValue(map, 'target');
  if (!label || !target) return null;

  const parsedLabel = parseMessageLikeNode(label, fileName, lineCounter);
  if (parsedLabel === undefined) {
    return null;
  }

  const item: RawNavItem = {
    label: parsedLabel,
    target: String(isScalar(target) ? (target as Scalar).value : target),
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };

  const icon = getMapValue(map, 'icon');
  if (icon !== undefined) item.icon = String(isScalar(icon) ? (icon as Scalar).value : icon);

  return item;
}

function parseModelBlock(
  name: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  sourceSpan?: SourceSpan,
): RawModel | null {
  const model: RawModel = { name, fields: [], sourceSpan };
  if (!isMap(node)) return model;
  const map = node as YAMLMap;

  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const fieldName = String((pair.key as Scalar).value);
    const rawType = String(isScalar(pair.value) ? (pair.value as Scalar).value : pair.value);

    const { baseName: typeExpr, decorators } = parseDecorators(rawType);
    const field: RawField = {
      name: fieldName,
      typeExpr: typeExpr || rawType,
      decorators,
      sourceSpan: getPairSpan(pair, fileName, lineCounter),
    };
    model.fields.push(field);
  }

  return model;
}

function parseResourceBlock(
  name: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawResource | null {
  if (!isMap(node)) return null;
  const map = node as YAMLMap;

  const resource: RawResource = {
    name,
    model: '',
    api: '',
    sourceSpan,
  };

  const model = getMapValue(map, 'model');
  if (model !== undefined) resource.model = String(isScalar(model) ? (model as Scalar).value : model);

  const api = getMapValue(map, 'api');
  if (api !== undefined) resource.api = String(isScalar(api) ? (api as Scalar).value : api);

  const workflowPair = getMapPair(map, 'workflow');
  if (workflowPair) {
    if (isScalar(workflowPair.value)) {
      resource.workflow = String((workflowPair.value as Scalar).value);
      resource.workflowSourceSpan = getPairSpan(workflowPair, fileName, lineCounter);
    } else if (isMap(workflowPair.value)) {
      const workflowMap = workflowPair.value as YAMLMap;
      const source = getMapValue(workflowMap, 'source');
      if (source !== undefined) {
        resource.workflow = String(isScalar(source) ? (source as Scalar).value : source);
      } else {
        errors.push({
          message: 'resource workflow map must declare source',
          line: getPairSpan(workflowPair, fileName, lineCounter)?.startLine,
          col: getPairSpan(workflowPair, fileName, lineCounter)?.startCol,
        });
      }
      const style = getMapValue(workflowMap, 'style');
      if (style !== undefined) {
        resource.workflowStyle = String(isScalar(style) ? (style as Scalar).value : style);
      }
      resource.workflowSourceSpan = getPairSpan(workflowPair, fileName, lineCounter);
    } else {
      errors.push({
        message: 'resource workflow must be a scalar @flow(...) link or a mapping with source/style',
        line: getPairSpan(workflowPair, fileName, lineCounter)?.startLine,
        col: getPairSpan(workflowPair, fileName, lineCounter)?.startCol,
      });
    }
  }

  // Parse list view
  const listPair = getMapPair(map, 'list');
  if (isMap(listPair?.value)) resource.list = parseListView(listPair.value as YAMLMap, fileName, lineCounter, getPairSpan(listPair, fileName, lineCounter));

  // Parse edit view
  const editPair = getMapPair(map, 'edit');
  if (isMap(editPair?.value)) resource.edit = parseEditView(editPair.value as YAMLMap, fileName, lineCounter, errors, getPairSpan(editPair, fileName, lineCounter));

  // Parse create view
  const createPair = getMapPair(map, 'create');
  if (isMap(createPair?.value)) resource.create = parseCreateView(createPair.value as YAMLMap, fileName, lineCounter, errors, getPairSpan(createPair, fileName, lineCounter));

  // Parse read view
  const readPair = getMapPair(map, 'read');
  if (isMap(readPair?.value)) resource.read = parseReadView(readPair.value as YAMLMap, fileName, lineCounter, getPairSpan(readPair, fileName, lineCounter));

  return resource;
}

function parseFieldMapBlock(
  ownerLabel: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawField[] | undefined {
  if (!isMap(node)) {
    errors.push({
      message: `${ownerLabel} must be a YAML mapping`,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return undefined;
  }

  const fields: RawField[] = [];
  for (const pair of (node as YAMLMap).items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const fieldName = String(pair.key.value);
    const rawType = isScalar(pair.value) ? String((pair.value as Scalar).value) : undefined;
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!rawType) {
      errors.push({
        message: `${ownerLabel} field "${fieldName}" must have a scalar type expression`,
        line: pairSpan?.startLine,
        col: pairSpan?.startCol,
      });
      continue;
    }

    const { baseName: typeExpr, decorators } = parseDecorators(rawType);
    fields.push({
      name: fieldName,
      typeExpr: typeExpr || rawType,
      decorators,
      sourceSpan: pairSpan,
    });
  }

  return fields;
}

function parseReadModelBlock(
  name: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawReadModel | null {
  if (!isMap(node)) {
    errors.push({
      message: `readModel ${name} must be a YAML mapping`,
      line: sourceSpan?.startLine,
      col: sourceSpan?.startCol,
    });
    return null;
  }

  const map = node as YAMLMap;
  const readModel: RawReadModel = {
    name,
    inputs: [],
    result: [],
    sourceSpan,
  };

  const api = getMapValue(map, 'api');
  if (api !== undefined) {
    readModel.api = String(isScalar(api) ? (api as Scalar).value : api);
  }

  const rules = getMapValue(map, 'rules');
  if (rules !== undefined) {
    readModel.rules = String(isScalar(rules) ? (rules as Scalar).value : rules);
  }

  const inputsPair = getMapPair(map, 'inputs');
  if (inputsPair) {
    readModel.inputs = parseFieldMapBlock(`readModel ${name} inputs`, inputsPair.value, fileName, lineCounter, errors, getPairSpan(inputsPair, fileName, lineCounter)) ?? [];
  }

  const resultPair = getMapPair(map, 'result');
  if (resultPair) {
    readModel.result = parseFieldMapBlock(`readModel ${name} result`, resultPair.value, fileName, lineCounter, errors, getPairSpan(resultPair, fileName, lineCounter)) ?? [];
  }

  const listPair = getMapPair(map, 'list');
  if (isMap(listPair?.value)) {
    readModel.list = parseReadModelListView(listPair.value as YAMLMap, fileName, lineCounter, getPairSpan(listPair, fileName, lineCounter));
  }

  return readModel;
}

function parseReadModelListView(
  map: YAMLMap,
  fileName: string,
  lineCounter: LineCounter,
  sourceSpan?: SourceSpan,
): RawReadModelListView {
  const view: RawReadModelListView = { sourceSpan };

  const columns = getMapValue(map, 'columns');
  if (isSeq(columns)) {
    view.columns = (columns as YAMLSeq).items.map((item: unknown) => {
      const value = isScalar(item) ? String((item as Scalar).value) : String(item);
      return parseColumnEntry(value, getNodeSpan(item, fileName, lineCounter));
    });
  }

  const groupBy = getMapValue(map, 'groupBy');
  if (isSeq(groupBy)) {
    view.groupBy = (groupBy as YAMLSeq).items.map((item: unknown) =>
      String(isScalar(item) ? (item as Scalar).value : item)
    );
  }

  const pivotBy = getMapValue(map, 'pivotBy');
  if (pivotBy !== undefined) {
    view.pivotBy = String(isScalar(pivotBy) ? (pivotBy as Scalar).value : pivotBy);
  }

  const pagination = getMapValue(map, 'pagination');
  if (isMap(pagination)) {
    const paginationMap = pagination as YAMLMap;
    const size = getMapValue(paginationMap, 'size');
    const style = getMapValue(paginationMap, 'style');
    view.pagination = {
      size: size !== undefined ? Number(isScalar(size) ? (size as Scalar).value : size) : undefined,
      style: style !== undefined ? String(isScalar(style) ? (style as Scalar).value : style) : undefined,
    };
  }

  return view;
}

function parseListView(map: YAMLMap, fileName: string, lineCounter: LineCounter, sourceSpan?: SourceSpan): RawListView {
  const view: RawListView = { sourceSpan };

  const title = getMapValue(map, 'title');
  if (title !== undefined) view.title = parseMessageLikeNode(title, fileName, lineCounter);
  const style = getMapValue(map, 'style');
  if (style !== undefined) view.style = String(isScalar(style) ? (style as Scalar).value : style);

  // Filters — array of strings
  const filters = getMapValue(map, 'filters');
  if (isSeq(filters)) {
    view.filters = (filters as YAMLSeq).items.map((i: unknown) =>
      String(isScalar(i) ? (i as Scalar).value : i)
    );
  }

  // Columns — array of decorated strings
  const columns = getMapValue(map, 'columns');
  if (isSeq(columns)) {
    view.columns = (columns as YAMLSeq).items.map((i: unknown) => {
      const val = isScalar(i) ? String((i as Scalar).value) : String(i);
      return parseColumnEntry(val, getNodeSpan(i, fileName, lineCounter));
    });
  }

  // Actions
  const actions = getMapValue(map, 'actions');
  if (isSeq(actions)) {
    view.actions = (actions as YAMLSeq).items.map((i: unknown) => {
      const val = isScalar(i) ? String((i as Scalar).value) : String(i);
      return parseActionEntry(val, getNodeSpan(i, fileName, lineCounter));
    });
  }

  // Pagination
  const pagination = getMapValue(map, 'pagination');
  if (isMap(pagination)) {
    const pMap = pagination as YAMLMap;
    const size = getMapValue(pMap, 'size');
    const style = getMapValue(pMap, 'style');
    view.pagination = {
      size: size !== undefined ? Number(isScalar(size) ? (size as Scalar).value : size) : undefined,
      style: style !== undefined ? String(isScalar(style) ? (style as Scalar).value : style) : undefined,
    };
  }

  // Rules
  view.rules = parseRules(map, fileName, lineCounter);

  return view;
}

function parseEditView(map: YAMLMap, fileName: string, lineCounter: LineCounter, errors: ParseError[], sourceSpan?: SourceSpan): RawEditView {
  const view: RawEditView = { sourceSpan };
  const style = getMapValue(map, 'style');
  if (style !== undefined) view.style = String(isScalar(style) ? (style as Scalar).value : style);

  const fields = getMapValue(map, 'fields');
  if (isSeq(fields)) {
    view.fields = (fields as YAMLSeq).items.map((item: unknown) =>
      parseFormFieldEntry(item, fileName, lineCounter)
    );
  }

  const includes = getMapValue(map, 'includes');
  if (isSeq(includes)) {
    view.includes = (includes as YAMLSeq).items
      .map((item) => parseCreateInclude(item, fileName, lineCounter))
      .filter((entry): entry is RawCreateInclude => Boolean(entry));
  }

  view.rules = parseViewRules(map, fileName, lineCounter);

  const onSuccess = getMapValue(map, 'onSuccess');
  if (isSeq(onSuccess)) {
    view.onSuccess = parseEffectList(onSuccess as YAMLSeq, fileName, lineCounter, errors);
  }

  return view;
}

function parseCreateView(map: YAMLMap, fileName: string, lineCounter: LineCounter, errors: ParseError[], sourceSpan?: SourceSpan): RawCreateView {
  const view: RawCreateView = { sourceSpan };
  const style = getMapValue(map, 'style');
  if (style !== undefined) view.style = String(isScalar(style) ? (style as Scalar).value : style);

  const fields = getMapValue(map, 'fields');
  if (isSeq(fields)) {
    view.fields = (fields as YAMLSeq).items.map((item: unknown) =>
      parseFormFieldEntry(item, fileName, lineCounter)
    );
  }

  const includes = getMapValue(map, 'includes');
  if (isSeq(includes)) {
    view.includes = (includes as YAMLSeq).items
      .map((item) => parseCreateInclude(item, fileName, lineCounter))
      .filter((entry): entry is RawCreateInclude => Boolean(entry));
  }

  view.rules = parseViewRules(map, fileName, lineCounter);

  const onSuccess = getMapValue(map, 'onSuccess');
  if (isSeq(onSuccess)) {
    view.onSuccess = parseEffectList(onSuccess as YAMLSeq, fileName, lineCounter, errors);
  }

  return view;
}

function parseCreateInclude(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawCreateInclude | null {
  if (!isMap(node)) {
    return null;
  }
  const map = node as YAMLMap;
  const field = getMapValue(map, 'field');
  if (!field) {
    return null;
  }

  const include: RawCreateInclude = {
    field: String(isScalar(field) ? (field as Scalar).value : field),
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };

  const minItems = getMapValue(map, 'minItems');
  if (minItems !== undefined) {
    include.minItems = Number(isScalar(minItems) ? (minItems as Scalar).value : minItems);
  }

  const rules = getMapValue(map, 'rules');
  if (rules !== undefined) {
    include.rules = String(isScalar(rules) ? (rules as Scalar).value : rules);
  }

  const fields = getMapValue(map, 'fields');
  if (isSeq(fields)) {
    include.fields = (fields as YAMLSeq).items.map((item: unknown) =>
      parseFormFieldEntry(item, fileName, lineCounter)
    );
  }

  return include;
}

function parseReadView(map: YAMLMap, fileName: string, lineCounter: LineCounter, sourceSpan?: SourceSpan): RawReadView {
  const view: RawReadView = { sourceSpan };

  const title = getMapValue(map, 'title');
  if (title !== undefined) view.title = parseMessageLikeNode(title, fileName, lineCounter);
  const style = getMapValue(map, 'style');
  if (style !== undefined) view.style = String(isScalar(style) ? (style as Scalar).value : style);

  const fields = getMapValue(map, 'fields');
  if (isSeq(fields)) {
    view.fields = (fields as YAMLSeq).items.map((i: unknown) => {
      const val = isScalar(i) ? String((i as Scalar).value) : String(i);
      return parseColumnEntry(val, getNodeSpan(i, fileName, lineCounter));
    });
  }

  const related = getMapValue(map, 'related');
  if (isSeq(related)) {
    view.related = (related as YAMLSeq).items.map((i: unknown) =>
      String(isScalar(i) ? (i as Scalar).value : i)
    );
  }

  return view;
}

function parseRules(map: YAMLMap, fileName: string, lineCounter: LineCounter): RawRules | undefined {
  const rulesPair = getMapPair(map, 'rules');
  if (!isMap(rulesPair?.value)) {
    // Fallback: check for top-level rule fields
    const result: RawRules = {};
    let found = false;
    for (const key of ['visibleIf', 'enabledIf', 'allowIf', 'enforce'] as const) {
      const val = getMapValue(map, key);
      if (val !== undefined) {
        result[key] = String(isScalar(val) ? (val as Scalar).value : val);
        found = true;
      }
    }
    return found ? result : undefined;
  }

  const rMap = rulesPair.value as YAMLMap;
  const result: RawRules = {
    sourceSpan: getPairSpan(rulesPair, fileName, lineCounter),
  };
  for (const key of ['visibleIf', 'enabledIf', 'allowIf', 'enforce'] as const) {
    const val = getMapValue(rMap, key);
    if (val !== undefined) {
      result[key] = String(isScalar(val) ? (val as Scalar).value : val);
    }
  }
  return result;
}

function parseViewRules(map: YAMLMap, fileName: string, lineCounter: LineCounter): RawViewRules | undefined {
  const rulesPair = getMapPair(map, 'rules');
  if (isScalar(rulesPair?.value)) {
    return String((rulesPair.value as Scalar).value);
  }
  return parseRules(map, fileName, lineCounter);
}

function parseEffectList(seq: YAMLSeq, fileName: string, lineCounter: LineCounter, errors: ParseError[]): RawEffect[] {
  const effects: RawEffect[] = [];
  for (const item of seq.items) {
    if (isMap(item)) {
      const map = item as YAMLMap;
      for (const pair of map.items) {
        if (isPair(pair) && isScalar(pair.key)) {
          const type = String((pair.key as Scalar).value);
          const parsedValue = parseEffectValue(type, pair.value, fileName, lineCounter, errors);
          if (parsedValue === undefined) {
            continue;
          }
          effects.push({
            type,
            value: parsedValue,
            sourceSpan: getPairSpan(pair, fileName, lineCounter),
          });
        }
      }
    } else if (isScalar(item)) {
      // Simple string effect like "toast: saved"
      const val = String((item as Scalar).value);
      const colonIdx = val.indexOf(':');
      if (colonIdx > 0) {
        effects.push({
          type: val.substring(0, colonIdx).trim(),
          value: val.substring(colonIdx + 1).trim(),
          sourceSpan: getNodeSpan(item, fileName, lineCounter),
        });
      }
    }
  }
  return effects;
}

function parseEffectValue(
  type: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
): string | RawToastMessageDescriptor | undefined {
  if (type === 'toast' && isMap(node)) {
    return parseToastDescriptor(node as YAMLMap, fileName, lineCounter, errors, getNodeSpan(node, fileName, lineCounter));
  }

  if (isScalar(node)) {
    return String((node as Scalar).value);
  }

  errors.push({
    message: `Effect "${type}" must use a scalar value${type === 'toast' ? ' or a supported toast descriptor object' : ''}`,
    line: getNodeSpan(node, fileName, lineCounter)?.startLine,
    col: getNodeSpan(node, fileName, lineCounter)?.startCol,
  });
  return undefined;
}

function parseToastDescriptor(
  map: YAMLMap,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
  sourceSpan?: SourceSpan,
): RawToastMessageDescriptor {
  const descriptor: RawToastMessageDescriptor = { sourceSpan };

  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }

    const key = String((pair.key as Scalar).value);
    if (key === 'key') {
      if (isScalar(pair.value)) {
        descriptor.key = String((pair.value as Scalar).value);
      } else {
        errors.push({
          message: 'toast.key must be a scalar string',
          line: getPairSpan(pair, fileName, lineCounter)?.startLine,
          col: getPairSpan(pair, fileName, lineCounter)?.startCol,
        });
      }
      continue;
    }

    if (key === 'defaultMessage') {
      if (isScalar(pair.value)) {
        descriptor.defaultMessage = String((pair.value as Scalar).value);
      } else {
        errors.push({
          message: 'toast.defaultMessage must be a scalar string',
          line: getPairSpan(pair, fileName, lineCounter)?.startLine,
          col: getPairSpan(pair, fileName, lineCounter)?.startCol,
        });
      }
      continue;
    }

    if (key === 'values') {
      if (isMap(pair.value)) {
        descriptor.values = parseToastValues(pair.value as YAMLMap, fileName, lineCounter, errors);
      } else {
        errors.push({
          message: 'toast.values must be a mapping of literal values or { ref: ... } objects',
          line: getPairSpan(pair, fileName, lineCounter)?.startLine,
          col: getPairSpan(pair, fileName, lineCounter)?.startCol,
        });
      }
      continue;
    }

    errors.push({
      message: `Unknown toast descriptor key: "${key}"`,
      line: getPairSpan(pair, fileName, lineCounter)?.startLine,
      col: getPairSpan(pair, fileName, lineCounter)?.startCol,
    });
  }

  return descriptor;
}

function parseToastValues(
  map: YAMLMap,
  fileName: string,
  lineCounter: LineCounter,
  errors: ParseError[],
): Record<string, RawToastMessageValue> {
  const values: Record<string, RawToastMessageValue> = {};

  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }

    const name = String((pair.key as Scalar).value);
    if (isScalar(pair.value)) {
      const scalarValue = (pair.value as Scalar).value;
      if (
        typeof scalarValue === 'string'
        || typeof scalarValue === 'number'
        || typeof scalarValue === 'boolean'
        || scalarValue === null
      ) {
        values[name] = scalarValue;
      } else {
        values[name] = String(scalarValue);
      }
      continue;
    }

    if (isMap(pair.value)) {
      const refPair = getMapPair(pair.value as YAMLMap, 'ref');
      if ((pair.value as YAMLMap).items.length === 1 && refPair && isScalar(refPair.value)) {
        values[name] = {
          ref: String((refPair.value as Scalar).value),
          sourceSpan: getPairSpan(refPair, fileName, lineCounter),
        };
      } else {
        errors.push({
          message: `toast.values.${name} must be a scalar or { ref: <path> }`,
          line: getPairSpan(pair, fileName, lineCounter)?.startLine,
          col: getPairSpan(pair, fileName, lineCounter)?.startCol,
        });
      }
      continue;
    }

    errors.push({
      message: `toast.values.${name} must be a scalar or { ref: <path> }`,
      line: getPairSpan(pair, fileName, lineCounter)?.startLine,
      col: getPairSpan(pair, fileName, lineCounter)?.startCol,
    });
  }

  return values;
}

function parseToastDescriptorObject(value: Record<string, unknown>): RawToastMessageDescriptor {
  const descriptor: RawToastMessageDescriptor = {};

  if (value.key !== undefined) {
    descriptor.key = String(value.key);
  }
  if (value.defaultMessage !== undefined) {
    descriptor.defaultMessage = String(value.defaultMessage);
  }
  if (value.values && typeof value.values === 'object' && !Array.isArray(value.values)) {
    descriptor.values = Object.fromEntries(
      Object.entries(value.values as Record<string, unknown>).map(([key, entry]) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'ref' in (entry as Record<string, unknown>)) {
          return [key, { ref: String((entry as Record<string, unknown>).ref) }];
        }
        return [key, entry as string | number | boolean | null];
      }),
    );
  }

  return descriptor;
}

function parseMessageLikeNode(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawMessageLike | undefined {
  if (isScalar(node)) {
    return String((node as Scalar).value);
  }
  if (isMap(node)) {
    return parseUiMessageDescriptor(node as YAMLMap, fileName, lineCounter, getNodeSpan(node, fileName, lineCounter));
  }
  return undefined;
}

function parseMessageLikeObject(value: unknown): RawMessageLike | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return parseUiMessageDescriptorObject(value as Record<string, unknown>);
  }
  return undefined;
}

function parseUiMessageDescriptor(
  map: YAMLMap,
  _fileName: string,
  _lineCounter: LineCounter,
  sourceSpan?: SourceSpan,
): RawMessageLike {
  const descriptor: RawMessageLike & { sourceSpan?: SourceSpan } = { sourceSpan };
  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String((pair.key as Scalar).value);
    if (key === 'key' || key === 'defaultMessage') {
      if (isScalar(pair.value)) {
        descriptor[key] = String((pair.value as Scalar).value);
      }
      continue;
    }
    if (key === 'values' && isMap(pair.value)) {
      descriptor.values = Object.fromEntries(
        (pair.value as YAMLMap).items.flatMap((entry) => {
          if (!isPair(entry) || !isScalar(entry.key) || !isScalar(entry.value)) {
            return [];
          }
          const value = (entry.value as Scalar).value;
          if (
            typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
            || value === null
          ) {
            return [[String((entry.key as Scalar).value), value]];
          }
          return [];
        }),
      ) as Record<string, string | number | boolean | null>;
    }
  }
  return descriptor;
}

function parseUiMessageDescriptorObject(value: Record<string, unknown>): RawMessageLike {
  const descriptor: RawMessageLike = {};
  if (value.key !== undefined) {
    descriptor.key = String(value.key);
  }
  if (value.defaultMessage !== undefined) {
    descriptor.defaultMessage = String(value.defaultMessage);
  }
  if (value.values && typeof value.values === 'object' && !Array.isArray(value.values)) {
    descriptor.values = Object.fromEntries(
      Object.entries(value.values as Record<string, unknown>).flatMap(([key, entry]) => {
        if (
          typeof entry === 'string'
          || typeof entry === 'number'
          || typeof entry === 'boolean'
          || entry === null
        ) {
          return [[key, entry]];
        }
        return [];
      }),
    ) as Record<string, string | number | boolean | null>;
  }
  return descriptor;
}

function parsePageBlock(
  name: string,
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
  sourceSpan?: SourceSpan,
): RawPage | null {
  if (!isMap(node)) return null;
  const map = node as YAMLMap;

  const page: RawPage = {
    name,
    title: '',
    type: 'dashboard',
    blocks: [],
    sourceSpan,
  };

  const title = getMapValue(map, 'title');
  if (title !== undefined) page.title = parseMessageLikeNode(title, fileName, lineCounter) ?? '';

  const type = getMapValue(map, 'type');
  if (type !== undefined) page.type = String(isScalar(type) ? (type as Scalar).value : type);

  const path = getMapValue(map, 'path');
  if (path !== undefined) page.path = String(isScalar(path) ? (path as Scalar).value : path);

  const layout = getMapValue(map, 'layout');
  if (layout !== undefined) page.layout = String(isScalar(layout) ? (layout as Scalar).value : layout);

  const style = getMapValue(map, 'style');
  if (style !== undefined) page.style = String(isScalar(style) ? (style as Scalar).value : style);

  const seo = getMapValue(map, 'seo');
  if (isMap(seo)) {
    page.seo = parsePageSeoBlock(seo as YAMLMap, fileName, lineCounter);
  }

  const actions = getMapValue(map, 'actions');
  if (isSeq(actions)) {
    page.actions = (actions as YAMLSeq).items
      .map((entry) => parsePageAction(entry, fileName, lineCounter))
      .filter((entry): entry is RawPageAction => Boolean(entry));
  }

  const blocks = getMapValue(map, 'blocks');
  if (isSeq(blocks)) {
    for (const item of (blocks as YAMLSeq).items) {
      if (isMap(item)) {
        const bMap = item as YAMLMap;
        const block: RawDashboardBlock = {
          type: '',
          title: '',
          sourceSpan: getNodeSpan(bMap, fileName, lineCounter),
        };

        const bType = getMapValue(bMap, 'type');
        if (bType !== undefined) block.type = String(isScalar(bType) ? (bType as Scalar).value : bType);

        const bTitle = getMapValue(bMap, 'title');
        if (bTitle !== undefined) block.title = parseMessageLikeNode(bTitle, fileName, lineCounter) ?? '';

        const bStyle = getMapValue(bMap, 'style');
        if (bStyle !== undefined) block.style = String(isScalar(bStyle) ? (bStyle as Scalar).value : bStyle);

        const bData = getMapValue(bMap, 'data');
        if (bData !== undefined) block.data = String(isScalar(bData) ? (bData as Scalar).value : bData);

        const bQueryState = getMapValue(bMap, 'queryState');
        if (bQueryState !== undefined) {
          block.queryState = String(isScalar(bQueryState) ? (bQueryState as Scalar).value : bQueryState);
        }

        const bSelectionState = getMapValue(bMap, 'selectionState');
        if (bSelectionState !== undefined) {
          block.selectionState = String(isScalar(bSelectionState) ? (bSelectionState as Scalar).value : bSelectionState);
        }

        const bDateNavigation = getMapValue(bMap, 'dateNavigation');
        if (isScalar(bDateNavigation)) {
          block.dateNavigation = {
            field: String((bDateNavigation as Scalar).value),
            sourceSpan: getNodeSpan(bMap, fileName, lineCounter),
          };
        } else if (isMap(bDateNavigation)) {
          const dateNavigationMap = bDateNavigation as YAMLMap;
          const field = getMapValue(dateNavigationMap, 'field');
          const prevLabel = getMapValue(dateNavigationMap, 'prevLabel');
          const nextLabel = getMapValue(dateNavigationMap, 'nextLabel');
          block.dateNavigation = {
            field: field === undefined ? '' : String(isScalar(field) ? (field as Scalar).value : field),
            prevLabel: prevLabel === undefined ? undefined : parseMessageLikeNode(prevLabel, fileName, lineCounter),
            nextLabel: nextLabel === undefined ? undefined : parseMessageLikeNode(nextLabel, fileName, lineCounter),
            sourceSpan: getNodeSpan(dateNavigationMap, fileName, lineCounter),
          };
        }

        // Escape hatch tier 3: custom block
        const bCustom = getMapValue(bMap, 'custom');
        if (bCustom !== undefined) block.custom = String(isScalar(bCustom) ? (bCustom as Scalar).value : bCustom);

        const bRowActions = getMapValue(bMap, 'rowActions');
        if (isSeq(bRowActions)) {
          block.rowActions = (bRowActions as YAMLSeq).items
            .map((entry) => parseDashboardRowAction(entry, fileName, lineCounter))
            .filter((entry): entry is RawDashboardRowAction => Boolean(entry));
        }

        page.blocks.push(block);
      }
    }
  }

  return page;
}

function parsePageActionSeedValue(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawPageActionSeedValue | undefined {
  if (isScalar(node)) {
    const value = (node as Scalar).value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return String(value);
  }

  if (!isMap(node)) {
    return undefined;
  }

  const map = node as YAMLMap;
  const input = getMapValue(map, 'input');
  if (isScalar(input)) {
    return {
      input: String((input as Scalar).value),
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  const selection = getMapValue(map, 'selection');
  if (isScalar(selection)) {
    return {
      selection: String((selection as Scalar).value),
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  return undefined;
}

function parseDashboardRowSeedValue(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawDashboardRowSeedValue | undefined {
  if (isScalar(node)) {
    const value = (node as Scalar).value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return String(value);
  }

  if (!isMap(node)) {
    return undefined;
  }

  const map = node as YAMLMap;
  const row = getMapValue(map, 'row');
  if (isScalar(row)) {
    return {
      row: String((row as Scalar).value),
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  const input = getMapValue(map, 'input');
  if (isScalar(input)) {
    return {
      input: String((input as Scalar).value),
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  return undefined;
}

function parsePageAction(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawPageAction | null {
  if (!isMap(node)) {
    return null;
  }

  const map = node as YAMLMap;
  const createPair = getMapPair(map, 'create');
  if (!createPair) {
    return null;
  }

  if (isScalar(createPair.value)) {
    return {
      create: {
        resource: String((createPair.value as Scalar).value),
        sourceSpan: getPairSpan(createPair, fileName, lineCounter),
      },
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  if (!isMap(createPair.value)) {
    return null;
  }

  const createMap = createPair.value as YAMLMap;
  const resource = getMapValue(createMap, 'resource');
  if (!isScalar(resource)) {
    return null;
  }

  const create: RawPageCreateAction = {
    resource: String((resource as Scalar).value),
    sourceSpan: getPairSpan(createPair, fileName, lineCounter),
  };

  const label = getMapValue(createMap, 'label');
  if (label !== undefined) {
    create.label = parseMessageLikeNode(label, fileName, lineCounter);
  }

  const seed = getMapValue(createMap, 'seed');
  if (isMap(seed)) {
    create.seed = {};
    for (const pair of (seed as YAMLMap).items) {
      if (!isPair(pair) || !isScalar(pair.key)) {
        continue;
      }
      const key = String((pair.key as Scalar).value);
      const value = parsePageActionSeedValue(pair.value, fileName, lineCounter);
      if (value !== undefined) {
        create.seed[key] = value;
      }
    }
  }

  return {
    create,
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };
}

function parseDashboardRowAction(
  node: unknown,
  fileName: string,
  lineCounter: LineCounter,
): RawDashboardRowAction | null {
  if (!isMap(node)) {
    return null;
  }

  const map = node as YAMLMap;
  const createPair = getMapPair(map, 'create');
  if (!createPair) {
    return null;
  }

  if (isScalar(createPair.value)) {
    return {
      create: {
        resource: String((createPair.value as Scalar).value),
        sourceSpan: getPairSpan(createPair, fileName, lineCounter),
      },
      sourceSpan: getNodeSpan(map, fileName, lineCounter),
    };
  }

  if (!isMap(createPair.value)) {
    return null;
  }

  const createMap = createPair.value as YAMLMap;
  const resource = getMapValue(createMap, 'resource');
  if (!isScalar(resource)) {
    return null;
  }

  const create: RawDashboardRowCreateAction = {
    resource: String((resource as Scalar).value),
    sourceSpan: getPairSpan(createPair, fileName, lineCounter),
  };

  const label = getMapValue(createMap, 'label');
  if (label !== undefined) {
    create.label = parseMessageLikeNode(label, fileName, lineCounter);
  }

  const seed = getMapValue(createMap, 'seed');
  if (isMap(seed)) {
    const entries: Record<string, RawDashboardRowSeedValue> = {};
    for (const pair of (seed as YAMLMap).items) {
      if (!isPair(pair) || !isScalar(pair.key)) {
        continue;
      }
      const fieldName = String((pair.key as Scalar).value);
      const parsedValue = parseDashboardRowSeedValue(pair.value, fileName, lineCounter);
      if (parsedValue !== undefined) {
        entries[fieldName] = parsedValue;
      }
    }
    create.seed = entries;
  }

  return {
    create,
    sourceSpan: getNodeSpan(map, fileName, lineCounter),
  };
}
