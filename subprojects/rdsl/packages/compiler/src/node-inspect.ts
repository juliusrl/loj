import type {
  DynamicValue,
  EscapeFn,
  EffectNode,
  ExprNode,
  IRAction,
  IRApp,
  IRColumn,
  IRCreateView,
  IRDashboardBlock,
  IREditView,
  IRFieldDecorator,
  IRFilter,
  IRFormField,
  IRListView,
  IRModel,
  IRModelField,
  IRNavGroup,
  IRNavItem,
  IRNode,
  IRPage,
  IRPageAction,
  IRReadView,
  IRRelatedPanel,
  IRResource,
  IRRules,
  MessageLikeNode,
  MessageValueNode,
  RuleValue,
  ToastMessageNode,
} from './ir.js';

export interface SemanticEffectInspection {
  type: EffectNode['type'];
  variant?: Extract<EffectNode, { type: 'toast' }>['variant'];
  target?: string;
  dialog?: string;
  event?: string;
  message?: ToastMessageNode;
}

export interface SemanticNodeInspection {
  id: string;
  kind: string;
  properties: Array<{ label: string; value: string }>;
  effects: SemanticEffectInspection[];
}

export function inspectSemanticNode(ir: IRApp, nodeId: string): SemanticNodeInspection | undefined {
  const node = findSemanticNode(ir, nodeId);
  if (!node) {
    return undefined;
  }

  return buildSemanticNodeInspection(node);
}

export function semanticNodeInspectionToLines(inspection: SemanticNodeInspection): string[] {
  const lines = inspection.properties.map((property) => `${property.label}: ${property.value}`);

  for (const effect of inspection.effects) {
    switch (effect.type) {
      case 'refresh':
      case 'invalidate':
      case 'redirect':
        lines.push(`onSuccess.${effect.type}: ${effect.target}`);
        break;
      case 'openDialog':
        lines.push(`onSuccess.openDialog: ${effect.dialog}`);
        break;
      case 'emitEvent':
        lines.push(`onSuccess.emitEvent: ${effect.event}`);
        break;
      case 'toast':
        if (effect.variant && effect.variant !== 'success') {
          lines.push(`onSuccess.toast.variant: ${effect.variant}`);
        }
        lines.push(...formatToastInspectionLines(effect.message));
        break;
    }
  }

  return lines;
}

function buildSemanticNodeInspection(node: IRNode): SemanticNodeInspection {
  switch (node.kind) {
    case 'app':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'name', value: (node as IRApp).name },
          { label: 'theme', value: (node as IRApp).theme },
          { label: 'auth', value: (node as IRApp).auth },
          { label: 'navigation groups', value: String((node as IRApp).navigation.length) },
          { label: 'resources', value: String((node as IRApp).resources.length) },
          { label: 'pages', value: String((node as IRApp).pages.length) },
        ],
        effects: [],
      };
    case 'model':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'name', value: (node as IRModel).name },
          { label: 'fields', value: joinNames((node as IRModel).fields.map((field) => field.name)) },
        ],
        effects: [],
      };
    case 'field':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'field', value: (node as IRModelField).name },
          { label: 'type', value: formatModelFieldType(node as IRModelField) },
          { label: 'decorators', value: formatDecorators((node as IRModelField).decorators) },
        ],
        effects: [],
      };
    case 'resource':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'resource', value: (node as IRResource).name },
          { label: 'model', value: (node as IRResource).model },
          { label: 'api', value: (node as IRResource).api },
          {
            label: 'views',
            value: joinNames(Object.entries((node as IRResource).views)
              .filter(([, view]) => Boolean(view))
              .map(([viewName]) => viewName)),
          },
        ],
        effects: [],
      };
    case 'view.list':
      return inspectListView(node as IRListView);
    case 'view.edit':
      return inspectFormView(node as IREditView);
    case 'view.create':
      return inspectFormView(node as IRCreateView);
    case 'view.read':
      return inspectReadView(node as IRReadView);
    case 'filter':
      return {
        id: node.id,
        kind: node.kind,
        properties: [{ label: 'field', value: (node as IRFilter).field }],
        effects: [],
      };
    case 'column':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'field', value: (node as IRColumn).field },
          { label: 'decorators', value: formatDecorators((node as IRColumn).decorators) },
          { label: 'displayFn', value: formatEscapeFnValue((node as IRColumn).displayFn) },
          { label: 'customRenderer', value: (node as IRColumn).customRenderer ?? '-' },
          { label: 'dynamicLabel', value: formatDynamicValue((node as IRColumn).dynamicLabel) },
        ],
        effects: [],
      };
    case 'formField':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'field', value: (node as IRFormField).field },
          { label: 'decorators', value: formatDecorators((node as IRFormField).decorators) },
          { label: 'visibleWhen', value: formatRuleValue((node as IRFormField).visibleWhen) },
          { label: 'enabledWhen', value: formatRuleValue((node as IRFormField).enabledWhen) },
          { label: 'validateFn', value: formatEscapeFnValue((node as IRFormField).validateFn) },
          { label: 'customField', value: (node as IRFormField).customField ?? '-' },
        ],
        effects: [],
      };
    case 'action':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'action', value: (node as IRAction).name },
          { label: 'confirm', value: (node as IRAction).confirm ?? '-' },
        ],
        effects: [],
      };
    case 'relatedPanel':
      return {
        id: node.id,
        kind: node.kind,
        properties: [{ label: 'field', value: (node as IRRelatedPanel).field }],
        effects: [],
      };
    case 'navGroup':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'group', value: formatMessageLikeValue((node as IRNavGroup).group) },
          { label: 'visibleIf', value: formatRuleValue((node as IRNavGroup).visibleIf) },
          { label: 'items', value: joinNames((node as IRNavGroup).items.map((item) => formatMessageLikeValue(item.label))) },
        ],
        effects: [],
      };
    case 'navItem':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'label', value: formatMessageLikeValue((node as IRNavItem).label) },
          { label: 'icon', value: (node as IRNavItem).icon ?? '-' },
          { label: 'target', value: (node as IRNavItem).target },
        ],
        effects: [],
      };
    case 'page':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'title', value: formatMessageLikeValue((node as IRPage).title) },
          { label: 'pageType', value: (node as IRPage).pageType },
          { label: 'layout', value: (node as IRPage).layout ?? '-' },
          { label: 'actions', value: String((node as IRPage).actions.length) },
          { label: 'blocks', value: String((node as IRPage).blocks.length) },
        ],
        effects: [],
      };
    case 'pageAction':
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'action', value: (node as IRPageAction).action },
          { label: 'resource', value: (node as IRPageAction).resource },
          { label: 'label', value: formatMessageLikeValue((node as IRPageAction).label) },
        ],
        effects: [],
      };
    case 'dashboardBlock':
      {
        const block = node as IRDashboardBlock;
      return {
        id: node.id,
        kind: node.kind,
        properties: [
          { label: 'blockType', value: block.blockType },
          { label: 'title', value: formatMessageLikeValue(block.title) },
          { label: 'data', value: block.data ?? '-' },
          { label: 'queryState', value: block.queryState ?? '-' },
          { label: 'selectionState', value: block.selectionState ?? '-' },
          { label: 'customBlock', value: block.customBlock ?? '-' },
        ],
        effects: [],
      };
      }
    default:
      return {
        id: node.id,
        kind: node.kind,
        properties: [],
        effects: [],
      };
  }
}

function inspectListView(node: IRListView): SemanticNodeInspection {
  return {
    id: node.id,
    kind: node.kind,
    properties: [
      { label: 'title', value: formatMessageLikeValue(node.title) },
      { label: 'filters', value: joinNames(node.filters.map((filter) => filter.field)) },
      { label: 'columns', value: joinNames(node.columns.map((column) => column.field)) },
      { label: 'actions', value: joinNames(node.actions.map((action) => action.name)) },
      { label: 'pagination', value: node.pagination ? `${node.pagination.size}/${node.pagination.style}` : '-' },
      ...formatRuleProperties(node.rules),
    ],
    effects: [],
  };
}

function inspectFormView(node: IREditView | IRCreateView): SemanticNodeInspection {
  return {
    id: node.id,
    kind: node.kind,
    properties: [
      { label: 'fields', value: joinNames(node.fields.map((field) => field.field)) },
      ...('includes' in node && node.includes.length > 0
        ? [{ label: 'includes', value: joinNames(node.includes.map((include) => `${include.field}[${joinNames(include.fields.map((field) => field.field))}]`)) }]
        : []),
      ...formatRuleProperties(node.rules),
    ],
    effects: node.onSuccess.map((effect) => inspectEffect(effect)),
  };
}

function inspectReadView(node: IRReadView): SemanticNodeInspection {
  return {
    id: node.id,
    kind: node.kind,
    properties: [
      { label: 'title', value: typeof node.title === 'string' ? node.title || '-' : formatMessageLikeValue(node.title) },
      { label: 'fields', value: joinNames(node.fields.map((field) => field.field)) },
      { label: 'related', value: joinNames(node.related.map((panel) => panel.field)) },
    ],
    effects: [],
  };
}

function inspectEffect(effect: EffectNode): SemanticEffectInspection {
  switch (effect.type) {
    case 'refresh':
    case 'invalidate':
    case 'redirect':
      return { type: effect.type, target: effect.target };
    case 'toast':
      return { type: effect.type, variant: effect.variant, message: effect.message };
    case 'openDialog':
      return { type: effect.type, dialog: effect.dialog };
    case 'emitEvent':
      return { type: effect.type, event: effect.event };
  }
}

function formatToastInspectionLines(message: ToastMessageNode | undefined): string[] {
  if (!message) {
    return ['onSuccess.toast: -'];
  }

  if (typeof message === 'string') {
    return [`onSuccess.toast: ${JSON.stringify(message)}`];
  }

  const lines = [`onSuccess.toast.key: ${message.key}`];
  if (message.defaultMessage) {
    lines.push(`onSuccess.toast.defaultMessage: ${JSON.stringify(message.defaultMessage)}`);
  }

  const valueEntries = Object.entries(message.values ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [name, value] of valueEntries) {
    lines.push(`onSuccess.toast.values.${name}: ${formatMessageValue(value)}`);
  }

  return lines;
}

function formatMessageLikeValue(message: MessageLikeNode): string {
  if (typeof message === 'string') {
    return message;
  }
  return message.defaultMessage ?? message.key ?? '-';
}

function formatMessageValue(value: MessageValueNode): string {
  if (typeof value === 'object' && value !== null && 'ref' in value) {
    return `ref ${value.ref}`;
  }
  return JSON.stringify(value);
}

function formatRuleProperties(rules: IRRules | undefined): Array<{ label: string; value: string }> {
  if (!rules) {
    return [];
  }

  return [
    { label: 'visibleIf', value: formatRuleValue(rules.visibleIf) },
    { label: 'enabledIf', value: formatRuleValue(rules.enabledIf) },
    { label: 'allowIf', value: formatRuleValue(rules.allowIf) },
    { label: 'enforce', value: formatRuleValue(rules.enforce) },
  ];
}

function formatRuleValue(value: RuleValue | undefined): string {
  if (!value) {
    return '-';
  }

  if (value.source === 'builtin') {
    return formatExpr(value.expr);
  }

  return value.source === 'escape-expr'
    ? `@expr(${value.escape.raw})`
    : `@fn(${formatEscapeFnToken(value.escape)})`;
}

function formatDynamicValue(value: DynamicValue | undefined): string {
  if (!value) {
    return '-';
  }

  if (value.source === 'static') {
    return JSON.stringify(value.value);
  }

  return value.source === 'escape-expr'
    ? `@expr(${value.escape.raw})`
    : `@fn(${formatEscapeFnToken(value.escape)})`;
}

function formatEscapeFnValue(value: EscapeFn | undefined): string {
  if (!value) {
    return '-';
  }

  return value.lockIn === 'neutral' && value.logicalPath
    ? `${value.logicalPath} -> ${value.path} (${value.lockIn})`
    : `${value.path} (${value.lockIn})`;
}

function formatEscapeFnToken(value: EscapeFn): string {
  return value.lockIn === 'neutral' && value.logicalPath
    ? `${value.logicalPath} -> ${value.path} [${value.lockIn}]`
    : `${value.path} [${value.lockIn}]`;
}

function formatExpr(expr: ExprNode): string {
  switch (expr.type) {
    case 'literal':
      return JSON.stringify(expr.value);
    case 'identifier':
      return expr.path.join('.');
    case 'binary':
      return `${formatExpr(expr.left)} ${expr.op} ${formatExpr(expr.right)}`;
    case 'unary':
      return `${expr.op} ${formatExpr(expr.operand)}`;
    case 'call':
      return `${expr.fn}(${expr.args.map((arg) => formatExpr(arg)).join(', ')})`;
    case 'member':
      return `${formatExpr(expr.object)}.${expr.property}`;
    case 'in':
      return `${formatExpr(expr.value)} in [${expr.list.map((entry) => formatExpr(entry)).join(', ')}]`;
  }
}

function formatModelFieldType(field: IRModelField): string {
  switch (field.fieldType.type) {
    case 'scalar':
      return field.fieldType.name;
    case 'enum':
      return `enum(${field.fieldType.values.join(', ')})`;
    case 'relation':
      return field.fieldType.kind === 'hasMany'
        ? `hasMany(${field.fieldType.target}, by: ${field.fieldType.by})`
        : `belongsTo(${field.fieldType.target})`;
  }
}

function formatDecorators(decorators: IRFieldDecorator[]): string {
  if (decorators.length === 0) {
    return '-';
  }

  return decorators
    .map((decorator) => (decorator.args ? `${decorator.name}(${JSON.stringify(decorator.args)})` : decorator.name))
    .join(', ');
}

function joinNames(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

function findSemanticNode(ir: IRApp, nodeId: string): IRNode | undefined {
  let found: IRNode | undefined;

  visitNode(ir, (node) => {
    if (found || node.id !== nodeId) {
      return;
    }
    found = node;
  });

  return found;
}

function visitNode(node: IRNode, visit: (node: IRNode) => void): void {
  visit(node);

  switch (node.kind) {
    case 'app': {
      const app = node as IRApp;
      for (const navGroup of app.navigation) visitNode(navGroup, visit);
      for (const model of app.models) visitNode(model, visit);
      for (const resource of app.resources) visitNode(resource, visit);
      for (const page of app.pages) visitNode(page, visit);
      return;
    }
    case 'model': {
      const model = node as IRModel;
      for (const field of model.fields) visitNode(field, visit);
      return;
    }
    case 'resource': {
      const resource = node as IRResource;
      if (resource.views.list) visitNode(resource.views.list, visit);
      if (resource.views.edit) visitNode(resource.views.edit, visit);
      if (resource.views.create) visitNode(resource.views.create, visit);
      if (resource.views.read) visitNode(resource.views.read, visit);
      return;
    }
    case 'view.list': {
      const view = node as IRListView;
      for (const filter of view.filters) visitNode(filter, visit);
      for (const column of view.columns) visitNode(column, visit);
      for (const action of view.actions) visitNode(action, visit);
      return;
    }
    case 'view.edit':
    case 'view.create': {
      const view = node as IREditView | IRCreateView;
      for (const field of view.fields) visitNode(field, visit);
      return;
    }
    case 'view.read': {
      const view = node as IRReadView;
      for (const field of view.fields) visitNode(field, visit);
      for (const panel of view.related) visitNode(panel, visit);
      return;
    }
    case 'navGroup': {
      const group = node as IRNavGroup;
      for (const item of group.items) visitNode(item, visit);
      return;
    }
    case 'page': {
      const page = node as IRPage;
      for (const action of page.actions) visitNode(action, visit);
      for (const block of page.blocks) visitNode(block, visit);
      return;
    }
    default:
      return;
  }
}
