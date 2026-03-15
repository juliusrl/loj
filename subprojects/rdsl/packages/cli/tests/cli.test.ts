import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@loj-lang/rdsl-compiler';
import { runCli } from '../src/index.js';

const exampleFile = new URL('../../../examples/user-admin/app.web.loj', import.meta.url);
const exampleSource = readFileSync(exampleFile, 'utf8');
const repoRoot = new URL('../../../../../', import.meta.url).pathname;

function createBuffers() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd: repoRoot,
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/');
}

function writeMultiFileProject(rootDir: string) {
  mkdirSync(join(rootDir, 'models'), { recursive: true });
  mkdirSync(join(rootDir, 'resources'), { recursive: true });
  mkdirSync(join(rootDir, 'pages'), { recursive: true });

  const entryFile = join(rootDir, 'app.web.loj');
  const modelFile = join(rootDir, 'models', 'user.web.loj');
  const resourceFile = join(rootDir, 'resources', 'users.web.loj');
  const pageFile = join(rootDir, 'pages', 'dashboard.web.loj');

  writeFileSync(entryFile, `
app:
  name: "User Management"
  navigation:
    - group: "Main"
      items:
        - label: "Dashboard"
          target: page.dashboard
        - label: "Users"
          target: resource.users.list

imports:
  - ./models/user.web.loj
  - ./resources/users.web.loj
  - ./pages/dashboard.web.loj
`, 'utf8');

  writeFileSync(modelFile, `
model User:
  name: string
  email: string
`, 'utf8');

  writeFileSync(resourceFile, `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
`, 'utf8');

  writeFileSync(pageFile, `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`, 'utf8');

  return { entryFile, modelFile, resourceFile, pageFile };
}

function writeNestedMultiFileProject(rootDir: string) {
  mkdirSync(join(rootDir, 'modules'), { recursive: true });
  mkdirSync(join(rootDir, 'models'), { recursive: true });
  mkdirSync(join(rootDir, 'resources'), { recursive: true });

  const entryFile = join(rootDir, 'app.web.loj');
  const moduleFile = join(rootDir, 'modules', 'admin.web.loj');
  const modelFile = join(rootDir, 'models', 'user.web.loj');
  const resourceFile = join(rootDir, 'resources', 'users.web.loj');

  writeFileSync(entryFile, `
app:
  name: "Nested Project"
  navigation:
    - group: "Main"
      items:
        - label: "Users"
          target: resource.users.list

imports:
  - ./modules/admin.web.loj
`, 'utf8');

  writeFileSync(moduleFile, `
imports:
  - ../models/user.web.loj
  - ../resources/users.web.loj
`, 'utf8');

  writeFileSync(modelFile, `
model User:
  name: string
  email: string
`, 'utf8');

  writeFileSync(resourceFile, `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
      - email
`, 'utf8');

  return { entryFile, moduleFile, modelFile, resourceFile };
}

function writeDescriptorToastProject(rootDir: string) {
  const entryFile = join(rootDir, 'app.web.loj');

  writeFileSync(entryFile, `
app:
  name: "Template Studio"
  theme: dark
  auth: jwt

compiler:
  target: react

model Template:
  name: string @required
  category: string
  status: enum(draft, active)

resource templates:
  model: Template
  api: /api/templates
  create:
    fields: [name, category, status]
    onSuccess:
      - refresh: templates
      - toast:
          key: templates.created
          defaultMessage: "Template {name} created"
          values:
            name:
              ref: form.name
`, 'utf8');

  return { entryFile };
}

function writeMultiFileProjectWithEscapes(rootDir: string) {
  mkdirSync(join(rootDir, 'resources', 'components'), { recursive: true });
  mkdirSync(join(rootDir, 'resources', 'logic'), { recursive: true });

  const project = writeMultiFileProject(rootDir);
  writeFileSync(project.resourceFile, `
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
`, 'utf8');

  const customFile = join(rootDir, 'resources', 'components', 'AvatarCell.tsx');
  const logicFile = join(rootDir, 'resources', 'logic', 'canEditUser.ts');
  writeFileSync(customFile, `export default function AvatarCell() { return null; }\n`, 'utf8');
  writeFileSync(logicFile, `export default function canEditUser() { return true; }\n`, 'utf8');

  return {
    ...project,
    customFile,
    logicFile,
  };
}

function writeMultiFileProjectWithHostDependencies(rootDir: string) {
  mkdirSync(join(rootDir, 'resources', 'components'), { recursive: true });
  mkdirSync(join(rootDir, 'resources', 'logic'), { recursive: true });
  mkdirSync(join(rootDir, 'resources', 'styles'), { recursive: true });

  const project = writeMultiFileProject(rootDir);
  writeFileSync(project.resourceFile, `
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
`, 'utf8');

  const customFile = join(rootDir, 'resources', 'components', 'AvatarCell.tsx');
  const helperFile = join(rootDir, 'resources', 'components', 'AvatarBadge.tsx');
  const styleFile = join(rootDir, 'resources', 'styles', 'avatar.css');
  const moduleStyleFile = join(rootDir, 'resources', 'styles', 'avatarBadge.module.css');
  const logicFile = join(rootDir, 'resources', 'logic', 'canEditUser.ts');

  writeFileSync(customFile, `
import '../styles/avatar.css';
import { AvatarBadge } from './AvatarBadge';

export default function AvatarCell() {
  return AvatarBadge();
}
`, 'utf8');
  writeFileSync(helperFile, `
import '../styles/avatarBadge.module.css';

export function AvatarBadge() {
  return null;
}
`, 'utf8');
  writeFileSync(styleFile, `.avatar-cell { display: grid; }\n`, 'utf8');
  writeFileSync(moduleStyleFile, `.avatar-badge { color: red; }\n`, 'utf8');
  writeFileSync(logicFile, `export default function canEditUser() { return true; }\n`, 'utf8');

  return {
    ...project,
    customFile,
    helperFile,
    styleFile,
    moduleStyleFile,
    logicFile,
  };
}

function writeDirectoryImportProject(rootDir: string) {
  mkdirSync(join(rootDir, 'pages'), { recursive: true });

  const entryFile = join(rootDir, 'app.web.loj');
  const dashboardFile = join(rootDir, 'pages', 'dashboard.web.loj');

  writeFileSync(entryFile, `
app:
  name: "Directory Import"
  navigation:
    - group: "Main"
      items:
        - label: "Dashboard"
          target: page.dashboard

imports:
  - ./pages/
`, 'utf8');

  writeFileSync(dashboardFile, `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`, 'utf8');

  return { entryFile, dashboardFile };
}

describe('rdsl cli', () => {
  it('prints an inspect summary', () => {
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['inspect', 'subprojects/rdsl/examples/user-admin/app.web.loj'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('source files:');
    expect(stdout.join('')).toContain('host files: 0');
    expect(stdout.join('')).toContain('target: react');
    expect(stdout.join('')).toContain('language: typescript');
    expect(stdout.join('')).toContain('trace nodes:');
    expect(stdout.join('')).toContain('trace regions:');
  });

  it('inspects a specific semantic node', () => {
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'inspect',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--node',
      'resource.users.view.list.column.role',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('node: resource.users.view.list.column.role');
    expect(stdout.join('')).toContain('kind: column');
    expect(stdout.join('')).toContain('column.definition');
  });

  it('inspects descriptor-shaped toast details for form views', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-inspect-toast-'));
    const { entryFile } = writeDescriptorToastProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'inspect',
      entryFile,
      '--node',
      'resource.templates.view.create',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('details:');
    expect(stdout.join('')).toContain('onSuccess.toast.key: templates.created');
    expect(stdout.join('')).toContain('onSuccess.toast.defaultMessage: "Template {name} created"');
    expect(stdout.join('')).toContain('onSuccess.toast.values.name: ref form.name');
  });

  it('traces a generated location back to the semantic node', () => {
    const compileResult = compile(exampleSource, 'subprojects/rdsl/examples/user-admin/app.web.loj');
    const traceRegion = compileResult.traceManifest?.regions.find((region) =>
      region.nodeId === 'resource.users.view.list.column.role' && region.role === 'column.definition'
    );

    expect(traceRegion).toBeDefined();

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'trace',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      `${traceRegion!.generatedFile}:${traceRegion!.range.startLine}:1`,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('node: resource.users.view.list.column.role');
    expect(stdout.join('')).toContain('role: column.definition');
  });

  it('returns json output when requested', () => {
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'inspect',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--node',
      'resource.users.view.list.column.role',
      '--json',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.inspect.result');
    expect(payload.schemaVersion).toBe('0.1.0');
    expect(payload.success).toBe(true);
    expect(payload.mode).toBe('node');
    expect(payload.node.id).toBe('resource.users.view.list.column.role');
    expect(payload.regions.some((region: { role: string }) => region.role === 'column.definition')).toBe(true);
  });

  it('returns semantic inspect details in json output when available', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-inspect-toast-json-'));
    const { entryFile } = writeDescriptorToastProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'inspect',
      entryFile,
      '--node',
      'resource.templates.view.create',
      '--json',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.inspect.result');
    expect(payload.schemaVersion).toBe('0.1.0');
    expect(payload.mode).toBe('node');
    expect(payload.semantic.properties.some((property: { label: string; value: string }) => property.label === 'fields' && property.value.includes('name'))).toBe(true);
    expect(payload.semantic.effects.some((effect: { type: string; message?: { key?: string } }) => effect.type === 'toast' && effect.message?.key === 'templates.created')).toBe(true);
  });

  it('returns artifact-shaped trace json output when requested', () => {
    const compileResult = compile(exampleSource, 'subprojects/rdsl/examples/user-admin/app.web.loj');
    const traceRegion = compileResult.traceManifest?.regions.find((region) =>
      region.nodeId === 'resource.users.view.list.column.role' && region.role === 'column.definition'
    );

    expect(traceRegion).toBeDefined();

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'trace',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      `${traceRegion!.generatedFile}:${traceRegion!.range.startLine}:1`,
      '--json',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.trace.result');
    expect(payload.schemaVersion).toBe('0.1.0');
    expect(payload.success).toBe(true);
    expect(payload.sourceKind).toBe('source');
    expect(payload.kind).toBe('match');
    expect(payload.matches[0].region.nodeId).toBe('resource.users.view.list.column.role');
  });

  it('validates successfully', () => {
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', 'subprojects/rdsl/examples/user-admin/app.web.loj'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Validation passed: subprojects/rdsl/examples/user-admin/app.web.loj');
    expect(stdout.join('')).toContain('source files: 1');
    expect(stdout.join('')).toContain('generated files:');
  });

  it('warns when validating a legacy .rdsl entry file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-legacy-warning-'));
    const entryFile = join(tempDir, 'app.rdsl');
    writeFileSync(entryFile, `
app:
  name: "Legacy App"

compiler:
  target: react
`, 'utf8');

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', entryFile], io);

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain(`Validation passed: ${entryFile}`);
    expect(stderr.join('')).toContain('Prefer .web.loj over .rdsl');
  });

  it('validates a multi-file project through the same entry-file command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-multi-validate-'));
    const { entryFile } = writeMultiFileProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', entryFile], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Validation passed: ${entryFile}`);
    expect(stdout.join('')).toContain('source files: 4');
  });

  it('validates a nested multi-file project through the same entry-file command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-nested-validate-'));
    const { entryFile } = writeNestedMultiFileProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', entryFile], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Validation passed: ${entryFile}`);
    expect(stdout.join('')).toContain('source files: 4');
  });

  it('validates a directory-import project through the same entry-file command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dir-validate-'));
    const { entryFile } = writeDirectoryImportProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', entryFile], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Validation passed: ${entryFile}`);
    expect(stdout.join('')).toContain('source files: 2');
  });

  it('reports host file counts in inspect summaries for projects with escape hatches', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-multi-host-summary-'));
    const { entryFile } = writeMultiFileProjectWithEscapes(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['inspect', entryFile], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`entry: ${entryFile}`);
    expect(stdout.join('')).toContain('host files: 2');
  });

  it('returns json validation errors for invalid input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-invalid-'));
  const invalidFile = join(tempDir, 'invalid.web.loj');
    writeFileSync(invalidFile, 'app:\n  theme: neon\n', 'utf8');

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', invalidFile, '--json'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.validate.result');
    expect(payload.schemaVersion).toBe('0.1.0');
    expect(payload.success).toBe(false);
    expect(payload.errors.some((error: { phase: string }) => error.phase === 'normalize')).toBe(true);
  });

  it('returns escape stats in artifact-shaped validation json output', () => {
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['validate', 'subprojects/rdsl/examples/user-admin/app.web.loj', '--json'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.validate.result');
    expect(payload.success).toBe(true);
    expect(payload.escapeStats).toBeDefined();
    expect(typeof payload.escapeStats.escapePercent).toBe('number');
    expect(typeof payload.escapeStats.totalNodes).toBe('number');
  });

  it('returns artifact-shaped build json output when requested', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-build-json-'));
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'build',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--out-dir',
      outDir,
      '--json',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('rdsl.build.result');
    expect(payload.schemaVersion).toBe('0.1.0');
    expect(payload.success).toBe(true);
    expect(payload.outDir).toBe(normalizePath(outDir));
    expect(payload.semanticManifest).toBe('.rdsl/semantic-manifest.json');
    expect(payload.traceManifest).toBe('.rdsl/trace-manifest.json');
  });

  it('builds generated files and manifest sidecars to the output directory', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-build-'));
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'build',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--out-dir',
      outDir,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Build complete: subprojects/rdsl/examples/user-admin/app.web.loj');
    expect(existsSync(join(outDir, 'App.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'views', 'UsersList.tsx'))).toBe(true);
    expect(existsSync(join(outDir, '.rdsl', 'semantic-manifest.json'))).toBe(true);
    expect(existsSync(join(outDir, '.rdsl', 'trace-manifest.json'))).toBe(true);
    expect(existsSync(join(outDir, '.rdsl', 'project-cache.json'))).toBe(true);

    const traceManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'trace-manifest.json'), 'utf8'));
    expect(traceManifest.artifact).toBe('rdsl.trace-manifest');
    expect(traceManifest.generatedFiles.some((file: { path: string }) => file.path === 'views/UsersList.tsx')).toBe(true);
  });

  it('exports a reusable react host template scaffold', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-host-export-'));
    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'host',
      'export-react',
      outDir,
      '--title',
      'Inventory Host',
      '--package-name',
      'inventory-host',
      '--api-base',
      'http://localhost:4100',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Host template export-react: ${normalizePath(outDir)}`);
    expect(existsSync(join(outDir, '.rdsl-host', 'template.json'))).toBe(true);
    expect(existsSync(join(outDir, 'src', 'HostApp.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'src', 'host-config.tsx'))).toBe(true);

    const templateManifest = JSON.parse(readFileSync(join(outDir, '.rdsl-host', 'template.json'), 'utf8'));
    expect(templateManifest.template).toBe('react-vite');
    expect(templateManifest.title).toBe('Inventory Host');

    const packageJson = readFileSync(join(outDir, 'package.json'), 'utf8');
    expect(packageJson).toContain('"name": "inventory-host"');

    const viteConfig = readFileSync(join(outDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('defaultApiBase: "http://localhost:4100"');
  });

  it('syncs managed host template files without overwriting starter config files', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-host-sync-'));
    const exportBuffers = createBuffers();
    const exportExit = runCli([
      'host',
      'export-react',
      outDir,
      '--title',
      'Template Host',
    ], exportBuffers.io);
    expect(exportExit).toBe(0);

    writeFileSync(join(outDir, 'src', 'host-config.tsx'), 'export const preserved = true;\n', 'utf8');
    writeFileSync(join(outDir, 'src', 'HostApp.tsx'), 'export const stale = true;\n', 'utf8');

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'host',
      'sync-react',
      outDir,
      '--title',
      'Template Host v2',
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Host template sync-react: ${normalizePath(outDir)}`);
    expect(stdout.join('')).toContain('starter files preserved: 2');
    expect(readFileSync(join(outDir, 'src', 'host-config.tsx'), 'utf8')).toBe('export const preserved = true;\n');
    expect(readFileSync(join(outDir, 'src', 'HostApp.tsx'), 'utf8')).toContain("import { HostProviders, HostStatus, HostToasts } from './host-config';");

    const templateManifest = JSON.parse(readFileSync(join(outDir, '.rdsl-host', 'template.json'), 'utf8'));
    expect(templateManifest.title).toBe('Template Host v2');
  });

  it('builds a multi-file project and preserves all source files in sidecar manifests', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-multi-build-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, modelFile, resourceFile, pageFile } = writeMultiFileProject(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Build complete: ${entryFile}`);

    const semanticManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'semantic-manifest.json'), 'utf8'));
    const traceManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'trace-manifest.json'), 'utf8'));
    expect(semanticManifest.sourceFiles).toEqual([
      normalizePath(entryFile),
      normalizePath(modelFile),
      normalizePath(resourceFile),
      normalizePath(pageFile),
    ]);
    expect(traceManifest.sourceFiles.map((file: { path: string }) => file.path)).toEqual([
      normalizePath(entryFile),
      normalizePath(modelFile),
      normalizePath(resourceFile),
      normalizePath(pageFile),
    ]);
  });

  it('prunes stale generated frontend files on rebuild', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-prune-build-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeMultiFileProject(tempDir);

    const firstBuffers = createBuffers();
    const firstExitCode = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], firstBuffers.io);

    expect(firstExitCode).toBe(0);
    expect(existsSync(join(outDir, 'pages', 'DashboardPage.tsx'))).toBe(true);

    writeFileSync(entryFile, `
app:
  name: "User Management"
  navigation:
    - group: "Main"
      items:
        - label: "Users"
          target: resource.users.list

imports:
  - ./models/user.web.loj
  - ./resources/users.web.loj
`, 'utf8');

    const secondBuffers = createBuffers();
    const secondExitCode = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], secondBuffers.io);

    expect(secondExitCode).toBe(0);
    expect(existsSync(join(outDir, 'views', 'UsersList.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'pages', 'DashboardPage.tsx'))).toBe(false);
  });

  it('copies escape hatch host files into the build output and rewrites generated imports', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-multi-escapes-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeMultiFileProjectWithEscapes(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Build complete: ${entryFile}`);
    expect(existsSync(join(outDir, 'resources', 'components', 'AvatarCell.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'resources', 'logic', 'canEditUser.ts'))).toBe(true);

    const listView = readFileSync(join(outDir, 'views', 'UsersList.tsx'), 'utf8');
    const editView = readFileSync(join(outDir, 'views', 'UsersEdit.tsx'), 'utf8');
    expect(listView).toContain("import AvatarCell from '../resources/components/AvatarCell';");
    expect(editView).toContain("import canEditUser from '../resources/logic/canEditUser';");

    const semanticManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'semantic-manifest.json'), 'utf8'));
    expect(semanticManifest.hostFiles).toEqual([
      {
        path: 'resources/components/AvatarCell.tsx',
        references: [
          {
            nodeId: 'resource.users.view.list.column.avatar',
            role: 'column.customRenderer',
            sourceFile: normalizePath(join(tempDir, 'resources', 'users.web.loj')),
          },
        ],
      },
      {
        path: 'resources/logic/canEditUser.ts',
        references: [
          {
            nodeId: 'resource.users.view.edit',
            role: 'rule.allowIf',
            sourceFile: normalizePath(join(tempDir, 'resources', 'users.web.loj')),
            lockIn: 'explicit',
          },
        ],
      },
    ]);
  });

  it('copies transitive host script and css dependencies into the build output', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-host-deps-build-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeMultiFileProjectWithHostDependencies(tempDir);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(`Build complete: ${entryFile}`);
    expect(existsSync(join(outDir, 'resources', 'components', 'AvatarCell.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'resources', 'components', 'AvatarBadge.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'resources', 'styles', 'avatar.css'))).toBe(true);
    expect(existsSync(join(outDir, 'resources', 'styles', 'avatarBadge.module.css'))).toBe(true);

    const semanticManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'semantic-manifest.json'), 'utf8'));
    expect(semanticManifest.hostFiles).toEqual([
      {
        path: 'resources/components/AvatarCell.tsx',
        references: [
          {
            nodeId: 'resource.users.view.list.column.avatar',
            role: 'column.customRenderer',
            sourceFile: normalizePath(join(tempDir, 'resources', 'users.web.loj')),
          },
        ],
        dependencies: [
          {
            path: 'resources/components/AvatarBadge.tsx',
            kind: 'script',
            importers: ['resources/components/AvatarCell.tsx'],
          },
          {
            path: 'resources/styles/avatar.css',
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
      {
        path: 'resources/logic/canEditUser.ts',
        references: [
          {
            nodeId: 'resource.users.view.edit',
            role: 'rule.allowIf',
            sourceFile: normalizePath(join(tempDir, 'resources', 'users.web.loj')),
            lockIn: 'explicit',
          },
        ],
      },
    ]);
  });

  it('inspects host file references from build sidecars without recompiling source', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-inspect-host-build-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeMultiFileProjectWithEscapes(tempDir);

    const buildBuffers = createBuffers();
    const buildExit = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], buildBuffers.io);
    expect(buildExit).toBe(0);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['inspect', outDir, '--node', 'resource.users.view.edit'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('node: resource.users.view.edit');
    expect(stdout.join('')).toContain('host files:');
    expect(stdout.join('')).toContain('resources/logic/canEditUser.ts (rule.allowIf)');
  });

  it('inspects transitive css host dependencies from build sidecars without recompiling source', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-inspect-css-build-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeMultiFileProjectWithHostDependencies(tempDir);

    const buildBuffers = createBuffers();
    const buildExit = runCli([
      'build',
      entryFile,
      '--out-dir',
      outDir,
    ], buildBuffers.io);
    expect(buildExit).toBe(0);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['inspect', outDir, '--node', 'resource.users.view.list.column.avatar'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('resources/components/AvatarCell.tsx (column.customRenderer)');
    expect(stdout.join('')).toContain('resources/styles/avatar.css [style]');
    expect(stdout.join('')).toContain('resources/styles/avatarBadge.module.css [style]');
  });

  it('inspects from build sidecars without recompiling source', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-inspect-build-'));
    const buildBuffers = createBuffers();
    const buildExit = runCli([
      'build',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--out-dir',
      outDir,
    ], buildBuffers.io);
    expect(buildExit).toBe(0);

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(['inspect', outDir, '--node', 'resource.users.view.list.column.role'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('node: resource.users.view.list.column.role');
    expect(stdout.join('')).toContain('column.definition');
  });

  it('traces from build sidecars without recompiling source', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-trace-build-'));
    const buildBuffers = createBuffers();
    const buildExit = runCli([
      'build',
      'subprojects/rdsl/examples/user-admin/app.web.loj',
      '--out-dir',
      outDir,
    ], buildBuffers.io);
    expect(buildExit).toBe(0);

    const traceManifest = JSON.parse(readFileSync(join(outDir, '.rdsl', 'trace-manifest.json'), 'utf8'));
    const traceRegion = traceManifest.regions.find((region: { nodeId: string; role: string }) =>
      region.nodeId === 'resource.users.view.list.column.role' && region.role === 'column.definition'
    );
    expect(traceRegion).toBeDefined();

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli([
      'trace',
      outDir,
      `${traceRegion.generatedFile}:${traceRegion.range.startLine}:1`,
    ], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('node: resource.users.view.list.column.role');
    expect(stdout.join('')).toContain('role: column.definition');
  });

  it('starts dev mode, writes output, and rebuilds on source changes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-'));
    const sourceFile = join(tempDir, 'app.web.loj');
    const outDir = join(tempDir, 'out');
    writeFileSync(sourceFile, exampleSource, 'utf8');

    let watchCallback: ((eventType: string, fileName?: string) => void) | undefined;
    let watcherClosed = false;
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', sourceFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(_directory, listener) {
            watchCallback = listener;
            return {
              close() {
                watcherClosed = true;
              },
            };
          },
        },
        onDevSession(session) {
          expect(existsSync(join(outDir, 'App.tsx'))).toBe(true);
          expect(existsSync(join(outDir, '.rdsl', 'trace-manifest.json'))).toBe(true);

          writeFileSync(sourceFile, 'app:\n  theme: neon\n', 'utf8');
          watchCallback?.('change', 'app.web.loj');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(watcherClosed).toBe(true);
    expect(stdout.join('')).toContain('Dev mode: watching');
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(stdout.join('')).toContain('Dev mode stopped');
    expect(stderr.join('')).toContain('Dev build failed (change)');
  });

  it('watches imported module files in dev mode for multi-file projects', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-multi-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, modelFile } = writeMultiFileProject(tempDir);
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    const closedDirectories: string[] = [];
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            listeners.set(normalizePath(directory), listener);
            return {
              close() {
                closedDirectories.push(normalizePath(directory));
              },
            };
          },
        },
        onDevSession(session) {
          expect(existsSync(join(outDir, 'App.tsx'))).toBe(true);
          expect(existsSync(join(outDir, '.rdsl', 'trace-manifest.json'))).toBe(true);

          writeFileSync(modelFile, `
model User:
  name: string
  email: string
  role: string
`, 'utf8');

          const modelDirectory = normalizePath(dirname(modelFile));
          listeners.get(modelDirectory)?.('change', 'user.web.loj');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(closedDirectories).toContain(normalizePath(dirname(entryFile)));
    expect(closedDirectories).toContain(normalizePath(dirname(modelFile)));
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(stdout.join('')).toContain('Change detected: user.web.loj');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toBe('');
  });

  it('watches transitively imported module files in dev mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-nested-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, modelFile, moduleFile } = writeNestedMultiFileProject(tempDir);
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    const closedDirectories: string[] = [];
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            const normalizedDirectory = normalizePath(directory);
            listeners.set(normalizedDirectory, listener);
            return {
              close() {
                closedDirectories.push(normalizedDirectory);
              },
            };
          },
        },
        onDevSession(session) {
          writeFileSync(modelFile, `
model User:
  name: string
  email: string
  role: string
`, 'utf8');

          listeners.get(normalizePath(dirname(modelFile)))?.('change', 'user.web.loj');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(closedDirectories).toContain(normalizePath(dirname(entryFile)));
    expect(closedDirectories).toContain(normalizePath(dirname(moduleFile)));
    expect(closedDirectories).toContain(normalizePath(dirname(modelFile)));
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(stdout.join('')).toContain('Change detected: user.web.loj');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toBe('');
  });

  it('rebuilds when a scanned directory gains a new .rdsl module in dev mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-dirscan-'));
    const outDir = join(tempDir, 'out');
    const { entryFile } = writeDirectoryImportProject(tempDir);
    const settingsFile = join(tempDir, 'pages', 'settings.web.loj');
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    const closedDirectories: string[] = [];
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            const normalizedDirectory = normalizePath(directory);
            listeners.set(normalizedDirectory, listener);
            return {
              close() {
                closedDirectories.push(normalizedDirectory);
              },
            };
          },
        },
        onDevSession(session) {
          writeFileSync(settingsFile, `
page settings:
  title: "Settings"
  type: dashboard
  blocks:
    - type: metric
      title: "Admins"
`, 'utf8');

          listeners.get(normalizePath(dirname(settingsFile)))?.('rename', 'settings.web.loj');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(closedDirectories).toContain(normalizePath(dirname(entryFile)));
    expect(closedDirectories).toContain(normalizePath(dirname(settingsFile)));
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(stdout.join('')).toContain('Change detected: settings.web.loj');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toBe('');
    expect(existsSync(join(outDir, 'pages', 'SettingsPage.tsx'))).toBe(true);
  });

  it('keeps imported module watchers active after a failed rebuild', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-multi-failure-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, modelFile } = writeMultiFileProject(tempDir);
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    const closedDirectories: string[] = [];
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            const normalizedDirectory = normalizePath(directory);
            listeners.set(normalizedDirectory, listener);
            return {
              close() {
                closedDirectories.push(normalizedDirectory);
                listeners.delete(normalizedDirectory);
              },
            };
          },
        },
        onDevSession(session) {
          const modelDirectory = normalizePath(dirname(modelFile));

          writeFileSync(modelFile, `
model User:
  email: [
`, 'utf8');
          listeners.get(modelDirectory)?.('change', 'user.web.loj');
          expect(listeners.has(modelDirectory)).toBe(true);

          writeFileSync(modelFile, `
model User:
  name: string
  email: string
  role: string
`, 'utf8');
          const waitUntil = Date.now() + 50;
          while (Date.now() < waitUntil) {
            // Allow the next synthetic watch event to clear the CLI debounce window.
          }
          listeners.get(modelDirectory)?.('change', 'user.web.loj');

          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(closedDirectories).toContain(normalizePath(dirname(entryFile)));
    expect(closedDirectories).toContain(normalizePath(dirname(modelFile)));
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toContain('Dev build failed (change)');
  });

  it('watches copied escape hatch host files in dev mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-escapes-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, logicFile } = writeMultiFileProjectWithEscapes(tempDir);
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            listeners.set(normalizePath(directory), listener);
            return { close() {} };
          },
        },
        onDevSession(session) {
          expect(existsSync(join(outDir, 'resources', 'logic', 'canEditUser.ts'))).toBe(true);
          writeFileSync(logicFile, `export default function canEditUser() { return false; }\n`, 'utf8');
          listeners.get(normalizePath(dirname(logicFile)))?.('change', 'canEditUser.ts');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(stdout.join('')).toContain('Change detected: canEditUser.ts');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toBe('');
    expect(readFileSync(join(outDir, 'resources', 'logic', 'canEditUser.ts'), 'utf8')).toContain('return false');
  });

  it('watches copied css dependencies in dev mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-cli-dev-css-'));
    const outDir = join(tempDir, 'out');
    const { entryFile, styleFile } = writeMultiFileProjectWithHostDependencies(tempDir);
    const listeners = new Map<string, (eventType: string, fileName?: string) => void>();
    let sessionClosed = false;

    const { stdout, stderr, io } = createBuffers();
    const exitCode = runCli(
      ['dev', entryFile, '--out-dir', outDir],
      {
        ...io,
        runtime: {
          watch(directory, listener) {
            listeners.set(normalizePath(directory), listener);
            return { close() {} };
          },
        },
        onDevSession(session) {
          expect(existsSync(join(outDir, 'resources', 'styles', 'avatar.css'))).toBe(true);
          writeFileSync(styleFile, `.avatar-cell { display: flex; }\n`, 'utf8');
          listeners.get(normalizePath(dirname(styleFile)))?.('change', 'avatar.css');
          session.close();
          sessionClosed = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(sessionClosed).toBe(true);
    expect(stdout.join('')).toContain('Change detected: avatar.css');
    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(stderr.join('')).toBe('');
    expect(readFileSync(join(outDir, 'resources', 'styles', 'avatar.css'), 'utf8')).toContain('display: flex');
  });
});
