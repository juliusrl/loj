import type { BackendLanguage, BackendProfile, BackendTarget } from './targets.js';
import type {
  FlowManifest,
  FlowProgram,
} from './flow-proof.js';
import type {
  RulesManifest,
  RulesProgram,
} from './rules-proof.js';

export interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface IRNode {
  id: string;
  kind: string;
  sourceSpan?: SourceSpan;
}

export interface IRCompilerConfig extends IRNode {
  kind: 'compiler';
  target: BackendTarget;
  language: BackendLanguage;
  profile: BackendProfile;
}

export interface IRAppConfig extends IRNode {
  kind: 'app';
  name: string;
  packageName: string;
}

export interface IRFieldDecorator {
  name: string;
  args?: Array<string | number | boolean>;
  sourceSpan?: SourceSpan;
}

export interface IRAuthPolicyEscape {
  kind: 'auth.policy';
  source: 'fn' | 'rules';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program?: RulesProgram;
  manifest?: RulesManifest;
}

export interface IRRulesLink extends IRNode {
  kind: 'rules.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program: RulesProgram;
  manifest: RulesManifest;
}

export interface IRFlowLink extends IRNode {
  kind: 'flow.link';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
  program: FlowProgram;
  manifest: FlowManifest;
}

export type IRFieldType =
  | {
    type: 'scalar';
    name: 'string' | 'text' | 'integer' | 'long' | 'decimal' | 'boolean' | 'datetime' | 'date';
  }
  | {
    type: 'enum';
    values: string[];
  }
  | {
    type: 'relation';
    kind: 'belongsTo';
    target: string;
  }
  | {
    type: 'relation';
    kind: 'hasMany';
    target: string;
    by: string;
  };

export interface IRModelField extends IRNode {
  kind: 'field';
  name: string;
  fieldType: IRFieldType;
  decorators: IRFieldDecorator[];
}

export interface IRModel extends IRNode {
  kind: 'model';
  name: string;
  fields: IRModelField[];
}

export interface IRResourceAuth extends IRNode {
  kind: 'resource.auth';
  mode: 'public' | 'authenticated';
  roles: string[];
  policy?: IRAuthPolicyEscape;
}

export interface IRResourceOperations extends IRNode {
  kind: 'resource.operations';
  list: boolean;
  get: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface IRResourceCreateInclude extends IRNode {
  kind: 'resource.create.include';
  field: string;
  fields: string[];
}

export interface IRResourceCreate extends IRNode {
  kind: 'resource.create';
  includes: IRResourceCreateInclude[];
  rules?: IRRulesLink;
}

export interface IRResourceUpdate extends IRNode {
  kind: 'resource.update';
  includes: IRResourceCreateInclude[];
}

export interface IRResource extends IRNode {
  kind: 'resource';
  name: string;
  model: string;
  api: string;
  auth: IRResourceAuth;
  operations: IRResourceOperations;
  create?: IRResourceCreate;
  update?: IRResourceUpdate;
  workflow?: IRFlowLink;
}

export interface IRReadModelField extends IRNode {
  kind: 'readModel.field';
  name: string;
  fieldType: IRFieldType;
  decorators: IRFieldDecorator[];
  section: 'input' | 'result';
}

export interface IRReadModelHandlerEscape {
  kind: 'readModel.handler';
  source: 'fn' | 'sql';
  logicalPath?: string;
  resolvedPath: string;
  lockIn: 'neutral' | 'explicit';
}

export interface IRReadModelAuth extends IRNode {
  kind: 'readModel.auth';
  mode: 'public' | 'authenticated';
  roles: string[];
}

export interface IRReadModel extends IRNode {
  kind: 'readModel';
  name: string;
  api: string;
  auth: IRReadModelAuth;
  inputs: IRReadModelField[];
  result: IRReadModelField[];
  handler: IRReadModelHandlerEscape;
  rules?: IRRulesLink;
}

export interface EscapeHatchStats {
  totalNodes: number;
  exprCount: number;
  fnCount: number;
  sqlCount?: number;
  customCount: number;
  escapePercent: number;
  overBudget: boolean;
}

export interface IRSdslProgram extends IRNode {
  kind: 'program';
  schemaVersion: '0.1.0';
  entryFile: string;
  sourceFiles: string[];
  moduleGraph: Record<string, string[]>;
  app: IRAppConfig;
  compiler: IRCompilerConfig;
  models: IRModel[];
  resources: IRResource[];
  readModels: IRReadModel[];
  escapeStats?: EscapeHatchStats;
}
