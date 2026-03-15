/**
 * ReactDSL Intermediate Representation (IR)
 *
 * The IR is the canonical, versioned semantic model of a ReactDSL application.
 * It is framework-agnostic — React is just one compilation target.
 *
 * Every meaningful node has:
 *   - id: a stable, path-based identifier (e.g. "resource.users.view.list")
 *   - kind: the semantic type of the node
 *   - sourceSpan: location in the .rdsl source file
 */

import type {
  FlowManifest,
  FlowProgram,
} from './flow-proof.js';
import type {
  RulesManifest,
  RulesProgram,
} from './rules-proof.js';
import type {
  StyleManifest,
  StyleProgram,
} from './style-proof.js';
import type {
  NormalizedCreateHandoffDescriptor,
  DateNavigationDescriptor as SharedDateNavigationDescriptor,
  InputFieldSeedValue as SharedInputFieldSeedValue,
  LiteralSeedValue as SharedLiteralSeedValue,
  NormalizedPageCreateSeedValue,
  NormalizedReadModelListPresentationDescriptor as SharedNormalizedReadModelListPresentationDescriptor,
  NormalizedReadModelRowSeedValue,
  QueryInputFieldSeedValue as SharedQueryInputFieldSeedValue,
  ReadModelPageConsumerDescriptor as SharedReadModelPageConsumerDescriptor,
  RowResultFieldSeedValue as SharedRowResultFieldSeedValue,
  SelectionFieldSeedValue as SharedSelectionFieldSeedValue,
  MessageLike as SharedMessageLike,
} from '@loj-lang/shared-contracts';

// ─── Source Mapping ──────────────────────────────────────────────

export interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

// ─── Base Node ───────────────────────────────────────────────────

export interface IRNode {
  id: string;
  kind: string;
  sourceSpan?: SourceSpan;
}

// ─── Three-Tier Logic Escape Hatch ───────────────────────────────
//
// Tier 0: Built-in DSL expressions (ExprNode) — the default, safest path
// Tier 1: @expr(...)  — pure TS expression subset, no statements/imports/side-effects
// Tier 2: @fn(...)    — reference to external pure function file
// Tier 3: @custom(...) — full React component (handled by UI escape hatch)
//
// The compiler meters all escape hatch usage and warns if the ratio
// exceeds the healthy threshold (~15-20%). If too many @fn() calls
// appear, that signals a DSL design gap — not a healthy extension.

/** Tier 1: Raw TS expression string — parsed but NOT compiled into ExprNode */
export interface EscapeExpr {
  tier: 'expr';
  /** The raw TS expression string, e.g. 'user.role === "admin"' */
  raw: string;
}

/** Tier 2: Reference to an external function file */
export interface EscapeFn {
  tier: 'fn';
  /** Project-relative resolved path to the function file, e.g. 'logic/canEditUser.ts' */
  path: string;
  /** Optional source logical id when the author used an extensionless path. */
  logicalPath?: string;
  /** Whether the source used target-neutral or explicit target-locked authoring. */
  lockIn: 'neutral' | 'explicit';
  /** Exported function name (default: 'default') */
  exportName?: string;
}

/** A value that can be either a built-in DSL expression or an escape hatch */
export type RuleValue =
  | { source: 'builtin'; expr: ExprNode }
  | { source: 'escape-expr'; escape: EscapeExpr }
  | { source: 'escape-fn'; escape: EscapeFn };

/** A label/display value that can be static, expr, or fn */
export type DynamicValue =
  | { source: 'static'; value: string }
  | { source: 'escape-expr'; escape: EscapeExpr }
  | { source: 'escape-fn'; escape: EscapeFn };

// ─── Expression AST (constrained rule language — Tier 0) ─────────

export type ExprNode =
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'identifier'; path: string[] }          // e.g. currentUser.role
  | { type: 'binary'; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { type: 'unary'; op: 'not'; operand: ExprNode }
  | { type: 'call'; fn: BuiltinFn; args: ExprNode[] }
  | { type: 'member'; object: ExprNode; property: string }
  | { type: 'in'; value: ExprNode; list: ExprNode[] };

export type BinaryOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||' | '+' | '-' | '*' | '/';
export type BuiltinFn = 'hasRole' | 'isOwner' | 'isEmpty' | 'isNotEmpty' | 'count';

// ─── Escape Hatch Statistics (metering) ──────────────────────────

export interface EscapeHatchStats {
  /** Total nodes in the IR */
  totalNodes: number;
  /** Number of @expr() usages */
  exprCount: number;
  /** Number of @fn() usages */
  fnCount: number;
  /** Number of @custom() usages (UI escape hatch) */
  customCount: number;
  /** escape% = (expr + fn + custom) / total * 100 */
  escapePercent: number;
  /** Whether the escape ratio exceeds the healthy threshold */
  overBudget: boolean;
}

// ─── Effect AST (constrained effect language) ────────────────────

export type MessageValueNode =
  | string
  | number
  | boolean
  | null
  | { ref: string };

export interface MessageDescriptorNode {
  key?: string;
  defaultMessage?: string;
  values?: Record<string, MessageValueNode>;
}

export interface ToastMessageDescriptorNode {
  key: string;
  defaultMessage?: string;
  values?: Record<string, MessageValueNode>;
}

export type MessageLikeNode = SharedMessageLike<string | number | boolean | null>;
export type ToastMessageNode = string | ToastMessageDescriptorNode;

export type EffectNode =
  | { type: 'refresh'; target: string }
  | { type: 'invalidate'; target: string }
  | { type: 'toast'; message: ToastMessageNode; variant?: 'success' | 'error' | 'info' }
  | { type: 'redirect'; target: string }
  | { type: 'openDialog'; dialog: string }
  | { type: 'emitEvent'; event: string; payload?: Record<string, unknown> };

// ─── Model ───────────────────────────────────────────────────────

export interface IRFieldDecorator {
  name: string;
  args?: Record<string, unknown>;
}

export interface IRModelField extends IRNode {
  kind: 'field';
  name: string;
  fieldType: IRFieldType;
  decorators: IRFieldDecorator[];
}

export type IRFieldType =
  | { type: 'scalar'; name: 'string' | 'number' | 'boolean' | 'datetime' }
  | { type: 'enum'; values: string[] }
  | { type: 'relation'; target: string; kind: 'belongsTo' }
  | { type: 'relation'; target: string; kind: 'hasMany'; by: string };

export interface IRModel extends IRNode {
  kind: 'model';
  name: string;
  fields: IRModelField[];
}

// ─── Column / Filter / FormField descriptors ─────────────────────

export interface IRColumnDecorator {
  name: string;
  args?: Record<string, unknown>;
}

export interface IRColumn extends IRNode {
  kind: 'column';
  field: string;
  decorators: IRColumnDecorator[];
  /** Logic escape: @expr() for computed label/value */
  dynamicLabel?: DynamicValue;
  /** Logic escape: @fn() for display transform */
  displayFn?: EscapeFn;
  /** UI escape: @custom() for full React cell renderer */
  customRenderer?: string;
}

export interface IRFilter extends IRNode {
  kind: 'filter';
  field: string;
}

export interface IRFormField extends IRNode {
  kind: 'formField';
  field: string;
  decorators: IRFieldDecorator[];
  /** Logic escape: @expr() for computed visibility */
  visibleWhen?: RuleValue;
  /** Logic escape: builtin / @expr() / @fn() for computed interactivity */
  enabledWhen?: RuleValue;
  /** Logic escape: @fn() for validation */
  validateFn?: EscapeFn;
  /** UI escape: @custom() for full React field component */
  customField?: string;
}

// ─── Actions ─────────────────────────────────────────────────────

export interface IRAction extends IRNode {
  kind: 'action';
  name: string;
  confirm?: string;
}

// ─── Policy Rules ────────────────────────────────────────────────
// Rules support three tiers:
//   Tier 0: built-in ExprNode (from DSL expression language)
//   Tier 1: @expr("TS expression") — pure TS expression subset
//   Tier 2: @fn("./logic/check.ts") — external function reference

export interface IRRules {
  visibleIf?: RuleValue;
  enabledIf?: RuleValue;
  allowIf?: RuleValue;
  enforce?: RuleValue;
}

// ─── Views ───────────────────────────────────────────────────────

export interface IRListView extends IRNode {
  kind: 'view.list';
  title: MessageLikeNode;
  style?: string;
  filters: IRFilter[];
  columns: IRColumn[];
  actions: IRAction[];
  pagination?: { size: number; style: 'numbered' | 'infinite' | 'loadMore' };
  rules?: IRRules;
}

export interface IREditView extends IRNode {
  kind: 'view.edit';
  style?: string;
  fields: IRFormField[];
  includes: IRCreateInclude[];
  rules?: IRRules;
  rulesLink?: IRRulesLink;
  onSuccess: EffectNode[];
}

export interface IRCreateView extends IRNode {
  kind: 'view.create';
  style?: string;
  fields: IRFormField[];
  includes: IRCreateInclude[];
  rules?: IRRules;
  rulesLink?: IRRulesLink;
  onSuccess: EffectNode[];
}

export interface IRCreateInclude extends IRNode {
  kind: 'createInclude';
  field: string;
  minItems: number;
  fields: IRFormField[];
  rulesLink?: IRRulesLink;
}

export interface IRFlowLink extends IRNode {
  kind: 'flow.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program: FlowProgram;
  manifest: FlowManifest;
}

export interface IRRulesLink extends IRNode {
  kind: 'rules.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program: RulesProgram;
  manifest: RulesManifest;
}

export interface IRStyleLink extends IRNode {
  kind: 'style.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program: StyleProgram;
  manifest: StyleManifest;
}

export interface IRAssetLink extends IRNode {
  kind: 'asset.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
}

export interface IRAppSeo {
  siteName?: MessageLikeNode;
  defaultTitle?: MessageLikeNode;
  titleTemplate?: MessageLikeNode;
  defaultDescription?: MessageLikeNode;
  defaultImage?: IRAssetLink;
  favicon?: IRAssetLink;
}

export interface IRPageSeo {
  description?: MessageLikeNode;
  canonicalPath?: string;
  image?: IRAssetLink;
  noIndex?: boolean;
}

export interface IRRelatedPanel extends IRNode {
  kind: 'relatedPanel';
  field: string;
}

export interface IRReadView extends IRNode {
  kind: 'view.read';
  title: MessageLikeNode;
  style?: string;
  fields: IRColumn[];
  related: IRRelatedPanel[];
}

export interface IRReadModelField extends IRNode {
  kind: 'readModel.field';
  name: string;
  section: 'inputs' | 'result';
  fieldType: IRFieldType;
  decorators: IRFieldDecorator[];
}

export interface IRReadModelListView extends IRNode, SharedNormalizedReadModelListPresentationDescriptor {
  kind: 'readModel.list';
  columns: IRColumn[];
  pagination?: { size: number; style: 'numbered' | 'infinite' | 'loadMore' };
}

export interface IRReadModel extends IRNode {
  kind: 'readModel';
  name: string;
  api: string;
  rules?: IRRulesLink;
  inputs: IRReadModelField[];
  result: IRReadModelField[];
  list?: IRReadModelListView;
}

// ─── Resource ────────────────────────────────────────────────────

export interface IRResource extends IRNode {
  kind: 'resource';
  name: string;
  model: string;
  api: string;
  workflow?: IRFlowLink;
  workflowStyle?: string;
  views: {
    list?: IRListView;
    edit?: IREditView;
    create?: IRCreateView;
    read?: IRReadView;
  };
}

// ─── Navigation ──────────────────────────────────────────────────

export interface IRNavItem extends IRNode {
  kind: 'navItem';
  label: MessageLikeNode;
  icon?: string;
  target: string;
}

export interface IRNavGroup extends IRNode {
  kind: 'navGroup';
  group: MessageLikeNode;
  visibleIf?: RuleValue;
  items: IRNavItem[];
}

// ─── Dashboard / Page ────────────────────────────────────────────

export interface IRDashboardBlock extends IRNode, SharedReadModelPageConsumerDescriptor {
  kind: 'dashboardBlock';
  blockType: 'metric' | 'chart' | 'table' | 'custom';
  title: MessageLikeNode;
  style?: string;
  data?: string;
  dateNavigation?: Omit<SharedDateNavigationDescriptor, 'prevLabel' | 'nextLabel'> & {
    prevLabel?: MessageLikeNode;
    nextLabel?: MessageLikeNode;
    sourceSpan?: SourceSpan;
  };
  rowActions: IRDashboardRowAction[];
  /** Escape hatch tier 3: custom block component */
  customBlock?: string;
}

export type IRDashboardRowSeedValue =
  | (SharedLiteralSeedValue & { sourceSpan?: SourceSpan })
  | (SharedRowResultFieldSeedValue & { sourceSpan?: SourceSpan })
  | (SharedInputFieldSeedValue & { sourceSpan?: SourceSpan });

export interface IRDashboardRowAction extends IRNode, NormalizedCreateHandoffDescriptor<IRDashboardRowSeedValue> {
  kind: 'dashboardRowAction';
}

export type IRPageActionSeedValue =
  | (SharedLiteralSeedValue & { sourceSpan?: SourceSpan })
  | (SharedQueryInputFieldSeedValue & { sourceSpan?: SourceSpan })
  | (SharedSelectionFieldSeedValue & { sourceSpan?: SourceSpan });

export type IRNormalizedDashboardRowSeedValue = NormalizedReadModelRowSeedValue;
export type IRNormalizedPageActionSeedValue = NormalizedPageCreateSeedValue;

export interface IRPageAction extends IRNode, NormalizedCreateHandoffDescriptor<IRPageActionSeedValue> {
  kind: 'pageAction';
  label: MessageLikeNode;
}

export interface IRPage extends IRNode {
  kind: 'page';
  name: string;
  title: MessageLikeNode;
  style?: string;
  seo?: IRPageSeo;
  pageType: 'dashboard' | 'custom';
  path?: string;
  layout?: string;
  actions: IRPageAction[];
  blocks: IRDashboardBlock[];
}

// ─── App (root) ──────────────────────────────────────────────────

export interface IRCompilerConfig {
  /**
   * Code generation target family.
   * v0.1 supports only "react"; other targets remain explicit future work.
   */
  target: 'react';
  /**
   * Implementation language inside the target family.
   * Kept separate from `target` so future targets such as spring-boot can
   * select `java` vs `kotlin` without encoding language into the target name.
   */
  language: 'typescript';
  /**
   * Optional implementation profile/template selector.
   * Reserved for future target-specific packaging variants.
   */
  profile?: string;
  sourceSpan?: SourceSpan;
}

export interface IRApp extends IRNode {
  kind: 'app';
  schemaVersion: '0.1.0';
  name: string;
  compiler: IRCompilerConfig;
  theme: 'light' | 'dark';
  auth: 'jwt' | 'session' | 'none';
  style?: IRStyleLink;
  seo?: IRAppSeo;
  navigation: IRNavGroup[];
  models: IRModel[];
  resources: IRResource[];
  readModels: IRReadModel[];
  pages: IRPage[];
  /** Escape hatch usage statistics — compiler metering */
  escapeStats?: EscapeHatchStats;
}
