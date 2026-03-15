import { parseExpr } from './expr.js';
import type { ExprNode } from './ir.js';
import {
  LineCounter,
  Pair,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from 'yaml';
import type { SourceSpan } from './ir.js';

export interface FlowCompileError {
  message: string;
  file?: string;
  line?: number;
  col?: number;
}

export interface FlowState {
  name: string;
  label?: string;
  color?: string;
}

export type FlowWizardStepSurface = 'form' | 'read' | 'workflow';

export interface FlowWizardStep {
  name: string;
  completesWith: string;
  surface: FlowWizardStepSurface;
  allow?: ExprNode;
}

export interface FlowTransition {
  name: string;
  from: string[];
  to: string;
  allow?: ExprNode;
}

export interface FlowProgram {
  name: string;
  model: string;
  field: string;
  states: FlowState[];
  wizard?: {
    steps: FlowWizardStep[];
  };
  transitions: FlowTransition[];
}

export interface FlowManifest {
  artifact: 'loj.flow.manifest';
  schemaVersion: 1;
  workflow: string;
  model: string;
  field: string;
  states: FlowState[];
  wizard?: {
    steps: Array<{
      name: string;
      completesWith: string;
      surface: FlowWizardStepSurface;
      allow?: ExprNode;
    }>;
  };
  transitions: Array<{
    name: string;
    from: string[];
    to: string;
    allow?: ExprNode;
  }>;
}

export interface FlowCompileResult {
  success: boolean;
  program?: FlowProgram;
  manifest?: FlowManifest;
  errors: FlowCompileError[];
  warnings: FlowCompileError[];
}

export function isFlowSourceFile(fileName: string): boolean {
  return fileName.endsWith('.flow.loj');
}

export function buildFlowManifestFileName(fileName: string): string {
  const normalizedFileName = fileName.replace(/\\/g, '/');
  const baseName = normalizedFileName.slice(normalizedFileName.lastIndexOf('/') + 1);
  if (baseName.endsWith('.flow.loj')) {
    return `${baseName.slice(0, -'.flow.loj'.length)}.flow.manifest.json`;
  }
  const withoutExtension = baseName.replace(/\.[^.]+$/, '');
  return `${withoutExtension}.flow.manifest.json`;
}

export function compileFlowSource(
  source: string,
  fileName: string = 'workflow.flow.loj',
): FlowCompileResult {
  const errors: FlowCompileError[] = [];
  const warnings: FlowCompileError[] = [];
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

  let program: FlowProgram | undefined;
  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const sourceSpan = getPairSpan(pair, fileName, lineCounter);
    if (!key.startsWith('workflow ')) {
      pushError(errors, `Unknown top-level key: "${key}"`, sourceSpan);
      continue;
    }
    if (program) {
      pushError(errors, 'Only one top-level "workflow <name>" block is supported in the first slice', sourceSpan);
      continue;
    }
    const name = key.slice('workflow '.length).trim();
    if (!name) {
      pushError(errors, 'Top-level workflow block must be named: workflow <name>', sourceSpan);
      continue;
    }
    program = parseWorkflowBlock(name, pair.value, fileName, lineCounter, errors, sourceSpan);
  }

  if (!program) {
    if (errors.length === 0) {
      errors.push({
        message: 'Document must contain one top-level "workflow <name>" block',
        file: fileName,
      });
    }
    return { success: false, errors, warnings };
  }
  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const manifest: FlowManifest = {
    artifact: 'loj.flow.manifest',
    schemaVersion: 1,
    workflow: program.name,
    model: program.model,
    field: program.field,
    states: program.states,
    wizard: program.wizard
      ? {
        steps: program.wizard.steps.map((step) => ({
          name: step.name,
          completesWith: step.completesWith,
          surface: step.surface,
          allow: step.allow,
        })),
      }
      : undefined,
    transitions: program.transitions.map((transition) => ({
      name: transition.name,
      from: transition.from,
      to: transition.to,
      allow: transition.allow,
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

function parseWorkflowBlock(
  name: string,
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: FlowCompileError[],
  sourceSpan?: SourceSpan,
): FlowProgram | undefined {
  if (!isMap(value)) {
    pushError(errors, `workflow ${name} must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let model = '';
  let field = '';
  let states: FlowState[] = [];
  let wizard: FlowProgram['wizard'];
  let transitions: FlowTransition[] = [];

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (key) {
      case 'model':
        model = parseRequiredStringField(pair.value, errors, pairSpan, `workflow ${name} model`) ?? '';
        break;
      case 'field':
        field = parseRequiredStringField(pair.value, errors, pairSpan, `workflow ${name} field`) ?? '';
        break;
      case 'states':
        states = parseStates(pair.value, fileName, lineCounter, errors, `workflow ${name}`, pairSpan);
        break;
      case 'wizard':
        wizard = parseWizard(pair.value, fileName, lineCounter, errors, `workflow ${name}`, pairSpan);
        break;
      case 'transitions':
        transitions = parseTransitions(pair.value, fileName, lineCounter, errors, `workflow ${name}`, pairSpan);
        break;
      default:
        pushError(errors, `workflow ${name} has unsupported key "${key}"`, pairSpan);
        break;
    }
  }

  if (!model) {
    pushError(errors, `workflow ${name} must set model`, sourceSpan);
  }
  if (!field) {
    pushError(errors, `workflow ${name} must set field`, sourceSpan);
  }
  if (states.length === 0) {
    pushError(errors, `workflow ${name} must define at least one state`, sourceSpan);
  }
  if (transitions.length === 0) {
    pushError(errors, `workflow ${name} must define at least one transition`, sourceSpan);
  }

  const knownStates = new Set(states.map((state) => state.name));
  for (const transition of transitions) {
    for (const fromState of transition.from) {
      if (!knownStates.has(fromState)) {
        pushError(errors, `workflow ${name} transition "${transition.name}" references unknown from state "${fromState}"`, sourceSpan);
      }
    }
    if (!knownStates.has(transition.to)) {
      pushError(errors, `workflow ${name} transition "${transition.name}" references unknown to state "${transition.to}"`, sourceSpan);
    }
  }
  for (const step of wizard?.steps ?? []) {
    if (!knownStates.has(step.completesWith)) {
      pushError(errors, `workflow ${name} wizard step "${step.name}" references unknown completesWith state "${step.completesWith}"`, sourceSpan);
    }
  }

  return {
    name,
    model,
    field,
    states,
    wizard,
    transitions,
  };
}

function parseStates(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: FlowCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): FlowState[] {
  if (!isMap(value)) {
    pushError(errors, `${label} states must be a YAML mapping`, sourceSpan);
    return [];
  }

  const seen = new Set<string>();
  const states: FlowState[] = [];
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const stateName = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!stateName) {
      pushError(errors, `${label} state names must be non-empty`, pairSpan);
      continue;
    }
    if (seen.has(stateName)) {
      pushError(errors, `${label} has duplicate state "${stateName}"`, pairSpan);
      continue;
    }
    seen.add(stateName);
    if (!isMap(pair.value)) {
      pushError(errors, `${label} state "${stateName}" must be a YAML mapping`, pairSpan);
      continue;
    }

    let labelValue: string | undefined;
    let color: string | undefined;
    for (const statePair of pair.value.items) {
      if (!isPair(statePair) || !isScalar(statePair.key)) {
        continue;
      }
      const key = String(statePair.key.value);
      const statePairSpan = getPairSpan(statePair, fileName, lineCounter);
      switch (key) {
        case 'label':
          labelValue = parseOptionalStringField(statePair.value, errors, statePairSpan, `${label} state "${stateName}" label`);
          break;
        case 'color':
          color = parseOptionalStringField(statePair.value, errors, statePairSpan, `${label} state "${stateName}" color`);
          break;
        default:
          pushError(errors, `${label} state "${stateName}" has unsupported key "${key}"`, statePairSpan);
      }
    }

    states.push({
      name: stateName,
      label: labelValue,
      color,
    });
  }
  return states;
}

function parseWizard(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: FlowCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): FlowProgram['wizard'] | undefined {
  if (!isMap(value)) {
    pushError(errors, `${label} wizard must be a YAML mapping`, sourceSpan);
    return undefined;
  }

  let steps: FlowWizardStep[] = [];
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (key !== 'steps') {
      pushError(errors, `${label} wizard has unsupported key "${key}"`, pairSpan);
      continue;
    }
    if (!isSeq(pair.value)) {
      pushError(errors, `${label} wizard steps must be a YAML sequence`, pairSpan);
      continue;
    }
    steps = pair.value.items
      .map((item, index) => parseWizardStep(item, fileName, lineCounter, errors, label, index))
      .filter((step): step is FlowWizardStep => Boolean(step));
  }

  return steps.length > 0 ? { steps } : undefined;
}

function parseWizardStep(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: FlowCompileError[],
  label: string,
  stepIndex: number,
): FlowWizardStep | undefined {
  const sourceSpan = getNodeSpan(value, fileName, lineCounter);
  if (!isMap(value)) {
    pushError(errors, `${label} wizard step must be a mapping`, sourceSpan);
    return undefined;
  }

  let name = '';
  let completesWith = '';
  let surface: FlowWizardStepSurface | undefined;
  let allow: ExprNode | undefined;

  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const key = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    switch (key) {
      case 'name':
        name = parseRequiredStringField(pair.value, errors, pairSpan, `${label} wizard step name`) ?? '';
        break;
      case 'completesWith':
        completesWith = parseRequiredStringField(pair.value, errors, pairSpan, `${label} wizard step completesWith`) ?? '';
        break;
      case 'surface': {
        const parsed = parseRequiredStringField(pair.value, errors, pairSpan, `${label} wizard step surface`);
        if (parsed === 'form' || parsed === 'read' || parsed === 'workflow') {
          surface = parsed;
        } else if (parsed) {
          pushError(errors, `${label} wizard step surface must be one of: form, read, workflow`, pairSpan);
        }
        break;
      }
      case 'allow': {
        const source = parseRequiredExprSource(pair.value, errors, pairSpan, `${label} wizard step allow`);
        allow = source ? parseFlowExpression(source, errors, pairSpan, `${label} wizard step allow`) : undefined;
        break;
      }
      default:
        pushError(errors, `${label} wizard step has unsupported key "${key}"`, pairSpan);
        break;
    }
  }

  if (!name || !completesWith) {
    pushError(errors, `${label} wizard step must set name and completesWith`, sourceSpan);
    return undefined;
  }

  return {
    name,
    completesWith,
    surface: surface ?? (stepIndex === 0 ? 'form' : 'workflow'),
    allow,
  };
}

function parseTransitions(
  value: unknown,
  fileName: string,
  lineCounter: LineCounter,
  errors: FlowCompileError[],
  label: string,
  sourceSpan?: SourceSpan,
): FlowTransition[] {
  if (!isMap(value)) {
    pushError(errors, `${label} transitions must be a YAML mapping`, sourceSpan);
    return [];
  }

  const transitions: FlowTransition[] = [];
  const seen = new Set<string>();
  for (const pair of value.items) {
    if (!isPair(pair) || !isScalar(pair.key)) {
      continue;
    }
    const transitionName = String(pair.key.value);
    const pairSpan = getPairSpan(pair, fileName, lineCounter);
    if (!transitionName) {
      pushError(errors, `${label} transition names must be non-empty`, pairSpan);
      continue;
    }
    if (seen.has(transitionName)) {
      pushError(errors, `${label} has duplicate transition "${transitionName}"`, pairSpan);
      continue;
    }
    seen.add(transitionName);
    if (!isMap(pair.value)) {
      pushError(errors, `${label} transition "${transitionName}" must be a YAML mapping`, pairSpan);
      continue;
    }

    let from: string[] = [];
    let to = '';
    let allow: ExprNode | undefined;

    for (const transitionPair of pair.value.items) {
      if (!isPair(transitionPair) || !isScalar(transitionPair.key)) {
        continue;
      }
      const key = String(transitionPair.key.value);
      const transitionPairSpan = getPairSpan(transitionPair, fileName, lineCounter);
      switch (key) {
        case 'from':
          from = parseStateList(transitionPair.value, errors, transitionPairSpan, `${label} transition "${transitionName}" from`);
          break;
        case 'to':
          to = parseRequiredStringField(transitionPair.value, errors, transitionPairSpan, `${label} transition "${transitionName}" to`) ?? '';
          break;
        case 'allow': {
          const source = parseRequiredExprSource(transitionPair.value, errors, transitionPairSpan, `${label} transition "${transitionName}" allow`);
          allow = source ? parseFlowExpression(source, errors, transitionPairSpan, `${label} transition "${transitionName}" allow`) : undefined;
          break;
        }
        default:
          pushError(errors, `${label} transition "${transitionName}" has unsupported key "${key}"`, transitionPairSpan);
          break;
      }
    }

    if (from.length === 0 || !to) {
      pushError(errors, `${label} transition "${transitionName}" must set from and to`, pairSpan);
      continue;
    }

    transitions.push({
      name: transitionName,
      from,
      to,
      allow,
    });
  }
  return transitions;
}

function parseStateList(
  value: unknown,
  errors: FlowCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string[] {
  if (isScalar(value)) {
    const parsed = parseOptionalStringField(value, errors, sourceSpan, label);
    return parsed ? [parsed] : [];
  }
  if (!isSeq(value)) {
    pushError(errors, `${label} must be a string or sequence of strings`, sourceSpan);
    return [];
  }
  const items = value.items
    .map((item) => (isScalar(item) && item.value !== undefined && item.value !== null ? String(item.value) : ''))
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    pushError(errors, `${label} must list at least one state`, sourceSpan);
  }
  return items;
}

function parseOptionalStringField(
  value: unknown,
  errors: FlowCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string | undefined {
  if (!isScalar(value) || value.value === null || value.value === undefined) {
    pushError(errors, `${label} must be a string`, sourceSpan);
    return undefined;
  }
  return String(value.value);
}

function parseRequiredStringField(
  value: unknown,
  errors: FlowCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string | undefined {
  const parsed = parseOptionalStringField(value, errors, sourceSpan, label);
  if (!parsed || parsed.trim().length === 0) {
    pushError(errors, `${label} must be a non-empty string`, sourceSpan);
    return undefined;
  }
  return parsed.trim();
}

function parseRequiredExprSource(
  value: unknown,
  errors: FlowCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): string | undefined {
  const source = scalarToExprSource(value);
  if (!source || source.trim().length === 0) {
    pushError(errors, `${label} must be a non-empty expression string`, sourceSpan);
    return undefined;
  }
  return source;
}

function scalarToExprSource(value: unknown): string | undefined {
  if (!isScalar(value) || value.value === null || value.value === undefined) {
    return undefined;
  }
  if (typeof value.value === 'string') {
    return value.value;
  }
  if (typeof value.value === 'number' || typeof value.value === 'boolean') {
    return String(value.value);
  }
  return undefined;
}

function parseFlowExpression(
  source: string,
  errors: FlowCompileError[],
  sourceSpan: SourceSpan | undefined,
  label: string,
): ExprNode | undefined {
  try {
    return parseExpr(source.replace(/\bin\s*\[([^\]]*)\]/g, 'in ($1)'));
  } catch (error) {
    pushError(errors, `${label} could not be parsed: ${error instanceof Error ? error.message : String(error)}`, sourceSpan);
    return undefined;
  }
}

function pushError(
  errors: FlowCompileError[],
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
