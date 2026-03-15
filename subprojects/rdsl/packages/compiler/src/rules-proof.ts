import type { ExprNode } from './ir.js';
import { parseExpr } from './expr.js';
import type { MessageDescriptor, MessageLike } from '@loj-lang/shared-contracts';
import {
  LineCounter,
  Pair,
  Scalar,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from 'yaml';

type RulesEffect = 'allow' | 'deny';
type RulesOperation = 'list' | 'get' | 'create' | 'update' | 'delete';

interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface RulesCompileError {
  message: string;
  file?: string;
  line?: number;
  col?: number;
}

export type RulesMessageDescriptor = MessageDescriptor<string>;

export type RulesMessage = MessageLike<string>;

export interface RulesEntry {
  effect: RulesEffect;
  operation: RulesOperation;
  when: ExprNode;
  or: ExprNode[];
  message?: RulesMessage;
  scopeWhen?: ExprNode;
  scope?: ExprNode;
}

export interface RulesEligibilityEntry {
  kind: 'eligibility';
  name: string;
  when: ExprNode;
  or: ExprNode[];
  message?: RulesMessage;
}

export interface RulesValidationEntry {
  kind: 'validation';
  name: string;
  when: ExprNode;
  or: ExprNode[];
  message?: RulesMessage;
}

export interface RulesDerivationEntry {
  kind: 'derive';
  field: string;
  when?: ExprNode;
  value: ExprNode;
}

export interface RulesProgram {
  name: string;
  rules: RulesEntry[];
  eligibility: RulesEligibilityEntry[];
  validation: RulesValidationEntry[];
  derivations: RulesDerivationEntry[];
}

export interface RulesManifest {
  artifact: 'loj.rules.manifest';
  schemaVersion: 2;
  ruleSet: string;
  rules: Array<{
    effect: RulesEffect;
    operation: RulesOperation;
    when: ExprNode;
    or?: ExprNode[];
    message?: RulesMessage;
    scopeWhen?: ExprNode;
    scope?: ExprNode;
  }>;
  eligibility: Array<{
    kind: 'eligibility';
    name: string;
    when: ExprNode;
    or?: ExprNode[];
    message?: RulesMessage;
  }>;
  validation: Array<{
    kind: 'validation';
    name: string;
    when: ExprNode;
    or?: ExprNode[];
    message?: RulesMessage;
  }>;
  derivations: Array<{
    kind: 'derive';
    field: string;
    when?: ExprNode;
    value: ExprNode;
  }>;
}

export interface RulesCompileResult {
  success: boolean;
  program?: RulesProgram;
  manifest?: RulesManifest;
  errors: RulesCompileError[];
  warnings: RulesCompileError[];
}

const RULES_OPERATIONS: readonly RulesOperation[] = ['list', 'get', 'create', 'update', 'delete'];

export function countRulesEntries(program: RulesProgram): number {
  return program.rules.length + program.eligibility.length + program.validation.length + program.derivations.length;
}

export function isRulesSourceFile(fileName: string): boolean {
  return fileName.endsWith('.rules.loj');
}

export function buildRulesManifestFileName(fileName: string): string {
  const normalizedFileName = fileName.replace(/\\/g, '/');
  const baseName = normalizedFileName.slice(normalizedFileName.lastIndexOf('/') + 1);
  if (baseName.endsWith('.rules.loj')) {
    return `${baseName.slice(0, -'.rules.loj'.length)}.rules.manifest.json`;
  }
  const withoutExtension = baseName.replace(/\.[^.]+$/, '');
  return `${withoutExtension}.rules.manifest.json`;
}

export function compileRulesSource(
  source: string,
  fileName: string = 'policy.rules.loj',
): RulesCompileResult {
  const errors: RulesCompileError[] = [];
  const warnings: RulesCompileError[] = [];
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

  let program: RulesProgram | undefined;

  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const sourceSpan = getPairSpan(pair, fileName, lineCounter);
    if (!key.startsWith('rules ')) {
      pushError(errors, `Unknown top-level key: "${key}"`, sourceSpan);
      continue;
    }
    if (program) {
      pushError(errors, 'Only one top-level "rules <name>" block is supported in the first slice', sourceSpan);
      continue;
    }
    const name = key.slice('rules '.length).trim();
    if (!name) {
      pushError(errors, 'Top-level rules block must be named: rules <name>', sourceSpan);
      continue;
    }
    program = parseRulesBlock(name, pair.value, fileName, lineCounter, errors, sourceSpan);
  }

  if (!program) {
    if (errors.length === 0) {
      errors.push({
        message: 'Document must contain one top-level "rules <name>" block',
        file: fileName,
      });
    }
    return { success: false, errors, warnings };
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const manifest: RulesManifest = {
    artifact: 'loj.rules.manifest',
    schemaVersion: 2,
    ruleSet: program.name,
    rules: program.rules.map((rule) => ({
      effect: rule.effect,
      operation: rule.operation,
      when: rule.when,
      or: rule.or.length > 0 ? rule.or : undefined,
      message: rule.message,
      scopeWhen: rule.scopeWhen,
      scope: rule.scope,
    })),
    eligibility: program.eligibility.map((rule) => ({
      kind: rule.kind,
      name: rule.name,
      when: rule.when,
      or: rule.or.length > 0 ? rule.or : undefined,
      message: rule.message,
    })),
    validation: program.validation.map((rule) => ({
      kind: rule.kind,
      name: rule.name,
      when: rule.when,
      or: rule.or.length > 0 ? rule.or : undefined,
      message: rule.message,
    })),
    derivations: program.derivations.map((rule) => ({
      kind: rule.kind,
      field: rule.field,
      when: rule.when,
      value: rule.value,
    })),
  };

  return {
    success: true,
    program,
    manifest,
    errors,
    warnings,
  };
}

function parseRulesBlock(
  name: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  sourceSpan?: SourceSpan,
): RulesProgram {
  if (!isMap(value)) {
    pushError(errors, `rules ${name} must be a YAML mapping`, sourceSpan);
    return {
      name,
      rules: [],
      eligibility: [],
      validation: [],
      derivations: [],
    };
  }

  const rules: RulesEntry[] = [];
  const eligibility: RulesEligibilityEntry[] = [];
  const validation: RulesValidationEntry[] = [];
  const derivations: RulesDerivationEntry[] = [];

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value).trim();
    const pairSpan = getPairSpan(pair, fileName, lineCounter);

    if (key.startsWith('allow ') || key.startsWith('deny ')) {
      const entry = parseAllowDenyEntry(key, pair.value, fileName, lineCounter, errors, pairSpan);
      if (entry) {
        rules.push(entry);
      }
      continue;
    }
    if (key.startsWith('eligibility ')) {
      const entry = parseEligibilityEntry(key, pair.value, fileName, lineCounter, errors, pairSpan);
      if (entry) {
        eligibility.push(entry);
      }
      continue;
    }
    if (key.startsWith('validate ')) {
      const entry = parseValidationEntry(key, pair.value, fileName, lineCounter, errors, pairSpan);
      if (entry) {
        validation.push(entry);
      }
      continue;
    }
    if (key.startsWith('derive ')) {
      const entry = parseDerivationEntry(key, pair.value, fileName, lineCounter, errors, pairSpan);
      if (entry) {
        derivations.push(entry);
      }
      continue;
    }

    pushError(errors, `rules ${name} has unsupported key "${key}"`, pairSpan);
  }

  if (rules.length === 0 && eligibility.length === 0 && validation.length === 0 && derivations.length === 0) {
    pushError(errors, `rules ${name} must define at least one allow/deny, eligibility, validate, or derive entry`, sourceSpan);
  }

  return {
    name,
    rules,
    eligibility,
    validation,
    derivations,
  };
}

function parseAllowDenyEntry(
  key: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  sourceSpan?: SourceSpan,
): RulesEntry | undefined {
  const [effectRaw, ...operationParts] = key.split(/\s+/);
  const effect = effectRaw as RulesEffect;
  const operation = operationParts.join(' ').trim() as RulesOperation;
  if (!RULES_OPERATIONS.includes(operation)) {
    pushError(errors, `Unsupported operation "${operation}" in "${key}"`, sourceSpan);
    return undefined;
  }
  if (!isMap(value)) {
    pushError(errors, `"${key}" must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let when: ExprNode | undefined;
  const or: ExprNode[] = [];
  let message: RulesMessage | undefined;
  let scopeWhen: ExprNode | undefined;
  let scope: ExprNode | undefined;

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const pairKey = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (pairKey) {
      case 'when': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} when`);
        when = source ? parseRulesExpr(source, errors, pairSpan, `${key} when`) : undefined;
        break;
      }
      case 'or':
        or.push(...parseExprList(pair.value, fileName, lineCounter, errors, `${key} or`, pairSpan));
        break;
      case 'message':
        message = parseMessageValue(pair.value, fileName, lineCounter, errors, `${key} message`, pairSpan);
        break;
      case 'scopeWhen': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} scopeWhen`);
        scopeWhen = source ? parseRulesExpr(source, errors, pairSpan, `${key} scopeWhen`) : undefined;
        break;
      }
      case 'scope': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} scope`);
        scope = source ? parseRulesExpr(source, errors, pairSpan, `${key} scope`) : undefined;
        break;
      }
      default:
        pushError(errors, `${key} has unsupported key "${pairKey}"`, pairSpan);
        break;
    }
  }

  if (!when) {
    pushError(errors, `${key} must set when`, sourceSpan);
    return undefined;
  }
  if ((scopeWhen && !scope) || (!scopeWhen && scope)) {
    pushError(errors, `${key} must set both scopeWhen and scope together`, sourceSpan);
  }
  if (operation !== 'list' && (scopeWhen || scope)) {
    pushError(errors, `${key} supports scopeWhen/scope only for list`, sourceSpan);
  }

  return {
    effect,
    operation,
    when,
    or,
    message,
    scopeWhen,
    scope,
  };
}

function parseEligibilityEntry(
  key: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  sourceSpan?: SourceSpan,
): RulesEligibilityEntry | undefined {
  const name = key.slice('eligibility '.length).trim();
  if (!name) {
    pushError(errors, `eligibility entry must be named: eligibility <name>`, sourceSpan);
    return undefined;
  }
  if (!isMap(value)) {
    pushError(errors, `"${key}" must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let when: ExprNode | undefined;
  const or: ExprNode[] = [];
  let message: RulesMessage | undefined;

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const pairKey = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (pairKey) {
      case 'when': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} when`);
        when = source ? parseRulesExpr(source, errors, pairSpan, `${key} when`) : undefined;
        break;
      }
      case 'or':
        or.push(...parseExprList(pair.value, fileName, lineCounter, errors, `${key} or`, pairSpan));
        break;
      case 'message':
        message = parseMessageValue(pair.value, fileName, lineCounter, errors, `${key} message`, pairSpan);
        break;
      default:
        pushError(errors, `${key} has unsupported key "${pairKey}"`, pairSpan);
        break;
    }
  }

  if (!when) {
    pushError(errors, `${key} must set when`, sourceSpan);
    return undefined;
  }

  return {
    kind: 'eligibility',
    name,
    when,
    or,
    message,
  };
}

function parseValidationEntry(
  key: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  sourceSpan?: SourceSpan,
): RulesValidationEntry | undefined {
  const name = key.slice('validate '.length).trim();
  if (!name) {
    pushError(errors, `validate entry must be named: validate <name>`, sourceSpan);
    return undefined;
  }
  if (!isMap(value)) {
    pushError(errors, `"${key}" must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let when: ExprNode | undefined;
  const or: ExprNode[] = [];
  let message: RulesMessage | undefined;

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const pairKey = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (pairKey) {
      case 'when': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} when`);
        when = source ? parseRulesExpr(source, errors, pairSpan, `${key} when`) : undefined;
        break;
      }
      case 'or':
        or.push(...parseExprList(pair.value, fileName, lineCounter, errors, `${key} or`, pairSpan));
        break;
      case 'message':
        message = parseMessageValue(pair.value, fileName, lineCounter, errors, `${key} message`, pairSpan);
        break;
      default:
        pushError(errors, `${key} has unsupported key "${pairKey}"`, pairSpan);
        break;
    }
  }

  if (!when) {
    pushError(errors, `${key} must set when`, sourceSpan);
    return undefined;
  }

  return {
    kind: 'validation',
    name,
    when,
    or,
    message,
  };
}

function parseDerivationEntry(
  key: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  sourceSpan?: SourceSpan,
): RulesDerivationEntry | undefined {
  const field = key.slice('derive '.length).trim();
  if (!field) {
    pushError(errors, `derive entry must target a field: derive <field>`, sourceSpan);
    return undefined;
  }
  if (!isMap(value)) {
    pushError(errors, `"${key}" must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let when: ExprNode | undefined;
  let derivationValue: ExprNode | undefined;

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const pairKey = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (pairKey) {
      case 'when': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} when`);
        when = source ? parseRulesExpr(source, errors, pairSpan, `${key} when`) : undefined;
        break;
      }
      case 'value': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${key} value`);
        derivationValue = source ? parseRulesExpr(source, errors, pairSpan, `${key} value`) : undefined;
        break;
      }
      default:
        pushError(errors, `${key} has unsupported key "${pairKey}"`, pairSpan);
        break;
    }
  }

  if (!derivationValue) {
    pushError(errors, `${key} must set value`, sourceSpan);
    return undefined;
  }

  return {
    kind: 'derive',
    field,
    when,
    value: derivationValue,
  };
}

function parseExprList(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): ExprNode[] {
  if (!isSeq(value)) {
    pushError(errors, `${label} must be a YAML sequence`, sourceSpan);
    return [];
  }

  const exprs: ExprNode[] = [];
  for (const item of value.items) {
    const itemSpan = getNodeSpan(item, fileName, lineCounter);
    const source = parseRequiredExprSource(item, errors, itemSpan, label);
    if (!source) {
      continue;
    }
    exprs.push(parseRulesExpr(source, errors, itemSpan, label));
  }
  return exprs;
}

function parseRequiredExprSource(
  value: unknown,
  errors: RulesCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string | undefined {
  if (!isScalar(value)) {
    pushError(errors, `${label} must be a scalar expression`, sourceSpan);
    return undefined;
  }
  const raw = value.value;
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    pushError(errors, `${label} must not be empty`, sourceSpan);
    return undefined;
  }
  return trimmed;
}

function parseRulesExpr(
  source: string,
  errors: RulesCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): ExprNode {
  try {
    return parseExpr(source.replace(/\bin\s*\[([^\]]*)\]/g, 'in ($1)'));
  } catch (error) {
    pushError(errors, `${label} could not be parsed: ${(error as Error).message}`, sourceSpan);
    return { type: 'literal', value: false };
  }
}

function parseMessageValue(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): RulesMessage | undefined {
  if (isScalar(value)) {
    const scalarValue = value.value;
    if (typeof scalarValue === 'string' && scalarValue.trim()) {
      return scalarValue;
    }
    pushError(errors, `${label} must be a non-empty string`, sourceSpan);
    return undefined;
  }
  if (!isMap(value)) {
    pushError(errors, `${label} must be a string or YAML mapping`, sourceSpan);
    return undefined;
  }

  const descriptor: RulesMessageDescriptor = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (key) {
      case 'key': {
        const raw = parseRequiredString(pair.value, errors, pairSpan, `${label} key`);
        if (raw) {
          descriptor.key = raw;
        }
        break;
      }
      case 'defaultMessage': {
        const raw = parseRequiredString(pair.value, errors, pairSpan, `${label} defaultMessage`);
        if (raw) {
          descriptor.defaultMessage = raw;
        }
        break;
      }
      case 'values': {
        descriptor.values = parseMessageValues(pair.value, fileName, lineCounter, errors, `${label} values`, pairSpan);
        break;
      }
      default:
        pushError(errors, `${label} has unsupported key "${key}"`, pairSpan);
        break;
    }
  }

  if (!descriptor.key && !descriptor.defaultMessage) {
    pushError(errors, `${label} descriptor must set key and/or defaultMessage`, sourceSpan);
    return undefined;
  }
  return descriptor;
}

function parseMessageValues(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: RulesCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): Record<string, string> | undefined {
  if (!isMap(value)) {
    pushError(errors, `${label} must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    const parsed = parseRequiredString(pair.value, errors, pairSpan, `${label}.${key}`);
    if (parsed !== undefined) {
      result[key] = parsed;
    }
  }
  return result;
}

function parseRequiredString(
  value: unknown,
  errors: RulesCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string | undefined {
  if (!isScalar(value) || typeof value.value !== 'string' || !value.value.trim()) {
    pushError(errors, `${label} must be a non-empty string`, sourceSpan);
    return undefined;
  }
  return value.value.trim();
}

function pushError(
  errors: RulesCompileError[],
  message: string,
  sourceSpan?: SourceSpan,
): void {
  errors.push({
    message,
    file: sourceSpan?.file,
    line: sourceSpan?.startLine,
    col: sourceSpan?.startCol,
  });
}

function getPairSpan(pair: Pair, fileName: string, lineCounter: LineCounter): SourceSpan | undefined {
  return getNodeSpan(pair, fileName, lineCounter);
}

function getNodeSpan(node: unknown, fileName: string, lineCounter: LineCounter): SourceSpan | undefined {
  if (!node || typeof node !== 'object' || !('range' in (node as Record<string, unknown>))) {
    return undefined;
  }
  const range = (node as { range?: [number, number, number] }).range;
  if (!range) {
    return undefined;
  }
  const start = lineCounter.linePos(range[0]);
  const end = lineCounter.linePos(range[1]);
  return {
    file: fileName,
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
  };
}
