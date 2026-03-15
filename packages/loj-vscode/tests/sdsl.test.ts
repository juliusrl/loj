import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canUseSdslSemanticAssistResult,
  collectSdslCompileDiagnostics,
  compileSdslProjectState,
  containsSdslAppBlock,
  findMostSpecificSdslNode,
  findSdslProjectEntry,
  sdslNodeInspectionToLines,
  selectSdslSemanticAssistResult,
} from '../src/sdsl.js';
import { createSnapshotMap, normalizeFsPath } from '../src/core.js';

function writeMultiFileProject(rootDir: string) {
  mkdirSync(join(rootDir, 'models'), { recursive: true });
  mkdirSync(join(rootDir, 'resources'), { recursive: true });

  const entryFile = join(rootDir, 'app.sdsl');
  const modelFile = join(rootDir, 'models', 'user.sdsl');
  const resourceFile = join(rootDir, 'resources', 'users.sdsl');

  writeFileSync(entryFile, `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./models/user.sdsl
  - ./resources/users.sdsl
`, 'utf8');

  writeFileSync(modelFile, `
model User:
  email: string @required @email
`, 'utf8');

  writeFileSync(resourceFile, `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
`, 'utf8');

  return { entryFile, modelFile, resourceFile };
}

describe('sdsl vscode helpers', () => {
  it('detects app blocks and resolves the root entry for imported modules', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sdsl-vscode-entry-'));
    const { entryFile, resourceFile } = writeMultiFileProject(tempDir);

    expect(containsSdslAppBlock(readFileSync(entryFile, 'utf8'))).toBe(true);
    expect(containsSdslAppBlock(readFileSync(resourceFile, 'utf8'))).toBe(false);

    const resolved = findSdslProjectEntry(resourceFile, [entryFile], (fileName) => {
      try {
        return readFileSync(fileName, 'utf8');
      } catch {
        return null;
      }
    });

    expect(resolved).toBe(normalizeFsPath(entryFile));
  });

  it('maps duplicate-model diagnostics back to the owning module files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sdsl-vscode-diags-'));
    mkdirSync(join(tempDir, 'models'), { recursive: true });

    const entryFile = join(tempDir, 'app.sdsl');
    const leftModelFile = join(tempDir, 'models', 'left.sdsl');
    const rightModelFile = join(tempDir, 'models', 'right.sdsl');

    writeFileSync(entryFile, `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./models/left.sdsl
  - ./models/right.sdsl

resource users:
  model: User
  api: /api/users
`, 'utf8');
    writeFileSync(leftModelFile, `
model User:
  email: string
`, 'utf8');
    writeFileSync(rightModelFile, `
model User:
  role: enum(ADMIN, VIEWER)
`, 'utf8');

    const result = compileSdslProjectState(entryFile, createSnapshotMap([]));
    expect(result.success).toBe(false);

    const diagnostics = collectSdslCompileDiagnostics(result, normalizeFsPath(entryFile));
    expect(diagnostics.get(normalizeFsPath(leftModelFile))?.some((issue) => issue.message.includes('Duplicate model'))).toBe(true);
    expect(diagnostics.get(normalizeFsPath(rightModelFile))?.some((issue) => issue.message.includes('Duplicate model'))).toBe(true);
  });

  it('finds the most specific semantic node and formats sdsl inspection lines', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sdsl-vscode-hover-'));
    const { entryFile } = writeMultiFileProject(tempDir);

    const result = compileSdslProjectState(entryFile, createSnapshotMap([]));
    expect(result.success).toBe(true);
    expect(canUseSdslSemanticAssistResult(result)).toBe(true);

    const targetNode = result.ir!.resources[0].auth;
    const matchedNode = findMostSpecificSdslNode(
      result.ir!,
      targetNode.sourceSpan!.file,
      targetNode.sourceSpan!.startLine,
      targetNode.sourceSpan!.startCol,
    );

    expect(matchedNode?.id).toBe('resource.users.auth');
    expect(sdslNodeInspectionToLines(matchedNode!)).toEqual([
      'mode: authenticated',
      'roles: ADMIN',
    ]);
  });

  it('reuses the last good semantic result when the current sdsl source becomes invalid', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sdsl-vscode-last-good-'));
    const entryFile = join(tempDir, 'app.sdsl');

    const validSource = `
app:
  name: "User Service"
  package: "com.example.users"

model User:
  email: string @required @email

resource users:
  model: User
  api: /api/users
`;
    const invalidSource = `
app:
  name: "User Service"
  package: "com.example.users"

model User:
  email: unsupported

resource users:
  model: User
  api: /api/users
`;

    writeFileSync(entryFile, validSource, 'utf8');
    const validResult = compileSdslProjectState(entryFile, createSnapshotMap([]));
    expect(canUseSdslSemanticAssistResult(validResult)).toBe(true);

    writeFileSync(entryFile, invalidSource, 'utf8');
    const invalidResult = compileSdslProjectState(entryFile, createSnapshotMap([]));
    expect(canUseSdslSemanticAssistResult(invalidResult)).toBe(false);

    const selected = selectSdslSemanticAssistResult(invalidResult, validResult);
    expect(selected.usingFallback).toBe(true);
    expect(selected.result).toBe(validResult);
  });
});
