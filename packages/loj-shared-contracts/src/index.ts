export type MessageDescriptorValue = string | number | boolean | null | undefined;
export type SeedScalarValue = string | number | boolean;

export interface MessageDescriptor<TValue = MessageDescriptorValue> {
  key?: string;
  defaultMessage?: string;
  values?: Record<string, TValue>;
}

export type MessageLike<TValue = MessageDescriptorValue> = string | MessageDescriptor<TValue>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isMessageDescriptor(value: unknown): value is MessageDescriptor<unknown> {
  return typeof value === 'object'
    && value !== null
    && ('key' in value || 'defaultMessage' in value || 'values' in value);
}

export function resolveMessageText<TValue = MessageDescriptorValue>(
  message: MessageLike<TValue> | unknown,
  fallback = '',
): string {
  if (typeof message === 'string') {
    return message;
  }
  if (!isMessageDescriptor(message)) {
    return fallback;
  }

  const template = isNonEmptyString(message.defaultMessage)
    ? message.defaultMessage
    : isNonEmptyString(message.key)
      ? message.key
      : fallback;

  if (!message.values || Object.keys(message.values).length === 0) {
    return template;
  }

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, token: string) => {
    const value = message.values?.[token];
    return value === undefined || value === null ? `{${token}}` : String(value);
  });
}

export interface RowFieldSeedSource {
  row?: string;
}

export interface InputFieldSeedSource {
  input?: string;
}

export interface SelectionFieldSeedSource {
  selection?: string;
}

export type ReadModelRowSeedSource =
  | SeedScalarValue
  | (RowFieldSeedSource & InputFieldSeedSource);

export type PageCreateSeedSource =
  | SeedScalarValue
  | (InputFieldSeedSource & SelectionFieldSeedSource);

export interface LiteralSeedValue {
  kind: 'literal';
  value: SeedScalarValue;
}

export interface RowResultFieldSeedValue {
  kind: 'rowField';
  field: string;
}

export interface InputFieldSeedValue {
  kind: 'inputField';
  field: string;
}

export interface QueryInputFieldSeedValue {
  kind: 'inputField';
  queryState: string;
  field: string;
}

export interface SelectionFieldSeedValue {
  kind: 'selectionField';
  selectionState: string;
  field: string;
}

export type NormalizedReadModelRowSeedValue =
  | LiteralSeedValue
  | RowResultFieldSeedValue
  | InputFieldSeedValue;

export type NormalizedPageCreateSeedValue =
  | LiteralSeedValue
  | QueryInputFieldSeedValue
  | SelectionFieldSeedValue;

export interface CreateHandoffDescriptor<TSeedValue> {
  resource: string;
  label?: MessageLike<string | number | boolean | null>;
  seed?: Record<string, TSeedValue>;
}

export interface NormalizedCreateHandoffDescriptor<TSeedValue> {
  action: 'create';
  resource: string;
  label: MessageLike<string | number | boolean | null>;
  seed: Record<string, TSeedValue>;
}

export interface ReadModelListPresentationDescriptor {
  groupBy?: string[];
  pivotBy?: string;
}

export interface NormalizedReadModelListPresentationDescriptor {
  groupBy: string[];
  pivotBy?: string;
}

export interface DateNavigationDescriptor {
  field: string;
  prevLabel?: MessageLike<string | number | boolean | null>;
  nextLabel?: MessageLike<string | number | boolean | null>;
}

export interface ReadModelQueryBindingDescriptor {
  queryState?: string;
}

export interface ReadModelSelectionBindingDescriptor {
  selectionState?: string;
}

export interface ReadModelPageConsumerDescriptor
  extends ReadModelQueryBindingDescriptor, ReadModelSelectionBindingDescriptor {
  dateNavigation?: DateNavigationDescriptor;
}

export type WorkflowSurface = 'form' | 'read' | 'workflow';
export type WorkflowStepStatus = 'done' | 'current' | 'upcoming';
export type RelationSurfaceKind = 'table' | 'label-list' | 'count';

export interface WorkflowSummaryStepDescriptor {
  name: string;
  status: WorkflowStepStatus;
  completesWith?: string;
  surface?: WorkflowSurface;
}

export interface WorkflowStepMetaDescriptor {
  name: string;
  completesWith: string;
  surface: WorkflowSurface;
  allow?: unknown;
}

export interface WorkflowTransitionSummaryDescriptor {
  name: string;
  to: string;
  toLabel: string;
}

export interface WorkflowTransitionMetaDescriptor {
  name: string;
  from: string[];
  to: string;
  allow?: unknown;
}

export interface WorkflowStateMetaDescriptor {
  name: string;
  label: string;
  color?: string | null;
}

export type WorkflowStateMetaDescriptorMap = Record<string, WorkflowStateMetaDescriptor>;
export type WorkflowTransitionTargetMap = Record<string, string>;
export type WorkflowStateLabelMap = Record<string, string>;

export interface WorkflowStateSummaryDescriptor {
  field: string;
  currentState: string;
  currentStateLabel: string;
  workflowHref: string | null;
  steps: WorkflowSummaryStepDescriptor[];
  transitions: WorkflowTransitionSummaryDescriptor[];
}

export interface WorkflowProgressDescriptor {
  stateHeading: string;
  stateLabel: string;
  currentStepName?: string | null;
  nextStepName?: string | null;
  steps: WorkflowSummaryStepDescriptor[];
}

export interface RelationItemSummaryDescriptor {
  id: string;
  label: string;
  viewHref: string | null;
  editHref: string | null;
  workflowHref: string | null;
  workflowStateLabel: string | null;
}

export interface RelationContextItemDescriptor {
  field: string;
  title: string;
  surfaceKind: RelationSurfaceKind;
  targetResource: string;
  targetModel: string;
  count: number;
  items: RelationItemSummaryDescriptor[] | null;
  createHref: string | null;
  loading: boolean;
  error: boolean;
}

export interface RecordScopedCustomBlockContextDescriptor<TParentRecord = unknown> {
  recordId: string;
  returnTo: string | null;
  backHref: string | null;
  parentReadHref: string | null;
  parentEditHref: string | null;
  parentRecord: TParentRecord | null;
  parentLoading: boolean;
  parentError: boolean;
  parentWorkflow: WorkflowStateSummaryDescriptor | null;
  relations: RelationContextItemDescriptor[];
}
