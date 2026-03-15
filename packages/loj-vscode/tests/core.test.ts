import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCurrentIssueQuickPickItems,
  findLinkedArtifactReferenceAtPosition,
  findLikelyGeneratedOutputTarget,
  buildProjectOverviewQuickPickItems,
  canUseSemanticAssistResult,
  collectToastCompletionSuggestions,
  collectToastQuickFixes,
  collectCompileDiagnostics,
  compileProjectState,
  createSnapshotMap,
  findContainingBuildRoot,
  findNearestAncestorProjectFile,
  findNearestProjectFile,
  findMostSpecificTraceNode,
  findProjectEntry,
  formatCurrentCompileIssueLine,
  formatProjectDiagnosticLocation,
  formatSemanticAssistDetail,
  formatSemanticAssistIssueSummary,
  formatSemanticAssistPrimaryIssue,
  formatSemanticAssistStatus,
  formatSemanticAssistStatusBarText,
  formatSemanticAssistStatusBarTooltip,
  listProjectDiagnostics,
  normalizeFsPath,
  selectSemanticAssistResult,
  shouldShowCurrentIssuesCommand,
  toGeneratedFilePath,
} from '../src/core.js';

function writeMultiFileProject(rootDir: string) {
  mkdirSync(join(rootDir, 'models'), { recursive: true });
  mkdirSync(join(rootDir, 'resources'), { recursive: true });

  const entryFile = join(rootDir, 'app.rdsl');
  const modelFile = join(rootDir, 'models', 'user.rdsl');
  const resourceFile = join(rootDir, 'resources', 'users.rdsl');

  writeFileSync(entryFile, `
app:
  name: "Users"

imports:
  - ./models/user.rdsl
  - ./resources/users.rdsl
`, 'utf8');

  writeFileSync(modelFile, `
model User:
  email: string
`, 'utf8');

  writeFileSync(resourceFile, `
resource users:
  model: User
  api: /api/users
  list:
    columns:
      - email
`, 'utf8');

  return { entryFile, modelFile, resourceFile };
}

function writeDirectoryImportProject(rootDir: string) {
  mkdirSync(join(rootDir, 'pages'), { recursive: true });

  const entryFile = join(rootDir, 'app.rdsl');
  const pageFile = join(rootDir, 'pages', 'dashboard.rdsl');

  writeFileSync(entryFile, `
app:
  name: "Directory Project"

imports:
  - ./pages/
`, 'utf8');

  writeFileSync(pageFile, `
page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
`, 'utf8');

  return { entryFile, pageFile };
}

describe('vscode extension core helpers', () => {
  it('finds the root entry file for an imported module', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-entry-'));
    const { entryFile, resourceFile } = writeMultiFileProject(tempDir);
    const resolved = findProjectEntry(resourceFile, [entryFile], (fileName) => {
      try {
        return readFileSync(fileName, 'utf8');
      } catch {
        return null;
      }
    });

    expect(resolved).toBe(normalizeFsPath(entryFile));
  });

  it('finds the nearest loj.project.yaml for the current file', () => {
    const projectFiles = [
      '/workspace/loj.project.yaml',
      '/workspace/examples/booking/loj.project.yaml',
    ];

    expect(findNearestProjectFile('/workspace/examples/booking/frontend/app.web.loj', projectFiles))
      .toBe('/workspace/examples/booking/loj.project.yaml');
    expect(findNearestProjectFile('/workspace/docs/notes.md', projectFiles))
      .toBe('/workspace/loj.project.yaml');
  });

  it('keeps nearest project resolution stable when no current file is available', () => {
    const projectFiles = [
      '/workspace/zeta/loj.project.yaml',
      '/workspace/alpha/loj.project.yaml',
      '/workspace/examples/booking/loj.project.yaml',
    ];

    expect(findNearestProjectFile(undefined, projectFiles))
      .toBe('/workspace/alpha/loj.project.yaml');
  });

  it('walks ancestor directories to find loj.project.yaml', () => {
    const existing = new Set([
      '/workspace/examples/booking/loj.project.yaml',
    ]);

    expect(findNearestAncestorProjectFile(
      '/workspace/examples/booking/frontend/pages/availability.web.loj',
      (fileName) => existing.has(normalizeFsPath(fileName)),
    )).toBe('/workspace/examples/booking/loj.project.yaml');
    expect(findNearestAncestorProjectFile(
      '/workspace/other/app.web.loj',
      (fileName) => existing.has(normalizeFsPath(fileName)),
    )).toBeNull();
  });

  it('finds the root entry file for a module discovered through a directory import', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-dir-entry-'));
    const { entryFile, pageFile } = writeDirectoryImportProject(tempDir);
    const resolved = findProjectEntry(
      pageFile,
      [entryFile],
      (fileName) => {
        try {
          return readFileSync(fileName, 'utf8');
        } catch {
          return null;
        }
      },
      (directory) => {
        try {
          return readdirSync(directory).map((entry) => join(directory, entry));
        } catch {
          return [];
        }
      },
    );

    expect(resolved).toBe(normalizeFsPath(entryFile));
  });

  it('maps duplicate-definition diagnostics back to the owning files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-diags-'));
    mkdirSync(join(tempDir, 'models'), { recursive: true });

    const entryFile = join(tempDir, 'app.rdsl');
    const leftModelFile = join(tempDir, 'models', 'left.rdsl');
    const rightModelFile = join(tempDir, 'models', 'right.rdsl');

    writeFileSync(entryFile, `
app:
  name: "Dupes"

imports:
  - ./models/left.rdsl
  - ./models/right.rdsl
`, 'utf8');
    writeFileSync(leftModelFile, `
model User:
  name: string
`, 'utf8');
    writeFileSync(rightModelFile, `
model User:
  email: string
`, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    expect(result.success).toBe(false);

    const diagnostics = collectCompileDiagnostics(result, normalizeFsPath(entryFile));
    expect(diagnostics.get(normalizeFsPath(leftModelFile))?.some((issue) => issue.message.includes('Duplicate model'))).toBe(true);
    expect(diagnostics.get(normalizeFsPath(rightModelFile))?.some((issue) => issue.message.includes('Duplicate model'))).toBe(true);
  });

  it('reuses the last good semantic result when the current source is temporarily invalid', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-last-good-'));
    const entryFile = join(tempDir, 'app.rdsl');

    const validSource = `
app:
  name: "Invite Console"

model Invite:
  email: string @email

resource invites:
  model: Invite
  api: /api/invites
  create:
    fields:
      - email
    onSuccess:
      - toast:
          key: invites.sent
          values:
            recipient:
              ref: form.email
`;
    const invalidSource = `${validSource}
model Invite:
  name: string
`;

    writeFileSync(entryFile, validSource, 'utf8');
    const validResult = compileProjectState(entryFile, createSnapshotMap([]));
    expect(canUseSemanticAssistResult(validResult)).toBe(true);

    writeFileSync(entryFile, invalidSource, 'utf8');
    const invalidResult = compileProjectState(entryFile, createSnapshotMap([]));
    expect(canUseSemanticAssistResult(invalidResult)).toBe(false);

    const selected = selectSemanticAssistResult(invalidResult, validResult);
    expect(selected.usingFallback).toBe(true);
    expect(selected.result).toBe(validResult);

    const invalidLines = invalidSource.split(/\r?\n/);
    const refLine = invalidLines.findIndex((line) => line.includes('ref:')) + 1;
    const suggestions = collectToastCompletionSuggestions(
      invalidSource,
      normalizeFsPath(entryFile),
      refLine,
      20,
      selected.result.ir,
    );

    expect(suggestions.some((suggestion) => suggestion.label === 'form.email')).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.label === 'user.name')).toBe(true);
  });

  it('formats semantic assist status for current and fallback results', () => {
    expect(formatSemanticAssistStatus(false)).toBe('current compile');
    expect(formatSemanticAssistStatus(true)).toBe('last successful compile (fallback)');
  });

  it('appends fallback semantic status to completion details only when needed', () => {
    expect(formatSemanticAssistDetail('Descriptor message key', false)).toBe('Descriptor message key');
    expect(formatSemanticAssistDetail('Descriptor message key', true))
      .toBe('Descriptor message key [semantic: last successful compile (fallback)]');
  });

  it('formats status bar text and tooltip for current and fallback semantic states', () => {
    expect(formatSemanticAssistStatusBarText(false)).toBe('Loj: semantic current');
    expect(formatSemanticAssistStatusBarText(true)).toBe('Loj: semantic fallback');
    expect(formatSemanticAssistIssueSummary(0, 0)).toBeUndefined();
    expect(formatSemanticAssistIssueSummary(1, 0)).toBe('1 error');
    expect(formatSemanticAssistIssueSummary(0, 2)).toBe('2 warnings');
    expect(formatSemanticAssistIssueSummary(2, 1)).toBe('2 errors and 1 warning');
    expect(formatSemanticAssistPrimaryIssue([], [])).toBeUndefined();
    expect(formatSemanticAssistPrimaryIssue([{ phase: 'validate', message: 'Duplicate model User' }], []))
      .toBe('validate: Duplicate model User');
    expect(formatSemanticAssistPrimaryIssue([], [{ phase: 'normalize', message: '  Unknown page kind  ' }]))
      .toBe('normalize: Unknown page kind');
    expect(formatSemanticAssistStatusBarTooltip(false)).toBe('Hover and completion are using the current compile. Click to inspect the current semantic node.');
    expect(formatSemanticAssistStatusBarTooltip(true))
      .toBe('Hover and completion are using the last successful compile. Diagnostics still reflect the current source. Click to inspect the current semantic node.');
    expect(formatSemanticAssistStatusBarTooltip(true, 2, 1))
      .toBe('Hover and completion are using the last successful compile. Current source has 2 errors and 1 warning. Click to inspect the current semantic node.');
    expect(formatSemanticAssistStatusBarTooltip(true, 2, 1, 'validate: Duplicate model User'))
      .toBe('Hover and completion are using the last successful compile. Current source has 2 errors and 1 warning. First issue: validate: Duplicate model User. Click to inspect the current semantic node.');
    expect(shouldShowCurrentIssuesCommand(false, 1, 0)).toBe(false);
    expect(shouldShowCurrentIssuesCommand(true, 0, 0)).toBe(false);
    expect(shouldShowCurrentIssuesCommand(true, 1, 0)).toBe(true);
    expect(formatCurrentCompileIssueLine({
      phase: 'validate',
      message: ' Duplicate model User ',
      file: '/tmp/app.rdsl',
      line: 12,
      col: 4,
    })).toBe('- [validate] /tmp/app.rdsl:12:4 Duplicate model User');
  });

  it('sorts project diagnostics and formats quick-pick issue items', () => {
    const diagnostics = listProjectDiagnostics(new Map([
      ['/tmp/pages.rdsl', [{
        file: '/tmp/pages.rdsl',
        severity: 'warning',
        message: '[validate] Unused page block',
        phase: 'validate',
        range: {
          file: '/tmp/pages.rdsl',
          startLine: 18,
          startCol: 3,
          endLine: 18,
          endCol: 8,
        },
      }]],
      ['/tmp/app.rdsl', [{
        file: '/tmp/app.rdsl',
        severity: 'error',
        message: '[normalize] Duplicate model User',
        phase: 'normalize',
        nodeId: 'model.User',
        range: {
          file: '/tmp/app.rdsl',
          startLine: 4,
          startCol: 1,
          endLine: 4,
          endCol: 6,
        },
      }]],
    ]));

    expect(diagnostics.map((diagnostic) => diagnostic.file)).toEqual(['/tmp/app.rdsl', '/tmp/pages.rdsl']);
    expect(formatProjectDiagnosticLocation(diagnostics[0]!)).toBe('/tmp/app.rdsl:4:1');

    const items = buildCurrentIssueQuickPickItems(diagnostics);
    expect(items).toEqual([
      {
        label: 'error: [normalize] Duplicate model User',
        description: '/tmp/app.rdsl:4:1',
        detail: 'phase: normalize, node: model.User',
        diagnostic: diagnostics[0],
      },
      {
        label: 'warning: [validate] Unused page block',
        description: '/tmp/pages.rdsl:18:3',
        detail: 'phase: validate',
        diagnostic: diagnostics[1],
      },
    ]);
  });

  it('keeps view-aware toast ref diagnostics on the owning source file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-toast-diags-'));
    const entryFile = join(tempDir, 'app.rdsl');

    writeFileSync(entryFile, `
app:
  name: "Invite Console"

model Invite:
  email: string @email

resource invites:
  model: Invite
  api: /api/invites
  create:
    fields:
      - email
    onSuccess:
      - toast:
          key: invites.sent
          values:
            recipient:
              ref: record.email
            routeId:
              ref: params.id
`, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    expect(result.success).toBe(false);

    const diagnostics = collectCompileDiagnostics(result, normalizeFsPath(entryFile));
    const fileDiagnostics = diagnostics.get(normalizeFsPath(entryFile)) ?? [];
    expect(fileDiagnostics.some((issue) => issue.message.includes('create views do not expose record.* values'))).toBe(true);
    expect(fileDiagnostics.some((issue) => issue.message.includes('create views do not expose route params'))).toBe(true);
  });

  it('finds the most specific semantic node for a source location', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-hover-'));
    const { entryFile } = writeMultiFileProject(tempDir);

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    expect(result.success).toBe(true);
    expect(result.traceManifest).toBeDefined();

    const columnNode = result.traceManifest!.nodes.find((node) => node.id === 'resource.users.view.list.column.email');
    expect(columnNode?.sourceSpan).toBeDefined();

    const matchedNode = findMostSpecificTraceNode(
      result.traceManifest!,
      columnNode!.sourceSpan!.file,
      columnNode!.sourceSpan!.startLine,
      columnNode!.sourceSpan!.startCol,
    );

    expect(matchedNode?.id).toBe('resource.users.view.list.column.email');
  });

  it('finds build roots and relative generated paths for trace commands', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-build-root-'));
    const buildRoot = join(tempDir, 'out');
    mkdirSync(join(buildRoot, '.rdsl'), { recursive: true });
    mkdirSync(join(buildRoot, 'views'), { recursive: true });
    writeFileSync(join(buildRoot, '.rdsl', 'semantic-manifest.json'), '{}', 'utf8');
    writeFileSync(join(buildRoot, '.rdsl', 'trace-manifest.json'), '{}', 'utf8');
    writeFileSync(join(buildRoot, 'views', 'UsersList.tsx'), 'export {};\n', 'utf8');

    const buildRootResult = findContainingBuildRoot(join(buildRoot, 'views', 'UsersList.tsx'));
    expect(buildRootResult).toBe(normalizeFsPath(buildRoot));
    expect(toGeneratedFilePath(normalizeFsPath(buildRoot), join(buildRoot, 'views', 'UsersList.tsx'))).toBe('views/UsersList.tsx');
  });

  it('builds lightweight project overview quick-pick items from doctor payloads', () => {
    const items = buildProjectOverviewQuickPickItems('/workspace/examples/booking/loj.project.yaml', {
      app: { name: 'booking-demo' },
      running: true,
      targets: [
        { alias: 'frontend', type: 'web', validated: true },
        { alias: 'backend', type: 'api', validated: true },
      ],
      surfaceCounts: { resources: 4, readModels: 2, workflows: 1, rules: 3 },
      dev: { hostUrl: 'http://127.0.0.1:5173', backendUrl: 'http://127.0.0.1:3001' },
      services: [{ kind: 'host', targetAlias: 'frontend', url: 'http://127.0.0.1:5173' }],
      databases: [{ targetAlias: 'backend', phase: 'ready', composeFile: 'generated/backend/docker-compose.database.yaml' }],
      checks: [
        { severity: 'info', message: 'loj dev is currently running for this project' },
        { severity: 'warning', target: 'frontend', message: 'dev host dependencies are missing' },
      ],
    });

    expect(items[0]).toEqual(expect.objectContaining({
      kind: 'summary',
      label: 'App: booking-demo',
      description: 'running',
    }));
    expect(items.some((item) => item.kind === 'target' && item.label.includes('frontend (web)'))).toBe(true);
    expect(items.some((item) => item.kind === 'url' && item.label === 'Open frontend host')).toBe(true);
    expect(items.some((item) => item.kind === 'service' && item.label.includes('Inspect service: host (frontend)'))).toBe(true);
    expect(items.some((item) => item.kind === 'database' && item.label.includes('Inspect database: backend (ready)'))).toBe(true);
    expect(items.some((item) => item.kind === 'checks' && item.description === '0 errors, 1 warnings')).toBe(true);
    expect(items.at(-1)).toEqual(expect.objectContaining({ kind: 'output', label: 'Open full overview in output' }));
  });

  it('finds a linked @rules reference at the current cursor position', () => {
    const source = `
resource bookings:
  create:
    rules: '@rules("../rules/booking-create")'
`;

    const reference = findLinkedArtifactReferenceAtPosition(
      source,
      '/workspace/frontend/bookings.web.loj',
      4,
      25,
    );

    expect(reference).toEqual(expect.objectContaining({
      kind: 'rules',
      rawPath: '../rules/booking-create',
      sourceFile: '/workspace/frontend/bookings.web.loj',
    }));
    expect(reference?.resolvedCandidates).toContain('/workspace/rules/booking-create.rules.loj');
  });

  it('finds linked @fn and @style references at the current cursor position', () => {
    const source = `
page availability:
  custom: '@fn("../logic/availability")'
  style: '@style("../styles/theme")'
`;

    const fnReference = findLinkedArtifactReferenceAtPosition(
      source,
      '/workspace/frontend/pages/availability.web.loj',
      3,
      20,
    );
    expect(fnReference).toEqual(expect.objectContaining({
      kind: 'fn',
      rawPath: '../logic/availability',
    }));
    expect(fnReference?.resolvedCandidates).toContain('/workspace/frontend/logic/availability.ts');

    const styleReference = findLinkedArtifactReferenceAtPosition(
      source,
      '/workspace/frontend/pages/availability.web.loj',
      4,
      25,
    );
    expect(styleReference).toEqual(expect.objectContaining({
      kind: 'style',
      rawPath: '../styles/theme',
    }));
    expect(styleReference?.resolvedCandidates).toContain('/workspace/frontend/styles/theme.style.loj');
  });

  it('picks the most likely generated output target for the current source file', () => {
    const target = findLikelyGeneratedOutputTarget(
      '/workspace/frontend/pages/availability.web.loj',
      '/workspace/loj.project.yaml',
      [
        { alias: 'backend', type: 'api', entry: 'backend/app.api.loj', outDir: 'generated/backend' },
        { alias: 'frontend', type: 'web', entry: 'frontend/app.web.loj', outDir: 'generated/frontend' },
      ],
    );

    expect(target).toEqual(expect.objectContaining({
      alias: 'frontend',
      outDir: 'generated/frontend',
    }));
  });

  it('suggests descriptor toast property and ref completions from semantic context', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-toast-completion-'));
    const entryFile = join(tempDir, 'app.rdsl');

    const source = `
app:
  name: "Template Studio"

model Template:
  name: string
  status: enum(draft, active)

resource templates:
  model: Template
  api: /api/templates
  create:
    fields: [name, status]
    onSuccess:
      - toast:
          key: templates.created
          defaultMessage: "Template {name} created"
          values:
            recipient:
              
`;
    writeFileSync(entryFile, source, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    const lines = source.split(/\r?\n/);
    const propertyLine = lines.findIndex((line) => line.includes('defaultMessage: "Template {name} created"')) + 1;
    const propertySuggestions = collectToastCompletionSuggestions(
      source,
      normalizeFsPath(entryFile),
      propertyLine,
      11,
      result.ir,
    );
    expect(propertySuggestions.some((suggestion) => suggestion.label === 'key')).toBe(true);
    expect(propertySuggestions.some((suggestion) => suggestion.label === 'values')).toBe(true);

    const refLineSource = source.replace('            recipient:\n              \n', '            recipient:\n              ref: \n');
    const refLines = refLineSource.split(/\r?\n/);
    const refLine = refLines.findIndex((line) => line.includes('ref: ')) + 1;
    const refSuggestions = collectToastCompletionSuggestions(
      refLineSource,
      normalizeFsPath(entryFile),
      refLine,
      20,
      result.ir,
    );
    expect(refSuggestions.some((suggestion) => suggestion.label === 'form.name')).toBe(true);
    expect(refSuggestions.some((suggestion) => suggestion.label === 'user.name')).toBe(true);
    expect(refSuggestions.some((suggestion) => suggestion.label === 'record.name')).toBe(false);
  });

  it('offers a context-aware toast descriptor skeleton snippet on the toast anchor line', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-toast-anchor-snippet-'));
    const entryFile = join(tempDir, 'app.rdsl');
    const source = `
app:
  name: "Invite Console"

model Invite:
  email: string @email

resource invites:
  model: Invite
  api: /api/invites
  create:
    fields:
      - email
    onSuccess:
      - toast:
`;
    writeFileSync(entryFile, source, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    const lines = source.split(/\r?\n/);
    const toastLine = lines.findIndex((line) => line.includes('- toast:')) + 1;

    const suggestions = collectToastCompletionSuggestions(
      source,
      normalizeFsPath(entryFile),
      toastLine,
      15,
      result.ir,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe('toast descriptor');
    expect(suggestions[0].snippet).toBe(true);
    expect(suggestions[0].insertText).toContain('defaultMessage: "${2:Created {email\\}}"');
    expect(suggestions[0].insertText).toContain('${3:email}:');
    expect(suggestions[0].insertText).toContain('ref: ${4:form.email}');
  });

  it('offers a values entry snippet inside toast descriptor values blocks', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-toast-values-snippet-'));
    const entryFile = join(tempDir, 'app.rdsl');
    const source = `
app:
  name: "Template Studio"

model Template:
  name: string

resource templates:
  model: Template
  api: /api/templates
  edit:
    fields: [name]
    onSuccess:
      - toast:
          key: templates.updated
          defaultMessage: "Saved {name}"
          values:
            currentName:
              ref: form.name
            
`;
    writeFileSync(entryFile, source, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    const lines = source.split(/\r?\n/);
    expect(result.success).toBe(true);
    const valuesEntryLine = lines.findIndex(
      (line, index) => line.trim() === '' && (lines[index - 1] ?? '').includes('ref: form.name'),
    ) + 1;
    const suggestions = collectToastCompletionSuggestions(
      source,
      normalizeFsPath(entryFile),
      valuesEntryLine,
      13,
      result.ir,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe('value entry');
    expect(suggestions[0].insertText).toContain('${1:name}:');
    expect(suggestions[0].insertText).toContain('ref: ${2:form.name}');
  });

  it('prioritizes params.id and record refs in edit-view toast ref completions', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'reactdsl-vscode-toast-edit-completion-'));
    const entryFile = join(tempDir, 'app.rdsl');

    const source = `
app:
  name: "Template Studio"

model Template:
  name: string
  status: enum(draft, active)

resource templates:
  model: Template
  api: /api/templates
  edit:
    fields: [name, status]
    onSuccess:
      - toast:
          key: templates.updated
          values:
            routeId:
              ref:
`;
    writeFileSync(entryFile, source, 'utf8');

    const result = compileProjectState(entryFile, createSnapshotMap([]));
    const lines = source.split(/\r?\n/);
    const refLine = lines.findIndex((line) => line.includes('ref:')) + 1;
    const suggestions = collectToastCompletionSuggestions(
      source,
      normalizeFsPath(entryFile),
      refLine,
      19,
      result.ir,
    );

    expect(suggestions[0]?.label).toBe('params.id');
    expect(suggestions.findIndex((suggestion) => suggestion.label === 'record.name')).toBeGreaterThan(-1);
    expect(suggestions.findIndex((suggestion) => suggestion.label === 'form.name')).toBeGreaterThan(-1);
    expect(suggestions.findIndex((suggestion) => suggestion.label === 'params.id'))
      .toBeLessThan(suggestions.findIndex((suggestion) => suggestion.label === 'record.name'));
    expect(suggestions.findIndex((suggestion) => suggestion.label === 'record.name'))
      .toBeLessThan(suggestions.findIndex((suggestion) => suggestion.label === 'form.name'));
  });

  it('builds a quick fix for create-view record refs that should become form refs', () => {
    const source = `
resource invites:
  model: Invite
  api: /api/invites
  create:
    fields:
      - email
    onSuccess:
      - toast:
          key: invites.sent
          values:
            recipient:
              ref: record.email
`;
    const lines = source.split(/\r?\n/);
    const refLine = lines.findIndex((line) => line.includes('ref: record.email')) + 1;

    const fixes = collectToastQuickFixes(
      source,
      [
        {
          file: 'app.rdsl',
          severity: 'error',
          phase: 'validate',
          message: '[validate] toast.values.recipient ref "record.email" is not available in create views; create views do not expose record.* values, use form.email instead',
          range: {
            file: 'app.rdsl',
            startLine: refLine,
            startCol: 7,
            endLine: refLine,
            endCol: 32,
          },
        },
      ],
      refLine,
      20,
    );

    expect(fixes).toHaveLength(1);
    expect(fixes[0].title).toContain('Replace record.email with form.email');
    expect(fixes[0].replacement).toBe('form.email');
  });
});
