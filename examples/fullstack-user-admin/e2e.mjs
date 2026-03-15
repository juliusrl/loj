import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = process.cwd();
const PROJECT_FILE = process.env.LOJ_PROJECT_FILE ?? 'loj.project.yaml';
const LOJ_CLI_PATH = fileURLToPath(new URL('../../packages/loj-cli/dist/index.js', import.meta.url));
const BACKEND_AUTH_HEADER = `Basic ${Buffer.from('admin:admin123', 'utf8').toString('base64')}`;
const STARTUP_TIMEOUT_MS = 180_000;
const ACTION_TIMEOUT_MS = 30_000;
const RECENT_LOG_LIMIT = 250;
const ARTIFACT_DIR = process.env.LOJ_E2E_ARTIFACT_DIR
  ? resolve(PROJECT_DIR, process.env.LOJ_E2E_ARTIFACT_DIR)
  : null;

async function main() {
  const { chromium } = await loadPlaywright();
  const devSession = startLojDev();
  let browser;
  let context;
  let page;
  let ready = null;

  try {
    ready = await devSession.waitForReady();
    await waitForHttpOk(ready.hostUrl);
    await waitForUsersApi(ready.backendUrl);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    context = await browser.newContext({
      baseURL: ready.hostUrl,
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    const user = {
      name: `Alice Example ${Date.now()}`,
      email: `alice.${Date.now()}@example.com`,
      role: 'editor',
      status: 'active',
      updatedRole: 'viewer',
      updatedStatus: 'suspended',
    };

    await page.goto('/users');
    await page.getByRole('heading', { name: 'User Management' }).waitFor();
    await expectText(page, 'No records');

    await page.getByRole('link', { name: 'Create' }).click();
    await page.getByRole('heading', { name: 'Create Users' }).waitFor();
    await page.getByLabel('Name').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.locator('select[name="role"]').selectOption(user.role);
    await page.locator('select[name="status"]').selectOption(user.status);
    await page.getByRole('button', { name: 'Create' }).click();

    await page.waitForURL('**/users');
    await expectText(page, user.email);
    await waitForUserCount(ready.backendUrl, 1);
    await waitForUserMatch(ready.backendUrl, (record) =>
      record.email === user.email &&
      record.role === user.role &&
      record.status === user.status
    );

    const row = page.locator('tr', { hasText: user.email });
    await row.getByRole('link', { name: 'Edit' }).click();
    await page.waitForURL('**/users/*/edit');
    await page.locator('select[name="role"]').selectOption(user.updatedRole);
    await page.locator('select[name="status"]').selectOption(user.updatedStatus);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectText(page, 'User saved successfully');
    await waitForUserMatch(ready.backendUrl, (record) =>
      record.email === user.email &&
      record.role === user.updatedRole &&
      record.status === user.updatedStatus
    );

    await page.goto('/users');
    await expectRowText(page, user.email, user.updatedStatus);
    const updatedRow = page.locator('tr', { hasText: user.email });
    await updatedRow.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Confirmation dialog' }).waitFor();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expectText(page, 'Deleted successfully');
    await waitForUserCount(ready.backendUrl, 0);
    await expectText(page, 'No records');

    console.log(`Full-stack E2E passed (${PROJECT_FILE}): ${ready.hostUrl}`);
  } catch (error) {
    await persistFailureArtifacts({
      artifactDir: ARTIFACT_DIR,
      context,
      page,
      devSession,
      ready,
      error,
    });
    devSession.dumpRecentLogs();
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
    await devSession.close();
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      `Playwright is not installed for examples/fullstack-user-admin. Run "npm install --prefix examples/fullstack-user-admin" and "npx --prefix examples/fullstack-user-admin playwright install chromium". Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function startLojDev() {
  const child = spawn(process.execPath, [
    LOJ_CLI_PATH,
    'dev',
    PROJECT_FILE,
    '--json',
  ], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const recentLogs = [];
  let readyResolve;
  let readyReject;
  let hostUrl = null;
  let backendUrl = null;
  let closed = false;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const remember = (line) => {
    recentLogs.push(line);
    if (recentLogs.length > RECENT_LOG_LIMIT) {
      recentLogs.shift();
    }
  };

  const handleLine = (stream, rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    remember(`[${stream}] ${line}`);

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof parsed.hostUrl === 'string' && parsed.hostUrl.length > 0) {
      hostUrl = parsed.hostUrl;
    }
    if (typeof parsed.backendUrl === 'string' && parsed.backendUrl.length > 0) {
      backendUrl = parsed.backendUrl;
    }

    if ((parsed.event === 'ready' || parsed.event === 'dev-summary') && hostUrl && backendUrl) {
      readyResolve({ hostUrl, backendUrl });
      return;
    }

    if (parsed.event === 'service' && parsed.status === 'failure') {
      readyReject(new Error(parsed.error || 'loj dev service failed'));
      return;
    }

    if (parsed.event === 'build' && parsed.status === 'failure') {
      const message = Array.isArray(parsed.errors) && parsed.errors.length > 0
        ? parsed.errors.map((entry) => entry.message).filter(Boolean).join('; ')
        : parsed.error || 'target build failed';
      readyReject(new Error(`${parsed.alias || parsed.target || 'target'} build failed: ${message}`));
    }
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  wireLineBuffer(child.stdout, (line) => handleLine('stdout', line));
  wireLineBuffer(child.stderr, (line) => handleLine('stderr', line));

  child.on('exit', (code, signal) => {
    if (closed) {
      return;
    }
    readyReject(new Error(`loj dev exited before E2E completed (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
  });

  const startupTimer = setTimeout(() => {
    readyReject(new Error(`Timed out waiting for loj dev readiness after ${STARTUP_TIMEOUT_MS}ms`));
  }, STARTUP_TIMEOUT_MS);

  readyPromise.finally(() => {
    clearTimeout(startupTimer);
  });

  return {
    async waitForReady() {
      return readyPromise;
    },
    getRecentLogs() {
      return [...recentLogs];
    },
    dumpRecentLogs() {
      if (recentLogs.length === 0) {
        return;
      }
      console.error('\nRecent loj dev logs:');
      for (const line of recentLogs) {
        console.error(line);
      }
      console.error('');
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await terminateProcess(child);
    },
  };
}

async function persistFailureArtifacts({ artifactDir, context, page, devSession, ready, error }) {
  if (!artifactDir) {
    return;
  }

  mkdirSync(artifactDir, { recursive: true });

  const summary = {
    projectFile: PROJECT_FILE,
    hostUrl: ready?.hostUrl ?? null,
    backendUrl: ready?.backendUrl ?? null,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  };
  writeTextArtifact('summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  writeTextArtifact(
    'error.txt',
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );

  const recentLogs = devSession.getRecentLogs();
  if (recentLogs.length > 0) {
    writeTextArtifact('loj-dev.log', `${recentLogs.join('\n')}\n`);
  }

  if (page) {
    try {
      await page.screenshot({
        path: resolve(artifactDir, 'failure.png'),
        fullPage: true,
      });
    } catch {
      // Best-effort artifact capture.
    }

    try {
      const html = await page.content();
      writeTextArtifact('failure.html', html);
    } catch {
      // Best-effort artifact capture.
    }
  }

  if (context) {
    try {
      await context.tracing.stop({
        path: resolve(artifactDir, 'playwright-trace.zip'),
      });
    } catch {
      // Best-effort artifact capture.
    }
  }

  console.error(`Saved E2E failure artifacts to ${artifactDir}`);

  function writeTextArtifact(fileName, content) {
    writeFileSync(resolve(artifactDir, fileName), content, 'utf8');
  }
}

function wireLineBuffer(stream, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += String(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
    }
  });
}

async function terminateProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGINT');
  const finished = await waitForExit(child, 10_000);
  if (finished) {
    return;
  }

  child.kill('SIGTERM');
  const terminated = await waitForExit(child, 5_000);
  if (!terminated) {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit);
      resolve(false);
    }, timeoutMs);
    const handleExit = () => {
      clearTimeout(timer);
      child.off('exit', handleExit);
      resolve(true);
    };
    child.on('exit', handleExit);
  });
}

async function waitForHttpOk(url) {
  await poll(async () => {
    const response = await fetch(url, { redirect: 'manual' });
    if (!response.ok && response.status !== 304) {
      throw new Error(`Expected ${url} to return 2xx, got ${response.status}`);
    }
  }, `host ${url} to be reachable`);
}

async function waitForUsersApi(backendUrl) {
  await poll(async () => {
    const response = await fetch(`${backendUrl}/api/users`, {
      headers: {
        Authorization: BACKEND_AUTH_HEADER,
      },
    });
    if (!response.ok) {
      throw new Error(`Expected backend users API to return 2xx, got ${response.status}`);
    }
  }, `backend ${backendUrl}/api/users to be reachable`);
}

async function waitForUserCount(backendUrl, expectedCount) {
  await poll(async () => {
    const users = await listUsers(backendUrl);
    if (users.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} users, got ${users.length}`);
    }
  }, `backend user count to become ${expectedCount}`);
}

async function waitForUserMatch(backendUrl, predicate) {
  await poll(async () => {
    const users = await listUsers(backendUrl);
    if (!users.some(predicate)) {
      throw new Error('Expected matching user record to exist');
    }
  }, 'backend user record to match expected state');
}

async function listUsers(backendUrl) {
  const response = await fetch(`${backendUrl}/api/users`, {
    headers: {
      Authorization: BACKEND_AUTH_HEADER,
    },
  });
  if (!response.ok) {
    throw new Error(`GET /api/users failed with ${response.status}`);
  }
  const payload = await response.json();
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  throw new Error('Unexpected /api/users payload shape');
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).waitFor();
}

async function expectRowText(page, rowText, text) {
  await page.locator('tr', { hasText: rowText }).getByText(text, { exact: false }).waitFor();
}

async function poll(fn, description) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }
  throw new Error(`Timed out waiting for ${description}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
