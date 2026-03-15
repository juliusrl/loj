import {
  LineCounter,
  Pair,
  Scalar,
  isMap,
  isPair,
  isScalar,
  parseDocument,
} from 'yaml';

export interface StyleCompileError {
  message: string;
  file?: string;
  line?: number;
  col?: number;
}

interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface StyleTypographyToken {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}

export interface StyleTokens {
  colors: Record<string, string>;
  typography: Record<string, StyleTypographyToken>;
  spacing: Record<string, number>;
  borderRadius: Record<string, number>;
  elevation: Record<string, number>;
}

export type StyleDisplay = 'row' | 'column' | 'stack';
export type StyleAlignItems = 'start' | 'center' | 'end' | 'stretch';
export type StyleJustifyContent = 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround';
export type StyleTokenOrNumber = string | number;

export interface StyleDefinition {
  name: string;
  extends?: string;
  display?: StyleDisplay;
  gap?: StyleTokenOrNumber;
  padding?: StyleTokenOrNumber;
  paddingHorizontal?: StyleTokenOrNumber;
  paddingVertical?: StyleTokenOrNumber;
  alignItems?: StyleAlignItems;
  justifyContent?: StyleJustifyContent;
  width?: number;
  minHeight?: number;
  maxWidth?: number;
  backgroundColor?: string;
  borderRadius?: StyleTokenOrNumber;
  borderWidth?: number;
  borderColor?: string;
  elevation?: StyleTokenOrNumber;
  typography?: string;
  color?: string;
  opacity?: number;
  escape?: Record<string, string>;
}

export interface ResolvedStyleDefinition extends StyleDefinition {
  extends?: undefined;
}

export interface StyleProgram {
  tokens: StyleTokens;
  styles: ResolvedStyleDefinition[];
}

export interface StyleManifest {
  artifact: 'loj.style.manifest';
  schemaVersion: 1;
  tokens: StyleTokens;
  styles: ResolvedStyleDefinition[];
}

export interface StyleCompileResult {
  success: boolean;
  program?: StyleProgram;
  manifest?: StyleManifest;
  errors: StyleCompileError[];
  warnings: StyleCompileError[];
}

const DISPLAY_VALUES: readonly StyleDisplay[] = ['row', 'column', 'stack'];
const ALIGN_ITEMS_VALUES: readonly StyleAlignItems[] = ['start', 'center', 'end', 'stretch'];
const JUSTIFY_CONTENT_VALUES: readonly StyleJustifyContent[] = ['start', 'center', 'end', 'spaceBetween', 'spaceAround'];
const SUPPORTED_STYLE_KEYS = new Set([
  'extends',
  'display',
  'gap',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'alignItems',
  'justifyContent',
  'width',
  'minHeight',
  'maxWidth',
  'backgroundColor',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'elevation',
  'typography',
  'color',
  'opacity',
  'escape',
]);

export function isStyleSourceFile(fileName: string): boolean {
  return fileName.endsWith('.style.loj');
}

export function buildStyleManifestFileName(fileName: string): string {
  const normalizedFileName = fileName.replace(/\\/g, '/');
  const baseName = normalizedFileName.slice(normalizedFileName.lastIndexOf('/') + 1);
  if (baseName.endsWith('.style.loj')) {
    return `${baseName.slice(0, -'.style.loj'.length)}.style.manifest.json`;
  }
  const withoutExtension = baseName.replace(/\.[^.]+$/, '');
  return `${withoutExtension}.style.manifest.json`;
}

export function compileStyleSource(
  source: string,
  fileName: string = 'theme.style.loj',
): StyleCompileResult {
  const errors: StyleCompileError[] = [];
  const warnings: StyleCompileError[] = [];
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    merge: false,
    uniqueKeys: true,
    lineCounter,
  });

  for (const error of document.errors) {
    errors.push({
      message: error.message,
      file: fileName,
    });
  }
  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const root = document.contents;
  if (!isMap(root)) {
    return {
      success: false,
      errors: [{ message: 'Root document must be a YAML mapping', file: fileName }],
      warnings,
    };
  }

  const tokens: StyleTokens = {
    colors: {},
    typography: {},
    spacing: {},
    borderRadius: {},
    elevation: {},
  };
  const rawStyles: StyleDefinition[] = [];

  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key === 'tokens') {
      parseTokens(pair.value, tokens, fileName, lineCounter, errors, pairSpan);
      continue;
    }
    if (key.startsWith('style ')) {
      const name = key.slice('style '.length).trim();
      if (!name) {
        pushError(errors, 'Top-level style block must be named: style <name>', pairSpan);
        continue;
      }
      const style = parseStyleBlock(name, pair.value, fileName, lineCounter, errors, pairSpan);
      if (style) {
        rawStyles.push(style);
      }
      continue;
    }
    pushError(errors, `Unknown top-level key: "${key}"`, pairSpan);
  }

  if (rawStyles.length === 0) {
    errors.push({
      message: 'Document must contain at least one top-level "style <name>" block',
      file: fileName,
    });
  }
  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const resolved = resolveStyleExtends(rawStyles, fileName, errors);
  if (!resolved) {
    return { success: false, errors, warnings };
  }

  const program: StyleProgram = {
    tokens,
    styles: resolved,
  };
  const manifest: StyleManifest = {
    artifact: 'loj.style.manifest',
    schemaVersion: 1,
    tokens,
    styles: resolved,
  };

  return {
    success: true,
    program,
    manifest,
    errors,
    warnings,
  };
}

export function emitReactStyleCss(program: StyleProgram): string {
  const lines: string[] = [];
  lines.push(`/* Generated by Loj style compiler */`);
  lines.push(`:root {`);
  for (const [name, value] of Object.entries(program.tokens.colors)) {
    lines.push(`  --loj-color-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(program.tokens.spacing)) {
    lines.push(`  --loj-spacing-${kebab(name)}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(program.tokens.borderRadius)) {
    lines.push(`  --loj-radius-${kebab(name)}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(program.tokens.elevation)) {
    lines.push(`  --loj-elevation-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(program.tokens.typography)) {
    lines.push(`  --loj-typography-${kebab(name)}-font-size: ${value.fontSize}px;`);
    lines.push(`  --loj-typography-${kebab(name)}-font-weight: ${value.fontWeight};`);
    lines.push(`  --loj-typography-${kebab(name)}-line-height: ${value.lineHeight}px;`);
  }
  lines.push(`}`);
  lines.push(``);

  for (const style of program.styles) {
    lines.push(`.loj-style-${kebab(style.name)} {`);
    appendStyleCssLines(lines, style, program.tokens);
    if (style.escape?.css) {
      for (const line of style.escape.css.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
    lines.push(``);
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function parseTokens(
  value: unknown,
  tokens: StyleTokens,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan?: SourceSpan,
): void {
  if (!isMap(value)) {
    pushError(errors, 'tokens must be a YAML mapping', sourceSpan);
    return;
  }

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (key) {
      case 'colors':
        tokens.colors = parseStringMap(pair.value, fileName, lineCounter, errors, pairSpan);
        break;
      case 'spacing':
        tokens.spacing = parseNumberMap(pair.value, fileName, lineCounter, errors, pairSpan, 'spacing');
        break;
      case 'borderRadius':
        tokens.borderRadius = parseNumberMap(pair.value, fileName, lineCounter, errors, pairSpan, 'borderRadius');
        break;
      case 'elevation':
        tokens.elevation = parseNumberMap(pair.value, fileName, lineCounter, errors, pairSpan, 'elevation');
        break;
      case 'typography':
        tokens.typography = parseTypographyMap(pair.value, fileName, lineCounter, errors, pairSpan);
        break;
      default:
        pushError(errors, `Unsupported tokens key "${key}"`, pairSpan);
        break;
    }
  }
}

function parseStyleBlock(
  name: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan?: SourceSpan,
): StyleDefinition | undefined {
  if (!isMap(value)) {
    pushError(errors, `style ${name} must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  const style: StyleDefinition = { name };
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!SUPPORTED_STYLE_KEYS.has(key)) {
      pushError(errors, `style ${name} has unsupported key "${key}"`, pairSpan);
      continue;
    }
    switch (key) {
      case 'extends':
      case 'backgroundColor':
      case 'borderColor':
      case 'typography':
      case 'color': {
        if (pair.value !== undefined) {
          style[key] = String(isScalar(pair.value) ? (pair.value as Scalar).value : pair.value);
        }
        break;
      }
      case 'display': {
        const parsed = getScalarValue(pair.value);
        if (parsed && DISPLAY_VALUES.includes(parsed as StyleDisplay)) {
          style.display = parsed as StyleDisplay;
        } else {
          pushError(errors, `style ${name} display must be one of: ${DISPLAY_VALUES.join(', ')}`, pairSpan);
        }
        break;
      }
      case 'alignItems': {
        const parsed = getScalarValue(pair.value);
        if (parsed && ALIGN_ITEMS_VALUES.includes(parsed as StyleAlignItems)) {
          style.alignItems = parsed as StyleAlignItems;
        } else {
          pushError(errors, `style ${name} alignItems must be one of: ${ALIGN_ITEMS_VALUES.join(', ')}`, pairSpan);
        }
        break;
      }
      case 'justifyContent': {
        const parsed = getScalarValue(pair.value);
        if (parsed && JUSTIFY_CONTENT_VALUES.includes(parsed as StyleJustifyContent)) {
          style.justifyContent = parsed as StyleJustifyContent;
        } else {
          pushError(errors, `style ${name} justifyContent must be one of: ${JUSTIFY_CONTENT_VALUES.join(', ')}`, pairSpan);
        }
        break;
      }
      case 'gap':
      case 'padding':
      case 'paddingHorizontal':
      case 'paddingVertical':
      case 'borderRadius':
      case 'elevation': {
        const parsed = parseTokenOrNumber(pair.value);
        if (parsed === undefined) {
          pushError(errors, `style ${name} ${key} must be a scalar token ref or number`, pairSpan);
        } else {
          style[key] = parsed;
        }
        break;
      }
      case 'width':
      case 'minHeight':
      case 'maxWidth':
      case 'borderWidth':
      case 'opacity': {
        const parsed = parseNumber(pair.value);
        if (parsed === undefined) {
          pushError(errors, `style ${name} ${key} must be a number`, pairSpan);
        } else {
          style[key] = parsed;
        }
        break;
      }
      case 'escape': {
        style.escape = parseEscapeMap(pair.value, fileName, lineCounter, errors, pairSpan, name);
        break;
      }
      default:
        break;
    }
  }
  return style;
}

function parseStringMap(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan: SourceSpan | undefined,
): Record<string, string> {
  if (!isMap(value)) {
    pushError(errors, 'Expected a mapping of string values', sourceSpan);
    return {};
  }
  const result: Record<string, string> = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key) || !isScalar(pair.value)) {
      pushError(errors, 'Expected scalar token key/value', getPairSpan(pair as Pair, fileName, lineCounter));
      continue;
    }
    result[String(pair.key.value)] = String((pair.value as Scalar).value);
  }
  return result;
}

function parseNumberMap(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): Record<string, number> {
  if (!isMap(value)) {
    pushError(errors, `${label} tokens must be a mapping`, sourceSpan);
    return {};
  }
  const result: Record<string, number> = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const parsed = parseNumber(pair.value);
    if (parsed === undefined) {
      pushError(errors, `${label}.${String(pair.key.value)} must be a number`, getPairSpan(pair, fileName, lineCounter));
      continue;
    }
    result[String(pair.key.value)] = parsed;
  }
  return result;
}

function parseTypographyMap(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan: SourceSpan | undefined,
): Record<string, StyleTypographyToken> {
  if (!isMap(value)) {
    pushError(errors, 'typography tokens must be a mapping', sourceSpan);
    return {};
  }
  const result: Record<string, StyleTypographyToken> = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key) || !isMap(pair.value)) {
      pushError(errors, 'typography tokens must define mapping values', getPairSpan(pair as Pair, fileName, lineCounter));
      continue;
    }
    const tokenMap = pair.value;
    const fontSize = parseNumber(getMapValue(tokenMap, 'fontSize'));
    const fontWeight = parseNumber(getMapValue(tokenMap, 'fontWeight'));
    const lineHeight = parseNumber(getMapValue(tokenMap, 'lineHeight'));
    if (fontSize === undefined || fontWeight === undefined || lineHeight === undefined) {
      pushError(errors, `typography.${String(pair.key.value)} must define numeric fontSize, fontWeight, and lineHeight`, getPairSpan(pair, fileName, lineCounter));
      continue;
    }
    result[String(pair.key.value)] = { fontSize, fontWeight, lineHeight };
  }
  return result;
}

function parseEscapeMap(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: StyleCompileError[],
  sourceSpan: SourceSpan | undefined,
  styleName: string,
): Record<string, string> {
  if (!isMap(value)) {
    pushError(errors, `style ${styleName} escape must be a mapping`, sourceSpan);
    return {};
  }
  const escape: Record<string, string> = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key) || !isScalar(pair.value)) {
      pushError(errors, `style ${styleName} escape entries must be scalar`, getPairSpan(pair as Pair, fileName, lineCounter));
      continue;
    }
    escape[String(pair.key.value)] = String((pair.value as Scalar).value);
  }
  return escape;
}

function resolveStyleExtends(
  styles: StyleDefinition[],
  fileName: string,
  errors: StyleCompileError[],
): ResolvedStyleDefinition[] | undefined {
  const byName = new Map(styles.map((style) => [style.name, style]));
  const resolved = new Map<string, ResolvedStyleDefinition>();
  const resolving = new Set<string>();

  const visit = (name: string): ResolvedStyleDefinition | undefined => {
    const existing = resolved.get(name);
    if (existing) return existing;
    if (resolving.has(name)) {
      errors.push({
        message: `style inheritance cycle detected at "${name}"`,
        file: fileName,
      });
      return undefined;
    }
    const style = byName.get(name);
    if (!style) {
      errors.push({
        message: `Unknown style "${name}"`,
        file: fileName,
      });
      return undefined;
    }
    resolving.add(name);
    const base = style.extends ? visit(style.extends) : undefined;
    resolving.delete(name);
    if (style.extends && !base) {
      return undefined;
    }
    const merged: ResolvedStyleDefinition = {
      ...(base ?? { name: style.name }),
      ...style,
      name: style.name,
      extends: undefined,
      escape: {
        ...(base?.escape ?? {}),
        ...(style.escape ?? {}),
      },
    };
    if (!merged.escape || Object.keys(merged.escape).length === 0) {
      delete merged.escape;
    }
    resolved.set(name, merged);
    return merged;
  };

  const result: ResolvedStyleDefinition[] = [];
  for (const style of styles) {
    const resolvedStyle = visit(style.name);
    if (resolvedStyle) {
      result.push(resolvedStyle);
    }
  }
  if (errors.length > 0) {
    return undefined;
  }
  return result;
}

function appendStyleCssLines(
  lines: string[],
  style: ResolvedStyleDefinition,
  tokens: StyleTokens,
): void {
  if (style.display) {
    if (style.display === 'row') {
      lines.push(`  display: flex;`);
      lines.push(`  flex-direction: row;`);
    } else if (style.display === 'column') {
      lines.push(`  display: flex;`);
      lines.push(`  flex-direction: column;`);
    } else {
      lines.push(`  display: block;`);
    }
  }
  appendCssTokenOrNumber(lines, 'gap', style.gap, 'spacing', tokens);
  appendCssTokenOrNumber(lines, 'padding', style.padding, 'spacing', tokens);
  if (style.paddingHorizontal !== undefined) {
    const value = cssTokenOrNumber(style.paddingHorizontal, 'spacing', tokens);
    lines.push(`  padding-left: ${value};`);
    lines.push(`  padding-right: ${value};`);
  }
  if (style.paddingVertical !== undefined) {
    const value = cssTokenOrNumber(style.paddingVertical, 'spacing', tokens);
    lines.push(`  padding-top: ${value};`);
    lines.push(`  padding-bottom: ${value};`);
  }
  if (style.alignItems) {
    lines.push(`  align-items: ${mapFlexAlignment(style.alignItems)};`);
  }
  if (style.justifyContent) {
    lines.push(`  justify-content: ${mapJustifyContent(style.justifyContent)};`);
  }
  appendCssPixels(lines, 'width', style.width);
  appendCssPixels(lines, 'min-height', style.minHeight);
  appendCssPixels(lines, 'max-width', style.maxWidth);
  if (style.backgroundColor) {
    lines.push(`  background-color: ${cssColorValue(style.backgroundColor, tokens)};`);
  }
  if (style.borderRadius !== undefined) {
    lines.push(`  border-radius: ${cssTokenOrNumber(style.borderRadius, 'borderRadius', tokens)};`);
  }
  if (style.borderWidth !== undefined) {
    lines.push(`  border-width: ${style.borderWidth}px;`);
    lines.push(`  border-style: solid;`);
  }
  if (style.borderColor) {
    lines.push(`  border-color: ${cssColorValue(style.borderColor, tokens)};`);
  }
  if (style.elevation !== undefined) {
    lines.push(`  box-shadow: ${cssElevationValue(style.elevation, tokens)};`);
  }
  if (style.typography) {
    const typography = tokens.typography[style.typography];
    if (typography) {
      const name = kebab(style.typography);
      lines.push(`  font-size: var(--loj-typography-${name}-font-size);`);
      lines.push(`  font-weight: var(--loj-typography-${name}-font-weight);`);
      lines.push(`  line-height: var(--loj-typography-${name}-line-height);`);
    }
  }
  if (style.color) {
    lines.push(`  color: ${cssColorValue(style.color, tokens)};`);
  }
  if (style.opacity !== undefined) {
    lines.push(`  opacity: ${style.opacity};`);
  }
}

function appendCssTokenOrNumber(
  lines: string[],
  cssProperty: string,
  value: StyleTokenOrNumber | undefined,
  tokenFamily: 'spacing' | 'borderRadius',
  tokens: StyleTokens,
): void {
  if (value === undefined) return;
  lines.push(`  ${cssProperty}: ${cssTokenOrNumber(value, tokenFamily, tokens)};`);
}

function appendCssPixels(lines: string[], cssProperty: string, value: number | undefined): void {
  if (value === undefined) return;
  lines.push(`  ${cssProperty}: ${value}px;`);
}

function cssTokenOrNumber(
  value: StyleTokenOrNumber,
  tokenFamily: 'spacing' | 'borderRadius',
  tokens: StyleTokens,
): string {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (tokenFamily === 'spacing' && tokens.spacing[value] !== undefined) {
    return `var(--loj-spacing-${kebab(value)})`;
  }
  if (tokenFamily === 'borderRadius' && tokens.borderRadius[value] !== undefined) {
    return `var(--loj-radius-${kebab(value)})`;
  }
  return value;
}

function cssColorValue(value: string, tokens: StyleTokens): string {
  if (tokens.colors[value] !== undefined) {
    return `var(--loj-color-${kebab(value)})`;
  }
  return value;
}

function cssElevationValue(value: StyleTokenOrNumber, tokens: StyleTokens): string {
  const numericValue = typeof value === 'number'
    ? value
    : tokens.elevation[value] ?? Number.NaN;
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 'none';
  }
  const blur = Math.max(2, numericValue * 4);
  const spread = Math.max(0, Math.round(numericValue / 2));
  const alpha = Math.min(0.28, 0.08 + (numericValue * 0.04));
  return `0 ${numericValue}px ${blur}px ${spread}px rgba(15, 23, 42, ${alpha.toFixed(2)})`;
}

function mapFlexAlignment(value: StyleAlignItems): string {
  switch (value) {
    case 'start':
      return 'flex-start';
    case 'end':
      return 'flex-end';
    default:
      return value;
  }
}

function mapJustifyContent(value: StyleJustifyContent): string {
  switch (value) {
    case 'start':
      return 'flex-start';
    case 'end':
      return 'flex-end';
    case 'spaceBetween':
      return 'space-between';
    case 'spaceAround':
      return 'space-around';
    default:
      return value;
  }
}

function parseTokenOrNumber(value: unknown): StyleTokenOrNumber | undefined {
  if (isScalar(value)) {
    const raw = (value as Scalar).value;
    if (typeof raw === 'number') {
      return raw;
    }
    if (typeof raw === 'string') {
      const numeric = Number(raw);
      return Number.isFinite(numeric) && raw.trim() !== '' ? numeric : raw;
    }
  }
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (isScalar(value)) {
    const raw = (value as Scalar).value;
    if (typeof raw === 'number') {
      return raw;
    }
    if (typeof raw === 'string') {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
  }
  return undefined;
}

function getMapValue(map: unknown, key: string): unknown {
  if (!isMap(map)) return undefined;
  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    if (String(pair.key.value) === key) {
      return pair.value;
    }
  }
  return undefined;
}

function getScalarValue(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  return String((node as Scalar).value);
}

function pushError(errors: StyleCompileError[], message: string, sourceSpan?: SourceSpan): void {
  errors.push({
    message,
    file: sourceSpan?.file,
    line: sourceSpan?.startLine,
    col: sourceSpan?.startCol,
  });
}

function getPairSpan(pair: Pair, file: string, lineCounter: LineCounter): SourceSpan | undefined {
  const keyRange = pair.key && typeof pair.key === 'object' && 'range' in pair.key
    ? (pair.key as { range?: [number, number, number?] | null }).range
    : undefined;
  const valueRange = pair.value && typeof pair.value === 'object' && 'range' in pair.value
    ? (pair.value as { range?: [number, number, number?] | null }).range
    : undefined;
  if (keyRange && valueRange) {
    return rangeToSourceSpan([keyRange[0], valueRange[1]], file, lineCounter);
  }
  if (valueRange) {
    return rangeToSourceSpan(valueRange, file, lineCounter);
  }
  if (keyRange) {
    return rangeToSourceSpan(keyRange, file, lineCounter);
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

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
