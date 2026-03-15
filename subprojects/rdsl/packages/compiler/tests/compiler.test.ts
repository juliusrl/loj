/**
 * Compiler Integration Tests
 *
 * Tests the full pipeline: .rdsl source → parsed AST → IR → generated React code
 */

import { describe, it, expect } from 'vitest';
import {
  compile,
  compileProject,
  createProjectCache,
  inspectSemanticNode,
  resolveTraceLocation,
  listTraceRegionsForNode,
  restoreProjectCache,
  semanticNodeInspectionToLines,
  serializeProjectCache,
} from '../src/index.js';
import { parse, parseDecorators } from '../src/parser.js';
import { parseExpr } from '../src/expr.js';
import { normalize } from '../src/normalize.js';
import { validate } from '../src/validator.js';

function createVfs(files: Record<string, string>) {
  return (fileName: string) => {
    const normalized = fileName.replace(/\\/g, '/');
    const source = files[normalized];
    if (source === undefined) {
      throw new Error(`ENOENT: ${normalized}`);
    }
    return source;
  };
}

function createDirectoryAwareVfs(files: Record<string, string>) {
  return {
    readFile: createVfs(files),
    listFiles(directory: string) {
      const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/+$/, '');
      return Object.keys(files)
        .map((fileName) => fileName.replace(/\\/g, '/'))
        .filter((fileName) => fileName.startsWith(`${normalizedDirectory}/`))
        .sort((left, right) => left.localeCompare(right));
    },
  };
}

// ─── Decorator Parser ────────────────────────────────────────────

describe('parseDecorators', () => {
  it('parses a simple decorator', () => {
    const result = parseDecorators('name @sortable');
    expect(result.baseName).toBe('name');
    expect(result.decorators).toHaveLength(1);
    expect(result.decorators[0].name).toBe('sortable');
  });

  it('parses decorator with arguments', () => {
    const result = parseDecorators('role @tag(admin:red, editor:blue)');
    expect(result.baseName).toBe('role');
    expect(result.decorators[0].name).toBe('tag');
    expect(result.decorators[0].args).toBe('admin:red, editor:blue');
  });

  it('parses multiple decorators', () => {
    const result = parseDecorators('email @required @email @unique');
    expect(result.baseName).toBe('email');
    expect(result.decorators).toHaveLength(3);
    expect(result.decorators.map(d => d.name)).toEqual(['required', 'email', 'unique']);
  });

  it('handles no decorators', () => {
    const result = parseDecorators('name');
    expect(result.baseName).toBe('name');
    expect(result.decorators).toHaveLength(0);
  });

  it('parses escape hatch decorator', () => {
    const result = parseDecorators('avatar @custom("./components/AvatarCell.tsx")');
    expect(result.baseName).toBe('avatar');
    expect(result.decorators[0].name).toBe('custom');
    expect(result.decorators[0].args).toBe('"./components/AvatarCell.tsx"');
  });
});

// ─── Expression Parser ──────────────────────────────────────────

describe('parseExpr', () => {
  it('parses a simple comparison', () => {
    const result = parseExpr('currentUser.role == "admin"');
    expect(result.type).toBe('binary');
    if (result.type === 'binary') {
      expect(result.op).toBe('==');
      expect(result.left).toEqual({ type: 'identifier', path: ['currentUser', 'role'] });
      expect(result.right).toEqual({ type: 'literal', value: 'admin' });
    }
  });

  it('parses a builtin function call', () => {
    const result = parseExpr('hasRole(currentUser, "admin")');
    expect(result.type).toBe('call');
    if (result.type === 'call') {
      expect(result.fn).toBe('hasRole');
      expect(result.args).toHaveLength(2);
    }
  });

  it('parses logical AND', () => {
    const result = parseExpr('hasRole(currentUser, "admin") && record.status == "active"');
    expect(result.type).toBe('binary');
    if (result.type === 'binary') {
      expect(result.op).toBe('&&');
    }
  });

  it('parses boolean literals', () => {
    const result = parseExpr('true');
    expect(result).toEqual({ type: 'literal', value: true });
  });

  it('parses not operator', () => {
    const result = parseExpr('not isEmpty(record.name)');
    expect(result.type).toBe('unary');
    if (result.type === 'unary') {
      expect(result.op).toBe('not');
      expect(result.operand.type).toBe('call');
    }
  });

  it('rejects unknown characters', () => {
    expect(() => parseExpr('x = 1')).toThrow();
  });
});

// ─── Parser ──────────────────────────────────────────────────────

describe('parse', () => {
  it('parses a minimal app', () => {
    const source = `
app:
  name: "Test App"
  theme: dark

model Item:
  title: string @required
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.app?.name).toBe('Test App');
    expect(ast.app?.theme).toBe('dark');
    expect(ast.models).toHaveLength(1);
    expect(ast.models[0].name).toBe('Item');
    expect(ast.models[0].fields).toHaveLength(1);
  });

  it('parses compiler target config', () => {
    const source = `
app:
  name: "Test App"

compiler:
  target: react
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.compiler?.target).toBe('react');
  });

  it('parses root imports', () => {
    const source = `
app:
  name: "Test App"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.imports).toEqual(['./models/user.rdsl', './resources/users.rdsl']);
  });

  it('parses hasMany relation type expressions with inline by metadata', () => {
    const source = `
model Team:
  members: hasMany(User, by: team)
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.models[0].fields[0].typeExpr).toBe('hasMany(User, by: team)');
  });

  it('parses a full resource with views', () => {
    const source = `
resource users:
  model: User
  api: /api/users

  list:
    columns:
      - name @sortable
      - email
    actions:
      - delete @confirm("Sure?")
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.resources).toHaveLength(1);
    expect(ast.resources[0].name).toBe('users');
    expect(ast.resources[0].list?.columns).toHaveLength(2);
    expect(ast.resources[0].list?.actions).toHaveLength(1);
  });

  it('parses effects in edit view', () => {
    const source = `
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    onSuccess:
      - refresh: users
      - toast: "Saved!"
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.resources[0].edit?.onSuccess).toHaveLength(2);
    expect(ast.resources[0].edit?.onSuccess?.[0].type).toBe('refresh');
    expect(ast.resources[0].edit?.onSuccess?.[1].type).toBe('toast');
  });

  it('parses descriptor-shaped toast effects in edit view', () => {
    const source = `
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    onSuccess:
      - toast:
          key: users.saved
          defaultMessage: "User {name} saved"
          values:
            name:
              ref: form.name
            count: 3
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    const effect = ast.resources[0].edit?.onSuccess?.[0];
    expect(effect?.type).toBe('toast');
    expect(typeof effect?.value).toBe('object');
    if (effect && typeof effect.value === 'object') {
      expect(effect.value).toMatchObject({
        key: 'users.saved',
        defaultMessage: 'User {name} saved',
        values: {
          name: { ref: 'form.name' },
          count: 3,
        },
      });
    }
  });

  it('parses navigation', () => {
    const source = `
app:
  name: "Test"
  navigation:
    - group: "Main"
      items:
        - label: "Home"
          icon: home
          target: page.home
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.app?.navigation).toHaveLength(1);
    expect(ast.app?.navigation?.[0].items).toHaveLength(1);
    expect(ast.app?.navigation?.[0].items[0].label).toBe('Home');
  });

  it('parses page with blocks', () => {
    const source = `
page dashboard:
  title: "Overview"
  type: dashboard
  layout: grid(2)
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`;
    const { ast, errors } = parse(source);
    expect(errors).toHaveLength(0);
    expect(ast.pages).toHaveLength(1);
    expect(ast.pages[0].name).toBe('dashboard');
    expect(ast.pages[0].blocks).toHaveLength(1);
    expect(ast.pages[0].blocks[0].type).toBe('metric');
  });

  it('rejects invalid YAML', () => {
    const { errors } = parse('{{invalid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects YAML aliases and anchors', () => {
    const { errors } = parse(`
model User: &user
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - *user
`);
    expect(errors.some(err => err.message.includes('anchors'))).toBe(true);
  });

  it('rejects unknown compiler keys', () => {
    const { errors } = parse(`
compiler:
  backend: fastapi
`);
    expect(errors.some(err => err.message.includes('Unknown compiler key'))).toBe(true);
  });

  it('attaches source spans to parsed nodes', () => {
    const source = `model User:
  email: string @required

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - email
`;
    const { ast, errors } = parse(source, 'fixtures/app.rdsl');
    expect(errors).toHaveLength(0);
    expect(ast.models[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 1,
      startCol: 1,
    });
    expect(ast.models[0].fields[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 2,
      startCol: 3,
    });
    expect(ast.resources[0].list?.sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 7,
      startCol: 3,
    });
    expect(ast.resources[0].list?.columns?.[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 9,
      startCol: 9,
    });
  });
});

// ─── Normalizer ──────────────────────────────────────────────────

describe('normalize', () => {
  it('assigns stable node IDs', () => {
    const { ast } = parse(`
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`);
    const { ir } = normalize(ast);
    expect(ir.id).toBe('app.main');
    expect(ir.models[0].id).toBe('model.User');
    expect(ir.resources[0].id).toBe('resource.users');
    expect(ir.resources[0].views.list?.id).toBe('resource.users.view.list');
  });

  it('parses enum field types', () => {
    const { ast } = parse(`
model User:
  role: enum(admin, editor, viewer)
`);
    const { ir } = normalize(ast);
    const roleField = ir.models[0].fields.find(f => f.name === 'role');
    expect(roleField?.fieldType.type).toBe('enum');
    if (roleField?.fieldType.type === 'enum') {
      expect(roleField.fieldType.values).toEqual(['admin', 'editor', 'viewer']);
    }
  });

  it('parses expressions in rules', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      allowIf: hasRole(currentUser, "admin")
    onSuccess:
      - toast: "Saved"
`);
    const { ir, errors } = normalize(ast);
    const allowIf = ir.resources[0].views.edit?.rules?.allowIf;
    expect(allowIf).toBeDefined();
    expect(allowIf?.source).toBe('builtin');
    if (allowIf?.source === 'builtin') {
      expect(allowIf.expr.type).toBe('call');
    }
  });

  it('normalizes descriptor-shaped toast effects', () => {
    const { ast } = parse(`
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    onSuccess:
      - toast:
          key: users.saved
          defaultMessage: "User {name} saved"
          values:
            name:
              ref: form.name
            email:
              ref: record.email
            actor:
              ref: user.name
`);
    const { ir, errors } = normalize(ast);
    expect(errors).toHaveLength(0);
    const effect = ir.resources[0].views.edit?.onSuccess[0];
    expect(effect?.type).toBe('toast');
    if (effect?.type === 'toast' && typeof effect.message !== 'string') {
      expect(effect.message).toEqual({
        key: 'users.saved',
        defaultMessage: 'User {name} saved',
        values: {
          name: { ref: 'form.name' },
          email: { ref: 'record.email' },
          actor: { ref: 'user.name' },
        },
      });
    }
  });

  it('reports invalid app theme and auth modes during normalization', () => {
    const { ast } = parse(`
app:
  name: "Bad Config"
  theme: neon
  auth: cookie
`);
    const { errors } = normalize(ast);
    expect(errors.some(err => err.message.includes('Invalid app theme'))).toBe(true);
    expect(errors.some(err => err.message.includes('Invalid auth mode'))).toBe(true);
  });

  it('defaults compiler target to react during normalization', () => {
    const { ast } = parse(`
app:
  name: "Default Target"
`);
    const { ir, errors } = normalize(ast);
    expect(errors).toHaveLength(0);
    expect(ir.compiler.target).toBe('react');
    expect(ir.compiler.language).toBe('typescript');
  });

  it('reports invalid compiler target during normalization', () => {
    const { ast } = parse(`
app:
  name: "Bad Target"

compiler:
  target: fastapi
`);
    const { errors } = normalize(ast);
    expect(errors.some(err => err.message.includes('Invalid compiler target'))).toBe(true);
  });

  it('handles escape hatch tier 1 (custom renderer)', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - avatar @custom("./components/AvatarCell.tsx")
`);
    const { ir } = normalize(ast);
    const col = ir.resources[0].views.list?.columns[0];
    expect(col?.customRenderer).toBe('./components/AvatarCell.tsx');
  });

  it('handles escape hatch tier 2 (custom field)', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - avatar @custom("./components/AvatarUploader.tsx")
    onSuccess:
      - toast: "Done"
`);
    const { ir } = normalize(ast);
    const field = ir.resources[0].views.edit?.fields[0];
    expect(field?.customField).toBe('./components/AvatarUploader.tsx');
  });

  it('handles escape hatch tier 3 (custom block)', () => {
    const { ast } = parse(`
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: custom
      title: "Revenue"
      custom: "./components/RevenueChart.tsx"
`);
    const { ir } = normalize(ast);
    const block = ir.pages[0].blocks[0];
    expect(block.customBlock).toBe('./components/RevenueChart.tsx');
    expect(block.blockType).toBe('custom');
  });

  // ── Three-Tier Logic Escape Hatch Tests ──

  it('handles @expr() in rules (tier 1 logic escape)', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      visibleIf: '@expr(user.role === "admin" && record.status !== "archived")'
    onSuccess:
      - toast: "Done"
`);
    const { ir } = normalize(ast);
    const rule = ir.resources[0].views.edit?.rules?.visibleIf;
    expect(rule).toBeDefined();
    expect(rule?.source).toBe('escape-expr');
    if (rule?.source === 'escape-expr') {
      expect(rule.escape.tier).toBe('expr');
      expect(rule.escape.raw).toContain('user.role');
    }
  });

  it('handles @fn() in rules (tier 2 logic escape)', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      allowIf: '@fn("./logic/canEditUser.ts")'
    onSuccess:
      - toast: "Done"
`);
    const { ir } = normalize(ast);
    const rule = ir.resources[0].views.edit?.rules?.allowIf;
    expect(rule).toBeDefined();
    expect(rule?.source).toBe('escape-fn');
    if (rule?.source === 'escape-fn') {
      expect(rule.escape.tier).toBe('fn');
      expect(rule.escape.path).toBe('./logic/canEditUser.ts');
      expect(rule.escape.lockIn).toBe('explicit');
      expect(rule.escape.logicalPath).toBeUndefined();
    }
  });

  it('resolves extensionless @fn() logical ids to target-aware files', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      allowIf: '@fn("./logic/canEditUser")'
    onSuccess:
      - toast: "Done"
`, 'app.web.loj');
    const { ir, errors } = normalize(ast, {
      projectRoot: '.',
      readFile(fileName) {
        if (fileName === 'logic/canEditUser.ts') {
          return 'export default function canEditUser() { return true; }';
        }
        return undefined;
      },
    });
    expect(errors).toHaveLength(0);
    const rule = ir.resources[0].views.edit?.rules?.allowIf;
    expect(rule?.source).toBe('escape-fn');
    if (rule?.source === 'escape-fn') {
      expect(rule.escape.path).toBe('logic/canEditUser.ts');
      expect(rule.escape.logicalPath).toBe('./logic/canEditUser');
      expect(rule.escape.lockIn).toBe('neutral');
    }
  });

  it('rejects ambiguous extensionless @fn() logical ids', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      allowIf: '@fn("./logic/canEditUser")'
    onSuccess:
      - toast: "Done"
`, 'app.web.loj');
    const { errors } = normalize(ast, {
      projectRoot: '.',
      readFile(fileName) {
        if (fileName === 'logic/canEditUser.ts' || fileName === 'logic/canEditUser.js') {
          return 'export default true;';
        }
        return undefined;
      },
    });
    expect(errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('@fn("./logic/canEditUser") is ambiguous'),
      ]),
    );
  });

  it('computes escape hatch statistics', () => {
    const { ast } = parse(`
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
  edit:
    fields:
      - name
    onSuccess:
      - toast: "Saved"
`);
    const { ir } = normalize(ast);
    expect(ir.escapeStats).toBeDefined();
    expect(ir.escapeStats!.exprCount).toBe(0);
    expect(ir.escapeStats!.fnCount).toBe(0);
    expect(ir.escapeStats!.customCount).toBe(0);
    expect(ir.escapeStats!.escapePercent).toBe(0);
    expect(ir.escapeStats!.overBudget).toBe(false);
  });

  it('counts escape hatch usage correctly', () => {
    const { ast } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - avatar @custom("./components/AvatarCell.tsx")
  edit:
    fields:
      - name
      - bio @custom("./components/RichTextEditor.tsx")
    rules:
      allowIf: '@fn("./logic/canEdit.ts")'
    onSuccess:
      - toast: "Saved"

page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: custom
      title: "Revenue"
      custom: "./components/RevenueChart.tsx"
`);
    const { ir } = normalize(ast);
    expect(ir.escapeStats!.customCount).toBe(3); // 2 @custom + 1 custom block
    expect(ir.escapeStats!.fnCount).toBe(1);     // 1 @fn in rules
  });

  it('propagates source spans into IR nodes', () => {
    const { ast } = parse(`page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"

model User:
  email: string @required

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - email
`, 'fixtures/app.rdsl');
    const { ir } = normalize(ast);

    expect(ir.pages[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 1,
      startCol: 1,
    });
    expect(ir.pages[0].blocks[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 5,
      startCol: 7,
    });
    expect(ir.models[0].fields[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 9,
      startCol: 3,
    });
    expect(ir.resources[0].views.list?.sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 14,
      startCol: 3,
    });
    expect(ir.resources[0].views.list?.columns[0].sourceSpan).toMatchObject({
      file: 'fixtures/app.rdsl',
      startLine: 16,
      startCol: 9,
    });
  });

  it('reuses unchanged normalized segments when a different module changes', () => {
    const { ast: firstAst } = parse(`
app:
  name: "Incremental"

model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name

page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
app:
  name: "Incremental"

model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name

page dashboard:
  title: "Updated Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.models[0]).toBe(first.ir.models[0]);
    expect(second.ir.resources[0]).toBe(first.ir.resources[0]);
    expect(second.ir.pages[0]).not.toBe(first.ir.pages[0]);
  });

  it('reuses unchanged sibling resource views when only one view changes', () => {
    const { ast: firstAst } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
  edit:
    fields:
      - name
    onSuccess:
      - toast: "Saved"
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
  edit:
    fields:
      - name
    onSuccess:
      - toast: "Saved"
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.resources[0]).not.toBe(first.ir.resources[0]);
    expect(second.ir.resources[0].views.list).not.toBe(first.ir.resources[0].views.list);
    expect(second.ir.resources[0].views.edit).toBe(first.ir.resources[0].views.edit);
  });

  it('reuses unchanged model fields when only one sibling field changes', () => {
    const { ast: firstAst } = parse(`
model User:
  name: string
  email: string
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
model User:
  name: string @required
  email: string
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.models[0]).not.toBe(first.ir.models[0]);
    expect(second.ir.models[0].fields[0]).not.toBe(first.ir.models[0].fields[0]);
    expect(second.ir.models[0].fields[1]).toBe(first.ir.models[0].fields[1]);
  });

  it('reuses unchanged nav items when only nav-group metadata changes', () => {
    const { ast: firstAst } = parse(`
app:
  name: "Incremental"
  navigation:
    - group: "Main"
      visibleIf: hasRole(currentUser, "admin")
      items:
        - label: "Users"
          target: resource.users.list
        - label: "Dashboard"
          target: page.dashboard
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
app:
  name: "Incremental"
  navigation:
    - group: "Admin"
      visibleIf: hasRole(currentUser, "admin")
      items:
        - label: "Users"
          target: resource.users.list
        - label: "Dashboard"
          target: page.dashboard
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.navigation[0]).not.toBe(first.ir.navigation[0]);
    expect(second.ir.navigation[0].items[0]).toBe(first.ir.navigation[0].items[0]);
    expect(second.ir.navigation[0].items[1]).toBe(first.ir.navigation[0].items[1]);
  });

  it('reuses unchanged list columns when only list metadata changes', () => {
    const { ast: firstAst } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    title: "Users"
    columns:
      - name
      - email
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
resource users:
  model: User
  api: /api/users
  list:
    title: "Accounts"
    columns:
      - name
      - email
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.resources[0].views.list).not.toBe(first.ir.resources[0].views.list);
    expect(second.ir.resources[0].views.list?.columns[0]).toBe(first.ir.resources[0].views.list?.columns[0]);
    expect(second.ir.resources[0].views.list?.columns[1]).toBe(first.ir.resources[0].views.list?.columns[1]);
  });

  it('reuses unchanged page blocks when only one block changes', () => {
    const { ast: firstAst } = parse(`
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
    - type: chart
      title: "Revenue"
      data: query.revenue
`, 'app.rdsl');
    const first = normalize(firstAst);

    const { ast: secondAst } = parse(`
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Active Users"
    - type: chart
      title: "Revenue"
      data: query.revenue
`, 'app.rdsl');
    const second = normalize(secondAst, { cache: first.cacheSnapshot });

    expect(second.ir.pages[0]).not.toBe(first.ir.pages[0]);
    expect(second.ir.pages[0].blocks[0]).not.toBe(first.ir.pages[0].blocks[0]);
    expect(second.ir.pages[0].blocks[1]).toBe(first.ir.pages[0].blocks[1]);
  });
});

describe('validate', () => {
  it('reuses unchanged validation segments from cache', () => {
    const { ast } = parse(`
app:
  name: "Incremental"

model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - missingField

page dashboard:
  title: ""
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`);
    const { ir } = normalize(ast);
    const first = validate(ir, {});
    const second = validate(ir, { cache: first.cacheSnapshot });

    expect(second.errors[0]).toBe(first.errors[0]);
    expect(second.errors[1]).toBe(first.errors[1]);
  });

  it('reuses navigation validation entries when only nav labels change', () => {
    const { ast: firstAst } = parse(`
app:
  name: "Incremental"
  navigation:
    - group: "Main"
      items:
        - label: "Users"
          target: resource.users.list
    - group: "Pages"
      items:
        - label: "Dashboard"
          target: page.dashboard

model User:
  name: string

resource users:
  model: User
  api: /api/users

page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`);
    const firstNormalized = normalize(firstAst);
    const first = validate(firstNormalized.ir, {});

    const { ast: secondAst } = parse(`
app:
  name: "Incremental"
  navigation:
    - group: "Main"
      items:
        - label: "User Directory"
          target: resource.users.list
    - group: "Pages"
      items:
        - label: "Dashboard"
          target: page.dashboard

model User:
  name: string

resource users:
  model: User
  api: /api/users

page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`);
    const secondNormalized = normalize(secondAst, { cache: firstNormalized.cacheSnapshot });
    const second = validate(secondNormalized.ir, { cache: first.cacheSnapshot });

    expect(second.cacheSnapshot.global?.navigation['app.nav.0']).toBe(first.cacheSnapshot.global?.navigation['app.nav.0']);
    expect(second.cacheSnapshot.global?.navigation['app.nav.1']).toBe(first.cacheSnapshot.global?.navigation['app.nav.1']);
  });

  it('reuses list validation entries when only column decorators change', () => {
    const { ast: firstAst } = parse(`
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name @sortable
      - email
`);
    const firstNormalized = normalize(firstAst);
    const first = validate(firstNormalized.ir, {});

    const { ast: secondAst } = parse(`
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name @date
      - email
`);
    const secondNormalized = normalize(secondAst, { cache: firstNormalized.cacheSnapshot });
    const second = validate(secondNormalized.ir, { cache: first.cacheSnapshot });

    expect(second.cacheSnapshot.resources['users'].list).toBe(first.cacheSnapshot.resources['users'].list);
    expect(second.errors).toEqual(first.errors);
  });

  it('rejects unsupported toast message refs in create views', () => {
    const { ast } = parse(`
model User:
  name: string

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - name
    onSuccess:
      - toast:
          key: users.saved
          values:
            actor:
              ref: record.name
            routeId:
              ref: params.id
`);
    const { ir } = normalize(ast);
    const result = validate(ir, {});
    expect(result.errors.some((error) => error.message.includes('record.name') && error.severity === 'error')).toBe(true);
    expect(result.errors.some((error) => error.message.includes('params.id') && error.severity === 'error')).toBe(true);
  });

  it('explains create-view toast ref misuse with view-aware guidance', () => {
    const { ast } = parse(`
model User:
  email: string

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - email
    onSuccess:
      - toast:
          key: users.saved
          values:
            recordEmail:
              ref: record.email
            routeId:
              ref: params.id
`);
    const { ir } = normalize(ast);
    const result = validate(ir, {});
    expect(result.errors.some((error) => error.message.includes('create views do not expose record.* values') && error.message.includes('form.email'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes('create views do not expose route params'))).toBe(true);
  });
});

// ─── Full Compilation ────────────────────────────────────────────

describe('compile', () => {
  const fullSource = `
app:
  name: "User Management"
  theme: dark
  auth: jwt
  navigation:
    - group: "System"
      visibleIf: hasRole(currentUser, "admin")
      items:
        - label: "Users"
          icon: users
          target: resource.users.list

page dashboard:
  title: "Overview"
  type: dashboard
  layout: grid(2)
  blocks:
    - type: metric
      title: "Total Users"
      data: query.users.count

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)
  createdAt: datetime @auto

resource users:
  model: User
  api: /api/users

  list:
    title: "User Management"
    filters: [email, role, status]
    columns:
      - name @sortable
      - email @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
      - status @badge(active:green, suspended:red)
      - createdAt @date
    actions:
      - create
      - edit
      - delete @confirm("Delete this user?")
    pagination: { size: 20, style: numbered }

  edit:
    fields:
      - name
      - email @disabled(mode == "edit")
      - role @select
    rules:
      enabledIf: hasRole(currentUser, "admin")
      allowIf: hasRole(currentUser, "admin")
    onSuccess:
      - refresh: users
      - toast: "User saved"

  create:
    fields: [name, email, role]
    onSuccess:
      - redirect: users.list
      - toast: "User created"
`;

  it('compiles successfully', () => {
    const result = compile(fullSource);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('generates expected files', () => {
    const result = compile(fullSource);
    const filePaths = result.files.map(f => f.path);

    expect(filePaths).toContain('models/User.ts');
    expect(filePaths).toContain('views/UsersList.tsx');
    expect(filePaths).toContain('views/UsersEdit.tsx');
    expect(filePaths).toContain('views/UsersCreate.tsx');
    expect(filePaths).toContain('pages/DashboardPage.tsx');
    expect(filePaths).toContain('layout/AdminLayout.tsx');
    expect(filePaths).toContain('router.tsx');
    expect(filePaths).toContain('App.tsx');
  });

  it('generates model types with validation schema', () => {
    const result = compile(fullSource);
    const modelFile = result.files.find(f => f.path === 'models/User.ts');
    expect(modelFile).toBeDefined();
    expect(modelFile!.content).toContain('export interface User');
    expect(modelFile!.content).toContain('name: string');
    expect(modelFile!.content).toContain('email: string');
    expect(modelFile!.content).toContain("'admin' | 'editor' | 'viewer'");
    expect(modelFile!.content).toContain('UserSchema');
    expect(modelFile!.content).toContain('required: true');
  });

  it('generates descriptor-shaped toast code with runtime refs', () => {
    const descriptorSource = `
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
      - email
    onSuccess:
      - toast:
          key: users.saved
          defaultMessage: "User {name} saved by {actor}"
          values:
            name:
              ref: form.name
            actor:
              ref: user.name
            id:
              ref: params.id
`;
    const result = compile(descriptorSource);
    expect(result.success).toBe(true);
    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    expect(editFile).toBeDefined();
    expect(editFile?.content).toContain(`toast.success({ key: "users.saved", defaultMessage: "User {name} saved by {actor}"`);
    expect(editFile?.content).toContain(`"name": (formData?.name as string | number | boolean | null | undefined)`);
    expect(editFile?.content).toContain(`"actor": (currentUser?.name as string | number | boolean | null | undefined)`);
    expect(editFile?.content).toContain(`"id": (id as string | number | boolean | null | undefined)`);
    expect(editFile?.content).toContain(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
  });

  it('inspects descriptor-shaped toast details on create views', () => {
    const result = compile(`
app:
  name: "Template Studio"

compiler:
  target: react

model Template:
  name: string
  status: enum(draft, active)

resource templates:
  model: Template
  api: /api/templates
  create:
    fields: [name, status]
    onSuccess:
      - refresh: templates
      - toast:
          key: templates.created
          defaultMessage: "Template {name} created"
          values:
            name:
              ref: form.name
`, 'toast-inspect.rdsl');

    expect(result.success).toBe(true);
    const inspection = inspectSemanticNode(result.ir!, 'resource.templates.view.create');
    const lines = semanticNodeInspectionToLines(inspection!);

    expect(inspection?.kind).toBe('view.create');
    expect(lines).toContain('onSuccess.refresh: templates');
    expect(lines).toContain('onSuccess.toast.key: templates.created');
    expect(lines).toContain('onSuccess.toast.defaultMessage: "Template {name} created"');
    expect(lines).toContain('onSuccess.toast.values.name: ref form.name');
  });

  it('generates list view with correct imports', () => {
    const result = compile(fullSource);
    const listFile = result.files.find(f => f.path === 'views/UsersList.tsx');
    expect(listFile).toBeDefined();
    const content = listFile!.content;

    // Direct subpath imports (invariant #1)
    expect(content).toContain("from '@loj-lang/rdsl-runtime/components/DataTable'");
    expect(content).toContain("from '@loj-lang/rdsl-runtime/components/FilterBar'");
    expect(content).not.toContain("from '@loj-lang/rdsl-runtime'");

    // startTransition for filters (invariant #5)
    expect(content).toContain('startTransition');
    expect(content).toContain('const handleSortChange = useCallback((nextSort: Parameters<typeof tableView.setSort>[0]) => {');
    expect(content).toContain('onSortChange={handleSortChange}');
    expect(content).toContain('const handlePaginationChange = useCallback((nextPage: Parameters<typeof tableView.setPagination>[0]) => {');
    expect(content).toContain('onChange={handlePaginationChange}');

    // Memoized component (invariant #10)
    expect(content).toContain('React.memo');

    // Source tracing comments
    expect(content).toContain('@source-node');
  });

  it('generates IR manifest for agent handoff', () => {
    const result = compile(fullSource);
    expect(result.semanticManifest).toBeDefined();
    expect(result.traceManifest).toBeDefined();
    expect(result.manifest).toBeDefined();
    const manifest = JSON.parse(result.manifest!);
    expect(manifest.artifact).toBe('rdsl.semantic-manifest');
    expect(manifest.schemaVersion).toBe('0.1.0');
    expect(manifest.ir.models).toHaveLength(1);
    expect(manifest.ir.resources).toHaveLength(1);
    expect(result.semanticManifest?.artifact).toBe('rdsl.semantic-manifest');
    expect(result.traceManifest?.artifact).toBe('rdsl.trace-manifest');
    expect(result.traceManifest?.generatedFiles).toHaveLength(result.files.length);
    expect(result.traceManifest?.regions.some(region => region.role === 'file.root')).toBe(true);
    expect(result.traceManifest?.regions.some(region => region.role === 'column.definition')).toBe(true);
    expect(result.traceManifest?.nodes.some(node => node.id === 'model.User' && node.sourceSpan?.file === 'app.web.loj')).toBe(true);
  });

  it('resolves fine-grained trace regions in generated files', () => {
    const result = compile(fullSource);
    expect(result.traceManifest).toBeDefined();

    const columnRegion = listTraceRegionsForNode(result.traceManifest!, 'resource.users.view.list.column.role')
      .find((region) => region.generatedFile === 'views/UsersList.tsx' && region.role === 'column.definition');
    expect(columnRegion).toBeDefined();

    const columnMatch = resolveTraceLocation(
      result.traceManifest!,
      'views/UsersList.tsx',
      columnRegion!.range.startLine,
      columnRegion!.range.startCol + 1,
    );
    expect(columnMatch?.kind).toBe('match');
    expect(columnMatch?.matches[0].region.nodeId).toBe('resource.users.view.list.column.role');
    expect(columnMatch?.matches[0].region.role).toBe('column.definition');

    const fieldRegion = listTraceRegionsForNode(result.traceManifest!, 'resource.users.view.edit.field.name')
      .find((region) => region.generatedFile === 'views/UsersEdit.tsx' && region.role === 'field.definition');
    expect(fieldRegion).toBeDefined();

    const fieldMatch = resolveTraceLocation(
      result.traceManifest!,
      'views/UsersEdit.tsx',
      fieldRegion!.range.startLine,
      fieldRegion!.range.startCol + 1,
    );
    expect(fieldMatch?.kind).toBe('match');
    expect(fieldMatch?.matches[0].region.nodeId).toBe('resource.users.view.edit.field.name');

    const listRouteRegion = listTraceRegionsForNode(result.traceManifest!, 'resource.users.view.list')
      .find((region) => region.generatedFile === 'router.tsx' && region.role === 'router.route');
    expect(listRouteRegion).toBeDefined();

    const routeMatch = resolveTraceLocation(
      result.traceManifest!,
      'router.tsx',
      listRouteRegion!.range.startLine,
      5,
    );
    expect(routeMatch?.kind).toBe('match');
    expect(routeMatch?.matches[0].region.nodeId).toBe('resource.users.view.list');
    expect(routeMatch?.matches[0].region.role).toBe('router.route');
  });

  it('lists multiple generated regions for a semantic node', () => {
    const result = compile(fullSource);
    const regions = listTraceRegionsForNode(result.traceManifest!, 'model.User.field.email');

    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(regions.every(region => region.generatedFile === 'models/User.ts')).toBe(true);
  });

  it('achieves significant token compression', () => {
    const result = compile(fullSource);
    const sourceTokens = fullSource.split(/\s+/).length;
    const generatedTokens = result.files
      .map(f => f.content.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);

    // Target: 10-30x compression ratio
    const ratio = generatedTokens / sourceTokens;
    expect(ratio).toBeGreaterThan(3); // Conservative minimum
    console.log(`Compression ratio: ${ratio.toFixed(1)}x (${sourceTokens} source → ${generatedTokens} generated tokens)`);
  });

  it('rejects invalid YAML', () => {
    const result = compile('{{invalid');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].phase).toBe('parse');
  });

  it('reports validation errors for missing models', () => {
    const source = `
resource users:
  model: NonExistentModel
  api: /api/users
  list:
    columns:
      - name
`;
    const result = compile(source);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.phase === 'validate')).toBe(true);
  });

  it('fails compilation for invalid theme/auth values', () => {
    const result = compile(`
app:
  name: "Bad Config"
  theme: neon
  auth: cookie
`);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.phase === 'normalize')).toBe(true);
  });

  it('fails compilation for invalid compiler target', () => {
    const result = compile(`
app:
  name: "Bad Target"

compiler:
  target: spring-boot
`);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.phase === 'normalize' && e.message.includes('Invalid compiler target'))).toBe(true);
  });
});

describe('compileProject', () => {
  it('compiles a root file plus imported modules into one app', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "User Management"
  navigation:
    - group: "Main"
      items:
        - label: "Users"
          target: resource.users.list

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`,
        'models/user.rdsl': `
model User:
  name: string
  email: string
`,
        'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
`,
        'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.semanticManifest?.entryFile).toBe('app.rdsl');
    expect(result.semanticManifest?.sourceFiles).toEqual([
      'app.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
      'pages/dashboard.rdsl',
    ]);
    expect(result.semanticManifest?.moduleGraph).toEqual({
      'app.rdsl': ['models/user.rdsl', 'resources/users.rdsl', 'pages/dashboard.rdsl'],
      'models/user.rdsl': [],
      'resources/users.rdsl': [],
      'pages/dashboard.rdsl': [],
    });
    expect(result.traceManifest?.sourceFiles.map((file) => file.path)).toEqual([
      'app.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
      'pages/dashboard.rdsl',
    ]);
    expect(result.traceManifest?.nodes.some((node) => (
      node.id === 'model.User' && node.sourceSpan?.file === 'models/user.rdsl'
    ))).toBe(true);
  });

  it('compiles nested imports transitively and records the full module graph', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Nested Imports"

imports:
  - ./modules/admin.rdsl
`,
        'modules/admin.rdsl': `
imports:
  - ../models/user.rdsl
  - ../resources/users.rdsl
`,
        'models/user.rdsl': `
model User:
  name: string
`,
        'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.semanticManifest?.sourceFiles).toEqual([
      'app.rdsl',
      'modules/admin.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
    ]);
    expect(result.semanticManifest?.moduleGraph).toEqual({
      'app.rdsl': ['modules/admin.rdsl'],
      'modules/admin.rdsl': ['models/user.rdsl', 'resources/users.rdsl'],
      'models/user.rdsl': [],
      'resources/users.rdsl': [],
    });
    expect(result.traceManifest?.sourceFiles.map((file) => file.path)).toEqual([
      'app.rdsl',
      'modules/admin.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
    ]);
  });

  it('expands directory imports deterministically', () => {
    const vfs = createDirectoryAwareVfs({
      'app.rdsl': `
app:
  name: "Directory Imports"

imports:
  - ./models/
  - ./resources/
`,
      'models/user.rdsl': `
model User:
  email: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - email
`,
    });
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.semanticManifest?.sourceFiles).toEqual([
      'app.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
    ]);
    expect(result.semanticManifest?.moduleGraph).toEqual({
      'app.rdsl': ['models/user.rdsl', 'resources/users.rdsl'],
      'models/user.rdsl': [],
      'resources/users.rdsl': [],
    });
  });

  it('rejects module files that contain app/rdsl-compiler blocks', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Bad Modules"

imports:
  - ./modules/bad.rdsl
`,
        'modules/bad.rdsl': `
app:
  name: "Nested App"

compiler:
  target: react

imports:
  - ./other.rdsl

model User:
  name: string
`,
        'modules/other.rdsl': `
model AuditLog:
  action: string
`,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes('Module file must not contain app'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes('Module file must not contain compiler'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes('Module file must not contain imports'))).toBe(false);
  });

  it('reports import cycles with the full import chain', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Cycle"

imports:
  - ./modules/a.rdsl
`,
        'modules/a.rdsl': `
imports:
  - ./b.rdsl
`,
        'modules/b.rdsl': `
imports:
  - ./a.rdsl
`,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => (
      error.phase === 'validate' &&
      error.message.includes('Import cycle detected: app.rdsl -> modules/a.rdsl -> modules/b.rdsl -> modules/a.rdsl')
    ))).toBe(true);
  });

  it('reports duplicate semantic names across files', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Duplicates"

imports:
  - ./models/user.rdsl
  - ./models/admin-user.rdsl
`,
        'models/user.rdsl': `
model User:
  name: string
`,
        'models/admin-user.rdsl': `
model User:
  email: string
`,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => (
      error.phase === 'validate' &&
      error.message.includes('Duplicate model "User"') &&
      error.message.includes('models/user.rdsl') &&
      error.message.includes('models/admin-user.rdsl')
    ))).toBe(true);
  });

  it('normalizes module escape hatch paths to project-relative IR paths and generated imports', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Escapes"

imports:
  - ./resources/users.rdsl
`,
        'resources/users.rdsl': `
model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - avatar @custom("./components/AvatarCell.tsx")
  edit:
    fields:
      - name
    rules:
      allowIf: '@fn("./logic/canEditUser.ts")'
    onSuccess:
      - toast: "Saved"
`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.ir?.resources[0].views.list?.columns[0].customRenderer).toBe('resources/components/AvatarCell.tsx');
    expect(result.ir?.resources[0].views.edit?.rules?.allowIf?.source).toBe('escape-fn');
    if (result.ir?.resources[0].views.edit?.rules?.allowIf?.source === 'escape-fn') {
      expect(result.ir.resources[0].views.edit.rules.allowIf.escape.path).toBe('resources/logic/canEditUser.ts');
    }
    expect(result.semanticManifest?.hostFiles).toEqual([
      {
        path: 'resources/components/AvatarCell.tsx',
        references: [
          {
            nodeId: 'resource.users.view.list.column.avatar',
            role: 'column.customRenderer',
            sourceFile: 'resources/users.rdsl',
          },
        ],
      },
      {
        path: 'resources/logic/canEditUser.ts',
        references: [
          {
            nodeId: 'resource.users.view.edit',
            role: 'rule.allowIf',
            sourceFile: 'resources/users.rdsl',
            lockIn: 'explicit',
          },
        ],
      },
    ]);

    const listFile = result.files.find((file) => file.path === 'views/UsersList.tsx');
    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    expect(listFile?.content).toContain("import AvatarCell from '../resources/components/AvatarCell';");
    expect(editFile?.content).toContain("import canEditUser from '../resources/logic/canEditUser';");
  });

  it('supports belongsTo fields in frontend-family models and generates relation selects', () => {
    const source = `
model Team:
  name: string @required

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - name
      - team
  edit:
    fields:
      - name
      - team
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const modelFile = result.files.find((file) => file.path === 'models/User.ts');
    const createFile = result.files.find((file) => file.path === 'views/UsersCreate.tsx');
    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');

    expect(modelFile?.content).toContain('team: string | number | null;');
    expect(createFile?.content).toContain(`const UsersCreateResourceOptions = { pageSize: 1000 } as const;`);
    expect(createFile?.content).toContain("const teamsLookup = useResource<Team>('/api/teams', UsersCreateResourceOptions);");
    expect(createFile?.content).toContain('const teamsOptions = React.useMemo(() => teamsLookup.allData.map((item) => ({ value: item.id, label: String(item.name ?? item.id) }))');
    expect(createFile?.content).toContain(`import { getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(createFile?.content).toContain(`const searchParams = getLocationSearchParams();`);
    expect(createFile?.content).toContain(`const teamParam = searchParams.get('team');`);
    expect(createFile?.content).toContain(`initial.team = teamParam;`);
    expect(createFile?.content).toContain(`const returnTo = getSanitizedReturnTo(searchParams);`);
    expect(createFile?.content).toContain(`const cancelHref = returnTo || prefixAppBasePath("/users");`);
    expect(createFile?.content).toContain(`if (returnTo) {`);
    expect(createFile?.content).toContain(`window.location.href = returnTo;`);
    expect(createFile?.content).toContain(`href={cancelHref}`);
    expect(createFile?.content).toContain('type="select"');
    expect(createFile?.content).toContain('options={teamsOptions}');
    expect(editFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(editFile?.content).toContain(`const searchParams = getLocationSearchParams();`);
    expect(editFile?.content).toContain(`const returnTo = getSanitizedReturnTo(searchParams);`);
    expect(editFile?.content).toContain(`const cancelHref = returnTo || prefixAppBasePath("/users");`);
    expect(editFile?.content).toContain(`window.location.href = returnTo;`);
    expect(editFile?.content).toContain(`href={cancelHref}`);
    expect(editFile?.content).toContain(`const UsersEditResourceOptions = { pageSize: 1000 } as const;`);
    expect(editFile?.content).toContain(`useResource<Team>('/api/teams', UsersEditResourceOptions)`);
    expect(editFile?.content).toContain('options={teamsOptions}');
  });

  it('uses sanitized returnTo as the default post-create redirect only when create views omit redirect effects', () => {
    const source = `
model Team:
  name: string @required

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - name
      - team

resource usersWithRedirect:
  model: User
  api: /api/users-with-redirect
  create:
    fields:
      - name
      - team
    onSuccess:
      - redirect: users.list
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const createFile = result.files.find((file) => file.path === 'views/UsersCreate.tsx');
    const redirectedCreateFile = result.files.find((file) => file.path === 'views/UsersWithRedirectCreate.tsx');

    expect(createFile?.content).toContain(`const returnTo = getSanitizedReturnTo(searchParams);`);
    expect(createFile?.content).toContain(`if (returnTo) {`);
    expect(createFile?.content).toContain(`window.location.href = returnTo;`);
    expect(redirectedCreateFile?.content).toContain(`window.location.href = prefixAppBasePath("/users");`);
    expect(redirectedCreateFile?.content).not.toContain(`window.location.href = returnTo;`);
  });

  it('uses sanitized returnTo as the default post-edit redirect only when edit views omit redirect effects', () => {
    const source = `
model User:
  name: string @required

resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name

resource usersWithRedirect:
  model: User
  api: /api/users-with-redirect
  edit:
    fields:
      - name
    onSuccess:
      - redirect: users.list
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    const redirectedEditFile = result.files.find((file) => file.path === 'views/UsersWithRedirectEdit.tsx');

    expect(editFile?.content).toContain(`const returnTo = getSanitizedReturnTo(searchParams);`);
    expect(editFile?.content).toContain(`if (returnTo) {`);
    expect(editFile?.content).toContain(`window.location.href = returnTo;`);
    expect(redirectedEditFile?.content).toContain(`window.location.href = prefixAppBasePath("/users");`);
    expect(redirectedEditFile?.content).not.toContain(`window.location.href = returnTo;`);
  });

  it('supports hasMany inverse metadata without generating model fields', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const membersField = result.ir?.models
      .find((model) => model.name === 'Team')
      ?.fields.find((field) => field.name === 'members');
    const teamModelFile = result.files.find((file) => file.path === 'models/Team.ts');
    expect(membersField?.fieldType).toEqual({
      type: 'relation',
      kind: 'hasMany',
      target: 'User',
      by: 'team',
    });
    expect(teamModelFile?.content).toContain('name: string;');
    expect(teamModelFile?.content).not.toContain('members:');
  });

  it('rejects invalid hasMany inverse metadata', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: company) @required

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Field "members" in model "Team" is a hasMany() inverse relation and does not support field decorators',
      'Field "members" in model "Team" references missing inverse field "company" on model "User"',
    ]));
  });

  it('supports relation-derived list projections for belongsTo labels and inverse counts', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    filters:
      - members.count
    columns:
      - name
      - members.count @sortable

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - team.name
    columns:
      - name
      - team.name @sortable
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const teamsListFile = result.files.find((file) => file.path === 'views/TeamsList.tsx');
    const usersListFile = result.files.find((file) => file.path === 'views/UsersList.tsx');

    expect(teamsListFile?.content).toContain("const usersProjectionLookup = useResource<User>('/api/users');");
    expect(teamsListFile?.content).toContain('const membersCountProjectionCountMap = React.useMemo(() => {');
    expect(teamsListFile?.content).toContain(`const TeamsListTableViewOptions = { paginate: false } as const;`);
    expect(teamsListFile?.content).toContain(`const tableView = useCollectionView<Team>(tableData, TeamsListTableViewOptions);`);
    expect(teamsListFile?.content).toContain("['members.count']:");
    expect(teamsListFile?.content).toContain(`{ key: 'members.count', label: 'Members Count', sortable: true },`);
    expect(teamsListFile?.content).toContain(`{ key: 'members.count', label: 'Members Count', type: 'text' },`);
    expect(teamsListFile?.content).toContain('data={tableView.data}');

    expect(usersListFile?.content).toContain("const teamsProjectionLookup = useResource<Team>('/api/teams');");
    expect(usersListFile?.content).toContain('const teamsById = React.useMemo(() => new Map(teamsProjectionLookup.allData.map((item) => [String(item.id), item] as const))');
    expect(usersListFile?.content).toContain(`const UsersListTableViewOptions = { paginate: false } as const;`);
    expect(usersListFile?.content).toContain(`const tableView = useCollectionView<User>(tableData, UsersListTableViewOptions);`);
    expect(usersListFile?.content).toContain("['team.name']:");
    expect(usersListFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', sortable: true },`);
    expect(usersListFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', type: 'text' },`);
  });

  it('rejects unsupported relation-derived list projections', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - members.name

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - team.members @sortable
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Column "members.name" in model "Team" only supports hasMany(...).count projections in generated lists',
      'Column "team.members" in model "User" can only project scalar or enum fields from belongsTo(Team); nested relation chains are not supported',
    ]));
  });

  it('rejects plain hasMany fields in generated list/filter/form surfaces', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - members
    filters: [members]
  create:
    fields:
      - name
      - members
  edit:
    fields:
      - name
      - members

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Column "members" in model "Team" references inverse relation metadata directly; use "members.count" for a read-only projection',
      'Filter field "members" in model "Team" references inverse relation metadata directly; use "members.count" for a relation-derived filter',
      'Create field "members" in model "Team" references inverse relation metadata and cannot be used in generated forms yet',
      'Edit field "members" in model "Team" references inverse relation metadata and cannot be used in generated forms yet',
    ]));
  });

  it('supports create.includes aggregate-root nested create forms', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  seat: enum(window, aisle)
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
    includes:
      - field: passengers
        fields:
          - name
          - seat
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    expect(createFile?.content).toContain('type BookingCreateFormData = Partial<Booking> & {');
    expect(createFile?.content).toContain('passengers: Array<Partial<Passenger>>;');
    expect(createFile?.content).toContain('const handleAddPassengers = useCallback(() => {');
    expect(createFile?.content).toContain('const handlePassengersFieldChange = useCallback((index: number, field: string, value: unknown) => {');
    expect(createFile?.content).toContain(`const BookingsCreatePassengersIncludeTitleElement = <h3>{"Passengers"}</h3>;`);
    expect(createFile?.content).toContain(`{BookingsCreatePassengersIncludeTitleElement}`);
    expect(createFile?.content).toContain('schema={PassengerSchema.name}');
    expect(createFile?.content).toContain('schema={PassengerSchema.seat}');
  });

  it('supports create.includes minItems plus field-level form reactions', () => {
    const source = `
model Booking:
  reference: string @required
  agentNote: string
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  ageGroup: enum(adult, infant)
  seat: string
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
      - field: agentNote
        rules:
          visibleIf: currentUser.role == "admin"
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - ageGroup
          - field: seat
            rules:
              enabledIf: item.ageGroup != "infant"
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);
    expect(result.ir?.resources[0].views.create?.fields[1].visibleWhen?.source).toBe('builtin');
    expect(result.ir?.resources[0].views.create?.includes[0].minItems).toBe(1);
    expect(result.ir?.resources[0].views.create?.includes[0].fields[2].enabledWhen?.source).toBe('builtin');

    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    expect(createFile?.content).toContain('passengers: Array.from({ length: 1 }, () => ({})),');
    expect(createFile?.content).toContain('At least 1 passengers item required in the current slice.');
    expect(createFile?.content).toContain('disabled={!isEnabled || passengersItems.length <= 1}');
    expect(createFile?.content).toContain('{can({"source":"builtin"');
    expect(createFile?.content).toContain('{ currentUser, formData, item }');
  });

  it('rejects invalid create.includes references', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required
  tags: hasMany(Tag, by: passenger)

model Tag:
  label: string @required
  passenger: belongsTo(Passenger) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
    includes:
      - field: reference
        fields:
          - name
      - field: passengers
        fields:
          - booking
          - tags
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Create include "reference" in model "Booking" must reference a hasMany(..., by: ...) field',
      'Create include field "booking" in related model "Passenger" is the inverse belongsTo(Booking) field and is seeded automatically',
      'Create include field "tags" in related model "Passenger" references inverse relation metadata and cannot be nested again in the current slice',
    ]));
  });

  it('rejects invalid create.includes minItems and field-level form reaction contexts', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  seat: string
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - field: reference
        rules:
          visibleIf: payload.reference == "x"
    includes:
      - field: passengers
        minItems: -1
        fields:
          - field: seat
            rules:
              enabledIf: item.unknown == "x"
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'resource bookings create field rules use unsupported identifier root "payload"; use currentUser, formData, or bare enum-like literals',
      'Create include "passengers" in model "Booking" minItems must be a non-negative integer',
      'resource bookings create include field rules reference unknown item field "unknown"',
    ]));
  });

  it('supports edit.includes aggregate-root nested update forms', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  seat: enum(window, aisle)
  booking: belongsTo(Booking) @required

resource passengers:
  model: Passenger
  api: /api/passengers

resource bookings:
  model: Booking
  api: /api/bookings
  edit:
    fields:
      - reference
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - seat
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const editFile = result.files.find((file) => file.path === 'views/BookingsEdit.tsx');
    expect(editFile?.content).toContain('type BookingEditFormData = Partial<Booking> & {');
    expect(editFile?.content).toContain('passengers: Array<(Partial<Passenger> & { id?: string })>;');
    expect(editFile?.content).toContain(`const BookingsEditResourceOptions = { pageSize: 1000 } as const;`);
    expect(editFile?.content).toContain(`useResource<Passenger>('/api/passengers', BookingsEditResourceOptions)`);
    expect(editFile?.content).toContain(`.filter((item) => String(item.booking ?? '') === id)`);
    expect(editFile?.content).toContain('const handleAddPassengers = useCallback(() => {');
    expect(editFile?.content).toContain('const handlePassengersFieldChange = useCallback((index: number, field: string, value: unknown) => {');
    expect(editFile?.content).toContain('At least 1 passengers item required in the current slice.');
  });

  it('rejects invalid edit.includes references', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required
  tags: hasMany(Tag, by: passenger)

model Tag:
  label: string @required
  passenger: belongsTo(Passenger) @required

resource bookings:
  model: Booking
  api: /api/bookings
  edit:
    fields:
      - reference
    includes:
      - field: reference
        fields:
          - name
      - field: passengers
        fields:
          - booking
          - tags
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Edit include "reference" in model "Booking" must reference a hasMany(..., by: ...) field',
      'Edit include "passengers" in model "Booking" requires a generated resource for related model "Passenger"',
      'Edit include field "booking" in related model "Passenger" is the inverse belongsTo(Booking) field and is seeded automatically',
      'Edit include field "tags" in related model "Passenger" references inverse relation metadata and cannot be nested again in the current slice',
    ]));
  });

  it('links resource workflow into generated create, edit, and read views', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)
  travelers: hasMany(Traveler, by: booking)

model Traveler:
  name: string @required
  booking: belongsTo(Booking)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
      - status
    actions:
      - view
      - edit
  create:
    fields:
      - reference
  edit:
    fields:
      - reference
  read:
    fields:
      - reference
      - status
    related:
      - travelers

resource travelers:
  model: Traveler
  api: /api/travelers
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - name
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  wizard:
    steps:
      - name: enter_booking
        completesWith: DRAFT
        surface: form
      - name: confirm_booking
        completesWith: READY
        surface: read
        allow: currentUser.role == "admin"
  transitions:
    confirm:
      from: DRAFT
      to: READY
      allow: currentUser.role == "admin"
    ticket:
      from: READY
      to: TICKETED
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);
    expect(result.semanticManifest?.hostFiles).toEqual([
      {
        path: 'workflows/booking-lifecycle.flow.loj',
        references: [
          {
            nodeId: 'resource.bookings',
            role: 'resource.workflow',
            sourceFile: 'app.web.loj',
            logicalPath: './workflows/booking-lifecycle',
            lockIn: 'neutral',
          },
        ],
      },
    ]);

    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    const editFile = result.files.find((file) => file.path === 'views/BookingsEdit.tsx');
    const listFile = result.files.find((file) => file.path === 'views/BookingsList.tsx');
    const readFile = result.files.find((file) => file.path === 'views/BookingsRead.tsx');
    const workflowFile = result.files.find((file) => file.path === 'views/BookingsWorkflow.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');

    expect(createFile?.content).toContain(`const BookingsCreateWorkflowSteps = [`);
    expect(createFile?.content).toContain(`"surface":"form"`);
    expect(createFile?.content).toContain(`"surface":"read"`);
    expect(createFile?.content).toContain(`const currentWorkflowState = "DRAFT";`);
    expect(createFile?.content).toContain(`status: "DRAFT" as Booking['status'],`);
    expect(createFile?.content).toContain(`Initial state`);
    expect(createFile?.content).toContain(`const currentWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex] ?? null : null;`);
    expect(createFile?.content).toContain(`const nextWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    expect(createFile?.content).toContain(`const workflowSummarySteps = visibleWorkflowSteps.map((step, index) => ({`);
    expect(createFile?.content).toContain(`const submitLabel = nextWorkflowStep ? \`Create and continue to \${nextWorkflowStep.name}\` : 'Create';`);
    expect(createFile?.content).toContain(`import { WorkflowSummary } from '@loj-lang/rdsl-runtime/components/WorkflowSummary';`);
    expect(createFile?.content).toContain(`<WorkflowSummary`);
    expect(createFile?.content).toContain(`stateHeading="Initial state"`);
    expect(createFile?.content).toContain(`>{submitLabel}</button>`);
    expect(createFile?.content).toContain(`      if (createdRecord?.id && nextWorkflowStep) {`);
    expect(createFile?.content).toContain(`"workflowStep=" + encodeURIComponent(nextWorkflowStep.name)`);
    expect(createFile?.content).toContain(`returnTo ? "returnTo=" + encodeURIComponent(returnTo) : null`);
    expect(createFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${createdRecord.id}/edit\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${createdRecord.id}/edit\`);`);
    expect(createFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${createdRecord.id}\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${createdRecord.id}\`);`);
    expect(createFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${createdRecord.id}/workflow\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${createdRecord.id}/workflow\`);`);
    expect(editFile?.content).toContain(`const currentWorkflowState = String(record?.status ?? "DRAFT");`);
    expect(editFile?.content).toContain(`Current state`);
    expect(editFile?.content).toContain(`const currentWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex] ?? null : null;`);
    expect(editFile?.content).toContain(`const nextWorkflowStep = activeWorkflowIndex >= 0 ? visibleWorkflowSteps[activeWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    expect(editFile?.content).toContain(`const workflowSummarySteps = visibleWorkflowSteps.map((step, index) => ({`);
    expect(editFile?.content).toContain(`const submitLabel = nextWorkflowStep ? \`Save and continue to \${nextWorkflowStep.name}\` : 'Save';`);
    expect(editFile?.content).toContain(`import { WorkflowSummary } from '@loj-lang/rdsl-runtime/components/WorkflowSummary';`);
    expect(editFile?.content).toContain(`<WorkflowSummary`);
    expect(editFile?.content).toContain(`stateHeading="Current state"`);
    expect(editFile?.content).toContain(`>{submitLabel}</button>`);
    expect(editFile?.content).toContain(`className="rdsl-btn rdsl-btn-secondary">Workflow</a>`);
    expect(editFile?.content).toContain(`const visibleWorkflowSteps = workflowSteps.filter`);
    expect(editFile?.content).toContain(`      if (nextWorkflowStep) {`);
    expect(editFile?.content).toContain(`        window.location.href = (nextWorkflowStep.surface === 'form' ? (() => {`);
    expect(editFile?.content).toContain(`"workflowStep=" + encodeURIComponent(nextWorkflowStep.name)`);
    expect(editFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${id}/edit\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${id}/edit\`);`);
    expect(editFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${id}\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${id}\`);`);
    expect(editFile?.content).toContain(`return params.length > 0 ? prefixAppBasePath(\`/bookings/\${id}/workflow\`) + "?" + params.join("&") : prefixAppBasePath(\`/bookings/\${id}/workflow\`);`);
    expect(listFile?.content).toContain(`const labels: import('@loj-lang/shared-contracts').WorkflowStateLabelMap = {"DRAFT":"Draft","READY":"Ready","TICKETED":"Ticketed"};`);
    expect(listFile?.content).toContain(`const label = labels[String(value)];`);
    expect(listFile?.content).toContain(`label: 'Workflow'`);
    expect(readFile?.content).toContain(`import { useResourceClient } from '@loj-lang/rdsl-runtime/hooks/resourceClient';`);
    expect(readFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getLocationSearchValues, getSanitizedReturnTo, replaceLocationSearchValues, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(readFile?.content).toContain(`const BookingsReadWorkflowTransitions = [`);
    expect(readFile?.content).toContain(`const availableWorkflowTransitions = workflowTransitions.filter`);
    expect(readFile?.content).toContain(`const requestedWorkflowStepName = returnToSearchParams?.get('workflowStep');`);
    expect(readFile?.content).toContain(`const prioritizedWorkflowStep = requestedWorkflowStepIndex > activeWorkflowIndex ? currentWorkflowStep : nextWorkflowStep;`);
    expect(readFile?.content).toContain(`const nextStepWorkflowTransitions = prioritizedWorkflowStep ? availableWorkflowTransitions.filter((transition) => transition.to === prioritizedWorkflowStep.completesWith) : [];`);
    expect(readFile?.content).toContain(`const otherWorkflowTransitions = nextStepWorkflowTransitions.length === 0 ? availableWorkflowTransitions : availableWorkflowTransitions.filter((transition) => !nextStepWorkflowTransitions.some((candidate) => candidate.name === transition.name));`);
    expect(readFile?.content).toContain(`const primaryWorkflowActionLabel = requestedWorkflowStepIndex > activeWorkflowIndex && prioritizedWorkflowStep ? \`Complete \${prioritizedWorkflowStep.name}\` : nextWorkflowStep ? \`Advance to \${nextWorkflowStep.name}\` : null;`);
    expect(readFile?.content).toContain(`const currentWorkflowIndex = requestedWorkflowStepIndex >= activeWorkflowIndex ? requestedWorkflowStepIndex : activeWorkflowIndex;`);
    expect(readFile?.content).toContain(`const currentWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex] ?? null : null;`);
    expect(readFile?.content).toContain(`const nextWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    expect(readFile?.content).toContain(`const resolveNextWorkflowSurfaceHref = React.useCallback((stateName: string) => {`);
    expect(readFile?.content).toContain(`const postTransitionRecord = record ? { ...record, status: stateName } : ({ status: stateName } as Partial<Booking>);`);
    expect(readFile?.content).toContain(`const value: unknown = record.status;`);
    expect(readFile?.content).toContain(`const label = labels[String(value)];`);
    expect(readFile?.content).toContain('await resourceClient.post<unknown>(`/api/bookings/${encodeURIComponent(id)}/transitions/${encodeURIComponent(transitionName)}`);');
    expect(readFile?.content).toContain(`const nextStepHref = transitionedState ? resolveNextWorkflowSurfaceHref(transitionedState) : null;`);
    expect(readFile?.content).toContain(`if (nextStepHref && typeof window !== 'undefined' && nextStepHref !== getCurrentAppHref()) {`);
    expect(readFile?.content).toContain(`              {primaryWorkflowActionLabel ?? transition.name}`);
    expect(readFile?.content).toContain('className="rdsl-btn rdsl-btn-secondary">Workflow</a>');
    expect(readFile?.content).toContain(`          <strong>Current step</strong>`);
    expect(readFile?.content).toContain(`          <strong>Next step</strong>`);
    expect(workflowFile?.content).toContain(`const availableWorkflowTransitions = workflowTransitions.filter`);
    expect(workflowFile?.content).toContain(`const currentWorkflowIndex = requestedWorkflowStepIndex >= activeWorkflowIndex ? requestedWorkflowStepIndex : activeWorkflowIndex;`);
    expect(workflowFile?.content).toContain(`const currentWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex] ?? null : null;`);
    expect(workflowFile?.content).toContain(`const nextWorkflowStep = currentWorkflowIndex >= 0 ? visibleWorkflowSteps[currentWorkflowIndex + 1] ?? null : visibleWorkflowSteps[0] ?? null;`);
    expect(workflowFile?.content).toContain(`const requestedWorkflowStepName = returnToSearchParams?.get('workflowStep');`);
    expect(workflowFile?.content).toContain(`const prioritizedWorkflowStep = requestedWorkflowStepIndex > activeWorkflowIndex ? currentWorkflowStep : nextWorkflowStep;`);
    expect(workflowFile?.content).toContain(`const nextStepWorkflowTransitions = prioritizedWorkflowStep ? availableWorkflowTransitions.filter((transition) => transition.to === prioritizedWorkflowStep.completesWith) : [];`);
    expect(workflowFile?.content).toContain(`const otherWorkflowTransitions = nextStepWorkflowTransitions.length === 0 ? availableWorkflowTransitions : availableWorkflowTransitions.filter((transition) => !nextStepWorkflowTransitions.some((candidate) => candidate.name === transition.name));`);
    expect(workflowFile?.content).toContain(`const primaryWorkflowActionLabel = requestedWorkflowStepIndex > activeWorkflowIndex && prioritizedWorkflowStep ? \`Complete \${prioritizedWorkflowStep.name}\` : nextWorkflowStep ? \`Advance to \${nextWorkflowStep.name}\` : null;`);
    expect(workflowFile?.content).toContain(`const resolveNextWorkflowSurfaceHref = React.useCallback((stateName: string) => {`);
    expect(workflowFile?.content).toContain(`const postTransitionRecord = record ? { ...record, status: stateName } : ({ status: stateName } as Partial<Booking>);`);
    expect(workflowFile?.content).toContain(`const BookingsWorkflowTitleElement = <h1>{"Bookings workflow"}</h1>`);
    expect(workflowFile?.content).toContain(`{BookingsWorkflowTitleElement}`);
    expect(workflowFile?.content).toContain(`              {primaryWorkflowActionLabel ?? transition.name}`);
    expect(workflowFile?.content).toContain(`className="rdsl-btn rdsl-btn-secondary">View</a>`);
    expect(workflowFile?.content).toContain(`interface WorkflowRelatedSurfaceSummary {`);
    expect(workflowFile?.content).toContain(`const BookingsWorkflowRelatedPanelsSection = React.memo(function BookingsWorkflowRelatedPanelsSection({ id }: BookingsWorkflowRelatedPanelsSectionProps) {`);
    expect(workflowFile?.content).toContain(`const workflowRelatedSurfaceSummaries: WorkflowRelatedSurfaceSummary[] = [`);
    expect(workflowFile?.content).toContain(`{ field: 'travelers', title: "Travelers", surfaceKind: 'table', count: travelersRelatedItems.length, createHref: null, viewAllHref: prefixAppBasePath(\`/bookings/\${id}/related/travelers\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) },`);
    expect(workflowFile?.content).toContain(`const BookingsWorkflowRelatedPanelsSectionRelatedSummaryTitleElement = <h2>{"Related"}</h2>`);
    expect(workflowFile?.content).toContain(`{BookingsWorkflowRelatedPanelsSectionRelatedSummaryTitleElement}`);
    expect(workflowFile?.content).toContain(`{workflowRelatedSurfaceSummaries.map((summary) => (`);
    expect(workflowFile?.content).toContain(`const BookingsWorkflowReadFieldsSection = React.memo(function BookingsWorkflowReadFieldsSection({ record }: BookingsWorkflowReadFieldsSectionProps) {`);
    expect(workflowFile?.content).toContain(`<dl className="rdsl-read-fields">`);
    expect(workflowFile?.content).toContain(`<dt>Reference</dt>`);
    expect(workflowFile?.content).toContain(`const value: unknown = record.status;`);
    expect(workflowFile?.content).toContain(`const label = labels[String(value)];`);
    expect(workflowFile?.content).toContain(`const BookingsWorkflowRelatedPanelsSectionTravelersPanelTitleElement = <h2>{"Travelers"}</h2>`);
    expect(workflowFile?.content).toContain(`{BookingsWorkflowRelatedPanelsSectionTravelersPanelTitleElement}`);
    expect(workflowFile?.content).toContain(`const travelersRelatedTableView = useCollectionView<Traveler>`);
    expect(workflowFile?.content).toContain(`className="rdsl-btn rdsl-btn-secondary">View all</a>`);
    expect(workflowFile?.content).toContain(`          <strong>Current step</strong>`);
    expect(workflowFile?.content).toContain(`          <strong>Next step</strong>`);
    expect(routerFile?.content).toContain(`{ path: '/bookings/:id/workflow', component: BookingsWorkflow },`);
    expect(readFile?.content).toContain(`toast.success('Workflow updated');`);
  });

  it('reuses workflow actions across resource-backed table consumers', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Overview"
  blocks:
    - type: table
      title: "Bookings"
      data: bookings.list

model Team:
  name: string @required
  bookings: hasMany(Booking, by: team)

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
    related:
      - bookings

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
      - status
    actions:
      - view
      - edit
  edit:
    fields:
      - reference
  read:
    fields:
      - reference
      - status
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const listFile = result.files.find((file) => file.path === 'views/BookingsList.tsx');
    const readFile = result.files.find((file) => file.path === 'views/TeamsRead.tsx');
    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');

    expect(listFile?.content).toContain(`label: 'Workflow'`);
    expect(listFile?.content).toContain('`/bookings/${row.id}/workflow`');
    expect(readFile?.content).toContain(`label: 'Workflow'`);
    expect(readFile?.content).toContain('`/bookings/${row.id}/workflow`');
    expect(pageFile?.content).toContain(`label: 'Workflow'`);
    expect(pageFile?.content).toContain('`/bookings/${row.id}/workflow`');
  });

  it('propagates read-field changes to dependent workflow pages through codegen cache', () => {
    const files: Record<string, string> = {
      'app.web.loj': `
imports:
  - ./models/booking.web.loj
  - ./resources/bookings.web.loj
`,
      'models/booking.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY)
`,
      'resources/bookings.web.loj': `
resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
  read:
    fields:
      - reference
`,
      'resources/workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.web.loj',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/bookings.web.loj'] = `
resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
  read:
    fields:
      - reference
      - status
`;

    const second = compileProject({
      entryFile: 'app.web.loj',
      readFile,
      cache,
      changedFiles: ['resources/bookings.web.loj'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('views/BookingsRead.tsx')).not.toBe(firstFiles.get('views/BookingsRead.tsx'));
    expect(secondFiles.get('views/BookingsWorkflow.tsx')).not.toBe(firstFiles.get('views/BookingsWorkflow.tsx'));
    expect(secondFiles.get('views/BookingsList.tsx')).toBe(firstFiles.get('views/BookingsList.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
    expect(secondFiles.get('views/BookingsWorkflow.tsx')?.content).toContain(`<dt>Status</dt>`);
  });

  it('propagates read.related changes to dependent workflow pages through codegen cache', () => {
    const files: Record<string, string> = {
      'app.web.loj': `
imports:
  - ./models/booking.web.loj
  - ./models/traveler.web.loj
  - ./resources/bookings.web.loj
  - ./resources/travelers.web.loj
`,
      'models/booking.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY)
  travelers: hasMany(Traveler, by: booking)
`,
      'models/traveler.web.loj': `
model Traveler:
  name: string @required
  booking: belongsTo(Booking)
`,
      'resources/bookings.web.loj': `
resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
  read:
    fields:
      - reference
`,
      'resources/travelers.web.loj': `
resource travelers:
  model: Traveler
  api: /api/travelers
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - name
`,
      'resources/workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.web.loj',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/bookings.web.loj'] = `
resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
  read:
    fields:
      - reference
    related:
      - travelers
`;

    const second = compileProject({
      entryFile: 'app.web.loj',
      readFile,
      cache,
      changedFiles: ['resources/bookings.web.loj'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('views/BookingsRead.tsx')).not.toBe(firstFiles.get('views/BookingsRead.tsx'));
    expect(secondFiles.get('views/BookingsWorkflow.tsx')).not.toBe(firstFiles.get('views/BookingsWorkflow.tsx'));
    expect(secondFiles.get('router.tsx')).not.toBe(firstFiles.get('router.tsx'));
    expect(secondFiles.get('views/BookingsList.tsx')).toBe(firstFiles.get('views/BookingsList.tsx'));
    expect(secondFiles.get('views/BookingsWorkflow.tsx')?.content).toContain(`const BookingsWorkflowRelatedPanelsSectionTravelersPanelTitleElement = <h2>{"Travelers"}</h2>`);
  });

  it('rejects direct editing of workflow-controlled state fields in generated forms', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  create:
    fields:
      - reference
      - status
  edit:
    fields:
      - reference
      - status
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Create field "status" in model "Booking" is controlled by resource workflow and cannot be edited directly in generated forms',
      'Edit field "status" in model "Booking" is controlled by resource workflow and cannot be edited directly in generated forms',
    ]));
  });

  it('supports read views with relation-derived fields and related panels', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - name
      - members.count
    actions:
      - view
  read:
    fields:
      - name
      - members.count
    related:
      - members

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - edit
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  edit:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const teamsListFile = result.files.find((file) => file.path === 'views/TeamsList.tsx');
    const teamsReadFile = result.files.find((file) => file.path === 'views/TeamsRead.tsx');
    const teamsMembersRelatedFile = result.files.find((file) => file.path === 'views/TeamsMembersRelated.tsx');
    const usersReadFile = result.files.find((file) => file.path === 'views/UsersRead.tsx');
    const usersEditFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');

    expect(teamsListFile?.content).toContain(`{ label: 'View', href: (row) => prefixAppBasePath(\`/teams/\${row.id}\`) }`);
    expect(teamsReadFile?.content).toContain(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    expect(teamsReadFile?.content).toContain(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
    expect(teamsReadFile?.content).toContain(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    expect(teamsReadFile?.content).toContain(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    expect(teamsReadFile?.content).toContain(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    expect(teamsReadFile?.content).toContain(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
    expect(teamsReadFile?.content).toContain(`const TeamsReadRelatedPanelsSectionResourceOptions = { pageSize: 1000 } as const;`);
    expect(teamsReadFile?.content).toContain(`const TeamsReadReadFieldsSectionResourceOptions = { pageSize: 1000 } as const;`);
    expect(teamsReadFile?.content).toContain(`const usersProjectionLookup = useResource<User>('/api/users', TeamsReadReadFieldsSectionResourceOptions);`);
    expect(teamsReadFile?.content).toContain('const membersCountProjectionCountMap = React.useMemo(() => {');
    expect(teamsReadFile?.content).toContain(`const membersRelatedResource = useResource<User>('/api/users', TeamsReadRelatedPanelsSectionResourceOptions);`);
    expect(teamsReadFile?.content).toContain('const membersRelatedItems = React.useMemo(() => membersRelatedResource.allData.filter');
    expect(teamsReadFile?.content).toContain('const membersRelatedColumns = [');
    expect(teamsReadFile?.content).toContain('const membersRelatedFilterFields = [');
    expect(teamsReadFile?.content).toContain(`const membersRelatedTableData = React.useMemo(() => membersRelatedItems.map((record) => ({`);
    expect(teamsReadFile?.content).toContain(`const TeamsReadRelatedPanelsSectionMembersPanelTableViewOptions = { pageSize: 10, paginate: true } as const;`);
    expect(teamsReadFile?.content).toContain(`const membersRelatedTableView = useCollectionView<User>(membersRelatedTableData, TeamsReadRelatedPanelsSectionMembersPanelTableViewOptions);`);
    expect(teamsReadFile?.content).toContain(`['team.name']: record.team == null ? undefined : teamsById.get(String(record.team))?.name,`);
    expect(teamsReadFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', sortable: true },`);
    expect(teamsReadFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', type: 'text' },`);
    expect(teamsReadFile?.content).toContain(`const TeamsReadRelatedPanelsSectionMembersPanelTitleElement = <h2>{"Members"}</h2>`);
    expect(teamsReadFile?.content).toContain(`{TeamsReadRelatedPanelsSectionMembersPanelTitleElement}`);
    expect(teamsReadFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getLocationSearchValues, getSanitizedReturnTo, replaceLocationSearchValues, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(teamsReadFile?.content).toContain('const returnTo = getSanitizedReturnTo(returnToSearchParams);');
    expect(teamsReadFile?.content).toContain('const backHref = returnTo || prefixAppBasePath("/teams");');
    expect(teamsReadFile?.content).toContain('href={prefixAppBasePath("/users/create") + "?" + "team=" + encodeURIComponent(String(id)) + "&" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(teamsReadFile?.content).toContain('href={prefixAppBasePath(`/teams/${id}/related/members`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(teamsReadFile?.content).toContain('const membersRelatedTableViewFiltersWithTransition = React.useCallback((nextFilters: Parameters<typeof membersRelatedTableView.setFilters>[0]) => {');
    expect(teamsReadFile?.content).toContain('FilterBar fields={membersRelatedFilterFields} values={membersRelatedTableView.filters} onChange={membersRelatedTableViewFiltersWithTransition}');
    expect(teamsReadFile?.content).toContain('data={membersRelatedTableView.data}');
    expect(teamsReadFile?.content).toContain('sort={membersRelatedTableView.sort}');
    expect(teamsReadFile?.content).toContain('onSortChange={membersRelatedTableViewSortWithTransition}');
    expect(teamsReadFile?.content).toContain('current={membersRelatedTableView.pagination.page}');
    expect(teamsReadFile?.content).toContain('onChange={membersRelatedTableViewPaginationWithTransition}');
    expect(teamsReadFile?.content).toContain(`const TeamsReadRelatedPanelsSectionMembersPanelTableActions = React.useMemo<Array<DataTableAction<User>>>(() => [{ label: 'View', href: (row) => prefixAppBasePath(\`/users/\${row.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Edit', href: (row) => prefixAppBasePath(\`/users/\${row.id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Delete', onClick: (row) => membersRelatedDeleteRequest(row.id), variant: 'danger' }], [membersRelatedDeleteRequest]);`);
    expect(teamsReadFile?.content).toContain(`actions={TeamsReadRelatedPanelsSectionMembersPanelTableActions}`);
    expect(teamsReadFile?.content).toContain('const [membersRelatedDeleteConfirmState, setMembersRelatedDeleteConfirmState]');
    expect(teamsReadFile?.content).toContain('setMembersRelatedDeleteConfirmState({ open: true, id, message: "Remove user?" });');
    expect(teamsReadFile?.content).toContain('onConfirm={membersRelatedDeleteConfirm}');
    expect(teamsMembersRelatedFile?.content).toContain(`const TeamsMembersRelatedResourceOptions = { pageSize: 1000 } as const;`);
    expect(teamsMembersRelatedFile?.content).toContain(`const membersRelatedResource = useResource<User>('/api/users', TeamsMembersRelatedResourceOptions);`);
    expect(teamsMembersRelatedFile?.content).toContain('const returnToSearchParams = getLocationSearchParams();');
    expect(teamsMembersRelatedFile?.content).toContain('const backHref = returnTo || prefixAppBasePath(`/teams/${id}`);');
    expect(teamsMembersRelatedFile?.content).toContain(`const TeamsMembersRelatedMembersPanelTableViewOptions = { pageSize: 10, paginate: true } as const;`);
    expect(teamsMembersRelatedFile?.content).toContain(`const membersRelatedTableView = useCollectionView<User>(membersRelatedTableData, TeamsMembersRelatedMembersPanelTableViewOptions);`);
    expect(teamsMembersRelatedFile?.content).toContain(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    expect(teamsMembersRelatedFile?.content).toContain(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
    expect(teamsMembersRelatedFile?.content).toContain('href={prefixAppBasePath("/users/create") + "?" + "team=" + encodeURIComponent(String(id)) + "&" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(teamsMembersRelatedFile?.content).toContain('href={backHref}');
    expect(teamsMembersRelatedFile?.content).toContain('const membersRelatedTableViewFiltersWithTransition = React.useCallback((nextFilters: Parameters<typeof membersRelatedTableView.setFilters>[0]) => {');
    expect(teamsMembersRelatedFile?.content).toContain('FilterBar fields={membersRelatedFilterFields} values={membersRelatedTableView.filters} onChange={membersRelatedTableViewFiltersWithTransition}');
    expect(teamsMembersRelatedFile?.content).toContain(`const TeamsMembersRelatedMembersPanelTableActions = React.useMemo<Array<DataTableAction<User>>>(() => [{ label: 'View', href: (row) => prefixAppBasePath(\`/users/\${row.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Edit', href: (row) => prefixAppBasePath(\`/users/\${row.id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Delete', onClick: (row) => membersRelatedDeleteRequest(row.id), variant: 'danger' }], [membersRelatedDeleteRequest]);`);
    expect(teamsMembersRelatedFile?.content).toContain(`actions={TeamsMembersRelatedMembersPanelTableActions}`);
    expect(usersReadFile?.content).toContain(`const UsersReadReadFieldsSectionResourceOptions = { pageSize: 1000 } as const;`);
    expect(usersReadFile?.content).toContain(`const teamsProjectionLookup = useResource<Team>('/api/teams', UsersReadReadFieldsSectionResourceOptions);`);
    expect(usersReadFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getLocationSearchValues, getSanitizedReturnTo, replaceLocationSearchValues, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(usersReadFile?.content).toContain('const returnTo = getSanitizedReturnTo(returnToSearchParams);');
    expect(usersReadFile?.content).toContain('const backHref = returnTo || prefixAppBasePath("/users");');
    expect(usersReadFile?.content).toContain('href={prefixAppBasePath(`/users/${id}/edit`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(usersReadFile?.content).toContain('{backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}');
    expect(usersReadFile?.content).toContain('<dt>Team Name</dt>');
    expect(usersEditFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(usersEditFile?.content).toContain('const returnTo = getSanitizedReturnTo(searchParams);');
    expect(usersEditFile?.content).toContain('const cancelHref = returnTo || prefixAppBasePath("/users");');
    expect(usersEditFile?.content).toContain('window.location.href = returnTo;');
    expect(usersEditFile?.content).toContain('href={cancelHref}');
    expect(routerFile?.content).toContain(`const TeamsRead = React.lazy(() => import('./views/TeamsRead').then((m) => ({ default: m.TeamsRead })));`);
    expect(routerFile?.content).toContain(`const TeamsMembersRelated = React.lazy(() => import('./views/TeamsMembersRelated').then((m) => ({ default: m.TeamsMembersRelated })));`);
    expect(routerFile?.content).toContain(`{ path: '/teams/:id', component: TeamsRead },`);
    expect(routerFile?.content).toContain(`{ path: '/teams/:id/related/members', component: TeamsMembersRelated },`);
  });

  it('falls back to label-list related panels when the related resource has no list view', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    related:
      - members

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const teamsReadFile = result.files.find((file) => file.path === 'views/TeamsRead.tsx');
    const teamsMembersRelatedFile = result.files.find((file) => file.path === 'views/TeamsMembersRelated.tsx');
    expect(teamsReadFile?.content).not.toContain(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    expect(teamsReadFile?.content).not.toContain(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    expect(teamsReadFile?.content).toContain('<ul className="rdsl-related-list">');
    expect(teamsReadFile?.content).toContain('href={prefixAppBasePath(`/teams/${id}/related/members`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(teamsReadFile?.content).toContain(`const TeamsReadRelatedPanelsSectionResourceOptions = { pageSize: 1000 } as const;`);
    expect(teamsReadFile?.content).toContain(`const membersRelatedResource = useResource<User>('/api/users', TeamsReadRelatedPanelsSectionResourceOptions);`);
    expect(teamsMembersRelatedFile?.content).not.toContain(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    expect(teamsMembersRelatedFile?.content).toContain('<ul className="rdsl-related-list">');
  });

  it('links workflow pages from label-list related fallbacks when the related target is workflow-linked', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY)
  travelers: hasMany(Traveler, by: booking)

model Traveler:
  name: string @required
  status: enum(PENDING, CONFIRMED)
  booking: belongsTo(Booking)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  read:
    related:
      - travelers

resource travelers:
  model: Traveler
  api: /api/travelers
  workflow: '@flow("./workflows/traveler-lifecycle")'
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
      'workflows/traveler-lifecycle.flow.loj': `
workflow traveler-lifecycle:
  model: Traveler
  field: status
  states:
    PENDING:
      label: "Pending"
    CONFIRMED:
      label: "Confirmed"
  transitions:
    confirm:
      from: PENDING
      to: CONFIRMED
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const bookingsReadFile = result.files.find((file) => file.path === 'views/BookingsRead.tsx');
    const bookingsWorkflowFile = result.files.find((file) => file.path === 'views/BookingsWorkflow.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');

    expect(bookingsReadFile?.content).toContain('href={prefixAppBasePath(`/travelers/${item.id}/workflow`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(bookingsWorkflowFile?.content).toContain('href={prefixAppBasePath(`/travelers/${item.id}/workflow`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}');
    expect(bookingsReadFile?.content).toContain(`{"PENDING":"Pending","CONFIRMED":"Confirmed"}`);
    expect(bookingsReadFile?.content).toContain(`{' '}<span className="rdsl-btn rdsl-btn-secondary">{(() => {`);
    expect(bookingsWorkflowFile?.content).toContain(`{"PENDING":"Pending","CONFIRMED":"Confirmed"}`);
    expect(routerFile?.content).toContain(`{ path: '/travelers/:id/workflow', component: TravelersWorkflow },`);
  });

  it('rejects invalid read surfaces and view actions without read views', () => {
    const source = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - members
      - members.name
    related:
      - name

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
    actions:
      - view
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'List action "view" in resource "users" requires a read: view',
      'Read field "members" in model "Team" references inverse relation metadata directly; use "members.count" or move it under related:',
      'Read field "members.name" in model "Team" only supports hasMany(...).count projections in generated read surfaces',
      'Related panel "name" in model "Team" must reference a hasMany(..., by: ...) field',
    ]));
  });

  it('supports page table blocks that reuse resource list surfaces', () => {
    const source = `
page dashboard:
  title: "Overview"
  blocks:
    - type: table
      title: "Users"
      data: users.list

model Team:
  name: string @required

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    expect(pageFile?.content).toContain(`import { DataTable } from '@loj-lang/rdsl-runtime/components/DataTable';`);
    expect(pageFile?.content).toContain(`import { FilterBar } from '@loj-lang/rdsl-runtime/components/FilterBar';`);
    expect(pageFile?.content).toContain(`import { Pagination } from '@loj-lang/rdsl-runtime/components/Pagination';`);
    expect(pageFile?.content).toContain(`import { useCollectionView } from '@loj-lang/rdsl-runtime/hooks/useCollectionView';`);
    expect(pageFile?.content).toContain(`import { ConfirmDialog } from '@loj-lang/rdsl-runtime/components/ConfirmDialog';`);
    expect(pageFile?.content).toContain(`import { useToast } from '@loj-lang/rdsl-runtime/hooks/useToast';`);
    expect(pageFile?.content).toContain(`const DashboardPageResourceOptions = { pageSize: 1000 } as const;`);
    expect(pageFile?.content).toContain(`const usersPageDashboardBlock0TableResource = useResource<User>('/api/users', DashboardPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const teamsProjectionLookup = useResource<Team>('/api/teams', DashboardPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableColumns = [`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0FilterFields = [`);
    expect(pageFile?.content).toContain(`['team.name']: record.team == null ? undefined : teamsById.get(String(record.team))?.name,`);
    expect(pageFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', sortable: true },`);
    expect(pageFile?.content).toContain(`{ key: 'team.name', label: 'Team Name', type: 'text' },`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableViewOptions = { pageSize: 10, paginate: true } as const;`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableView = useCollectionView<User>(pageDashboardBlock0TableData, pageDashboardBlock0TableViewOptions);`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableViewFiltersWithTransition = React.useCallback((nextFilters: Parameters<typeof pageDashboardBlock0TableView.setFilters>[0]) => {`);
    expect(pageFile?.content).toContain(`sort={pageDashboardBlock0TableView.sort}`);
    expect(pageFile?.content).toContain(`onSortChange={pageDashboardBlock0TableViewSortWithTransition}`);
    expect(pageFile?.content).toContain(`href={prefixAppBasePath("/users/create") + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}`);
    expect(pageFile?.content).toContain(`FilterBar fields={pageDashboardBlock0FilterFields} values={pageDashboardBlock0TableView.filters} onChange={pageDashboardBlock0TableViewFiltersWithTransition}`);
    expect(pageFile?.content).toContain(`current={pageDashboardBlock0TableView.pagination.page}`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableActions = React.useMemo<Array<DataTableAction<User>>>(() => [{ label: 'View', href: (row) => prefixAppBasePath(\`/users/\${row.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Delete', onClick: (row) => pageDashboardBlock0DeleteRequest(row.id), variant: 'danger' }], [pageDashboardBlock0DeleteRequest]);`);
    expect(pageFile?.content).toContain(`actions={pageDashboardBlock0TableActions}`);
    expect(pageFile?.content).toContain(`const [pageDashboardBlock0DeleteConfirmState, setPageDashboardBlock0DeleteConfirmState]`);
    expect(pageFile?.content).toContain(`setPageDashboardBlock0DeleteConfirmState({ open: true, id, message: "Remove user?" });`);
    expect(pageFile?.content).toContain(`onConfirm={pageDashboardBlock0DeleteConfirm}`);
  });

  it('supports page table blocks backed by read-model list surfaces', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
  list:
    columns:
      - flightNo
      - fare @sortable
    pagination:
      size: 10
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    const readModelFile = result.files.find((file) => file.path === 'read-models/FlightAvailability.ts');
    expect(pageFile?.content).toContain(`import { useReadModel } from '@loj-lang/rdsl-runtime/hooks/useReadModel';`);
    expect(pageFile?.content).toContain(`import type { FlightAvailabilityReadModelItem } from '../read-models/FlightAvailability';`);
    expect(pageFile?.content).toContain(`import { getCurrentAppHref, getLocationSearchParams, getSanitizedReturnTo, prefixAppBasePath, getLocationSearchValues, replaceLocationSearchValues } from '@loj-lang/rdsl-runtime/hooks/navigation';`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryFields = [`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryLocationOptions = { prefix: "flightAvailability" } as const;`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryLocationSyncOptions = { prefix: "flightAvailability", keys: ["from","cabin"] } as const;`);
    expect(pageFile?.content).toContain(`const [flightAvailabilityPageQuery, setFlightAvailabilityPageQueryState] = React.useState<Record<string, string>>(() => getLocationSearchValues(flightAvailabilityPageQueryDefaults, flightAvailabilityPageQueryLocationOptions));`);
    expect(pageFile?.content).toContain(`const setFlightAvailabilityPageQuery = React.useCallback((nextQueryState: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => {`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryDeferred = React.useDeferredValue(flightAvailabilityPageQuery);`);
    expect(pageFile?.content).toContain(`replaceLocationSearchValues(flightAvailabilityPageQuery, flightAvailabilityPageQueryLocationSyncOptions);`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageCanLoad = flightAvailabilityPageQueryEnabled;`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageReadModelOptions = React.useMemo(() => ({ enabled: flightAvailabilityPageCanLoad }), [flightAvailabilityPageCanLoad]);`);
    expect(pageFile?.content).toContain(`useReadModel<FlightAvailabilityReadModelItem>('/api/flights/search', flightAvailabilityPageQueryDeferred, flightAvailabilityPageReadModelOptions);`);
    expect(pageFile?.content).toContain(`FilterBar fields={flightAvailabilityPageQueryFields} values={flightAvailabilityPageQuery} onChange={setFlightAvailabilityPageQuery}`);
    expect(pageFile?.content).toContain(`Fill the required search inputs to load results`);
    expect(readModelFile?.content).toContain(`export interface FlightAvailabilityReadModelInput {`);
    expect(readModelFile?.content).toContain(`export interface FlightAvailabilityReadModelItem {`);
  });

  it('supports grouped read-model table consumers on pages', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare @sortable
    pagination:
      size: 5
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    expect(pageFile?.content).toContain(`import { GroupedDataTable } from '@loj-lang/rdsl-runtime/components/GroupedDataTable';`);
    expect(pageFile?.content).toContain(`import { useGroupedCollectionView } from '@loj-lang/rdsl-runtime/hooks/useGroupedCollectionView';`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0GroupBy = ["flightNo","departureTime"] as const;`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableViewOptions = { pageSize: 5, paginate: true } as const;`);
    expect(pageFile?.content).toContain(`useGroupedCollectionView<FlightAvailabilityReadModelItem>(pageDashboardBlock0ReadModelItems, pageDashboardBlock0GroupBy, pageDashboardBlock0TableViewOptions);`);
    expect(pageFile?.content).toContain(`groupBy={pageDashboardBlock0GroupBy}`);
    expect(pageFile?.content).toContain(`groups={pageDashboardBlock0TableView.groups}`);
    expect(pageFile?.content).toContain(`<GroupedDataTable`);
  });

  it('supports pivoted read-model table consumers on pages', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
    seatsRemaining: integer
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare
      - seatsRemaining
    pagination:
      size: 5
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    expect(pageFile?.content).toContain(`import { PivotDataTable } from '@loj-lang/rdsl-runtime/components/PivotDataTable';`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0GroupBy = ["flightNo","departureTime"] as const;`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0TableViewOptions = { pageSize: 5, paginate: true } as const;`);
    expect(pageFile?.content).toContain(`useGroupedCollectionView<FlightAvailabilityReadModelItem>(pageDashboardBlock0ReadModelItems, pageDashboardBlock0GroupBy, pageDashboardBlock0TableViewOptions);`);
    expect(pageFile?.content).toContain(`pivotBy="fareBrand"`);
    expect(pageFile?.content).toContain(`groups={pageDashboardBlock0TableView.groups}`);
    expect(pageFile?.content).toContain(`<PivotDataTable`);
  });

  it('supports read-model table rowActions that hand off into generated create views with seeded fields', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list
      rowActions:
        - create:
            resource: bookings
            label: "Start booking"
            seed:
              travelDate:
                input: travelDate
              routeCode:
                row: flightNo
              cabin:
                row: cabin
              baseFare:
                row: baseFare
              quotedFare:
                row: quotedFare

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    travelDate: string @required
  result:
    flightNo: string
    cabin: enum(ECONOMY, BUSINESS)
    baseFare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare

model Booking:
  travelDate: string
  routeCode: string
  cabin: enum(ECONOMY, BUSINESS)
  baseFare: number
  quotedFare: number

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - travelDate
      - routeCode
      - cabin @select
      - baseFare
      - quotedFare
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    expect(pageFile?.content).toContain(`const pageAvailabilityBlock0TableActions = React.useMemo<Array<DataTableAction<FlightAvailabilityReadModelItem>>>(() => [{ label: "Start booking", href: (row) => prefixAppBasePath("/bookings/create") + "?" + "travelDate=" + encodeURIComponent(String(flightAvailabilityPageQuery.travelDate)) + "&" + "routeCode=" + encodeURIComponent(String(row.flightNo)) + "&" + "cabin=" + encodeURIComponent(String(row.cabin)) + "&" + "baseFare=" + encodeURIComponent(String(row.baseFare)) + "&" + "quotedFare=" + encodeURIComponent(String(row.quotedFare)) + "&" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }], [flightAvailabilityPageQuery]);`);
    expect(pageFile?.content).toContain(`actions={pageAvailabilityBlock0TableActions}`);
    expect(createFile?.content).toContain(`const travelDateParam = searchParams.get('travelDate');`);
    expect(createFile?.content).toContain(`initial.travelDate = travelDateParam;`);
    expect(createFile?.content).toContain(`const routeCodeParam = searchParams.get('routeCode');`);
    expect(createFile?.content).toContain(`initial.routeCode = routeCodeParam;`);
    expect(createFile?.content).toContain(`const cabinParam = searchParams.get('cabin');`);
    expect(createFile?.content).toContain(`initial.cabin = cabinParam as Booking['cabin'];`);
    expect(createFile?.content).toContain(`const baseFareParam = searchParams.get('baseFare');`);
    expect(createFile?.content).toContain(`initial.baseFare = Number.isNaN(Number(baseFareParam)) ? initial.baseFare : Number(baseFareParam);`);
  });

  it('supports shared queryState and dateNavigation across multiple read-model table consumers', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: metric
      title: "Matching Outbound Flights"
      data: readModel.outwardFlightAvailability.count
      queryState: availabilitySearch
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      dateNavigation:
        field: outwardDate
        prevLabel: "Previous outbound day"
        nextLabel: "Next outbound day"
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      dateNavigation:
        field: homewardDate
        prevLabel: "Previous homeward day"
        nextLabel: "Next homeward day"

readModel outwardFlightAvailability:
  api: /api/outward-flights
  inputs:
    departureCode: string @required
    arrivalCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare

readModel homewardFlightAvailability:
  api: /api/homeward-flights
  inputs:
    departureCode: string @required
    arrivalCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    expect(pageFile?.content).toContain(`const availabilitySearchPageQueryLocationOptions = { prefix: "availabilitySearch" } as const;`);
    expect(pageFile?.content).toContain(`const availabilitySearchPageQueryLocationSyncOptions = { prefix: "availabilitySearch", keys: ["departureCode","arrivalCode","outwardDate","homewardDate"] } as const;`);
    expect(pageFile?.content).toContain(`getLocationSearchValues(availabilitySearchPageQueryDefaults, availabilitySearchPageQueryLocationOptions)`);
    expect(pageFile?.content).toContain(`const availabilitySearchPageQueryDeferred = React.useDeferredValue(availabilitySearchPageQuery);`);
    expect(pageFile?.content).toContain(`replaceLocationSearchValues(availabilitySearchPageQuery, availabilitySearchPageQueryLocationSyncOptions);`);
    expect((pageFile?.content.match(/<FilterBar fields=\{availabilitySearchPageQueryFields\}/g) ?? []).length).toBe(1);
    expect(pageFile?.content).toContain(`Previous outbound day`);
    expect(pageFile?.content).toContain(`Next outbound day`);
    expect(pageFile?.content).toContain(`Previous homeward day`);
    expect(pageFile?.content).toContain(`Next homeward day`);
    expect(pageFile?.content).toContain(`<span className="rdsl-table-pager-current">{pageAvailabilityBlock1DateNavigationCurrentLabel}</span>`);
    expect(pageFile?.content).toContain(`<span className="rdsl-table-pager-current">{pageAvailabilityBlock2DateNavigationCurrentLabel}</span>`);
    expect(pageFile?.content).toContain(`React.startTransition(() => {`);
    expect(pageFile?.content).toContain(`shiftDateInputValue(String(previous.outwardDate ?? ''), -1)`);
    expect(pageFile?.content).toContain(`shiftDateInputValue(String(previous.homewardDate ?? ''), 1)`);
  });

  it('supports descriptor-shaped frontend UI copy across page, view, and navigation titles/labels', () => {
    const source = `
app:
  name: "Flights"
  navigation:
    - group:
        key: nav.booking
        defaultMessage: "Booking"
      items:
        - label:
            key: nav.availability
            defaultMessage: "Availability"
          target: availability

page availability:
  title:
    key: flights.availability
    defaultMessage: "Flight Availability"
  actions:
    - create:
        resource: bookings
        label:
          key: flights.bookSelected
          defaultMessage: "Book selected itinerary"
  blocks:
    - type: table
      title:
        key: flights.outbound
        defaultMessage: "Outbound Flights"
      data: readModel.flightAvailability.list
      dateNavigation:
        field: travelDate
        prevLabel:
          key: flights.prev
          defaultMessage: "Previous day"
        nextLabel:
          key: flights.next
          defaultMessage: "Next day"

readModel flightAvailability:
  api: /api/flights
  inputs:
    travelDate: string @required
  result:
    flightNo: string
  list:
    columns:
      - flightNo

model Booking:
  flightNo: string

resource bookings:
  model: Booking
  api: /api/bookings
  list:
    title:
      key: bookings.list
      defaultMessage: "Bookings"
    columns:
      - flightNo
  read:
    title:
      key: bookings.read
      defaultMessage: "Booking Details"
    fields:
      - flightNo
  create:
    fields:
      - flightNo
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);
    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    const layoutFile = result.files.find((file) => file.path === 'layout/AdminLayout.tsx');
    const listFile = result.files.find((file) => file.path === 'views/BookingsList.tsx');
    const readFile = result.files.find((file) => file.path === 'views/BookingsRead.tsx');
    expect(pageFile?.content).toContain(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
    expect(pageFile?.content).toContain(`const AvailabilityPageTitleElement = <h1>{resolveMessageText({ key: "flights.availability", defaultMessage: "Flight Availability", })}</h1>;`);
    expect(pageFile?.content).toContain(`const AvailabilityPagePageAvailabilityBlock0TitleElement = <h3>{resolveMessageText({ key: "flights.outbound", defaultMessage: "Outbound Flights", })}</h3>;`);
    expect(pageFile?.content).toContain(`>{resolveMessageText({ key: "flights.prev", defaultMessage: "Previous day", })}</button>`);
    expect(pageFile?.content).toContain(`>{resolveMessageText({ key: "flights.next", defaultMessage: "Next day", })}</button>`);
    expect(layoutFile?.content).toContain(`import { resolveMessageText } from '@loj-lang/shared-contracts';`);
    expect(layoutFile?.content).toContain(`group: resolveMessageText({ key: "nav.booking", defaultMessage: "Booking", }),`);
    expect(layoutFile?.content).toContain(`label: resolveMessageText({ key: "nav.availability", defaultMessage: "Availability", }),`);
    expect(listFile?.content).toContain(`const BookingsListTitleElement = <h1>{resolveMessageText({ key: "bookings.list", defaultMessage: "Bookings", })}</h1>;`);
    expect(readFile?.content).toContain(`const BookingsReadTitleElement = <h1>{resolveMessageText({ key: "bookings.read", defaultMessage: "Booking Details", })}</h1>;`);
  });

  it('supports app/page SEO metadata, asset refs, and linked style authoring on page and resource surfaces', () => {
    const source = `
app:
  name: "Flight Booking Proof"
  style: '@style("./styles/theme")'
  seo:
    siteName: "Flight Booking Proof"
    defaultTitle: "Flight Booking Proof"
    titleTemplate: "{title} · Flight Booking Proof"
    defaultDescription: "Default proof description"
    defaultImage: '@asset("./assets/default-og.svg")'
    favicon: '@asset("./assets/favicon.svg")'

model Booking:
  reference: string
  status: enum(draft, ready)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
  list:
    title: "Bookings"
    style: listShell
    columns:
      - reference
  read:
    title: "Booking Detail"
    style: detailShell
    fields:
      - reference
      - status
  create:
    style: formShell
    fields:
      - reference
  edit:
    style: formShell
    fields:
      - reference

page availability:
  title: "Flight Availability"
  style: pageShell
  seo:
    description: "Search and compare outbound and homeward flights."
    canonicalPath: /availability
    image: '@asset("./assets/availability-og.svg")'
  blocks:
    - type: metric
      title: "Matching Flights"
      style: metricCard
`;
    const styleSource = `
tokens:
  colors:
    surface: "#ffffff"
  spacing:
    md: 16
  borderRadius:
    lg: 24
  elevation:
    card: 2
  typography:
    body:
      fontSize: 16
      fontWeight: 400
      lineHeight: 24

style pageShell:
  display: column
  gap: md
  padding: md
  backgroundColor: surface

style metricCard:
  display: column
  padding: md
  borderRadius: lg
  elevation: card

style listShell:
  extends: metricCard

style detailShell:
  extends: metricCard

style formShell:
  extends: metricCard

style workflowShell:
  extends: metricCard
`;
    const fileMap = new Map<string, string>([
      ['frontend/app.web.loj', source],
      ['frontend/styles/theme.style.loj', styleSource],
      ['frontend/workflows/booking-lifecycle.flow.loj', `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    draft:
      label: "Draft"
    ready:
      label: "Ready"
  wizard:
    steps:
      - name: draft_step
        completesWith: draft
      - name: ready_step
        completesWith: ready
  transitions:
    advance:
      from: draft
      to: ready
`],
      ['frontend/assets/default-og.svg', '<svg></svg>'],
      ['frontend/assets/favicon.svg', '<svg></svg>'],
      ['frontend/assets/availability-og.svg', '<svg></svg>'],
    ]);
    const result = compileProject({
      entryFile: 'frontend/app.web.loj',
      projectRoot: '.',
      readFile(fileName) {
        const value = fileMap.get(fileName);
        if (value === undefined) {
          throw new Error(`unexpected file read: ${fileName}`);
        }
        return value;
      },
    });
    expect(result.success).toBe(true);
    const appFile = result.files.find((file) => file.path === 'App.tsx');
    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    const styleFile = result.files.find((file) => file.path === 'styles/generated-styles.css');
    expect(appFile?.content).toContain(`import './styles/generated-styles.css';`);
    expect(pageFile?.content).toContain(`import { useDocumentMetadata } from '@loj-lang/rdsl-runtime/hooks/useDocumentMetadata';`);
    expect(pageFile?.content).toContain(`import appSeoDefaultImageAsset from '../frontend/assets/default-og.svg';`);
    expect(pageFile?.content).toContain(`import appSeoFaviconAsset from '../frontend/assets/favicon.svg';`);
    expect(pageFile?.content).toContain(`import availabilityPageSeoImageAsset from '../frontend/assets/availability-og.svg';`);
    expect(pageFile?.content).toContain(`useDocumentMetadata({`);
    expect(pageFile?.content).toContain(`titleTemplate: "`);
    expect(pageFile?.content).toContain(`className="rdsl-page loj-style-page-shell"`);
    expect(pageFile?.content).toContain(`className="rdsl-block rdsl-metric loj-style-metric-card"`);
    const listFile = result.files.find((file) => file.path === 'views/BookingsList.tsx');
    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    const readFile = result.files.find((file) => file.path === 'views/BookingsRead.tsx');
    const workflowFile = result.files.find((file) => file.path === 'views/BookingsWorkflow.tsx');
    expect(listFile?.content).toContain(`className="rdsl-resource-list loj-style-list-shell"`);
    expect(createFile?.content).toContain(`className="rdsl-form loj-style-form-shell"`);
    expect(readFile?.content).toContain(`className="rdsl-resource-read loj-style-detail-shell"`);
    expect(workflowFile?.content).toContain(`className="rdsl-resource-read loj-style-workflow-shell"`);
    expect(styleFile?.content).toContain(`.loj-style-page-shell {`);
    expect(styleFile?.content).toContain(`.loj-style-metric-card {`);
    expect(styleFile?.content).toContain(`.loj-style-list-shell {`);
    expect(styleFile?.content).toContain(`.loj-style-workflow-shell {`);
    expect(styleFile?.content).toContain(`--loj-typography-body-line-height: 24px;`);
  });

  it('supports page-level create handoff from shared read-model selectionState consumers', () => {
    const source = `
page availability:
  title: "Flight Availability"
  actions:
    - create:
        resource: bookings
        label: "Book selected itinerary"
        seed:
          travelDate:
            input: availabilitySearch.outwardDate
          outwardFlightNo:
            selection: outwardFlight.flightNo
          homewardFlightNo:
            selection: homewardFlight.flightNo
  blocks:
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: outwardFlight
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: homewardFlight

readModel outwardFlightAvailability:
  api: /api/outward-flights
  inputs:
    departureCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    id: string
    flightNo: string
  list:
    columns:
      - flightNo

readModel homewardFlightAvailability:
  api: /api/homeward-flights
  inputs:
    departureCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    id: string
    flightNo: string
  list:
    columns:
      - flightNo

model Booking:
  travelDate: string
  outwardFlightNo: string
  homewardFlightNo: string

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - travelDate
      - outwardFlightNo
      - homewardFlightNo
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    expect(pageFile?.content).toContain(`const [outwardFlightSelectedId, setOutwardFlightSelectedId] = React.useState<string | null>(null);`);
    expect(pageFile?.content).toContain(`const [homewardFlightSelectedId, setHomewardFlightSelectedId] = React.useState<string | null>(null);`);
    expect(pageFile?.content).toContain(`const outwardFlightRowsById = React.useMemo(() => new Map(pageAvailabilityBlock0ReadModelItems.map((item) => [String(item.id), item] as const)), [pageAvailabilityBlock0ReadModelItems]);`);
    expect(pageFile?.content).toContain(`const selectOutwardFlightRow = React.useCallback((row: OutwardFlightAvailabilityReadModelItem) => {`);
    expect(pageFile?.content).toContain(`const pageAvailabilityAction0Href = Boolean(outwardFlightSelectedRow) && Boolean(homewardFlightSelectedRow) ? prefixAppBasePath("/bookings/create")`);
    expect(pageFile?.content).toContain(`"travelDate="`);
    expect(pageFile?.content).toContain(`availabilitySearchPageQuery.outwardDate`);
    expect(pageFile?.content).toContain(`"outwardFlightNo="`);
    expect(pageFile?.content).toContain(`outwardFlightSelectedRow`);
    expect(pageFile?.content).toContain(`"homewardFlightNo="`);
    expect(pageFile?.content).toContain(`homewardFlightSelectedRow`);
    expect(pageFile?.content).toContain(`"returnTo="`);
    expect(pageFile?.content).toContain(`selectionName="pageAvailabilityBlock0Selection"`);
    expect(pageFile?.content).toContain(`selectionName="pageAvailabilityBlock1Selection"`);
    expect(pageFile?.content).toContain(`{pageAvailabilityAction0Href ? <a href={pageAvailabilityAction0Href} className="rdsl-btn rdsl-btn-primary">{"Book selected itinerary"}</a> : <button type="button" className="rdsl-btn rdsl-btn-primary" disabled>{"Book selected itinerary"}</button>}`);
    expect(createFile?.content).toContain(`const travelDateParam = searchParams.get('travelDate');`);
    expect(createFile?.content).toContain(`initial.travelDate = travelDateParam;`);
    expect(createFile?.content).toContain(`const outwardFlightNoParam = searchParams.get('outwardFlightNo');`);
    expect(createFile?.content).toContain(`initial.outwardFlightNo = outwardFlightNoParam;`);
    expect(createFile?.content).toContain(`const homewardFlightNoParam = searchParams.get('homewardFlightNo');`);
    expect(createFile?.content).toContain(`initial.homewardFlightNo = homewardFlightNoParam;`);
  });

  it('rejects invalid grouped read-model list definitions', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
  list:
    groupBy: [flightNo]
    columns:
      - flightNo @sortable
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      `Read-model "flightAvailability" list groupBy field "flightNo" cannot also be @sortable in the current grouped-table slice`,
      `Read-model "flightAvailability" grouped list must leave at least one non-grouped offer column`,
    ]));
  });

  it('rejects invalid pivoted read-model list definitions', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    fareBrand: string
    quotedFare: number
  list:
    pivotBy: fareBrand
    columns:
      - flightNo
      - fareBrand @sortable
      - quotedFare @sortable
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      `Read-model "flightAvailability" list pivotBy requires groupBy in the current grouped-matrix slice`,
      `Read-model "flightAvailability" list pivotBy field "fareBrand" cannot also be @sortable in the current grouped-matrix slice`,
      `Read-model "flightAvailability" pivoted list column "quotedFare" cannot use @sortable in the current grouped-matrix slice`,
    ]));
  });

  it('rejects invalid shared queryState and dateNavigation definitions on page blocks', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      dateNavigation:
        field: missingDate
    - type: metric
      title: "Broken Count"
      data: readModel.passengerCount.count
      queryState: availabilitySearch

readModel outwardFlightAvailability:
  api: /api/outward-flights
  inputs:
    departureCode: string @required
    outwardDate: string @required
  result:
    flightNo: string
  list:
    columns:
      - flightNo

readModel passengerCount:
  api: /api/passenger-count
  inputs:
    departureCode: string @required
    passengerCount: string @required
  result:
    id: string
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      `Page block "Outbound Flights" in page "availability" dateNavigation field "missingDate" must reference a read-model input`,
      `Page "availability" queryState "availabilitySearch" may only be shared by read-model consumers with identical inputs; "outwardFlightAvailability" and "passengerCount" differ`,
    ]));
  });

  it('supports grouped .rules.loj consumption on frontend read-model list pages', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare @sortable
`,
      'rules/flight-availability.rules.loj': `
rules flightAvailability:
  eligibility business-only:
    when: input.cabin != BUSINESS || currentUser.role == "agent"
    message:
      defaultMessage: "Only agents may search business fares"
  validate origin-open:
    when: input.from != "BLOCKED"
    message: "Blocked route"
  derive quotedFare:
    value: item.fare + 20
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    expect(pageFile?.content).toContain(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
    expect(pageFile?.content).toContain(`import { evaluatePolicyExpr, firstPolicyFailure } from '@loj-lang/rdsl-runtime/policies/can';`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageEligibilityRules = [`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageValidationRules = [`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0DerivationRules = [`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageCanLoad = flightAvailabilityPageQueryEnabled && !flightAvailabilityPageEligibilityFailure && !flightAvailabilityPageValidationFailure;`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageReadModelOptions = React.useMemo(() => ({ enabled: flightAvailabilityPageCanLoad }), [flightAvailabilityPageCanLoad]);`);
    expect(pageFile?.content).toContain(`useReadModel<FlightAvailabilityReadModelItem>('/api/flights/search', flightAvailabilityPageQueryDeferred, flightAvailabilityPageReadModelOptions);`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0ReadModelItems = React.useMemo(() => {`);
    expect(pageFile?.content).toContain(`nextItem.quotedFare = Number.isNaN(Number(value)) ? nextItem.quotedFare : Number(value);`);
    expect(pageFile?.content).toContain(`Only agents may search business fares`);
    expect(pageFile?.content).toContain(`Blocked route`);
  });

  it('supports page metric blocks backed by read-model count surfaces', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: metric
      title: "Matching Flights"
      data: readModel.flightAvailability.count

readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
`,
      'rules/flight-availability.rules.loj': `
rules flightAvailability:
  eligibility business-only:
    when: input.cabin != BUSINESS || currentUser.role == "agent"
    message:
      defaultMessage: "Only agents may search business fares"
  validate origin-open:
    when: input.from != "BLOCKED"
    message: "Blocked route"
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');
    expect(pageFile?.content).toContain(`import { useReadModel } from '@loj-lang/rdsl-runtime/hooks/useReadModel';`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryFields = [`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryLocationOptions = { prefix: "flightAvailability" } as const;`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryLocationSyncOptions = { prefix: "flightAvailability", keys: ["from","cabin"] } as const;`);
    expect(pageFile?.content).toContain(`const [flightAvailabilityPageQuery, setFlightAvailabilityPageQueryState] = React.useState<Record<string, string>>(() => getLocationSearchValues(flightAvailabilityPageQueryDefaults, flightAvailabilityPageQueryLocationOptions));`);
    expect(pageFile?.content).toContain(`const setFlightAvailabilityPageQuery = React.useCallback((nextQueryState: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => {`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageQueryDeferred = React.useDeferredValue(flightAvailabilityPageQuery);`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageCanLoad = flightAvailabilityPageQueryEnabled && !flightAvailabilityPageEligibilityFailure && !flightAvailabilityPageValidationFailure;`);
    expect(pageFile?.content).toContain(`const flightAvailabilityPageReadModelOptions = React.useMemo(() => ({ enabled: flightAvailabilityPageCanLoad }), [flightAvailabilityPageCanLoad]);`);
    expect(pageFile?.content).toContain(`useReadModel<FlightAvailabilityReadModelItem>('/api/flights/search', flightAvailabilityPageQueryDeferred, flightAvailabilityPageReadModelOptions);`);
    expect(pageFile?.content).toContain(`const pageDashboardBlock0MetricCount = flightAvailabilityPageDashboardBlock0ReadModel.allData.length;`);
    expect(pageFile?.content).toContain(`FilterBar fields={flightAvailabilityPageQueryFields} values={flightAvailabilityPageQuery} onChange={setFlightAvailabilityPageQuery}`);
    expect(pageFile?.content).toContain(`Fill the required search inputs to load results`);
    expect(pageFile?.content).toContain(`Only agents may search business fares`);
    expect(pageFile?.content).toContain(`Blocked route`);
  });

  it('rejects unsupported allow/deny entries in frontend read-model rules', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
  result:
    flightNo: string
  list:
    columns:
      - flightNo
`,
      'rules/flight-availability.rules.loj': `
rules flightAvailability:
  allow get:
    when: currentUser.role == "agent"
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain(
      'Read-model "flightAvailability" rules do not support allow/deny auth entries; keep readModel access control to local page gating in the current frontend slice',
    );
  });

  it('rejects invalid read-model table rowActions', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list
      rowActions:
        - create:
            resource: bookings
            seed:
              travelDate:
                input: missingInput
              routeCode:
                row: missingField
              passengers:
                row: flightNo

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    travelDate: string @required
  result:
    flightNo: string
  list:
    columns:
      - flightNo

model Booking:
  travelDate: string
  routeCode: string
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  fullName: string
  booking: belongsTo(Booking)

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - travelDate
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Row action "Create Bookings" in page "availability" references unknown read-model input field "missingInput"',
      'Row action "Create Bookings" in page "availability" references unknown read-model result field "missingField"',
      'Row action "Create Bookings" in page "availability" may only seed fields already present in resource "bookings" create.fields; "routeCode" is not included',
      'Row action "Create Bookings" in page "availability" may only seed fields already present in resource "bookings" create.fields; "passengers" is not included',
      'Row action "Create Bookings" in page "availability" may only seed top-level scalar, enum, or belongsTo fields; "passengers" is not supported',
    ]));
  });

  it('supports grouped .rules.loj consumption on frontend create and edit views', () => {
    const files = {
      'app.web.loj': `
model Booking:
  status: enum(DRAFT, CONFIRMED)
  baseFare: number
  travelerCount: number
  quotedFare: number

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-create")'
  edit:
    fields:
      - status
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-edit")'
`,
      'rules/booking-create.rules.loj': `
rules bookingCreate:
  eligibility agent-only:
    when: currentUser.role == "agent"
    message: "Only agents may create bookings"
  validate traveler-count:
    when: formData.travelerCount > 0
    message: "Traveler count must be positive"
  derive quotedFare:
    value: formData.baseFare + 20
`,
      'rules/booking-edit.rules.loj': `
rules bookingEdit:
  eligibility editable:
    when: record.status != CONFIRMED
    message: "Confirmed bookings cannot be edited"
  validate traveler-count:
    when: formData.travelerCount > 0
    message: "Traveler count must be positive"
  derive quotedFare:
    value: formData.baseFare + 10
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    const editFile = result.files.find((file) => file.path === 'views/BookingsEdit.tsx');
    expect(createFile?.content).toContain(`import { evaluatePolicyExpr, firstPolicyFailure } from '@loj-lang/rdsl-runtime/policies/can';`);
    expect(createFile?.content).toContain(`const BookingsCreateLinkedEligibilityRules = [`);
    expect(createFile?.content).toContain(`const BookingsCreateLinkedValidationRules = [`);
    expect(createFile?.content).toContain(`const BookingsCreateLinkedDerivationRules = [`);
    expect(createFile?.content).toContain(`const linkedEligibilityRules = BookingsCreateLinkedEligibilityRules;`);
    expect(createFile?.content).toContain(`const linkedValidationRules = BookingsCreateLinkedValidationRules;`);
    expect(createFile?.content).toContain(`const linkedDerivationRules = BookingsCreateLinkedDerivationRules;`);
    expect(createFile?.content).toContain(`const linkedEligibilityFailure = firstPolicyFailure(linkedEligibilityRules, { currentUser, formData }, 'Forbidden');`);
    expect(createFile?.content).toContain(`const linkedValidationFailure = linkedEligibilityFailure ? null : firstPolicyFailure(linkedValidationRules, { currentUser, formData }, 'Invalid request');`);
    expect(createFile?.content).toContain(`nextFormData.quotedFare = Number.isNaN(Number(value)) ? nextFormData.quotedFare : Number(value);`);
    expect(createFile?.content).toContain(`linkedDerivedFieldNames.includes('quotedFare')`);
    expect(createFile?.content).toContain(`Only agents may create bookings`);
    expect(createFile?.content).toContain(`Traveler count must be positive`);
    expect(editFile?.content).toContain(`const linkedEligibilityFailure = firstPolicyFailure(linkedEligibilityRules, { currentUser, formData, record }, 'Forbidden');`);
    expect(editFile?.content).toContain(`const linkedValidationFailure = linkedEligibilityFailure ? null : firstPolicyFailure(linkedValidationRules, { currentUser, formData, record }, 'Invalid request');`);
    expect(editFile?.content).toContain(`nextFormData.quotedFare = Number.isNaN(Number(value)) ? nextFormData.quotedFare : Number(value);`);
    expect(editFile?.content).toContain(`linkedDerivedFieldNames.includes('quotedFare')`);
    expect(editFile?.content).toContain(`Confirmed bookings cannot be edited`);
  });

  it('rejects unsupported allow/deny entries in frontend create rules links', () => {
    const files = {
      'app.web.loj': `
model Booking:
  baseFare: number

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - baseFare
    rules: '@rules("./rules/booking-create")'
`,
      'rules/booking-create.rules.loj': `
rules bookingCreate:
  allow create:
    when: currentUser.role == "agent"
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain(
      'Resource "bookings" create.rules do not support allow/deny auth entries; keep generated form rules to eligibility, validate, and derive in the current frontend slice',
    );
  });

  it('supports repeated-child create/edit includes linked to grouped rules', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, CONFIRMED)
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  ageGroup: enum(adult, infant)
  seatPreference: string
  booking: belongsTo(Booking) @required

resource passengers:
  model: Passenger
  api: /api/passengers

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - ageGroup
          - seatPreference
        rules: '@rules("./rules/passenger-create")'
  edit:
    fields:
      - reference
      - status
    includes:
      - field: passengers
        fields:
          - name
          - ageGroup
          - seatPreference
        rules: '@rules("./rules/passenger-edit")'
`,
      'rules/passenger-create.rules.loj': `
rules passengerCreate:
  eligibility passenger-seat:
    when: item.ageGroup != "infant"
    message: "Infants need manual seat assignment"
  validate passenger-name:
    when: item.name != ""
    message: "Passenger name is required"
  derive seatPreference:
    value: '"auto"'
`,
      'rules/passenger-edit.rules.loj': `
rules passengerEdit:
  eligibility editable:
    when: record.status != CONFIRMED
    message: "Confirmed bookings cannot change passengers"
  validate passenger-name:
    when: item.name != ""
    message: "Passenger name is required"
  derive seatPreference:
    value: '"edited"'
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const createFile = result.files.find((file) => file.path === 'views/BookingsCreate.tsx');
    const editFile = result.files.find((file) => file.path === 'views/BookingsEdit.tsx');
    expect(createFile?.content).toContain(`const BookingsCreatePassengersLinkedEligibilityRules = [`);
    expect(createFile?.content).toContain(`const BookingsCreatePassengersLinkedValidationRules = [`);
    expect(createFile?.content).toContain(`const BookingsCreatePassengersLinkedDerivationRules = [`);
    expect(createFile?.content).toContain(`const passengersLinkedEligibilityRules = BookingsCreatePassengersLinkedEligibilityRules;`);
    expect(createFile?.content).toContain(`const passengersLinkedValidationRules = BookingsCreatePassengersLinkedValidationRules;`);
    expect(createFile?.content).toContain(`const passengersLinkedDerivationRules = BookingsCreatePassengersLinkedDerivationRules;`);
    expect(createFile?.content).toContain(`const passengersLinkedValidationFailures = (formData.passengers ?? []).map((item, index) => passengersLinkedEligibilityFailures[index] ? null : firstPolicyFailure(passengersLinkedValidationRules, { currentUser, formData, item }, 'Invalid request'));`);
    expect(createFile?.content).toContain(`evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData, item: nextItem })`);
    expect(createFile?.content).toContain(`const linkedIncludeFailure = [passengersLinkedFailure].find((failure) => Boolean(failure)) ?? null;`);
    expect(createFile?.content).toContain(`toast.error(linkedIncludeFailure);`);
    expect(createFile?.content).toContain(`passengersLinkedDerivedFieldNames.includes('seatPreference')`);
    expect(createFile?.content).toContain(`Infants need manual seat assignment`);
    expect(editFile?.content).toContain(`const passengersLinkedEligibilityFailures = (formData.passengers ?? []).map((item) => firstPolicyFailure(passengersLinkedEligibilityRules, { currentUser, formData, record, item }, 'Forbidden'));`);
    expect(editFile?.content).toContain(`evaluatePolicyExpr(derivation.value, { currentUser, formData: nextFormData, record, item: nextItem })`);
    expect(editFile?.content).toContain(`passengersLinkedDerivedFieldNames.includes('seatPreference')`);
    expect(editFile?.content).toContain(`Confirmed bookings cannot change passengers`);
  });

  it('rejects unsupported allow/deny entries in frontend repeated-child rules links', () => {
    const files = {
      'app.web.loj': `
model Booking:
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource passengers:
  model: Passenger
  api: /api/passengers

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields: []
    includes:
      - field: passengers
        fields:
          - name
        rules: '@rules("./rules/passenger-create")'
`,
      'rules/passenger-create.rules.loj': `
rules passengerCreate:
  allow create:
    when: currentUser.role == "agent"
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain(
      'Resource "bookings" create.includes.passengers.rules do not support allow/deny auth entries; keep repeated-child generated rules to eligibility, validate, and derive in the current frontend slice',
    );
  });

  it('rejects unknown read-model metric references on pages', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: metric
      title: "Matching Flights"
      data: readModel.flightAvailability.count
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain(
      'Metric block "Matching Flights" in page "dashboard" references unknown read-model "flightAvailability"',
    );
  });

  it('supports record-scoped relation page table blocks', () => {
    const source = `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: table
      title: "Members"
      data: teams.members

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamOverviewPage.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');
    expect(pageFile?.content).toContain(`interface TeamOverviewPageProps {`);
    expect(pageFile?.content).toContain(`export const TeamOverviewPage = React.memo(function TeamOverviewPage({ id }: TeamOverviewPageProps) {`);
    expect(pageFile?.content).toContain(`const returnToSearchParams = getLocationSearchParams();`);
    expect(pageFile?.content).toContain(`const returnTo = getSanitizedReturnTo(returnToSearchParams);`);
    expect(pageFile?.content).toContain(`const backHref = returnTo || prefixAppBasePath(\`/teams/\${id}\`);`);
    expect(pageFile?.content).toContain(`const parentReadHref = prefixAppBasePath(\`/teams/\${id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View Team</a> : null}`);
    expect(pageFile?.content).toContain(`{backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
    expect(pageFile?.content).toContain(`const TeamOverviewPageResourceOptions = { pageSize: 1000 } as const;`);
    expect(pageFile?.content).toContain(`const usersPageTeamOverviewBlock0TableResource = useResource<User>('/api/users', TeamOverviewPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0Items = React.useMemo(() => usersPageTeamOverviewBlock0TableResource.allData.filter((item) => String(item.team ?? '') === String(id)), [usersPageTeamOverviewBlock0TableResource.allData, id]);`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0TableData = React.useMemo(() => pageTeamOverviewBlock0Items.map((record) => ({`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0TableViewOptions = { pageSize: 10, paginate: true } as const;`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0TableView = useCollectionView<User>(pageTeamOverviewBlock0TableData, pageTeamOverviewBlock0TableViewOptions);`);
    expect(pageFile?.content).toContain(`href={prefixAppBasePath("/users/create") + "?" + "team=" + encodeURIComponent(String(id)) + "&" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0TableViewFiltersWithTransition = React.useCallback((nextFilters: Parameters<typeof pageTeamOverviewBlock0TableView.setFilters>[0]) => {`);
    expect(pageFile?.content).toContain(`FilterBar fields={pageTeamOverviewBlock0FilterFields} values={pageTeamOverviewBlock0TableView.filters} onChange={pageTeamOverviewBlock0TableViewFiltersWithTransition}`);
    expect(pageFile?.content).toContain(`const pageTeamOverviewBlock0TableActions = React.useMemo<Array<DataTableAction<User>>>(() => [{ label: 'View', href: (row) => prefixAppBasePath(\`/users/\${row.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()) }, { label: 'Delete', onClick: (row) => pageTeamOverviewBlock0DeleteRequest(row.id), variant: 'danger' }], [pageTeamOverviewBlock0DeleteRequest]);`);
    expect(pageFile?.content).toContain(`actions={pageTeamOverviewBlock0TableActions}`);
    expect(routerFile?.content).toContain(`{ path: '/teams/:id/overview', component: TeamOverviewPage },`);
  });

  it('falls back to a label-list for record-scoped relation page table blocks when the target resource has no list', () => {
    const source = `
page teamMembers:
  title: "Team Members"
  path: /teams/:id/members
  blocks:
    - type: table
      title: "Members"
      data: teams.members

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  read:
    fields:
      - name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamMembersPage.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');
    expect(pageFile?.content).toContain(`const backHref = returnTo || prefixAppBasePath(\`/teams/\${id}\`);`);
    expect(pageFile?.content).toContain(`const parentReadHref = prefixAppBasePath(\`/teams/\${id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View Team</a> : null}`);
    expect(pageFile?.content).toContain(`{backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
    expect(pageFile?.content).toContain(`const TeamMembersPageResourceOptions = { pageSize: 1000 } as const;`);
    expect(pageFile?.content).toContain(`const usersPageTeamMembersBlock0TableResource = useResource<User>('/api/users', TeamMembersPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const pageTeamMembersBlock0Items = React.useMemo(() => usersPageTeamMembersBlock0TableResource.allData.filter((item) => String(item.team ?? '') === String(id)), [usersPageTeamMembersBlock0TableResource.allData, id]);`);
    expect(pageFile?.content).toContain(`          <ul className="rdsl-related-list">`);
    expect(pageFile?.content).toContain(`                  <a href={prefixAppBasePath(\`/users/\${item.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref())}>{String(item.name ?? item.id)}</a>`);
    expect(pageFile?.content).not.toContain(`import { DataTable }`);
    expect(pageFile?.content).not.toContain(`useCollectionView<`);
    expect(routerFile?.content).toContain(`{ path: '/teams/:id/members', component: TeamMembersPage },`);
  });

  it('supports record-scoped relation page metric count blocks', () => {
    const source = `
page teamMetrics:
  title: "Team Metrics"
  path: /teams/:id/metrics
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
  edit:
    fields:
      - name

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamMetricsPage.tsx');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');
    expect(pageFile?.content).toContain(`import { useResource } from '@loj-lang/rdsl-runtime/hooks/useResource';`);
    expect(pageFile?.content).toContain(`interface TeamMetricsPageProps {`);
    expect(pageFile?.content).toContain(`export const TeamMetricsPage = React.memo(function TeamMetricsPage({ id }: TeamMetricsPageProps) {`);
    expect(pageFile?.content).toContain(`const backHref = returnTo || prefixAppBasePath(\`/teams/\${id}\`);`);
    expect(pageFile?.content).toContain(`const parentReadHref = prefixAppBasePath(\`/teams/\${id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View Team</a> : null}`);
    expect(pageFile?.content).toContain(`const parentEditHref = prefixAppBasePath(\`/teams/\${id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentEditHref ? <a href={parentEditHref} className="rdsl-btn rdsl-btn-primary">Edit Team</a> : null}`);
    expect(pageFile?.content).toContain(`{backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
    expect(pageFile?.content).toContain(`const TeamMetricsPageResourceOptions = { pageSize: 1000 } as const;`);
    expect(pageFile?.content).toContain(`const usersPageTeamMetricsBlock0MetricResource = useResource<User>('/api/users', TeamMetricsPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const pageTeamMetricsBlock0Items = React.useMemo(() => usersPageTeamMetricsBlock0MetricResource.allData.filter((item) => String(item.team ?? '') === String(id)), [usersPageTeamMetricsBlock0MetricResource.allData, id]);`);
    expect(pageFile?.content).toContain(`const pageTeamMetricsBlock0MetricCount = pageTeamMetricsBlock0Items.length;`);
    expect(pageFile?.content).toContain(`{usersPageTeamMetricsBlock0MetricResource.loading ? '—' : pageTeamMetricsBlock0MetricCount}`);
    expect(routerFile?.content).toContain(`{ path: '/teams/:id/metrics', component: TeamMetricsPage },`);
  });

  it('shares record-scoped relation resources and filtered items across table and metric page blocks', () => {
    const source = `
page teamMembers:
  title: "Team Members"
  path: /teams/:id/members
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count
    - type: metric
      title: "Again"
      data: teams.members.count
    - type: table
      title: "Members"
      data: teams.members

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamMembersPage.tsx');
    expect(pageFile?.content).toContain(`const TeamMembersPageResourceOptions = { pageSize: 1000 } as const;`);
    expect((pageFile?.content.match(/useResource<User>\('\/api\/users', TeamMembersPageResourceOptions\);/g) ?? [])).toHaveLength(1);
    expect(pageFile?.content).toContain(`const pageTeamMembersBlock2Items = React.useMemo(() => usersPageTeamMembersBlock2TableResource.allData.filter((item) => String(item.team ?? '') === String(id)), [usersPageTeamMembersBlock2TableResource.allData, id]);`);
    expect(pageFile?.content).toContain(`const pageTeamMembersBlock0MetricCount = pageTeamMembersBlock2Items.length;`);
    expect(pageFile?.content).toContain(`const pageTeamMembersBlock1MetricCount = pageTeamMembersBlock2Items.length;`);
  });

  it('falls back to the parent list route for record-scoped relation page back links when the parent resource has no read view', () => {
    const source = `
page teamMetrics:
  title: "Team Metrics"
  path: /teams/:id/metrics
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - name

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamMetricsPage.tsx');
    expect(pageFile?.content).toContain(`const backHref = returnTo || prefixAppBasePath("/teams");`);
    expect(pageFile?.content).toContain(`{backHref ? <a href={backHref} className="rdsl-btn rdsl-btn-secondary">Back</a> : null}`);
  });

  it('reuses parent edit routes in record-scoped relation page headers', () => {
    const source = `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
  edit:
    fields:
      - name

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamOverviewPage.tsx');
    expect(pageFile?.content).toContain(`const parentReadHref = prefixAppBasePath(\`/teams/\${id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`const parentEditHref = prefixAppBasePath(\`/teams/\${id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View Team</a> : null}`);
    expect(pageFile?.content).toContain(`{parentEditHref ? <a href={parentEditHref} className="rdsl-btn rdsl-btn-primary">Edit Team</a> : null}`);
  });

  it('surfaces parent workflow summaries in record-scoped relation page headers when the parent resource is workflow-linked', () => {
    const files = {
      'app.web.loj': `
page bookingTravelers:
  title: "Booking Travelers"
  path: /bookings/:id/travelers
  blocks:
    - type: table
      title: "Travelers"
      data: bookings.travelers

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)
  travelers: hasMany(Traveler, by: booking)

model Traveler:
  name: string @required
  booking: belongsTo(Booking)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  read:
    fields:
      - reference
  edit:
    fields:
      - reference

resource travelers:
  model: Traveler
  api: /api/travelers
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - name
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  wizard:
    steps:
      - name: enter_booking
        completesWith: DRAFT
      - name: confirm_booking
        completesWith: READY
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/BookingTravelersPage.tsx');
    expect(pageFile?.content).toContain(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
    expect(pageFile?.content).toContain(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
    expect(pageFile?.content).toContain(`import type { WorkflowStateSummaryDescriptor } from '@loj-lang/shared-contracts';`);
    expect(pageFile?.content).toContain(`type RecordScopedParentWorkflowSummary = WorkflowStateSummaryDescriptor;`);
    expect(pageFile?.content).toContain(`const bookingTravelersParentWorkflow = React.useMemo<RecordScopedParentWorkflowSummary | null>(() => bookingTravelersParentRecord ? ({`);
    expect(pageFile?.content).toContain(`          {bookingTravelersParentWorkflow ? <p>{bookingTravelersParentWorkflow.currentStateLabel}</p> : null}`);
    expect(pageFile?.content).toContain(`          {bookingTravelersParentWorkflow?.workflowHref ? <a href={bookingTravelersParentWorkflow.workflowHref} className="rdsl-btn rdsl-btn-secondary">Workflow</a> : null}`);
  });

  it('passes record-scoped route context into custom blocks on relation pages', () => {
    const source = `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count
    - type: table
      title: "Members"
      data: teams.members
    - type: custom
      title: "Summary"
      custom: "./components/TeamSummary.tsx"

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
  edit:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
    actions:
      - create
      - view
      - edit
  read:
    fields:
      - name
  edit:
    fields:
      - name
      - team @select
  create:
    fields:
      - name
      - team @select
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/TeamOverviewPage.tsx');
    expect(pageFile?.content).toContain(`import TeamSummary from '../components/TeamSummary';`);
    expect(pageFile?.content).toContain(`import type {`);
    expect(pageFile?.content).toContain(`RelationContextItemDescriptor`);
    expect(pageFile?.content).toContain(`RecordScopedCustomBlockContextDescriptor`);
    expect(pageFile?.content).toContain(`from '@loj-lang/shared-contracts';`);
    expect(pageFile?.content).toContain(`type RecordScopedRelationContextItem = RelationContextItemDescriptor;`);
    expect(pageFile?.content).toContain(`type RecordScopedCustomBlockProps<TParentRecord = unknown> = RecordScopedCustomBlockContextDescriptor<TParentRecord>;`);
    expect(pageFile?.content).toContain(`import type { Team } from '../models/Team';`);
    expect(pageFile?.content).toContain(`const TeamOverviewPageResourceOptions = { pageSize: 1000 } as const;`);
    expect(pageFile?.content).toContain(`const teamOverviewParentResource = useResource<Team>('/api/teams', TeamOverviewPageResourceOptions);`);
    expect(pageFile?.content).toContain(`const teamOverviewParentRecord = React.useMemo(() => teamOverviewParentResource.allData.find((item) => String(item.id) === String(id)) ?? null, [teamOverviewParentResource.allData, id]);`);
    expect(pageFile?.content).toContain(`const parentReadHref = prefixAppBasePath(\`/teams/\${id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`const parentEditHref = prefixAppBasePath(\`/teams/\${id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref());`);
    expect(pageFile?.content).toContain(`{parentReadHref ? <a href={parentReadHref} className="rdsl-btn rdsl-btn-secondary">View Team</a> : null}`);
    expect(pageFile?.content).toContain(`{parentEditHref ? <a href={parentEditHref} className="rdsl-btn rdsl-btn-primary">Edit Team</a> : null}`);
    expect(pageFile?.content).toContain(`const teamOverviewRelationContexts = React.useMemo<RecordScopedRelationContextItem[]>(() => [`);
    expect(pageFile?.content).toContain(`{ field: 'members', title: "Members", surfaceKind: 'table', targetResource: 'users', targetModel: 'User', count: pageTeamOverviewBlock1Items.length, items: pageTeamOverviewBlock1Items.map((item) => ({ id: String(item.id), label: String(item.name ?? item.id), viewHref: prefixAppBasePath(\`/users/\${item.id}\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()), editHref: prefixAppBasePath(\`/users/\${item.id}/edit\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()), workflowHref: null, workflowStateLabel: null })), createHref: prefixAppBasePath("/users/create") + "?" + "team=" + encodeURIComponent(String(id)) + "&" + "returnTo=" + encodeURIComponent(getCurrentAppHref()), loading: usersPageTeamOverviewBlock1TableResource.loading, error: Boolean(usersPageTeamOverviewBlock1TableResource.error) },`);
    expect(pageFile?.content).toContain(`const TeamSummaryRecordScopedBlock = TeamSummary as React.ComponentType<RecordScopedCustomBlockProps<Team>>;`);
    expect(pageFile?.content).toContain(`<TeamSummaryRecordScopedBlock recordId={id} returnTo={returnTo} backHref={backHref} parentReadHref={parentReadHref} parentEditHref={parentEditHref} parentRecord={teamOverviewParentRecord} parentLoading={teamOverviewParentResource.loading} parentError={Boolean(teamOverviewParentResource.error)} parentWorkflow={null} relations={teamOverviewRelationContexts} />`);
  });

  it('passes parent workflow summaries into custom blocks on relation pages when the parent resource is workflow-linked', () => {
    const files = {
      'app.web.loj': `
page bookingOverview:
  title: "Booking Overview"
  path: /bookings/:id/overview
  blocks:
    - type: metric
      title: "Traveler Count"
      data: bookings.travelers.count
    - type: table
      title: "Travelers"
      data: bookings.travelers
    - type: custom
      title: "Summary"
      custom: "./components/BookingSummary.tsx"

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)
  travelers: hasMany(Traveler, by: booking)

model Traveler:
  name: string @required
  booking: belongsTo(Booking)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  read:
    fields:
      - reference
  edit:
    fields:
      - reference

resource travelers:
  model: Traveler
  api: /api/travelers
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - name
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  wizard:
    steps:
      - name: enter_booking
        completesWith: DRAFT
      - name: confirm_booking
        completesWith: READY
        allow: currentUser.role == "admin"
  transitions:
    confirm:
      from: DRAFT
      to: READY
      allow: currentUser.role == "admin"
    ticket:
      from: READY
      to: TICKETED
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/BookingOverviewPage.tsx');
    expect(pageFile?.content).toContain(`import { useAuth } from '@loj-lang/rdsl-runtime/hooks/useAuth';`);
    expect(pageFile?.content).toContain(`import { can } from '@loj-lang/rdsl-runtime/policies/can';`);
    expect(pageFile?.content).toContain(`import type {`);
    expect(pageFile?.content).toContain(`WorkflowStateSummaryDescriptor`);
    expect(pageFile?.content).toContain(`RelationContextItemDescriptor`);
    expect(pageFile?.content).toContain(`RecordScopedCustomBlockContextDescriptor`);
    expect(pageFile?.content).toContain(`from '@loj-lang/shared-contracts';`);
    expect(pageFile?.content).toContain(`type RecordScopedParentWorkflowSummary = WorkflowStateSummaryDescriptor;`);
    expect(pageFile?.content).toContain(`type RecordScopedRelationContextItem = RelationContextItemDescriptor;`);
    expect(pageFile?.content).toContain(`type RecordScopedCustomBlockProps<TParentRecord = unknown> = RecordScopedCustomBlockContextDescriptor<TParentRecord>;`);
    expect(pageFile?.content).toContain(`const { currentUser } = useAuth();`);
    expect(pageFile?.content).toContain(`const bookingOverviewParentWorkflow = React.useMemo<RecordScopedParentWorkflowSummary | null>(() => bookingOverviewParentRecord ? ({`);
    expect(pageFile?.content).toContain(`field: 'status',`);
    expect(pageFile?.content).toContain(`workflowHref: prefixAppBasePath(\`/bookings/\${id}/workflow\`) + "?" + "returnTo=" + encodeURIComponent(getCurrentAppHref()),`);
    expect(pageFile?.content).toContain(`steps: bookingOverviewParentVisibleWorkflowSteps.map((step, index) => ({`);
    expect(pageFile?.content).toContain(`transitions: bookingOverviewParentAvailableWorkflowTransitions.map((transition) => ({`);
    expect(pageFile?.content).toContain(`toLabel: bookingOverviewParentWorkflowStates.find((state) => state.name === transition.to)?.label ?? transition.to,`);
    expect(pageFile?.content).toContain(`          {bookingOverviewParentWorkflow ? <p>{bookingOverviewParentWorkflow.currentStateLabel}</p> : null}`);
    expect(pageFile?.content).toContain(`          {bookingOverviewParentWorkflow?.workflowHref ? <a href={bookingOverviewParentWorkflow.workflowHref} className="rdsl-btn rdsl-btn-secondary">Workflow</a> : null}`);
    expect(pageFile?.content).toContain(`<BookingSummaryRecordScopedBlock recordId={id} returnTo={returnTo} backHref={backHref} parentReadHref={parentReadHref} parentEditHref={parentEditHref} parentRecord={bookingOverviewParentRecord} parentLoading={bookingOverviewParentResource.loading} parentError={Boolean(bookingOverviewParentResource.error)} parentWorkflow={bookingOverviewParentWorkflow} relations={bookingOverviewRelationContexts} />`);
  });

  it('rejects invalid record-scoped relation page table blocks', () => {
    const source = `
page teamMembersNoPath:
  title: "Members"
  blocks:
    - type: table
      title: "Members"
      data: teams.members

page teamMembersWrongPath:
  title: "Members"
  path: /users/:id/overview
  blocks:
    - type: table
      title: "Members"
      data: teams.members

page staticCustomRoute:
  title: "Static"
  path: /overview
  blocks:
    - type: table
      title: "Users"
      data: users.list

page invalidRelation:
  title: "Invalid"
  path: /teams/:id/invalid
  blocks:
    - type: table
      title: "Invalid"
      data: teams.name

app:
  name: "Bad Pages"
  navigation:
    - group: "Pages"
      items:
        - label: "Members"
          target: page.teamMembersWrongPath

model Team:
  name: string
  members: hasMany(User, by: team)

model User:
  name: string
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - name
      - team
  edit:
    fields:
      - name
    onSuccess:
      - redirect: page.teamMembersWrongPath
  list:
    columns:
      - name
  read:
    fields:
      - name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Page "teamMembersNoPath" contains record-scoped relation blocks and must set path: /teams/:id/...',
      'Page "teamMembersWrongPath" path "/users/:id/overview" must start with "/teams/:id" to scope data: teams.<relation>',
      'Page "staticCustomRoute" uses path: but page-scoped params are currently only supported for relation blocks using data: <resource>.<hasManyField> or data: <resource>.<hasManyField>.count',
      'Page "invalidRelation" uses path: but page-scoped params are currently only supported for relation blocks using data: <resource>.<hasManyField> or data: <resource>.<hasManyField>.count',
      'Table block "Invalid" in page "invalidRelation" must reference a hasMany(..., by: ...) field; "name" on resource "teams" is not one',
      'Navigation target references page "teamMembersWrongPath" with record-scoped path "/users/:id/overview"; current navigation targets only support static page routes',
    ]));
  });

  it('rejects invalid record-scoped relation page metric count blocks', () => {
    const source = `
page teamMetricNoPath:
  title: "Metrics"
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count

page invalidMetric:
  title: "Invalid Metric"
  path: /teams/:id/metrics
  blocks:
    - type: metric
      title: "Invalid Count"
      data: teams.name.count

model Team:
  name: string
  members: hasMany(User, by: team)

model User:
  name: string
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Page "teamMetricNoPath" contains record-scoped relation blocks and must set path: /teams/:id/...',
      'Page "invalidMetric" uses path: but page-scoped params are currently only supported for relation blocks using data: <resource>.<hasManyField> or data: <resource>.<hasManyField>.count',
      'Metric block "Invalid Count" in page "invalidMetric" must reference a hasMany(..., by: ...) field; "name" on resource "teams" is not one',
    ]));
  });

  it('rejects invalid page table block data refs', () => {
    const source = `
page dashboard:
  title: "Overview"
  blocks:
    - type: table
      title: "Broken Ref"
      data: users
    - type: table
      title: "No Data"
    - type: table
      title: "Missing List"
      data: teams.list
    - type: table
      title: "Missing Resource"
      data: projects.list
    - type: table
      title: "Missing Read Model"
      data: readModel.flights.list

model Team:
  name: string

model User:
  name: string

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'Table block "Broken Ref" in page "dashboard" must use data: <resource>.list, data: readModel.<name>.list, or data: <resource>.<hasManyField>; got "users"',
      'Table block "No Data" in page "dashboard" must set data: <resource>.list, data: readModel.<name>.list, or data: <resource>.<hasManyField>',
      'Table block "Missing List" in page "dashboard" requires resource "teams" to define list:',
      'Table block "Missing Resource" in page "dashboard" references unknown resource "projects"',
      'Table block "Missing Read Model" in page "dashboard" references unknown read-model "flights"',
    ]));
  });

  it('resolves extensionless module @fn() paths and records logical ids in host-file manifests', () => {
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: createVfs({
        'app.web.loj': `
app:
  name: "Escapes"

imports:
  - ./resources/users.web.loj
`,
        'resources/users.web.loj': `
model User:
  name: string

resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
    rules:
      allowIf: '@fn("./logic/canEditUser")'
    onSuccess:
      - toast: "Saved"
`,
        'resources/logic/canEditUser.ts': `
export default function canEditUser() {
  return true;
}
`,
      }),
    });

    expect(result.success).toBe(true);
    const rule = result.ir?.resources[0].views.edit?.rules?.allowIf;
    expect(rule?.source).toBe('escape-fn');
    if (rule?.source === 'escape-fn') {
      expect(rule.escape.path).toBe('resources/logic/canEditUser.ts');
      expect(rule.escape.logicalPath).toBe('./logic/canEditUser');
      expect(rule.escape.lockIn).toBe('neutral');
    }
    expect(result.semanticManifest?.hostFiles).toEqual([
      {
        path: 'resources/logic/canEditUser.ts',
        references: [
          {
            nodeId: 'resource.users.view.edit',
            role: 'rule.allowIf',
            sourceFile: 'resources/users.web.loj',
            logicalPath: './logic/canEditUser',
            lockIn: 'neutral',
          },
        ],
      },
    ]);

    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    expect(editFile?.content).toContain("import canEditUser from '../resources/logic/canEditUser';");
  });

  it('records transitive host script and css dependencies in semantic manifests', () => {
    const result = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs({
        'app.rdsl': `
app:
  name: "Escapes"

imports:
  - ./resources/users.rdsl
`,
        'resources/users.rdsl': `
model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - avatar @custom("./components/AvatarCell.tsx")
`,
        'resources/components/AvatarCell.tsx': `
import './AvatarCell.css';
import { AvatarBadge } from './AvatarBadge';

export default function AvatarCell() {
  return AvatarBadge();
}
`,
        'resources/components/AvatarBadge.tsx': `
import '../styles/avatarBadge.module.css';

export function AvatarBadge() {
  return null;
}
`,
        'resources/components/AvatarCell.css': `.avatar-cell { display: grid; }\n`,
        'resources/styles/avatarBadge.module.css': `.badge { color: red; }\n`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.semanticManifest?.hostFiles).toEqual([
      {
        path: 'resources/components/AvatarCell.tsx',
        references: [
          {
            nodeId: 'resource.users.view.list.column.avatar',
            role: 'column.customRenderer',
            sourceFile: 'resources/users.rdsl',
          },
        ],
        dependencies: [
          {
            path: 'resources/components/AvatarBadge.tsx',
            kind: 'script',
            importers: ['resources/components/AvatarCell.tsx'],
          },
          {
            path: 'resources/components/AvatarCell.css',
            kind: 'style',
            importers: ['resources/components/AvatarCell.tsx'],
          },
          {
            path: 'resources/styles/avatarBadge.module.css',
            kind: 'style',
            importers: ['resources/components/AvatarBadge.tsx'],
          },
        ],
      },
    ]);
  });

  it('rescans host dependency metadata when a referenced host file changes', () => {
    const cache = createProjectCache();
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Escapes"

imports:
  - ./resources/users.rdsl
`,
      'resources/users.rdsl': `
model User:
  name: string

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - avatar @custom("./components/AvatarCell.tsx")
`,
      'resources/components/AvatarCell.tsx': `
import './AvatarCell.css';

export default function AvatarCell() {
  return null;
}
`,
      'resources/components/AvatarCell.css': `.avatar-cell { display: grid; }\n`,
      'resources/components/AvatarCell.next.css': `.avatar-cell { display: flex; }\n`,
    };

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs(files),
      cache,
    });
    expect(first.success).toBe(true);
    expect(first.semanticManifest?.hostFiles?.[0]?.dependencies).toEqual([
      {
        path: 'resources/components/AvatarCell.css',
        kind: 'style',
        importers: ['resources/components/AvatarCell.tsx'],
      },
    ]);

    files['resources/components/AvatarCell.tsx'] = `
import './AvatarCell.next.css';

export default function AvatarCell() {
  return null;
}
`;

    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs(files),
      cache,
      changedFiles: ['resources/components/AvatarCell.tsx'],
    });
    expect(second.success).toBe(true);
    expect(second.semanticManifest?.hostFiles?.[0]?.dependencies).toEqual([
      {
        path: 'resources/components/AvatarCell.next.css',
        kind: 'style',
        importers: ['resources/components/AvatarCell.tsx'],
      },
    ]);
  });

  it('records transitive host css dependencies for project-relative custom files under nested entry roots', () => {
    const result = compileProject({
      entryFile: 'frontend/app.web.loj',
      readFile: createVfs({
        'frontend/app.web.loj': `
app:
  name: "Escapes"

imports:
  - ./pages/availability.web.loj
`,
        'frontend/pages/availability.web.loj': `
page availability:
  title: "Availability"
  blocks:
    - type: custom
      custom: "../components/ProofCssMount.tsx"
`,
        'frontend/components/ProofCssMount.tsx': `
import './proof-overrides.css';

export function ProofCssMount() {
  return null;
}
`,
        'frontend/components/proof-overrides.css': `.proof-mount { display: none; }\n`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.semanticManifest?.hostFiles).toEqual([
      {
        path: 'components/ProofCssMount.tsx',
        references: [
          {
            nodeId: 'page.availability.block.0',
            role: 'block.customBlock',
            sourceFile: 'frontend/pages/availability.web.loj',
            logicalPath: undefined,
            lockIn: undefined,
          },
        ],
        dependencies: [
          {
            path: 'components/proof-overrides.css',
            kind: 'style',
            importers: ['components/ProofCssMount.tsx'],
          },
        ],
      },
    ]);
  });

  it('reuses cached project units and only reloads invalidated .rdsl files', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Cached"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
    };
    const readCounts = new Map<string, number>();
    const cache = createProjectCache();
    const readFile = (fileName: string) => {
      const normalized = fileName.replace(/\\/g, '/');
      readCounts.set(normalized, (readCounts.get(normalized) ?? 0) + 1);
      const source = files[normalized];
      if (source === undefined) {
        throw new Error(`ENOENT: ${normalized}`);
      }
      return source;
    };

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    expect(readCounts).toEqual(new Map([
      ['app.rdsl', 1],
      ['models/user.rdsl', 1],
      ['resources/users.rdsl', 1],
    ]));

    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(second.success).toBe(true);
    expect(readCounts).toEqual(new Map([
      ['app.rdsl', 1],
      ['models/user.rdsl', 1],
      ['resources/users.rdsl', 1],
    ]));

    files['models/user.rdsl'] = `
model User:
  name: string
  email: string
`;

    const third = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['models/user.rdsl'],
    });
    expect(third.success).toBe(true);
    expect(readCounts).toEqual(new Map([
      ['app.rdsl', 1],
      ['models/user.rdsl', 2],
      ['resources/users.rdsl', 1],
    ]));
    expect(third.ir?.models[0].fields.map((field) => field.name)).toEqual(['name', 'email']);
  });

  it('tracks cached project graphs across module failures and entry import changes', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Graph Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    expect(cache.graphs.get('app.rdsl')).toEqual({
      entryFile: 'app.rdsl',
      sourceFiles: ['app.rdsl', 'models/user.rdsl', 'resources/users.rdsl'],
      scanDirectories: [],
      moduleGraph: {
        'app.rdsl': ['models/user.rdsl', 'resources/users.rdsl'],
        'models/user.rdsl': [],
        'resources/users.rdsl': [],
      },
      hasErrors: false,
    });

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: [
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(false);
    expect(second.errors.some((error) => error.phase === 'parse' && error.file === 'resources/users.rdsl')).toBe(true);
    expect(cache.graphs.get('app.rdsl')).toEqual({
      entryFile: 'app.rdsl',
      sourceFiles: ['app.rdsl', 'models/user.rdsl', 'resources/users.rdsl'],
      scanDirectories: [],
      moduleGraph: {
        'app.rdsl': ['models/user.rdsl', 'resources/users.rdsl'],
        'models/user.rdsl': [],
        'resources/users.rdsl': [],
      },
      hasErrors: true,
    });

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`;
    files['app.rdsl'] = `
app:
  name: "Graph Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`;
    const third = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['app.rdsl', 'resources/users.rdsl'],
    });
    expect(third.success).toBe(true);
    expect(cache.graphs.get('app.rdsl')).toEqual({
      entryFile: 'app.rdsl',
      sourceFiles: ['app.rdsl', 'models/user.rdsl', 'resources/users.rdsl', 'pages/dashboard.rdsl'],
      scanDirectories: [],
      moduleGraph: {
        'app.rdsl': ['models/user.rdsl', 'resources/users.rdsl', 'pages/dashboard.rdsl'],
        'models/user.rdsl': [],
        'resources/users.rdsl': [],
        'pages/dashboard.rdsl': [],
      },
      hasErrors: false,
    });
    expect(third.semanticManifest?.sourceFiles).toEqual([
      'app.rdsl',
      'models/user.rdsl',
      'resources/users.rdsl',
      'pages/dashboard.rdsl',
    ]);
  });

  it('relinks the project graph when a scanned directory gains a new module', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Directory Graph Cache"

imports:
  - ./pages/
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const cache = createProjectCache();

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
      cache,
    });
    expect(first.success).toBe(true);
    expect(cache.graphs.get('app.rdsl')).toEqual({
      entryFile: 'app.rdsl',
      sourceFiles: ['app.rdsl', 'pages/dashboard.rdsl'],
      scanDirectories: ['pages'],
      moduleGraph: {
        'app.rdsl': ['pages/dashboard.rdsl'],
        'pages/dashboard.rdsl': [],
      },
      hasErrors: false,
    });

    files['pages/settings.rdsl'] = `
page settings:
  title: "Settings"
  type: dashboard
  blocks:
    - type: metric
      title: "Admins"
`;

    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
      cache,
      changedFiles: ['pages/settings.rdsl'],
    });
    expect(second.success).toBe(true);
    expect(second.semanticManifest?.sourceFiles).toEqual([
      'app.rdsl',
      'pages/dashboard.rdsl',
      'pages/settings.rdsl',
    ]);
    expect(second.semanticManifest?.moduleGraph).toEqual({
      'app.rdsl': ['pages/dashboard.rdsl', 'pages/settings.rdsl'],
      'pages/dashboard.rdsl': [],
      'pages/settings.rdsl': [],
    });
  });

  it('reuses unchanged outputs when entry imports add an unrelated page module', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Entry Import Reuse"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['app.rdsl'] = `
app:
  name: "Entry Import Reuse"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`;

    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['app.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('models/User.ts')).toBe(firstFiles.get('models/User.ts'));
    expect(secondFiles.get('views/UsersList.tsx')).toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('pages/DashboardPage.tsx')).toBeDefined();
  });

  it('rebuilds safely when only host files change', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Host Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name @custom("./components/NameCell.tsx")
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);

    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/components/NameCell.tsx'],
    });
    expect(second.success).toBe(true);
    expect(second.ir).toStrictEqual(first.ir);
    expect(second.files).toStrictEqual(first.files);
    expect(second.semanticManifest).toStrictEqual(first.semanticManifest);
    expect(second.traceManifest).toStrictEqual(first.traceManifest);
  });

  it('reuses cached compile results when invalidated .rdsl content is unchanged', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Stable Rewrite"

imports:
  - ./models/user.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
    };
    const cache = createProjectCache();
    const readCounts = new Map<string, number>();
    const readFile = (fileName: string) => {
      const normalized = fileName.replace(/\\/g, '/');
      readCounts.set(normalized, (readCounts.get(normalized) ?? 0) + 1);
      const source = files[normalized];
      if (source === undefined) {
        throw new Error(`ENOENT: ${normalized}`);
      }
      return source;
    };

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);

    files['models/user.rdsl'] = `
model User:
  name: string
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['models/user.rdsl'],
    });
    expect(second.success).toBe(true);
    expect(readCounts).toEqual(new Map([
      ['app.rdsl', 1],
      ['models/user.rdsl', 2],
    ]));
    expect(second.ir).toBe(first.ir);
    expect(second.files).toBe(first.files);
    expect(second.semanticManifest).toBe(first.semanticManifest);
  });

  it('serializes and restores project cache snapshots for safe warm rebuilds', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Persistent Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
    };
    const firstCache = createProjectCache();
    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile: createVfs(files),
      cache: firstCache,
    });
    expect(first.success).toBe(true);

    const snapshot = serializeProjectCache(firstCache);
    expect(snapshot.files['app.rdsl']).toBeDefined();
    expect(snapshot.internals.entries['app.rdsl']).toBeDefined();
    expect(snapshot.internals.results['app.rdsl']).toBeDefined();

    const restoredCache = restoreProjectCache(snapshot);
    const readCounts = new Map<string, number>();
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile(fileName) {
        const normalized = fileName.replace(/\\/g, '/');
        readCounts.set(normalized, (readCounts.get(normalized) ?? 0) + 1);
        const source = files[normalized];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
      cache: restoredCache,
    });

    expect(second.success).toBe(true);
    expect(readCounts).toEqual(new Map([
      ['app.rdsl', 1],
      ['models/user.rdsl', 1],
      ['resources/users.rdsl', 1],
    ]));
    expect(second.manifest).toBe(first.manifest);
    expect(second.semanticManifest?.sourceFiles).toEqual(first.semanticManifest?.sourceFiles);
    expect(second.traceManifest?.generatedFiles).toEqual(first.traceManifest?.generatedFiles);
  });

  it('reuses unchanged generated file segments when only one view changes', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Segment Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
  email: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
  edit:
    fields:
      - name
      - email
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
  edit:
    fields:
      - name
      - email
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('views/UsersList.tsx')).not.toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('views/UsersEdit.tsx')).toBe(firstFiles.get('views/UsersEdit.tsx'));
    expect(secondFiles.get('models/User.ts')).toBe(firstFiles.get('models/User.ts'));
    expect(secondFiles.get('pages/DashboardPage.tsx')).toBe(firstFiles.get('pages/DashboardPage.tsx'));
    expect(secondFiles.get('layout/AdminLayout.tsx')).toBe(firstFiles.get('layout/AdminLayout.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
    expect(secondFiles.get('App.tsx')).toBe(firstFiles.get('App.tsx'));
  });

  it('reuses non-layout files when only app navigation changes', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Segment Cache"
  navigation:
    - group: "Main"
      items:
        - label: "Users"
          target: resource.users.list

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['app.rdsl'] = `
app:
  name: "Segment Cache"
  navigation:
    - group: "Admin"
      items:
        - label: "Users"
          target: resource.users.list

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['app.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('layout/AdminLayout.tsx')).not.toBe(firstFiles.get('layout/AdminLayout.tsx'));
    expect(secondFiles.get('views/UsersList.tsx')).toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('models/User.ts')).toBe(firstFiles.get('models/User.ts'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
    expect(secondFiles.get('App.tsx')).toBe(firstFiles.get('App.tsx'));
  });

  it('propagates model changes to dependent resource views through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Dependency Graph"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`,
      'models/user.rdsl': `
model User:
  role: enum(admin, editor)
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    filters:
      - role
    columns:
      - role
  edit:
    fields:
      - role
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['models/user.rdsl'] = `
model User:
  role: enum(admin, editor, manager)
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['models/user.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('models/User.ts')).not.toBe(firstFiles.get('models/User.ts'));
    expect(secondFiles.get('views/UsersList.tsx')).not.toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('views/UsersEdit.tsx')).not.toBe(firstFiles.get('views/UsersEdit.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
    expect(secondFiles.get('layout/AdminLayout.tsx')).toBe(firstFiles.get('layout/AdminLayout.tsx'));
  });

  it('propagates related target list changes to dependent read panels through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Related Panel Dependency Graph"

imports:
  - ./models/team.rdsl
  - ./models/user.rdsl
  - ./resources/teams.rdsl
  - ./resources/users.rdsl
`,
      'models/team.rdsl': `
model Team:
  name: string
  members: hasMany(User, by: team)
`,
      'models/user.rdsl': `
model User:
  name: string
  team: belongsTo(Team)
`,
      'resources/teams.rdsl': `
resource teams:
  model: Team
  api: /api/teams
  read:
    related:
      - members
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
    columns:
      - name
    pagination:
      size: 10
      style: numbered
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('views/TeamsRead.tsx')).not.toBe(firstFiles.get('views/TeamsRead.tsx'));
    expect(secondFiles.get('views/UsersList.tsx')).not.toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
  });

  it('propagates related target list changes to dependent record-scoped relation pages through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Relation Page Dependency Graph"

imports:
  - ./models/team.rdsl
  - ./models/user.rdsl
  - ./resources/teams.rdsl
  - ./resources/users.rdsl
  - ./pages/team-overview.rdsl
`,
      'models/team.rdsl': `
model Team:
  name: string
  members: hasMany(User, by: team)
`,
      'models/user.rdsl': `
model User:
  name: string
  team: belongsTo(Team)
`,
      'resources/teams.rdsl': `
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      'pages/team-overview.rdsl': `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: table
      title: "Members"
      data: teams.members
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
    columns:
      - name
    pagination:
      size: 10
      style: numbered
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('pages/TeamOverviewPage.tsx')).not.toBe(firstFiles.get('pages/TeamOverviewPage.tsx'));
    expect(secondFiles.get('views/UsersList.tsx')).not.toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
  });

  it('propagates target list additions to record-scoped relation page label-list fallbacks through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Relation Page Fallback Dependency Graph"

imports:
  - ./models/team.rdsl
  - ./models/user.rdsl
  - ./resources/teams.rdsl
  - ./resources/users.rdsl
  - ./pages/team-members.rdsl
`,
      'models/team.rdsl': `
model Team:
  name: string
  members: hasMany(User, by: team)
`,
      'models/user.rdsl': `
model User:
  name: string
  team: belongsTo(Team)
`,
      'resources/teams.rdsl': `
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  read:
    fields:
      - name
`,
      'pages/team-members.rdsl': `
page teamMembers:
  title: "Team Members"
  path: /teams/:id/members
  blocks:
    - type: table
      title: "Members"
      data: teams.members
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));
    expect(firstFiles.get('pages/TeamMembersPage.tsx')?.content).toContain(`<ul className="rdsl-related-list">`);

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
  read:
    fields:
      - name
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('pages/TeamMembersPage.tsx')).not.toBe(firstFiles.get('pages/TeamMembersPage.tsx'));
    expect(secondFiles.get('views/UsersList.tsx')).not.toBe(firstFiles.get('views/UsersList.tsx'));
    expect(secondFiles.get('router.tsx')).not.toBe(firstFiles.get('router.tsx'));
  });

  it('propagates related target resource changes to dependent record-scoped relation metric pages through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Relation Metric Dependency Graph"

imports:
  - ./models/team.rdsl
  - ./models/user.rdsl
  - ./resources/teams.rdsl
  - ./resources/users.rdsl
  - ./pages/team-metrics.rdsl
`,
      'models/team.rdsl': `
model Team:
  name: string
  members: hasMany(User, by: team)
`,
      'models/user.rdsl': `
model User:
  name: string
  team: belongsTo(Team)
`,
      'resources/teams.rdsl': `
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
`,
      'pages/team-metrics.rdsl': `
page teamMetrics:
  title: "Team Metrics"
  path: /teams/:id/metrics
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/members
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('pages/TeamMetricsPage.tsx')).not.toBe(firstFiles.get('pages/TeamMetricsPage.tsx'));
    expect(secondFiles.get('router.tsx')).toBe(firstFiles.get('router.tsx'));
  });

  it('propagates read.related route changes to the router through the dependency graph', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Related Route Dependency Graph"

imports:
  - ./models/team.rdsl
  - ./models/user.rdsl
  - ./resources/teams.rdsl
  - ./resources/users.rdsl
`,
      'models/team.rdsl': `
model Team:
  name: string
  members: hasMany(User, by: team)
`,
      'models/user.rdsl': `
model User:
  name: string
  team: belongsTo(Team)
`,
      'resources/teams.rdsl': `
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstFiles = new Map(first.files.map((file) => [file.path, file]));

    files['resources/teams.rdsl'] = `
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
    related:
      - members
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/teams.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondFiles = new Map(second.files.map((file) => [file.path, file]));

    expect(secondFiles.get('views/TeamsRead.tsx')).not.toBe(firstFiles.get('views/TeamsRead.tsx'));
    expect(secondFiles.get('views/TeamsMembersRelated.tsx')).toBeDefined();
    expect(secondFiles.get('router.tsx')).not.toBe(firstFiles.get('router.tsx'));
  });

  it('reuses unaffected trace manifest nodes and file regions when only one root changes', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Trace Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
  email: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstPageNode = first.traceManifest?.nodes.find((node) => node.id === 'page.dashboard');
    const firstPageRegion = first.traceManifest?.regions.find((region) => (
      region.generatedFile === 'pages/DashboardPage.tsx' &&
      region.nodeId === 'page.dashboard' &&
      region.role === 'file.root'
    ));
    const firstListRegion = first.traceManifest?.regions.find((region) => (
      region.generatedFile === 'views/UsersList.tsx' &&
      region.nodeId === 'resource.users.view.list' &&
      region.role === 'file.root'
    ));

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);

    const secondPageNode = second.traceManifest?.nodes.find((node) => node.id === 'page.dashboard');
    const secondPageRegion = second.traceManifest?.regions.find((region) => (
      region.generatedFile === 'pages/DashboardPage.tsx' &&
      region.nodeId === 'page.dashboard' &&
      region.role === 'file.root'
    ));
    const secondListRegion = second.traceManifest?.regions.find((region) => (
      region.generatedFile === 'views/UsersList.tsx' &&
      region.nodeId === 'resource.users.view.list' &&
      region.role === 'file.root'
    ));

    expect(secondPageNode).toBe(firstPageNode);
    expect(secondPageRegion).toBe(firstPageRegion);
    expect(secondListRegion).not.toBe(firstListRegion);
  });

  it('reuses assembled manifest arrays and module graph when only one root changes', () => {
    const files: Record<string, string> = {
      'app.rdsl': `
app:
  name: "Manifest Assembly Cache"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
  - ./pages/dashboard.rdsl
`,
      'models/user.rdsl': `
model User:
  name: string
  email: string
`,
      'resources/users.rdsl': `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
`,
      'pages/dashboard.rdsl': `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`,
    };
    const cache = createProjectCache();
    const readFile = createVfs(files);

    const first = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
    });
    expect(first.success).toBe(true);
    const firstPageGenerated = first.traceManifest?.generatedFiles.find((file) => file.path === 'pages/DashboardPage.tsx');

    files['resources/users.rdsl'] = `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
`;
    const second = compileProject({
      entryFile: 'app.rdsl',
      readFile,
      cache,
      changedFiles: ['resources/users.rdsl'],
    });
    expect(second.success).toBe(true);
    const secondPageGenerated = second.traceManifest?.generatedFiles.find((file) => file.path === 'pages/DashboardPage.tsx');

    expect(second.semanticManifest?.sourceFiles).toBe(first.semanticManifest?.sourceFiles);
    expect(second.semanticManifest?.moduleGraph).toBe(first.semanticManifest?.moduleGraph);
    expect(second.traceManifest?.sourceFiles).toBe(first.traceManifest?.sourceFiles);
    expect(second.traceManifest?.generatedFiles).toBe(first.traceManifest?.generatedFiles);
    expect(secondPageGenerated).toBe(firstPageGenerated);
    expect(second.manifest).not.toBe(first.manifest);
  });
});
