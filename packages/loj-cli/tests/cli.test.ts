import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import type { CliRuntime } from '../src/index.js';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(testDir, '..', '..', '..');

function createTempProject(options: { backendCompilerBlock?: string; backendEntry?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'loj-cli-'));
  mkdirSync(join(root, 'frontend'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  const backendEntry = options.backendEntry ?? 'backend/app.api.loj';

  writeFileSync(join(root, 'frontend', 'app.web.loj'), `
app:
  name: "Admin Frontend"

compiler:
  target: react

model User:
  name: string @required

resource users:
  model: User
  api: /api/users
`, 'utf8');

  writeFileSync(join(root, backendEntry), `
app:
  name: "User Service"
  package: "com.example.userservice"

${options.backendCompilerBlock ?? ''}

model User:
  name: string @required

resource users:
  model: User
  api: /api/users
`, 'utf8');

  writeFileSync(join(root, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: ${backendEntry}
    outDir: generated/backend
`, 'utf8');

  return root;
}

function createTempSkillBundle(name = 'demo-skill'): string {
  const root = mkdtempSync(join(tmpdir(), 'loj-cli-skill-'));
  const skillRoot = join(root, name);
  mkdirSync(join(skillRoot, 'references'), { recursive: true });
  writeFileSync(join(skillRoot, 'SKILL.md'), `# ${name}\n`, 'utf8');
  writeFileSync(join(skillRoot, 'metadata.json'), '{"version":"1.0.0"}\n', 'utf8');
  writeFileSync(join(skillRoot, 'references', 'guide.md'), '# guide\n', 'utf8');
  return skillRoot;
}

function writeDevConfig(
  root: string,
  overrides: {
    hostDir?: string;
    hostPort?: number;
    previewPort?: number;
    backendPort?: number;
    proxyAuth?: string | null;
    backendEntry?: string;
    backendOutDir?: string;
  } = {},
) {
  const hostDir = overrides.hostDir ?? 'host';
  const hostPort = overrides.hostPort ?? 5173;
  const previewPort = overrides.previewPort ?? 4173;
  const backendPort = overrides.backendPort ?? 3001;
  const proxyAuth = overrides.proxyAuth === undefined ? 'admin:admin123' : overrides.proxyAuth;
  const backendEntry = overrides.backendEntry ?? 'backend/app.api.loj';
  const backendOutDir = overrides.backendOutDir ?? 'generated/backend';
  writeFileSync(join(root, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: ${backendEntry}
    outDir: ${backendOutDir}

dev:
  host:
    type: react-vite
    target: frontend
    dir: ${hostDir}
    apiBase: /api
    port: ${hostPort}
    previewPort: ${previewPort}
    proxyTarget: backend
${proxyAuth ? `    proxyAuth: ${proxyAuth}` : ''}
  server:
    target: backend
    port: ${backendPort}
`, 'utf8');
}

class FakeProcess {
  exitCode: number | null = null;
  signalCode: string | null = null;
  closeSignals: string[] = [];
  private readonly stdoutListeners = new Set<(line: string) => void>();
  private readonly stderrListeners = new Set<(line: string) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>();

  onStdoutLine(listener?: (line: string) => void) {
    if (listener) {
      this.stdoutListeners.add(listener);
    }
  }

  onStderrLine(listener?: (line: string) => void) {
    if (listener) {
      this.stderrListeners.add(listener);
    }
  }

  onExit(listener?: (code: number | null, signal: string | null) => void) {
    if (listener) {
      this.exitListeners.add(listener);
    }
  }

  emitStdout(line: string) {
    for (const listener of this.stdoutListeners) {
      listener(line);
    }
  }

  emitStderr(line: string) {
    for (const listener of this.stderrListeners) {
      listener(line);
    }
  }

  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }

  close(signal = 'SIGINT') {
    this.closeSignals.push(signal);
    this.signalCode = signal;
  }
}

class FakeRuntime implements CliRuntime {
  private watchers = new Map<string, Set<(eventType: string, fileName?: string) => void>>();
  readonly spawns: Array<{
    command: string;
    args: string[];
    options: {
      cwd: string;
      env?: Record<string, string | undefined>;
    };
    process: FakeProcess;
  }> = [];

  watch(directory: string, listener: (eventType: string, fileName?: string) => void) {
    const normalized = normalizePath(directory);
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

  spawn(command: string, args: string[], options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    onExit?: (code: number | null, signal: string | null) => void;
  }) {
    const process = new FakeProcess();
    process.onStdoutLine(options.onStdoutLine);
    process.onStderrLine(options.onStderrLine);
    process.onExit(options.onExit);
    this.spawns.push({
      command,
      args,
      options: {
        cwd: options.cwd,
        env: options.env,
      },
      process,
    });
    return process;
  }

  exists(path: string) {
    return existsSync(path);
  }

  npmCommand() {
    return 'npm';
  }

  emit(directory: string, fileName?: string) {
    const normalized = normalizePath(directory);
    const listeners = this.watchers.get(normalized);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener('change', fileName);
    }
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('loj-cli', () => {
  it('keeps bundled agent assets in sync with the source skill bundle', () => {
    const sourceRoot = resolve(repoRoot, 'skills', 'loj-authoring');
    const bundledRoot = resolve(repoRoot, 'packages', 'loj-cli', 'agent-assets', 'loj-authoring');
    const relativeFiles = [
      'SKILL.md',
      'metadata.json',
      'agents/openai.yaml',
      'references/backend-family.md',
      'references/backend-targets.md',
      'references/frontend-family.md',
      'references/frontend-runtime-trace.md',
      'references/policy-rules-proof.md',
      'references/project-and-transport.md',
    ];

    for (const relativePath of relativeFiles) {
      const sourcePath = join(sourceRoot, relativePath);
      const bundledPath = join(bundledRoot, relativePath);
      expect(existsSync(sourcePath), `${relativePath} should exist in skills/loj-authoring`).toBe(true);
      expect(existsSync(bundledPath), `${relativePath} should exist in packages/loj-cli/agent-assets`).toBe(true);
      expect(readUtf8(bundledPath)).toBe(readUtf8(sourcePath));
    }
  });

  it('installs the bundled skill into CODEX_HOME for codex user scope', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-agent-user-'));
    const codexHome = join(cwd, 'codex-home');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['agent', 'install', 'codex'], {
      cwd,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
      },
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Installed bundled loj-authoring for codex');
    expect(stdout.join('')).toContain(`destination: ${normalizePath(join(codexHome, 'skills', 'loj-authoring'))}`);
    expect(existsSync(join(codexHome, 'skills', 'loj-authoring', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(codexHome, 'skills', 'loj-authoring', 'references', 'frontend-family.md'))).toBe(true);
    expect(existsSync(join(codexHome, 'skills', 'loj-authoring', 'agents', 'openai.yaml'))).toBe(true);
  });

  it('vendors the bundled skill into project scope for codex', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-agent-project-'));
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['agent', 'install', 'codex', '--scope', 'project', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join('')) as {
      artifact: string;
      schemaVersion: number;
      scope: string;
      destination: string;
      autoDiscovered: boolean;
      note?: string;
    };
    expect(payload.artifact).toBe('loj.agent.install.result');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.scope).toBe('project');
    expect(payload.autoDiscovered).toBe(false);
    expect(payload.destination).toBe(normalizePath(join(cwd, '.loj', 'agents', 'codex', 'skills', 'loj-authoring')));
    expect(payload.note).toContain('Project scope vendors a pinned copy only');
    expect(existsSync(join(cwd, '.loj', 'agents', 'codex', 'skills', 'loj-authoring', 'SKILL.md'))).toBe(true);
  });

  it('exports the bundled skill into a custom directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-agent-export-'));
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['agent', 'export', 'codex', '--out-dir', 'tooling/skills'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Exported loj-authoring for codex');
    expect(stdout.join('')).toContain(`destination: ${normalizePath(join(cwd, 'tooling', 'skills', 'loj-authoring'))}`);
    expect(existsSync(join(cwd, 'tooling', 'skills', 'loj-authoring', 'metadata.json'))).toBe(true);
  });

  it('adds a local skill bundle into an explicit skills directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-agent-add-'));
    const sourceSkill = createTempSkillBundle('custom-skill');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['agent', 'add', 'generic', '--from', sourceSkill, '--skills-dir', './external-skills'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Added custom-skill for generic');
    expect(stdout.join('')).toContain(`destination: ${normalizePath(join(cwd, 'external-skills', 'custom-skill'))}`);
    expect(existsSync(join(cwd, 'external-skills', 'custom-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, 'external-skills', 'custom-skill', 'references', 'guide.md'))).toBe(true);
  });

  it('installs the bundled skill into windsurf default user scope', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-agent-windsurf-'));
    const windsurfHome = join(cwd, 'windsurf-home');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['agent', 'install', 'windsurf'], {
      cwd,
      env: {
        ...process.env,
        WINDSURF_HOME: windsurfHome,
      },
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Installed bundled loj-authoring for windsurf');
    expect(stdout.join('')).toContain(`destination: ${normalizePath(join(windsurfHome, 'skills', 'loj-authoring'))}`);
    expect(existsSync(join(windsurfHome, 'skills', 'loj-authoring', 'SKILL.md'))).toBe(true);
  });

  it('validates a full-stack loj project', () => {
    const cwd = createTempProject();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['validate', 'loj.project.yaml'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('| loj validate');
    expect(stdout.join('')).toContain('overview:');
    expect(stdout.join('')).toContain('targets:');
    expect(stdout.join('')).toContain('next:');
    expect(stdout.join('')).toContain('Validation passed: loj.project.yaml');
    expect(stdout.join('')).toContain('frontend (web)');
    expect(stdout.join('')).toContain('backend (api)');
  });

  it('warns when a project target uses legacy rdsl/sdsl naming', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'frontend', 'app.rdsl'), readFileSync(join(cwd, 'frontend', 'app.web.loj'), 'utf8'), 'utf8');
    writeFileSync(join(cwd, 'backend', 'app.sdsl'), readFileSync(join(cwd, 'backend', 'app.api.loj'), 'utf8'), 'utf8');
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: Legacy Project

targets:
  frontend:
    type: rdsl
    entry: frontend/app.rdsl
    outDir: generated/frontend
  backend:
    type: sdsl
    entry: backend/app.sdsl
    outDir: generated/backend
`, 'utf8');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['validate', 'loj.project.yaml'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Validation passed: loj.project.yaml');
    expect(stderr.join('')).toContain('legacy type "rdsl"');
    expect(stderr.join('')).toContain('Prefer .web.loj over .rdsl');
    expect(stderr.join('')).toContain('legacy type "sdsl"');
    expect(stderr.join('')).toContain('Prefer .api.loj over .sdsl');
  });

  it('validates shared linked rules and workflows through the project shell without target-local duplicates', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'rules'), { recursive: true });
    mkdirSync(join(cwd, 'workflows'), { recursive: true });

    writeFileSync(join(cwd, 'frontend', 'app.web.loj'), `
app:
  name: "Booking Frontend"

compiler:
  target: react

model Booking:
  reference: string @required
  status: enum(DRAFT, READY)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("../workflows/booking-lifecycle")'
  create:
    fields:
      - reference
    rules: '@rules("../rules/booking-create")'
`, 'utf8');

    writeFileSync(join(cwd, 'backend', 'app.api.loj'), `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required
  status: enum(DRAFT, READY)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("../workflows/booking-lifecycle")'
  create:
    rules: '@rules("../rules/booking-create-api")'
`, 'utf8');

    writeFileSync(join(cwd, 'rules', 'booking-create.rules.loj'), `
rules bookingCreate:
  eligibility agent-only:
    when: currentUser.role == "agent"
    message: "Only agents may create bookings"
`, 'utf8');

    writeFileSync(join(cwd, 'rules', 'booking-create-api.rules.loj'), `
rules bookingCreateApi:
  validate reference-required:
    when: payload.reference != ""
    message: "Reference is required"
`, 'utf8');

    writeFileSync(join(cwd, 'workflows', 'booking-lifecycle.flow.loj'), `
workflow bookingLifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
  wizard:
    steps:
      - name: booking_form
        completesWith: DRAFT
        surface: form
      - name: review
        completesWith: READY
        surface: workflow
  transitions:
    confirm:
      from: DRAFT
      to: READY
`, 'utf8');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['validate', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join('')) as {
      success: boolean;
      targets: Record<string, { success: boolean; result: { escapeStats: { escapePercent: number } | null } }>;
    };
    expect(payload.success).toBe(true);
    expect(payload.targets.frontend.success).toBe(true);
    expect(payload.targets.backend.success).toBe(true);
    expect(payload.targets.frontend.result.escapeStats).toBeTruthy();
    expect(payload.targets.backend.result.escapeStats).toBeTruthy();
  });

  it('builds both target outputs into their configured directories', () => {
    const cwd = createTempProject();
    const stdout: string[] = [];
    const exitCode = runCli(['build', 'loj.project.yaml'], {
      cwd,
      stdout: (text) => stdout.push(text),
    });
    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('| loj build');
    expect(stdout.join('')).toContain('next:');
    expect(existsSync(join(cwd, 'generated', 'frontend', 'App.tsx'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'frontend', '.rdsl', 'semantic-manifest.json'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'pom.xml'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'src', 'main', 'java', 'com', 'example', 'userservice', 'UserServiceApplication.java'))).toBe(true);
  });

  it('builds a spring backend with a postgres database runtime profile', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: postgres
      mode: docker-compose
      name: demo_app
      username: demo
      password: secret
      migrations: flyway
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pom.xml'))).toContain('<artifactId>postgresql</artifactId>');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pom.xml'))).toContain('<artifactId>flyway-core</artifactId>');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'))).toContain('jdbc:postgresql://127.0.0.1:5432/demo_app');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'))).toContain('spring.flyway.enabled=true');
    expect(existsSync(join(cwd, 'generated', 'backend', 'src', 'test', 'resources', 'application.properties'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', '.env.database.example'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'docker-compose.database.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'db', 'migration', 'V1__baseline.sql'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'schema.sql'))).toBe(true);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'db', 'migration', 'V1__baseline.sql'))).toContain('CREATE TABLE user_records');
  });

  it('builds a fastapi backend with a mysql database runtime profile', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    database:
      vendor: mysql
      mode: docker-compose
      name: demo_app
      username: demo
      password: secret
      migrations: native-sql
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pyproject.toml'))).toContain('"pymysql>=1.1,<2"');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'app', 'config.py'))).toContain('mysql+pymysql://demo:secret@127.0.0.1:3306/demo_app');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'README.md'))).toContain('mysql+pymysql://demo:secret@127.0.0.1:3306/demo_app');
    expect(existsSync(join(cwd, 'generated', 'backend', '.env.database.example'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'docker-compose.database.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'schema.sql'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'native-migrations', 'V1__baseline.sql'))).toBe(true);
  });

  it('builds a spring backend with a mariadb database runtime profile', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: mariadb
      mode: docker-compose
      name: demo_app
      username: demo
      password: secret
      migrations: native-sql
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pom.xml'))).toContain('<artifactId>mariadb-java-client</artifactId>');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'))).toContain('jdbc:mariadb://127.0.0.1:3306/demo_app');
    expect(existsSync(join(cwd, 'generated', 'backend', 'docker-compose.database.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'native-migrations', 'V1__baseline.sql'))).toBe(true);
  });

  it('builds a fastapi backend with a sqlserver database runtime profile', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    database:
      vendor: sqlserver
      mode: external
      name: demo_app
      username: sa
      password: LojPassw0rd!
      migrations: native-sql
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pyproject.toml'))).toContain('"pyodbc>=5,<6"');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'app', 'config.py'))).toContain('mssql+pyodbc://sa:LojPassw0rd!@127.0.0.1:1433/demo_app');
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'native-migrations', 'V1__baseline.sql'))).toBe(true);
  });

  it('builds a spring backend with an oracle database runtime profile', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: oracle
      mode: external
      name: FREEPDB1
      username: demo
      password: LojPassw0rd!
      migrations: native-sql
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    expect(readUtf8(join(cwd, 'generated', 'backend', 'pom.xml'))).toContain('<artifactId>ojdbc11</artifactId>');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'))).toContain('jdbc:oracle:thin:@//127.0.0.1:1521/FREEPDB1');
    expect(existsSync(join(cwd, 'generated', 'backend', 'db', 'native-migrations', 'V1__baseline.sql'))).toBe(true);
  });

  it('builds a spring backend with graceful shutdown runtime settings', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      shutdown:
        mode: graceful
        timeout: 45s
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    const applicationProperties = readUtf8(join(cwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'));
    expect(applicationProperties).toContain('server.shutdown=graceful');
    expect(applicationProperties).toContain('spring.lifecycle.timeout-per-shutdown-phase=45s');
  });

  it('builds a fastapi backend with graceful shutdown runtime settings', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      shutdown:
        mode: graceful
        timeout: 45s
`, 'utf8');

    const exitCode = runCli(['build', 'loj.project.yaml'], { cwd });
    expect(exitCode).toBe(0);
    const mainSource = readUtf8(join(cwd, 'generated', 'backend', 'app', 'main.py'));
    expect(mainSource).toContain('from contextlib import asynccontextmanager');
    expect(mainSource).toContain('def loj_graceful_shutdown_lifespan');
    expect(mainSource).toContain('app = FastAPI(title=SETTINGS.app_name, lifespan=loj_graceful_shutdown_lifespan)');
    expect(readUtf8(join(cwd, 'generated', 'backend', 'README.md'))).toContain('--timeout-graceful-shutdown 45');
  });

  it('builds runtime health/readiness/drain endpoints for spring and fastapi targets', () => {
    const springCwd = createTempProject();
    writeFileSync(join(springCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      shutdown:
        mode: graceful
        timeout: 45s
      health:
        path: /healthz
      readiness:
        path: /readyz
      drain:
        path: /drainz
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: springCwd })).toBe(0);
    const springController = readUtf8(join(springCwd, 'generated', 'backend', 'src', 'main', 'java', 'com', 'example', 'userservice', 'runtime', 'LojRuntimeController.java'));
    expect(springController).toContain('@GetMapping("/healthz")');
    expect(springController).toContain('@GetMapping("/readyz")');
    expect(springController).toContain('@PostMapping("/drainz")');

    const fastapiCwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      shutdown:
        mode: graceful
        timeout: 45s
      health:
        path: /healthz
      readiness:
        path: /readyz
      drain:
        path: /drainz
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: fastapiCwd })).toBe(0);
    const fastapiMain = readUtf8(join(fastapiCwd, 'generated', 'backend', 'app', 'main.py'));
    expect(fastapiMain).toContain('@app.get("/healthz")');
    expect(fastapiMain).toContain('@app.get("/readyz")');
    expect(fastapiMain).toContain('@app.post("/drainz")');
    expect(fastapiMain).toContain('app.state.loj_draining = True');
  });

  it('builds runtime cors and forwarded-header settings for spring and fastapi targets', () => {
    const springCwd = createTempProject();
    writeFileSync(join(springCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      cors:
        origins:
          - http://127.0.0.1:5173
        methods:
          - GET
          - POST
        headers:
          - Authorization
          - Content-Type
        credentials: true
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: local
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: springCwd })).toBe(0);
    const springWebConfig = readUtf8(join(springCwd, 'generated', 'backend', 'src', 'main', 'java', 'com', 'example', 'userservice', 'runtime', 'LojRuntimeWebConfig.java'));
    expect(springWebConfig).toContain('.allowedOrigins("http://127.0.0.1:5173")');
    expect(springWebConfig).toContain('.allowedMethods("GET", "POST")');
    expect(springWebConfig).toContain('FilterRegistrationBean<OncePerRequestFilter>');
    expect(springWebConfig).toContain('address.isLoopbackAddress()');

    const fastapiCwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      cors:
        origins:
          - http://127.0.0.1:5173
        methods:
          - GET
          - POST
        headers:
          - Authorization
          - Content-Type
        credentials: true
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: all
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: fastapiCwd })).toBe(0);
    const fastapiMain = readUtf8(join(fastapiCwd, 'generated', 'backend', 'app', 'main.py'));
    expect(fastapiMain).toContain('from fastapi.middleware.cors import CORSMiddleware');
    expect(fastapiMain).toContain('from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware');
    expect(fastapiMain).toContain('app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")');
    expect(fastapiMain).toContain('app.add_middleware(');
    expect(fastapiMain).toContain('allow_origins=["http://127.0.0.1:5173"]');
    expect(readUtf8(join(fastapiCwd, 'generated', 'backend', 'README.md'))).toContain('--proxy-headers --forwarded-allow-ips *');
  });

  it('supports trustedProxy cidrs for spring, fastapi, and the fastapi dev runner', () => {
    const springCwd = createTempProject();
    writeFileSync(join(springCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: cidrs
        cidrs:
          - 10.0.0.0/8
          - 192.168.0.0/16
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: springCwd })).toBe(0);
    const springWebConfig = readUtf8(join(springCwd, 'generated', 'backend', 'src', 'main', 'java', 'com', 'example', 'userservice', 'runtime', 'LojRuntimeWebConfig.java'));
    expect(springWebConfig).toContain('"10.0.0.0/8", "192.168.0.0/16"');
    expect(springWebConfig).toContain('isWithinTrustedCidrs');
    expect(springWebConfig).toContain('matchesCidr');

    const fastapiCwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: cidrs
        cidrs:
          - 10.0.0.0/8
          - 192.168.0.0/16
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: fastapiCwd })).toBe(0);
    const fastapiMain = readUtf8(join(fastapiCwd, 'generated', 'backend', 'app', 'main.py'));
    expect(fastapiMain).toContain('app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["10.0.0.0/8", "192.168.0.0/16"])');
    expect(readUtf8(join(fastapiCwd, 'generated', 'backend', 'README.md'))).toContain('--forwarded-allow-ips 10.0.0.0/8,192.168.0.0/16');

    writeDevConfig(fastapiCwd, {
      backendEntry: 'backend/app.fastapi.api.loj',
      backendOutDir: 'generated/backend',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: cidrs
        cidrs:
          - 10.0.0.0/8
          - 192.168.0.0/16

dev:
  server:
    target: backend
    port: 3001
`, 'utf8');
    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;
    expect(runCli(['dev', 'loj.project.yaml'], {
      cwd: fastapiCwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    })).toBe(0);
    const serverSpawn = runtime.spawns.find((entry) => entry.args.some((arg) => arg.endsWith('fastapi-dev-runner.js')));
    expect(serverSpawn?.args).toContain('--trusted-proxy-mode');
    expect(serverSpawn?.args).toContain('cidrs');
    expect(serverSpawn?.args).toContain('--trusted-proxy-cidrs');
    expect(serverSpawn?.args).toContain('10.0.0.0/8,192.168.0.0/16');
    session?.close();
  });

  it('builds requestSizeLimit runtime settings for spring and fastapi targets', () => {
    const springCwd = createTempProject();
    writeFileSync(join(springCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      requestSizeLimit: 10mb
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: springCwd })).toBe(0);
    const applicationProperties = readUtf8(join(springCwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'));
    expect(applicationProperties).toContain('spring.servlet.multipart.max-file-size=10mb');
    expect(applicationProperties).toContain('spring.servlet.multipart.max-request-size=10mb');

    const fastapiCwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      requestSizeLimit: 10mb
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: fastapiCwd })).toBe(0);
    const fastapiMain = readUtf8(join(fastapiCwd, 'generated', 'backend', 'app', 'main.py'));
    expect(fastapiMain).toContain('from starlette.middleware.base import BaseHTTPMiddleware');
    expect(fastapiMain).toContain('class LojRequestSizeLimitMiddleware(BaseHTTPMiddleware):');
    expect(fastapiMain).toContain('app.add_middleware(LojRequestSizeLimitMiddleware, max_bytes=10485760)');
    expect(fastapiMain).toContain('Request exceeds generated limit of 10mb');
  });

  it('builds basePath runtime settings for spring and fastapi targets', () => {
    const springCwd = createTempProject();
    writeFileSync(join(springCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      basePath: /internal-api
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: springCwd })).toBe(0);
    const applicationProperties = readUtf8(join(springCwd, 'generated', 'backend', 'src', 'main', 'resources', 'application.properties'));
    expect(applicationProperties).toContain('server.servlet.context-path=/internal-api');

    const fastapiCwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeFileSync(join(fastapiCwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      basePath: /internal-api
`, 'utf8');
    expect(runCli(['build', 'loj.project.yaml'], { cwd: fastapiCwd })).toBe(0);
    const fastapiMain = readUtf8(join(fastapiCwd, 'generated', 'backend', 'app', 'main.py'));
    expect(fastapiMain).toContain('app = FastAPI(title=SETTINGS.app_name, root_path="/internal-api")');
    expect(readUtf8(join(fastapiCwd, 'generated', 'backend', 'README.md'))).toContain('--root-path /internal-api');
  });

  it('supports --target for validate and build project-shell commands', () => {
    const cwd = createTempProject();
    const validateStdout: string[] = [];
    expect(runCli(['validate', 'loj.project.yaml', '--target', 'backend', '--json'], {
      cwd,
      stdout: (text) => validateStdout.push(text),
    })).toBe(0);
    const validatePayload = JSON.parse(validateStdout.join('')) as { targets: Record<string, unknown> };
    expect(Object.keys(validatePayload.targets)).toEqual(['backend']);

    expect(runCli(['build', 'loj.project.yaml', '--target', 'backend'], { cwd })).toBe(0);
    expect(existsSync(join(cwd, 'generated', 'backend', 'pom.xml'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'frontend', 'App.tsx'))).toBe(false);
  });

  it('propagates backend runtime basePath into loj dev proxy summaries and fastapi runner args', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeDevConfig(cwd, {
      backendEntry: 'backend/app.fastapi.api.loj',
      backendOutDir: 'generated/backend',
    });
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend
    runtime:
      basePath: /internal-api

dev:
  host:
    type: react-vite
    target: frontend
    dir: host
    apiBase: /api
    proxyTarget: backend
  server:
    target: backend
    port: 3001
`, 'utf8');
    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    let session: { close(): void } | undefined;
    expect(runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      onDevSession(value) {
        session = value;
      },
    })).toBe(0);
    expect(stdout.join('')).toContain('backend url: http://127.0.0.1:3001/internal-api');
    expect(stdout.join('')).toContain('api proxy: /api -> http://127.0.0.1:3001/internal-api');
    const serverSpawn = runtime.spawns.find((entry) => entry.args.some((arg) => arg.endsWith('fastapi-dev-runner.js')));
    expect(serverSpawn?.args).toContain('--root-path');
    expect(serverSpawn?.args).toContain('/internal-api');
    session?.close();
  });

  it('propagates frontend runtime basePath into loj dev host summaries and env', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
    runtime:
      basePath: /admin
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend

dev:
  host:
    type: react-vite
    target: frontend
    dir: host
    apiBase: /api
    proxyTarget: backend
  server:
    target: backend
    port: 3001
`, 'utf8');
    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    let session: { close(): void } | undefined;
    expect(runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      onDevSession(value) {
        session = value;
      },
    })).toBe(0);
    expect(stdout.join('')).toContain('host url: http://127.0.0.1:5173/admin');
    const hostSpawn = runtime.spawns.find((entry) => entry.command === 'npm');
    expect(hostSpawn?.options.env?.VITE_RDSL_APP_BASE_PATH).toBe('/admin');
    session?.close();
  });

  it('rejects an incompatible sqlite database profile on spring targets', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: sqlite
`, 'utf8');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(['validate', 'loj.project.yaml'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('database.vendor "sqlite"');
  });

  it('rejects shared placeholder usage in the first implementation', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

shared:
  - ./shared/domain/

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
`, 'utf8');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['validate', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('"success": false');
    expect(stdout.join('')).toContain('"shared is reserved for future target-neutral schemas and is not supported yet"');
  });

  it('reports loaded env files during project validation', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, '.env'), 'LOJ_DEV_PROXY_AUTH=admin:admin123\nSHARED_FLAG=1\n', 'utf8');
    writeFileSync(join(cwd, '.env.frontend'), 'VITE_THEME=navy\n', 'utf8');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['validate', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join('')) as {
      envFiles: string[];
      targets: Record<string, { envFiles: string[]; type: string }>;
    };
    expect(payload.envFiles).toEqual(['.env', '.env.frontend']);
    expect(payload.targets.frontend.type).toBe('web');
    expect(payload.targets.backend.type).toBe('api');
    expect(payload.targets.frontend.envFiles).toEqual(['.env.frontend']);
    expect(payload.targets.backend.envFiles).toEqual([]);
  });

  it('starts a full-stack dev loop that watches both targets', () => {
    const cwd = createTempProject();
    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Loj dev: watching loj.project.yaml');
    expect(stdout.join('')).toContain('[frontend] "event": "build"');
    expect(stdout.join('')).toContain('[frontend] "trigger": "initial"');
    expect(stdout.join('')).toContain('[backend] Dev build complete (initial)');
    expect(existsSync(join(cwd, 'generated', 'frontend', 'App.tsx'))).toBe(true);
    expect(existsSync(join(cwd, 'generated', 'backend', 'pom.xml'))).toBe(true);

    writeFileSync(join(cwd, 'frontend', 'app.web.loj'), `
app:
  name: "Admin Frontend"

compiler:
  target: react

model User:
  name: string @required

page dashboard:
  title: "Overview"
  type: dashboard
  blocks:
    - type: metric
      title: "Users"
      data: query.users.count
`, 'utf8');
    runtime.emit(join(cwd, 'frontend'), 'app.web.loj');

    writeFileSync(join(cwd, 'backend', 'app.api.loj'), `
app:
  name: "User Service"
  package: "com.example.userservice"

model User:
  name: string @required
  email: string @required @email

resource users:
  model: User
  api: /api/users
`, 'utf8');
    runtime.emit(join(cwd, 'backend'), 'app.api.loj');

    expect(stdout.join('')).toContain('[frontend] Change detected: app.web.loj');
    expect(stdout.join('')).toContain('[backend] Change detected: app.api.loj');
    expect(stdout.join('')).toContain('[frontend] "trigger": "change"');
    expect(stdout.join('')).toContain('[backend] Dev build complete (change)');

    session?.close();
  });

  it('auto-provisions docker-compose databases during loj dev before starting the backend server', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: postgres
      mode: docker-compose
      name: demo_app
      username: demo
      password: secret
      autoProvision: true
      migrations: flyway

dev:
  server:
    target: backend
    port: 3001
`, 'utf8');

    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');

    const databaseUpSpawn = runtime.spawns.find((entry) => entry.command === 'docker' && entry.args.includes('up'));
    expect(databaseUpSpawn).toBeDefined();
    expect(databaseUpSpawn?.args).toContain('compose');
    expect(databaseUpSpawn?.args.some((arg) => arg.endsWith('docker-compose.database.yaml'))).toBe(true);
    expect(runtime.spawns.find((entry) => entry.command === 'mvn')).toBeUndefined();

    databaseUpSpawn?.process.exit(0);

    const serverSpawn = runtime.spawns.find((entry) => entry.command === 'mvn');
    expect(serverSpawn).toBeDefined();
    expect(serverSpawn?.args.at(-1)).toBe('spring-boot:run');

    session?.close();

    const databaseDownSpawn = runtime.spawns.find((entry) => entry.command === 'docker' && entry.args.includes('down'));
    expect(databaseDownSpawn).toBeDefined();
  });

  it('reports and stops an active loj dev session through status/stop', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(devExitCode).toBe(0);
    expect(session).toBeDefined();

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => statusStdout.push(text),
    });

    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as {
      running: boolean;
      services: Array<{ kind: string }>;
      dev: { hostUrl?: string; backendUrl?: string };
    };
    expect(statusPayload.running).toBe(true);
    expect(statusPayload.dev.hostUrl).toBe('http://127.0.0.1:5173');
    expect(statusPayload.dev.backendUrl).toBe('http://127.0.0.1:3001');
    expect(statusPayload.services.map((service) => service.kind).sort()).toEqual(['host', 'server']);

    const stopStdout: string[] = [];
    const stopExitCode = runCli(['stop', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => stopStdout.push(text),
    });

    expect(stopExitCode).toBe(0);
    const stopPayload = JSON.parse(stopStdout.join('')) as {
      stopped: boolean;
      mode: string;
    };
    expect(stopPayload.stopped).toBe(true);
    expect(stopPayload.mode).toBe('in-process');

    const stateFile = join(cwd, '.loj', 'dev', 'loj.project.yaml.session.json');
    expect(existsSync(stateFile)).toBe(false);
  });

  it('rebuilds only the selected frontend target inside an active loj dev session', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    expect(runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    })).toBe(0);
    expect(session).toBeDefined();

    const initialSpringBootRuns = runtime.spawns.filter((entry) => entry.command === 'mvn' && entry.args.includes('spring-boot:run')).length;
    expect(initialSpringBootRuns).toBe(1);

    const stdout: string[] = [];
    const exitCode = runCli(['rebuild', 'loj.project.yaml', '--target', 'frontend', '--json'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join('')) as {
      artifact: string;
      accepted: boolean;
      mode: string;
      targetAliases: string[];
    };
    expect(payload.artifact).toBe('loj.rebuild.result');
    expect(payload.accepted).toBe(true);
    expect(payload.mode).toBe('in-process');
    expect(payload.targetAliases).toEqual(['frontend']);

    const nextSpringBootRuns = runtime.spawns.filter((entry) => entry.command === 'mvn' && entry.args.includes('spring-boot:run')).length;
    expect(nextSpringBootRuns).toBe(1);

    session?.close();
  });

  it('restarts only the selected managed host service inside an active loj dev session', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    expect(runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    })).toBe(0);
    expect(session).toBeDefined();

    const initialHostRuns = runtime.spawns.filter((entry) => entry.command === 'npm' && entry.args.includes('run')).length;
    const initialServerRuns = runtime.spawns.filter((entry) => entry.command === 'mvn' && entry.args.includes('spring-boot:run')).length;
    const firstHostProcess = runtime.spawns.find((entry) => entry.command === 'npm' && entry.args.includes('run'))?.process;
    expect(initialHostRuns).toBe(1);
    expect(initialServerRuns).toBe(1);
    expect(firstHostProcess).toBeDefined();

    const stdout: string[] = [];
    const exitCode = runCli(['restart', 'loj.project.yaml', '--service', 'host', '--json'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join('')) as {
      artifact: string;
      accepted: boolean;
      mode: string;
      services: string[];
    };
    expect(payload.artifact).toBe('loj.restart.result');
    expect(payload.accepted).toBe(true);
    expect(payload.mode).toBe('in-process');
    expect(payload.services).toEqual(['host']);

    const nextHostRuns = runtime.spawns.filter((entry) => entry.command === 'npm' && entry.args.includes('run')).length;
    const nextServerRuns = runtime.spawns.filter((entry) => entry.command === 'mvn' && entry.args.includes('spring-boot:run')).length;
    expect(nextHostRuns).toBe(2);
    expect(nextServerRuns).toBe(1);
    expect(firstHostProcess?.closeSignals).toContain('SIGTERM');

    session?.close();
  });

  it('includes backend probe urls in loj status when runtime probes are configured', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    runtime:
      basePath: /internal-api
      health:
        path: /healthz
      readiness:
        path: /readyz
      drain:
        path: /drainz

dev:
  host:
    type: react-vite
    target: frontend
    dir: host
    apiBase: /api
    port: 5173
    previewPort: 4173
    proxyTarget: backend
  server:
    target: backend
    port: 3001
`, 'utf8');
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(devExitCode).toBe(0);
    expect(session).toBeDefined();

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => statusStdout.push(text),
    });

    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as {
      probes: Array<{ kind: string; url: string }>;
    };
    expect(statusPayload.probes).toEqual([
      { targetAlias: 'backend', kind: 'health', url: 'http://127.0.0.1:3001/internal-api/healthz' },
      { targetAlias: 'backend', kind: 'readiness', url: 'http://127.0.0.1:3001/internal-api/readyz' },
      { targetAlias: 'backend', kind: 'drain', url: 'http://127.0.0.1:3001/internal-api/drainz' },
    ]);

    session?.close();
  });

  it('formats non-json loj status output with banner, sections, and next steps', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;
    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(devExitCode).toBe(0);
    const stdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
    });

    expect(statusExitCode).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('| loj status');
    expect(output).toContain('overview:');
    expect(output).toContain('version: 0.5.0 (Logos)');
    expect(output).toContain('targets:');
    expect(output).toContain('urls:');
    expect(output).toContain('next:');
    expect(output).toContain('stop services: loj stop loj.project.yaml');

    session?.close();
  });

  it('cleans stale dev-session state during loj status and reports no running session', () => {
    const cwd = createTempProject();
    const stateFile = join(cwd, '.loj', 'dev', 'loj.project.yaml.session.json');
    mkdirSync(join(cwd, '.loj', 'dev'), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify({
      artifact: 'loj.dev.session',
      schemaVersion: 1,
      projectFile: normalizePath(join(cwd, 'loj.project.yaml')),
      app: { name: 'fullstack-demo' },
      pid: process.pid,
      startedAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
      debug: false,
      targets: [],
      dev: {},
      services: [],
      databases: [],
    }, null, 2)}\n`, 'utf8');

    const stdout: string[] = [];
    const exitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join('')) as {
      running: boolean;
      stale: boolean;
      warnings?: string[];
    };
    expect(payload.running).toBe(false);
    expect(payload.stale).toBe(true);
    expect(payload.warnings?.some((warning) => warning.includes('Removed stale dev-session state file'))).toBe(true);
    expect(existsSync(stateFile)).toBe(false);
  });

  it('reports stable no-session status and stop results when loj dev is not running', () => {
    const cwd = createTempProject();

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => statusStdout.push(text),
    });

    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as {
      running: boolean;
      stale: boolean;
    };
    expect(statusPayload.running).toBe(false);
    expect(statusPayload.stale).toBe(false);

    const stopStdout: string[] = [];
    const stopExitCode = runCli(['stop', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stopStdout.push(text),
    });

    expect(stopExitCode).toBe(0);
    const stopPayload = JSON.parse(stopStdout.join('')) as {
      stopped: boolean;
      stale: boolean;
    };
    expect(stopPayload.stopped).toBe(false);
    expect(stopPayload.stale).toBe(false);
  });

  it('cleans session state and stops sibling services when a managed process exits abnormally', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(devExitCode).toBe(0);
    expect(session).toBeDefined();

    const stateFile = join(cwd, '.loj', 'dev', 'loj.project.yaml.session.json');
    expect(existsSync(stateFile)).toBe(true);

    const hostSpawn = runtime.spawns.find((entry) => entry.command === 'npm' && entry.args.includes('run'));
    const backendSpawn = runtime.spawns.find((entry) => entry.command === 'mvn');
    expect(hostSpawn).toBeDefined();
    expect(backendSpawn).toBeDefined();

    const previousExitCode = process.exitCode;
    try {
      hostSpawn?.process.exit(1);
    } finally {
      process.exitCode = previousExitCode;
    }

    expect(stderr.join('')).toContain('exited with 1');
    expect(backendSpawn?.process.closeSignals).toContain('SIGINT');
    expect(existsSync(stateFile)).toBe(false);

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => statusStdout.push(text),
    });
    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as { running: boolean; stale: boolean };
    expect(statusPayload.running).toBe(false);
    expect(statusPayload.stale).toBe(false);
  });

  it('runs loj doctor with project-level dependency and surface checks', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['doctor', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join('')) as {
      success: boolean;
      surfaceCounts: { resources: number; readModels: number; workflows: number; rules: number };
      checks: Array<{ severity: string; target?: string; message: string }>;
    };
    expect(payload.success).toBe(true);
    expect(payload.surfaceCounts.resources).toBe(2);
    expect(payload.surfaceCounts.readModels).toBe(0);
    expect(payload.checks.some((check) => check.severity === 'warning' && check.message.includes('npm install --prefix host'))).toBe(true);
    expect(payload.checks.some((check) => check.severity === 'warning' && check.message.includes('generated output is missing'))).toBe(true);
    expect(payload.checks.some((check) => check.severity === 'info' && check.message.includes('loj dev is not currently running'))).toBe(true);
  });

  it('formats non-json loj doctor output with banner and next steps', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const stdout: string[] = [];
    const exitCode = runCli(['doctor', 'loj.project.yaml'], {
      cwd,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('| loj doctor');
    expect(output).toContain('overview:');
    expect(output).toContain('version: 0.5.0 (Logos)');
    expect(output).toContain('checks: errors=');
    expect(output).toContain('targets:');
    expect(output).toContain('next:');
    expect(output).toContain('start the project loop: loj dev loj.project.yaml');
  });

  it('formats non-json loj stop output with banner and next steps', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;
    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });
    expect(devExitCode).toBe(0);
    expect(session).toBeDefined();

    const stdout: string[] = [];
    const stopExitCode = runCli(['stop', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
    });

    expect(stopExitCode).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('| loj stop');
    expect(output).toContain('Stopped loj dev:');
    expect(output).toContain('next:');
    expect(output).toContain('restart services: loj dev loj.project.yaml');
  });

  it('reports missing linked rules, flows, and sql files through loj doctor', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-doctor-links-'));
    mkdirSync(join(cwd, 'frontend'), { recursive: true });
    mkdirSync(join(cwd, 'backend'), { recursive: true });
    writeFileSync(join(cwd, 'frontend', 'app.web.loj'), `
app:
  name: "Admin Frontend"

model Booking:
  status: string

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("../workflows/booking-lifecycle")'
  create:
    fields: [status]
    rules: '@rules("../rules/booking-create")'
`, 'utf8');
    writeFileSync(join(cwd, 'backend', 'app.api.loj'), `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  status: string

readModel availability:
  result:
    bookingId: id
  handler: '@sql("../queries/availability")'

resource bookings:
  model: Booking
  api: /api/bookings
`, 'utf8');
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: booking-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
`, 'utf8');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(['doctor', 'loj.project.yaml', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe('');
    const payload = JSON.parse(stdout.join('')) as {
      success: boolean;
      checks: Array<{ severity: string; message: string }>;
    };
    expect(payload.success).toBe(false);
    expect(payload.checks.some((check) => check.severity === 'error' && check.message.includes('linked @flow(...) file is missing'))).toBe(true);
    expect(payload.checks.some((check) => check.severity === 'error' && check.message.includes('linked @rules(...) file is missing'))).toBe(true);
    expect(payload.checks.some((check) => check.severity === 'error' && check.message.includes('linked @sql(...) file is missing'))).toBe(true);
  });

  it('includes active service and database summaries in loj doctor output for overview consumers', () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: postgres
      mode: docker-compose
      name: demo_app
      username: demo
      password: secret
      autoProvision: true
      migrations: flyway

dev:
  host:
    type: react-vite
    target: frontend
    dir: host
    apiBase: /api
    port: 5173
    previewPort: 4173
    proxyTarget: backend
  server:
    target: backend
    port: 3001
`, 'utf8');
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    const devExitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });
    expect(devExitCode).toBe(0);
    expect(session).toBeDefined();

    const databaseUpSpawn = runtime.spawns.find((entry) => entry.command === 'docker' && entry.args.includes('up'));
    expect(databaseUpSpawn).toBeDefined();
    databaseUpSpawn?.process.exit(0);

    const stdout: string[] = [];
    const exitCode = runCli(['doctor', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join('')) as {
      running: boolean;
      services: Array<{ kind: string; targetAlias: string; url: string }>;
      databases: Array<{ targetAlias: string; phase: string }>;
    };
    expect(payload.running).toBe(true);
    expect(payload.services.map((service) => service.kind)).toEqual(['host', 'server']);
    expect(payload.databases).toEqual([
      expect.objectContaining({ targetAlias: 'backend', phase: 'ready' }),
    ]);

    session?.close();
  });

  it('accepts loj dev --debug and emits verbose orchestration lines', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'package.json'), '{}', 'utf8');
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml', '--debug'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('██████  LOJ DEV');
    expect(stdout.join('')).toContain('watch, run, inspect, debug');
    expect(stdout.join('')).toContain('version: 0.5.0 (Logos)');
    expect(stdout.join('')).toContain('debug: verbose orchestration enabled');
    expect(stdout.join('')).toContain('session state:');
    expect(stdout.join('')).toContain('command:');
    expect(stdout.join('')).toContain('next:');
    const serverSpawn = runtime.spawns.find((entry) => entry.command === 'mvn');
    expect(serverSpawn?.args).toContain('-Dspring-boot.run.fork=true');
    expect(serverSpawn?.args.some((arg) => arg.includes('-agentlib:jdwp=transport=dt_socket'))).toBe(true);

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => statusStdout.push(text),
    });
    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as {
      debuggers: Array<{ targetAlias: string; attachKind: string; port: number }>;
    };
    expect(statusPayload.debuggers).toEqual([
      expect.objectContaining({ targetAlias: 'backend', attachKind: 'java', port: 5005 }),
    ]);
    session?.close();
  });

  it('prints the loj version through version and --version', () => {
    const stdout: string[] = [];
    const versionExitCode = runCli(['version'], {
      stdout: (text) => stdout.push(text),
    });
    expect(versionExitCode).toBe(0);
    expect(stdout.join('')).toBe('0.5.0 (Logos)\n');

    const globalStdout: string[] = [];
    const globalExitCode = runCli(['--version'], {
      stdout: (text) => globalStdout.push(text),
    });
    expect(globalExitCode).toBe(0);
    expect(globalStdout.join('')).toBe('0.5.0 (Logos)\n');
  });

  it('passes graceful shutdown and debugger settings into the fastapi dev runner', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    writeDevConfig(cwd, {
      backendEntry: 'backend/app.fastapi.api.loj',
      backendOutDir: 'generated/backend-fastapi',
    });
    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
  backend:
    type: api
    entry: backend/app.fastapi.api.loj
    outDir: generated/backend-fastapi
    runtime:
      shutdown:
        mode: graceful
        timeout: 45s
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: all

dev:
  server:
    target: backend
    port: 3001
`, 'utf8');

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;
    const exitCode = runCli(['dev', 'loj.project.yaml', '--debug'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    const serverSpawn = runtime.spawns.find((entry) => entry.args.some((arg) => arg.endsWith('fastapi-dev-runner.js')));
    expect(serverSpawn).toBeDefined();
    expect(serverSpawn?.args).toContain('--shutdown-mode');
    expect(serverSpawn?.args).toContain('graceful');
    expect(serverSpawn?.args).toContain('--shutdown-timeout');
    expect(serverSpawn?.args).toContain('45');
    expect(serverSpawn?.args).toContain('--forwarded-headers-mode');
    expect(serverSpawn?.args).toContain('standard');
    expect(serverSpawn?.args).toContain('--trusted-proxy-mode');
    expect(serverSpawn?.args).toContain('all');
    expect(serverSpawn?.args).toContain('--debugpy-host');
    expect(serverSpawn?.args).toContain('127.0.0.1');
    expect(serverSpawn?.args).toContain('--debugpy-port');
    expect(serverSpawn?.args).toContain('5678');

    const statusStdout: string[] = [];
    const statusExitCode = runCli(['status', 'loj.project.yaml', '--json'], {
      cwd,
      runtime,
      stdout: (text) => statusStdout.push(text),
    });
    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout.join('')) as {
      debuggers: Array<{ targetAlias: string; attachKind: string; port: number }>;
    };
    expect(statusPayload.debuggers).toEqual([
      expect.objectContaining({ targetAlias: 'backend', attachKind: 'debugpy', port: 5678 }),
    ]);
    session?.close();
  });

  it('reloads target sessions when loj.project.yaml changes', () => {
    const cwd = createTempProject();
    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');

    writeFileSync(join(cwd, 'loj.project.yaml'), `
app:
  name: fullstack-demo

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: preview/frontend
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: preview/backend
`, 'utf8');
    runtime.emit(cwd, 'loj.project.yaml');

    expect(stdout.join('')).toContain('Project file changed: loj.project.yaml');
    expect(stdout.join('')).toContain('Project config reloaded: loj.project.yaml');
    expect(existsSync(join(cwd, 'preview', 'frontend', 'App.tsx'))).toBe(true);
    expect(existsSync(join(cwd, 'preview', 'backend', 'pom.xml'))).toBe(true);

    session?.close();
  });

  it('starts host and backend processes when dev host/server config is present', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('host url: http://127.0.0.1:5173');
    expect(stdout.join('')).toContain('backend url: http://127.0.0.1:3001');
    expect(stdout.join('')).toContain('api proxy: /api -> http://127.0.0.1:3001');
    expect(runtime.spawns).toHaveLength(2);

    const serverSpawn = runtime.spawns.find((entry) => entry.command === 'mvn');
    expect(serverSpawn).toBeDefined();
    expect(serverSpawn?.args.at(-1)).toBe('spring-boot:run');
    expect(serverSpawn?.options.env?.SERVER_PORT).toBe('3001');
    expect(serverSpawn?.options.env?.SERVER_ADDRESS).toBe('127.0.0.1');
    expect(serverSpawn?.args).toContain(resolve(cwd, 'generated', 'backend', 'pom.xml'));

    const hostSpawn = runtime.spawns.find((entry) => entry.command === 'npm');
    expect(hostSpawn).toBeDefined();
    expect(hostSpawn?.args).toEqual(['--prefix', resolve(cwd, 'host'), 'run', 'dev']);
    expect(hostSpawn?.options.env?.RDSL_GENERATED_DIR).toBe('../generated/frontend');
    expect(hostSpawn?.options.env?.VITE_RDSL_API_BASE).toBe('/api');
    expect(hostSpawn?.options.env?.RDSL_PROXY_API_TARGET).toBe('http://127.0.0.1:3001');
    expect(hostSpawn?.options.env?.RDSL_PROXY_API_AUTH).toBe('admin:admin123');
    expect(hostSpawn?.options.env?.PORT).toBe('5173');
    expect(hostSpawn?.options.env?.PREVIEW_PORT).toBe('4173');

    writeFileSync(join(cwd, 'backend', 'app.api.loj'), `
app:
  name: "User Service"
  package: "com.example.userservice"

model User:
  name: string @required
  email: string @required @email

resource users:
  model: User
  api: /api/users
`, 'utf8');
    runtime.emit(join(cwd, 'backend'), 'app.api.loj');

    expect(stdout.join('')).toContain('Restarting backend server: generated backend updated (change)');
    expect(runtime.spawns.filter((entry) => entry.command === 'mvn')).toHaveLength(2);
    expect(serverSpawn?.process.closeSignals).toContain('SIGTERM');

    session?.close();
  });

  it('starts a FastAPI backend process when the generated sdsl target is fastapi', () => {
    const cwd = createTempProject({
      backendCompilerBlock: `compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth`,
      backendEntry: 'backend/app.fastapi.api.loj',
    });
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd, {
      backendEntry: 'backend/app.fastapi.api.loj',
      backendOutDir: 'generated/backend-fastapi',
      backendPort: 3002,
      hostPort: 5174,
      previewPort: 4174,
    });

    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('host url: http://127.0.0.1:5174');
    expect(stdout.join('')).toContain('backend url: http://127.0.0.1:3002');
    expect(stdout.join('')).toContain('api proxy: /api -> http://127.0.0.1:3002');

    const serverSpawn = runtime.spawns.find((entry) => entry.command === process.execPath);
    expect(serverSpawn).toBeDefined();
    expect(serverSpawn?.args.some((arg) => arg.endsWith('fastapi-dev-runner.js'))).toBe(true);
    expect(serverSpawn?.args).toContain('--generated-dir');
    expect(serverSpawn?.args).toContain(resolve(cwd, 'generated', 'backend-fastapi'));
    expect(serverSpawn?.args).toContain('--port');
    expect(serverSpawn?.args).toContain('3002');
    expect(serverSpawn?.options.env?.LOJ_FASTAPI_VENV_DIR).toBe(resolve(cwd, '.loj-python', 'backend'));
    expect(serverSpawn?.options.env?.LOJ_TARGET_ALIAS).toBe('backend');

    const hostSpawn = runtime.spawns.find((entry) => entry.command === 'npm');
    expect(hostSpawn?.options.env?.PORT).toBe('5174');
    expect(hostSpawn?.options.env?.RDSL_PROXY_API_TARGET).toBe('http://127.0.0.1:3002');

    session?.close();
  });

  it('loads project env files into managed host and backend processes', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd, { proxyAuth: null });
    writeFileSync(join(cwd, '.env'), 'LOJ_DEV_HOST_HOST=0.0.0.0\nLOJ_DEV_HOST_PORT=6100\nLOJ_DEV_SERVER_PORT=3200\nLOJ_DEV_PROXY_AUTH=admin:env123\nSHARED_FLAG=shared\n', 'utf8');
    writeFileSync(join(cwd, '.env.frontend'), 'VITE_THEME=navy\n', 'utf8');
    writeFileSync(join(cwd, '.env.backend.local'), 'SPRING_PROFILES_ACTIVE=local\n', 'utf8');

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();

    const serverSpawn = runtime.spawns.find((entry) => entry.command === 'mvn');
    const hostSpawn = runtime.spawns.find((entry) => entry.command === 'npm');
    expect(serverSpawn?.options.env?.SERVER_PORT).toBe('3200');
    expect(serverSpawn?.options.env?.SPRING_PROFILES_ACTIVE).toBe('local');
    expect(serverSpawn?.options.env?.SHARED_FLAG).toBe('shared');
    expect(serverSpawn?.options.env?.LOJ_TARGET_ALIAS).toBe('backend');
    expect(hostSpawn?.options.env?.PORT).toBe('6100');
    expect(hostSpawn?.options.env?.HOST).toBe('0.0.0.0');
    expect(hostSpawn?.options.env?.RDSL_PROXY_API_AUTH).toBe('admin:env123');
    expect(hostSpawn?.options.env?.VITE_THEME).toBe('navy');
    expect(hostSpawn?.options.env?.SHARED_FLAG).toBe('shared');
    expect(hostSpawn?.options.env?.LOJ_TARGET_ALIAS).toBe('frontend');

    session?.close();
  });

  it('restarts managed processes when dev config changes in loj.project.yaml', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd);

    const runtime = new FakeRuntime();
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    expect(runtime.spawns).toHaveLength(2);

    writeDevConfig(cwd, {
      hostPort: 5180,
      previewPort: 4180,
      backendPort: 3010,
    });
    runtime.emit(cwd, 'loj.project.yaml');

    expect(runtime.spawns.filter((entry) => entry.command === 'mvn')).toHaveLength(2);
    expect(runtime.spawns.filter((entry) => entry.command === 'npm')).toHaveLength(2);
    const latestServer = runtime.spawns.filter((entry) => entry.command === 'mvn').at(-1);
    const latestHost = runtime.spawns.filter((entry) => entry.command === 'npm').at(-1);
    expect(latestServer?.options.env?.SERVER_PORT).toBe('3010');
    expect(latestHost?.options.env?.PORT).toBe('5180');
    expect(latestHost?.options.env?.PREVIEW_PORT).toBe('4180');

    session?.close();
  });

  it('reloads env-derived target and service state when env files change', () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, 'host', 'node_modules', 'vite'), { recursive: true });
    writeFileSync(join(cwd, 'host', 'node_modules', 'vite', 'package.json'), '{}', 'utf8');
    writeDevConfig(cwd, { proxyAuth: null });
    writeFileSync(join(cwd, '.env'), 'LOJ_DEV_PROXY_AUTH=admin:admin123\n', 'utf8');

    const runtime = new FakeRuntime();
    const stdout: string[] = [];
    let session: { close(): void } | undefined;

    const exitCode = runCli(['dev', 'loj.project.yaml'], {
      cwd,
      runtime,
      stdout: (text) => stdout.push(text),
      onDevSession(value) {
        session = value;
      },
    });

    expect(exitCode).toBe(0);
    expect(session).toBeDefined();
    const initialFrontendBuilds = countOccurrences(stdout.join(''), '[frontend] "trigger": "initial"');

    writeFileSync(join(cwd, '.env.frontend.local'), 'VITE_THEME=teal\n', 'utf8');
    runtime.emit(cwd, '.env.frontend.local');

    expect(stdout.join('')).toContain('Project env changed: .env.frontend.local');
    expect(stdout.join('')).toContain('Project config reloaded: loj.project.yaml');
    expect(countOccurrences(stdout.join(''), '[frontend] "trigger": "initial"')).toBeGreaterThan(initialFrontendBuilds);

    const latestHost = runtime.spawns.filter((entry) => entry.command === 'npm').at(-1);
    expect(latestHost?.options.env?.VITE_THEME).toBe('teal');

    session?.close();
  });

  it('validates standalone .rules.loj files via loj rules validate --json', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-rules-'));
    mkdirSync(join(cwd, 'policies'), { recursive: true });
    writeFileSync(join(cwd, 'policies', 'invoice-access.rules.loj'), `
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, FINANCE, SALES]

  deny delete:
    when: record.status == COMPLETED
`, 'utf8');

    const stdout: string[] = [];
    const exitCode = runCli(['rules', 'validate', 'policies/invoice-access.rules.loj', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('loj.rules.validate.result');
    expect(payload.success).toBe(true);
    expect(payload.ruleSet).toBe('invoice-access');
    expect(payload.rules).toBe(2);
  });

  it('builds standalone .rules.loj manifests via loj rules build', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-rules-'));
    mkdirSync(join(cwd, 'policies'), { recursive: true });
    writeFileSync(join(cwd, 'policies', 'invoice-access.rules.loj'), `
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, FINANCE, SALES]

  allow update:
    when: currentUser.role == ADMIN
`, 'utf8');

    const exitCode = runCli(['rules', 'build', 'policies/invoice-access.rules.loj', '--out-dir', 'generated/rules'], {
      cwd,
    });

    expect(exitCode).toBe(0);
    const manifestPath = join(cwd, 'generated', 'rules', 'invoice-access.rules.manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.artifact).toBe('loj.rules.manifest');
    expect(manifest.ruleSet).toBe('invoice-access');
    expect(manifest.rules).toHaveLength(2);
  });

  it('validates standalone .flow.loj files via loj flow validate --json', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-flow-'));
    mkdirSync(join(cwd, 'workflows'), { recursive: true });
    writeFileSync(join(cwd, 'workflows', 'booking.flow.loj'), `
workflow booking:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
    CONFIRMED:
      label: "Confirmed"

  transitions:
    confirm:
      from: DRAFT
      to: CONFIRMED
`, 'utf8');

    const stdout: string[] = [];
    const exitCode = runCli(['flow', 'validate', 'workflows/booking.flow.loj', '--json'], {
      cwd,
      stdout: (text) => stdout.push(text),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.artifact).toBe('loj.flow.validate.result');
    expect(payload.success).toBe(true);
    expect(payload.workflow).toBe('booking');
    expect(payload.transitions).toBe(1);
  });

  it('builds standalone .flow.loj manifests via loj flow build', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loj-cli-flow-'));
    mkdirSync(join(cwd, 'workflows'), { recursive: true });
    writeFileSync(join(cwd, 'workflows', 'booking.flow.loj'), `
workflow booking:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
    CONFIRMED:
      label: "Confirmed"

  transitions:
    confirm:
      from: DRAFT
      to: CONFIRMED
`, 'utf8');

    const exitCode = runCli(['flow', 'build', 'workflows/booking.flow.loj', '--out-dir', 'generated/flow'], {
      cwd,
    });

    expect(exitCode).toBe(0);
    const manifestPath = join(cwd, 'generated', 'flow', 'booking.flow.manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.artifact).toBe('loj.flow.manifest');
    expect(manifest.workflow).toBe('booking');
    expect(manifest.transitions).toHaveLength(1);
  });
});
