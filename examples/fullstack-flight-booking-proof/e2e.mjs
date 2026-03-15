import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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
const RECORD_VIDEO = process.env.LOJ_E2E_RECORD_VIDEO === '1';
const ARTIFACT_DIR = process.env.LOJ_E2E_ARTIFACT_DIR
  ? resolve(PROJECT_DIR, process.env.LOJ_E2E_ARTIFACT_DIR)
  : RECORD_VIDEO
    ? resolve(PROJECT_DIR, '.artifacts/local-e2e')
    : null;

async function main() {
  const { chromium } = await loadPlaywright();
  const devPorts = await allocateE2eDevPorts();
  const devSession = startLojDev(devPorts);
  let browser;
  let context;
  let page;
  let video = null;
  let ready = null;

  try {
    ready = await devSession.waitForReady();
    await waitForHttpOk(ready.hostUrl);
    await waitForBookingsApi(ready.backendUrl);

    const member = await createMember(ready.backendUrl);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    if (ARTIFACT_DIR) {
      mkdirSync(ARTIFACT_DIR, { recursive: true });
    }

    context = await browser.newContext({
      baseURL: ready.hostUrl,
      ...(RECORD_VIDEO && ARTIFACT_DIR
        ? {
            recordVideo: {
              dir: ARTIFACT_DIR,
              size: { width: 1440, height: 900 },
            },
          }
        : {}),
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
    });

    page = await context.newPage();
    video = page.video?.() ?? null;
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    const scenario = {
      reference: `BK${Date.now()}`,
      representativeName: `Alice Traveler ${Date.now()}`,
      representativeAge: '30',
      contactPhone: '09012345678',
      contactEmail: `alice.booking.${Date.now()}@example.com`,
      memberId: String(member.id),
      confirmationSummary: 'Confirm at airport counter before departure.',
      failureRecoveryGuidance: 'If payment fails, retry once and contact support.',
      ticketingDeadlineSummary: 'Ticketing deadline is 24 hours before departure.',
      failureReasonSummary: 'Ticketing may fail when fare inventory changes.',
      recoveryChannelSummary: 'Recovery available via airport desk or call center.',
      historyReviewSummary: 'Review prior booking changes before reissue.',
      failureEscalationGuidance: 'Escalate to duty manager for repeated failures.',
      redoSearchGuidance: 'Redo search if seats or fare change before payment.',
      passengerFullName: `Bob Passenger ${Date.now()}`,
      passengerAge: '30',
    };

    await page.goto('/availability');
    await page.getByRole('heading', { name: 'Flight Availability' }).waitFor();
    await page.getByLabel('Departure Code').fill('HND');
    await page.getByLabel('Arrival Code').fill('CTS');
    await page.getByLabel('Outward Date').fill('2026-04-10');
    await page.getByLabel('Homeward Date').fill('2026-04-14');
    await page.getByLabel('Passenger Count').fill('1');
    await page.getByLabel('Cabin').fill('ECONOMY');

    await expectText(page, 'Matching Outbound');
    await page.locator('.loj-style-availability-result-shell').nth(0).getByRole('radio').first().check();
    await page.locator('.loj-style-availability-result-shell').nth(1).getByRole('radio').first().check();
    await page.getByRole('link', { name: 'Book selected itinerary' }).click();

    await page.waitForURL('**/bookings/create**');
    await page.getByRole('heading', { name: 'Create Bookings' }).waitFor();
    await page.getByRole('textbox', { name: /^Reference\b/i }).fill(scenario.reference);
    await page.getByRole('textbox', { name: /^Representative Name\b/i }).fill(scenario.representativeName);
    await page.getByRole('textbox', { name: /^Representative Age\b/i }).fill(scenario.representativeAge);
    await page.getByRole('combobox', { name: /^Representative Gender\b/i }).selectOption('FEMALE');
    await page.getByRole('textbox', { name: /^Contact Phone\b/i }).fill(scenario.contactPhone);
    await page.getByRole('textbox', { name: /^Contact Email\b/i }).fill(scenario.contactEmail);
    await page.getByRole('textbox', { name: /^Confirmation Summary\b/i }).fill(scenario.confirmationSummary);
    await page.getByRole('textbox', { name: /^Failure Recovery Guidance\b/i }).fill(scenario.failureRecoveryGuidance);
    await page.getByRole('textbox', { name: /^Ticketing Deadline Summary\b/i }).fill(scenario.ticketingDeadlineSummary);
    await page.getByRole('textbox', { name: /^Failure Reason Summary\b/i }).fill(scenario.failureReasonSummary);
    await page.getByRole('textbox', { name: /^Recovery Channel Summary\b/i }).fill(scenario.recoveryChannelSummary);
    await page.getByRole('textbox', { name: /^History Review Summary\b/i }).fill(scenario.historyReviewSummary);
    await page.getByRole('textbox', { name: /^Failure Escalation Guidance\b/i }).fill(scenario.failureEscalationGuidance);
    await page.getByRole('textbox', { name: /^Redo Search Guidance\b/i }).fill(scenario.redoSearchGuidance);
    await page.getByRole('combobox', { name: /^Member\b/i }).selectOption(scenario.memberId);
    await page.getByRole('textbox', { name: /^Full Name\b/i }).fill(scenario.passengerFullName);
    await page.getByRole('textbox', { name: /^Age\b/i }).fill(scenario.passengerAge);
    await page.getByRole('combobox', { name: /^Gender\b/i }).selectOption('MALE');
    await page.getByRole('button', { name: /Create and continue to confirm_booking|Create/i }).click();

    await page.waitForURL('**/bookings/*');
    await page.getByRole('heading', { name: 'Booking Detail' }).waitFor();
    await expectText(page, scenario.reference);
    await waitForBookingMatch(ready.backendUrl, (record) =>
      record.reference === scenario.reference &&
      record.representativeName === scenario.representativeName &&
      record.contactEmail === scenario.contactEmail &&
      String(record.status ?? '') === 'DRAFT'
    );
    await waitForPassengerMatch(ready.backendUrl, (record) =>
      record.fullName === scenario.passengerFullName
    );

    console.log(`Flight-booking E2E passed (${PROJECT_FILE}): ${ready.hostUrl}`);
  } catch (error) {
    await persistFailureArtifacts({
      artifactDir: ARTIFACT_DIR,
      context,
      page,
      video,
      devSession,
      ready,
      error,
    });
    devSession.dumpRecentLogs();
    throw error;
  } finally {
    await context?.close();
    if (ARTIFACT_DIR && video) {
      await persistSuccessVideoArtifacts(video, ARTIFACT_DIR);
    }
    await browser?.close();
    await devSession.close();
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      `Playwright is not installed for examples/fullstack-flight-booking-proof. Run "npm install --prefix examples/fullstack-flight-booking-proof" and "npx --prefix examples/fullstack-flight-booking-proof playwright install chromium". Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function startLojDev(devPorts) {
  const child = spawn(process.execPath, [
    LOJ_CLI_PATH,
    'dev',
    PROJECT_FILE,
    '--json',
  ], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Keep browser E2E traffic on loopback even if the example's local
      // developer defaults expose the host/server on 0.0.0.0 for WSL.
      LOJ_DEV_HOST_HOST: process.env.LOJ_E2E_DEV_HOST_HOST ?? '127.0.0.1',
      LOJ_DEV_SERVER_HOST: process.env.LOJ_E2E_DEV_SERVER_HOST ?? '127.0.0.1',
      LOJ_DEV_HOST_PORT: String(devPorts.hostPort),
      LOJ_DEV_HOST_PREVIEW_PORT: String(devPorts.hostPreviewPort),
      LOJ_DEV_SERVER_PORT: String(devPorts.serverPort),
    },
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

async function allocateE2eDevPorts() {
  const hostPort = await allocateFreePort();
  const hostPreviewPort = await allocateFreePort();
  const serverPort = await allocateFreePort();
  return {
    hostPort,
    hostPreviewPort,
    serverPort,
  };
}

function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a free localhost port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function persistFailureArtifacts({ artifactDir, context, page, video, devSession, ready, error }) {
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
    } catch {}

    try {
      const html = await page.content();
      writeTextArtifact('failure.html', html);
    } catch {}
  }

  if (context) {
    try {
      await context.tracing.stop({
        path: resolve(artifactDir, 'playwright-trace.zip'),
      });
    } catch {}
  }

  if (video) {
    await persistSuccessVideoArtifacts(video, artifactDir);
  }

  console.error(`Saved E2E failure artifacts to ${artifactDir}`);

  function writeTextArtifact(fileName, content) {
    writeFileSync(resolve(artifactDir, fileName), content, 'utf8');
  }
}

async function persistSuccessVideoArtifacts(video, artifactDir) {
  try {
    const webmPath = resolve(artifactDir, 'playwright-video.webm');
    await video.saveAs(webmPath);
    await tryConvertVideoToMp4(webmPath);
  } catch {
    // Best-effort artifact capture.
  }
}

async function tryConvertVideoToMp4(inputPath) {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    return;
  }
  const outputPath = inputPath.replace(/\.webm$/i, '.mp4');
  await new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, outputPath], {
      stdio: 'ignore',
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
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

async function waitForBookingsApi(backendUrl) {
  await poll(async () => {
    const response = await fetch(`${backendUrl}/api/bookings`, {
      headers: {
        Authorization: BACKEND_AUTH_HEADER,
      },
    });
    if (!response.ok) {
      throw new Error(`Expected backend bookings API to return 2xx, got ${response.status}`);
    }
  }, `backend ${backendUrl}/api/bookings to be reachable`);
}

async function createMember(backendUrl) {
  const now = Date.now();
  const payload = {
    name: `E2E Member ${now}`,
    email: `e2e.member.${now}@example.com`,
    membershipNumber: `M-${now}`,
    phone: '09011112222',
    preferredAirport: 'HND',
    recoveryDeskChannel: 'Airport desk',
    disruptionSupportTier: 'Standard desk support',
    supportNote: 'Created by E2E setup',
    historyServiceNote: 'Created by E2E setup',
    tier: 'STANDARD',
  };
  const response = await fetch(`${backendUrl}/api/members`, {
    method: 'POST',
    headers: {
      Authorization: BACKEND_AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST /api/members failed with ${response.status}`);
  }
  const created = await readCreatedRecord(response);
  if (!created || created.id == null) {
    throw new Error('POST /api/members returned no id');
  }
  return created;
}

async function waitForBookingMatch(backendUrl, predicate) {
  await poll(async () => {
    const records = await listRecords(backendUrl, 'bookings');
    if (!records.some(predicate)) {
      throw new Error('Expected matching booking record to exist');
    }
  }, 'backend booking record to match expected state');
}

async function waitForPassengerMatch(backendUrl, predicate) {
  await poll(async () => {
    const records = await listRecords(backendUrl, 'passengers');
    if (!records.some(predicate)) {
      throw new Error('Expected matching passenger record to exist');
    }
  }, 'backend passenger record to match expected state');
}

async function readCreatedRecord(response) {
  const payload = await response.json();
  if (payload && typeof payload === 'object') {
    if (payload.item && typeof payload.item === 'object') {
      return payload.item;
    }
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
      return payload.data;
    }
  }
  return payload;
}

async function listRecords(backendUrl, resource) {
  const response = await fetch(`${backendUrl}/api/${resource}`, {
    headers: {
      Authorization: BACKEND_AUTH_HEADER,
    },
  });
  if (!response.ok) {
    throw new Error(`GET /api/${resource} failed with ${response.status}`);
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
  throw new Error(`Unexpected /api/${resource} payload shape`);
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).waitFor();
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
