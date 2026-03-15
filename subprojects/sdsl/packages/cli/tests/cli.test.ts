import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const repoRoot = new URL('../../../../../', import.meta.url).pathname;

function createBuffers(cwd: string = repoRoot) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd,
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

class FakeRuntime {
  private watchers = new Map<string, Set<(eventType: string, fileName?: string) => void>>();

  watch(directory: string, listener: (eventType: string, fileName?: string) => void) {
    const normalized = directory.replace(/\\/g, '/');
    const listeners = this.watchers.get(normalized) ?? new Set();
    listeners.add(listener);
    this.watchers.set(normalized, listeners);
    return {
      close: () => {
        const current = this.watchers.get(normalized);
        if (!current) {
          return;
        }
        current.delete(listener);
        if (current.size === 0) {
          this.watchers.delete(normalized);
        }
      },
    };
  }

  emit(directory: string, fileName?: string) {
    const normalized = directory.replace(/\\/g, '/');
    const listeners = this.watchers.get(normalized);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener('change', fileName);
    }
  }
}

function writeExampleProject(rootDir: string, compilerBlock: string = '') {
  mkdirSync(join(rootDir, 'models'), { recursive: true });
  mkdirSync(join(rootDir, 'resources'), { recursive: true });

  const entryFile = join(rootDir, 'app.api.loj');
  writeFileSync(entryFile, `
app:
  name: "User Service"
  package: "com.example.userservice"
${compilerBlock}

imports:
  - ./models/
  - ./resources/
`, 'utf8');

  writeFileSync(join(rootDir, 'models', 'user.api.loj'), `
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, SUPPORT, VIEWER) @required
  active: boolean
  createdAt: datetime @createdAt
  updatedAt: datetime @updatedAt
`, 'utf8');

  writeFileSync(join(rootDir, 'resources', 'users.api.loj'), `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
  operations:
    delete: false
`, 'utf8');

  return entryFile;
}

function writePolicyProtectedExampleProject(rootDir: string, compilerBlock: string = '', policyFileName: string = 'canManageUsers.java') {
  const entryFile = writeExampleProject(rootDir, compilerBlock);
  mkdirSync(join(rootDir, 'resources', 'policies'), { recursive: true });
  writeFileSync(join(rootDir, 'resources', 'users.api.loj'), `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
    policy: '@fn("./policies/${policyFileName.replace(/\.(java|py)$/, '')}")'
  operations:
    delete: false
`, 'utf8');
  writeFileSync(join(rootDir, 'resources', 'policies', policyFileName), policyFileName.endsWith('.py')
    ? 'return "ADMIN" in principal.roles\n'
    : 'return principal.hasRole("ADMIN");\n', 'utf8');
  return entryFile;
}

function writeRulesProtectedExampleProject(rootDir: string, compilerBlock: string = '') {
  const entryFile = writeExampleProject(rootDir, compilerBlock);
  mkdirSync(join(rootDir, 'resources', 'policies'), { recursive: true });
  writeFileSync(join(rootDir, 'resources', 'users.api.loj'), `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
    policy: '@rules("./policies/user-access")'
`, 'utf8');
  writeFileSync(join(rootDir, 'resources', 'policies', 'user-access.rules.loj'), `
rules user-access:
  allow list:
    when: currentUser.role == ADMIN

  allow get:
    when: currentUser.role == ADMIN

  deny delete:
    when: record.email == "blocked@example.com"
    message:
      defaultMessage: "Blocked users cannot be deleted."
`, 'utf8');
  return entryFile;
}

describe('sdsl cli', () => {
  it('validates a multi-file project', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-validate-'));
    const entryFile = writeExampleProject(rootDir);
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['validate', entryFile.replace(`${rootDir}/`, '')], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Validation passed');
    expect(stdout.join('')).toContain('target: spring-boot/java/mvc-jpa-security');
  });

  it('writes generated spring project files', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-build-'));
    const entryFile = writeExampleProject(rootDir);
    const outDir = 'generated';
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['build', entryFile.replace(`${rootDir}/`, ''), '--out-dir', outDir], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Built SDSL project');
    expect(stdout.join('')).toContain('target: spring-boot/java/mvc-jpa-security');
    expect(existsSync(join(rootDir, outDir, 'pom.xml'))).toBe(true);
    expect(existsSync(join(rootDir, outDir, 'src', 'main', 'resources', 'application.properties'))).toBe(true);
    const applicationClass = readFileSync(
      join(rootDir, outDir, 'src', 'main', 'java', 'com', 'example', 'userservice', 'UserServiceApplication.java'),
      'utf8',
    );
    expect(applicationClass).toContain('@SpringBootApplication');
  });

  it('prunes stale generated backend files on rebuild', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-prune-'));
    mkdirSync(join(rootDir, 'read-models'), { recursive: true });
    const entryFile = join(rootDir, 'app.api.loj');
    const outDir = 'generated';
    writeFileSync(entryFile, `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    travelDate: date @required
  result:
    flightNumber: string
  handler: '@fn("./read-models/flightAvailability")'
`, 'utf8');
    writeFileSync(join(rootDir, 'read-models', 'flightAvailability.java'), 'return List.of();\n', 'utf8');
    const firstBuffers = createBuffers(rootDir);

    const firstExitCode = runCli(['build', 'app.api.loj', '--out-dir', outDir], firstBuffers.io);

    expect(firstExitCode).toBe(0);
    expect(existsSync(join(rootDir, outDir, 'src', 'main', 'java', 'com', 'example', 'flights', 'dto', 'FlightAvailabilityReadModelInput.java'))).toBe(true);

    writeFileSync(entryFile, `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel outwardFlightAvailability:
  api: /api/outward-flight-availability
  auth:
    mode: public
  inputs:
    outwardDate: date @required
  result:
    flightNumber: string
  handler: '@fn("./read-models/outwardFlightAvailability")'
`, 'utf8');
    writeFileSync(join(rootDir, 'read-models', 'outwardFlightAvailability.java'), 'return List.of();\n', 'utf8');
    const secondBuffers = createBuffers(rootDir);

    const secondExitCode = runCli(['build', 'app.api.loj', '--out-dir', outDir], secondBuffers.io);

    expect(secondExitCode).toBe(0);
    expect(existsSync(join(rootDir, outDir, 'src', 'main', 'java', 'com', 'example', 'flights', 'dto', 'OutwardFlightAvailabilityReadModelInput.java'))).toBe(true);
    expect(existsSync(join(rootDir, outDir, 'src', 'main', 'java', 'com', 'example', 'flights', 'dto', 'FlightAvailabilityReadModelInput.java'))).toBe(false);
  });

  it('prints json validation failures', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-error-'));
    const entryFile = join(rootDir, 'app.sdsl');
    writeFileSync(entryFile, `
app:
  name: "Broken Service"
  package: "com.example.broken"

model User:
  id: string

resource users:
  model: User
  api: /api/users
  operations:
    list: false
    get: false
    create: false
    update: false
    delete: false
`, 'utf8');
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['validate', 'app.sdsl', '--json'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.success).toBe(false);
    expect(payload.errors.some((error: { message: string }) => error.message.includes('must not define "id"'))).toBe(true);
    expect(payload.errors.some((error: { message: string }) => error.message.includes('must enable at least one CRUD operation'))).toBe(true);
  });

  it('returns escape stats in json validation output', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-escape-json-'));
    const entryFile = writePolicyProtectedExampleProject(rootDir);
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['validate', entryFile.replace(`${rootDir}/`, ''), '--json'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join(''));
    expect(payload.success).toBe(true);
    expect(payload.escapeStats).toBeDefined();
    expect(payload.escapeStats.fnCount).toBe(1);
    expect(typeof payload.escapeStats.escapePercent).toBe('number');
  });

  it('warns when validating a legacy .sdsl entry file', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-legacy-warning-'));
    const canonicalEntryFile = writeExampleProject(rootDir);
    const entryFile = join(rootDir, 'app.sdsl');
    writeFileSync(entryFile, readFileSync(canonicalEntryFile, 'utf8'), 'utf8');
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['validate', 'app.sdsl'], io);

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Validation passed: app.sdsl');
    expect(stderr.join('')).toContain('Prefer .api.loj over .sdsl');
  });

  it('writes generated fastapi project files', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-fastapi-'));
    const entryFile = writeExampleProject(rootDir, `

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth
`);
    const { stdout, stderr, io } = createBuffers(rootDir);

    const exitCode = runCli(['build', entryFile.replace(`${rootDir}/`, ''), '--out-dir', 'generated-fastapi'], io);

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Built SDSL project');
    expect(stdout.join('')).toContain('target: fastapi/python/rest-sqlalchemy-auth');
    expect(existsSync(join(rootDir, 'generated-fastapi', 'pyproject.toml'))).toBe(true);
    expect(existsSync(join(rootDir, 'generated-fastapi', 'app', 'main.py'))).toBe(true);
    expect(existsSync(join(rootDir, 'generated-fastapi', 'tests', 'test_users_api.py'))).toBe(true);
    const main = readFileSync(join(rootDir, 'generated-fastapi', 'app', 'main.py'), 'utf8');
    expect(main).toContain('FastAPI(title=SETTINGS.app_name)');
  });

  it('starts dev mode and rebuilds when an imported source file changes', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-dev-'));
    const entryFile = writeExampleProject(rootDir);
    const runtime = new FakeRuntime();
    const { stdout, stderr, io } = createBuffers(rootDir);
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', entryFile.replace(`${rootDir}/`, ''), '--out-dir', 'generated'], {
      ...io,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Dev build complete (initial)');
    expect(existsSync(join(rootDir, 'generated', 'pom.xml'))).toBe(true);

    writeFileSync(join(rootDir, 'resources', 'users.api.loj'), `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
  operations:
    delete: true
`, 'utf8');
    runtime.emit(join(rootDir, 'resources'), 'users.api.loj');

    expect(stdout.join('')).toContain('Change detected: users.api.loj');
    expect(stdout.join('')).toContain('Dev build complete (change)');

    session?.close();
  });

  it('watches directory imports for newly added backend-family modules in dev mode', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-dev-dir-'));
    writeExampleProject(rootDir);
    const runtime = new FakeRuntime();
    const { stdout, stderr, io } = createBuffers(rootDir);
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'app.api.loj', '--out-dir', 'generated'], {
      ...io,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');

    writeFileSync(join(rootDir, 'models', 'team.api.loj'), `
model Team:
  name: string @required
`, 'utf8');
    writeFileSync(join(rootDir, 'resources', 'teams.api.loj'), `
resource teams:
  model: Team
  api: /api/teams
`, 'utf8');

    runtime.emit(join(rootDir, 'models'), 'team.api.loj');
    runtime.emit(join(rootDir, 'resources'), 'teams.api.loj');

    expect(stdout.join('')).toContain('Dev build complete (change)');
    expect(existsSync(join(rootDir, 'generated', 'src', 'main', 'java', 'com', 'example', 'userservice', 'controller', 'TeamsController.java'))).toBe(true);

    session?.close();
  });

  it('watches backend auth.policy host files in dev mode', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-dev-policy-'));
    writePolicyProtectedExampleProject(rootDir);
    const runtime = new FakeRuntime();
    const { stdout, stderr, io } = createBuffers(rootDir);
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'app.api.loj', '--out-dir', 'generated'], {
      ...io,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Dev build complete (initial)');

    writeFileSync(join(rootDir, 'resources', 'policies', 'canManageUsers.java'), 'return operation.equals("list");\n', 'utf8');
    runtime.emit(join(rootDir, 'resources', 'policies'), 'canManageUsers.java');

    expect(stdout.join('')).toContain('Change detected: canManageUsers.java');
    expect(stdout.join('')).toContain('Dev build complete (change)');

    session?.close();
  });

  it('watches backend @rules auth.policy files in dev mode', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sdsl-cli-dev-rules-'));
    writeRulesProtectedExampleProject(rootDir);
    const runtime = new FakeRuntime();
    const { stdout, stderr, io } = createBuffers(rootDir);
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'app.api.loj', '--out-dir', 'generated'], {
      ...io,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Dev build complete (initial)');

    writeFileSync(join(rootDir, 'resources', 'policies', 'user-access.rules.loj'), `
rules user-access:
  allow list:
    when: currentUser.role in [ADMIN, SUPPORT]

  allow get:
    when: currentUser.role in [ADMIN, SUPPORT]
`, 'utf8');
    runtime.emit(join(rootDir, 'resources', 'policies'), 'user-access.rules.loj');

    expect(stdout.join('')).toContain('Change detected: user-access.rules.loj');
    expect(stdout.join('')).toContain('Dev build complete (change)');

    session?.close();
  });
});
