import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const ARTIFACT_DIR = resolve(
  PROJECT_DIR,
  process.env.LOJ_DEMO_PACK_ARTIFACT_DIR ?? '.artifacts/demo-pack',
);

async function main() {
  const { chromium } = await loadPlaywright();
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const devSession = startLojDev();
  let browser;
  let context;
  let page;
  let ready = null;

  try {
    ready = await devSession.waitForReady();
    await waitForHttpOk(ready.hostUrl);
    await waitForApi(ready.backendUrl, '/api/teams');
    const seeded = await seedDemoData(ready.backendUrl);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    context = await browser.newContext({
      baseURL: ready.hostUrl,
      viewport: {
        width: 1600,
        height: 1100,
      },
      recordVideo: {
        dir: ARTIFACT_DIR,
        size: {
          width: 1280,
          height: 880,
        },
      },
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
    });

    page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const video = page.video();

    const screenshots = [];

    await page.goto('/invoices');
    await page.getByRole('heading', { name: 'Invoices' }).waitFor();
    await expectText(page, seeded.invoiceOne.number);
    await expectText(page, seeded.primaryCustomer.name);
    await pauseForMotion(1_200);
    screenshots.push(await capture(page, '01-invoices-list.png', 'Invoices list with relation-derived columns and seeded records.'));
    await pauseForMotion(900);

    await page.goto(`/invoices/${seeded.invoiceOne.id}`);
    await page.getByRole('heading', { name: 'Invoice Detail' }).waitFor();
    await expectText(page, seeded.invoiceOne.number);
    await expectText(page, seeded.invoiceOneLineItem.description);
    await page.mouse.wheel(0, 720);
    await pauseForMotion(900);
    screenshots.push(await capture(page, '02-invoice-read.png', 'Invoice read surface with related line-items panel and relation-derived fields.'));
    await pauseForMotion(900);

    await page.goto(`/customers/${seeded.primaryCustomer.id}/invoices`);
    await page.getByRole('heading', { name: 'Customer Invoices' }).waitFor();
    await expectText(page, seeded.invoiceOne.number);
    await pauseForMotion(1_100);
    screenshots.push(await capture(page, '03-customer-invoices-page.png', 'Record-scoped relation page reusing the invoices list surface.'));
    await pauseForMotion(900);

    await page.goto(`/teams/${seeded.primaryTeam.id}`);
    await page.getByRole('heading', { name: 'Team Detail' }).waitFor();
    await expectText(page, seeded.primaryCustomer.name);
    await page.mouse.wheel(0, 420);
    await pauseForMotion(1_100);
    screenshots.push(await capture(page, '04-team-read.png', 'Team read surface with related customers panel.'));
    await pauseForMotion(900);

    await context.tracing.stop({
      path: resolve(ARTIFACT_DIR, 'playwright-trace.zip'),
    });
    await context.close();
    context = null;

    const motion = await saveRecordedVideo(video, 'invoice-walkthrough.webm', 'Short walkthrough video derived from the demo-pack navigation.');
    const derivedMotion = motion ? await transcodeMotionArtifacts(motion.file) : [];
    const summary = {
      projectFile: PROJECT_FILE,
      hostUrl: ready.hostUrl,
      backendUrl: ready.backendUrl,
      artifactDir: ARTIFACT_DIR,
      generatedAt: new Date().toISOString(),
      seeded: {
        primaryTeamId: seeded.primaryTeam.id,
        primaryCustomerId: seeded.primaryCustomer.id,
        invoiceId: seeded.invoiceOne.id,
      },
      motion: motion ? {
        ...motion,
        derivatives: derivedMotion,
      } : null,
      screenshots,
    };
    writeTextArtifact('summary.json', `${JSON.stringify(summary, null, 2)}\n`);

    console.log(`Demo pack captured (${PROJECT_FILE}): ${ARTIFACT_DIR}`);
  } catch (error) {
    await persistFailureArtifacts({
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
      `Playwright is not available. Run "npm install --prefix examples/fullstack-invoice-backoffice" and "npx --prefix examples/fullstack-invoice-backoffice playwright install chromium". Original error: ${error instanceof Error ? error.message : String(error)}`,
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
  let hostUrlConfirmed = false;
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

    if (parsed.event === 'service-log' && parsed.service === 'host' && typeof parsed.text === 'string') {
      const localMatch = parsed.text.match(/https?:\/\/[^\s/$.?#].[^\s]*/);
      if (localMatch) {
        hostUrl = localMatch[0].replace(/\/+$/, '');
        hostUrlConfirmed = true;
      }
    }

    if (hostUrlConfirmed && backendUrl) {
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
    readyReject(new Error(`loj dev exited before demo pack completed (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
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

async function seedDemoData(backendUrl) {
  const timestamp = Date.now();
  const primaryTeam = await createRecord(backendUrl, '/api/teams', {
    name: `North Accounts ${timestamp}`,
    region: 'NA',
  });
  const secondaryTeam = await createRecord(backendUrl, '/api/teams', {
    name: `Enterprise EMEA ${timestamp}`,
    region: 'EMEA',
  });
  const primaryCustomer = await createRecord(backendUrl, '/api/customers', {
    name: `Acme Holdings ${timestamp}`,
    tier: 'STRATEGIC',
    team: primaryTeam.id,
  });
  await createRecord(backendUrl, '/api/customers', {
    name: `Globex Retail ${timestamp}`,
    tier: 'GROWTH',
    team: secondaryTeam.id,
  });
  const invoiceOne = await createRecord(backendUrl, '/api/invoices', {
    number: `INV-${timestamp}-A`,
    status: 'SENT',
    total: 12500,
    salesOwnerUsername: 'admin',
    customer: primaryCustomer.id,
  });
  const invoiceTwo = await createRecord(backendUrl, '/api/invoices', {
    number: `INV-${timestamp}-B`,
    status: 'COMPLETED',
    total: 5400,
    salesOwnerUsername: 'admin',
    customer: primaryCustomer.id,
  });
  const invoiceOneLineItem = await createRecord(backendUrl, '/api/line-items', {
    description: 'Annual Platform Subscription',
    category: 'SUBSCRIPTION',
    quantity: 1,
    amount: 10000,
    invoice: invoiceOne.id,
  });
  await createRecord(backendUrl, '/api/line-items', {
    description: 'Launch Services',
    category: 'SERVICES',
    quantity: 1,
    amount: 2500,
    invoice: invoiceOne.id,
  });
  await createRecord(backendUrl, '/api/line-items', {
    description: 'Priority Support',
    category: 'SUPPORT',
    quantity: 1,
    amount: 5400,
    invoice: invoiceTwo.id,
  });

  return {
    primaryTeam,
    primaryCustomer,
    invoiceOne,
    invoiceTwo,
    invoiceOneLineItem,
  };
}

async function createRecord(backendUrl, path, payload) {
  const response = await fetch(`${backendUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: BACKEND_AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return extractItem(await response.json());
}

function extractItem(payload) {
  if (payload && typeof payload === 'object' && payload.item && typeof payload.item === 'object') {
    return payload.item;
  }
  return payload;
}

async function capture(page, fileName, caption) {
  const relativePath = fileName;
  await page.screenshot({
    path: resolve(ARTIFACT_DIR, fileName),
    fullPage: true,
  });
  return {
    file: relativePath,
    caption,
  };
}

async function saveRecordedVideo(video, fileName, caption) {
  if (!video) {
    return null;
  }
  const file = resolve(ARTIFACT_DIR, fileName);
  await video.saveAs(file);
  await video.delete();
  return {
    file: fileName,
    caption,
  };
}

async function transcodeMotionArtifacts(fileName) {
  const inputPath = resolve(ARTIFACT_DIR, fileName);
  const derivatives = [];

  const mp4File = 'invoice-walkthrough.mp4';
  const mp4Succeeded = await tryRunCommand('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    resolve(ARTIFACT_DIR, mp4File),
  ]);
  if (mp4Succeeded) {
    derivatives.push({
      file: mp4File,
      caption: 'H.264/MP4 export derived from the walkthrough video.',
    });
  }

  const palettePath = resolve(ARTIFACT_DIR, 'invoice-walkthrough-palette.png');
  const gifFile = 'invoice-walkthrough.gif';
  const paletteSucceeded = await tryRunCommand('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    'fps=12,scale=960:-1:flags=lanczos,palettegen',
    palettePath,
  ]);
  if (paletteSucceeded) {
    const gifSucceeded = await tryRunCommand('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-i',
      palettePath,
      '-lavfi',
      'fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a',
      resolve(ARTIFACT_DIR, gifFile),
    ]);
    if (gifSucceeded) {
      derivatives.push({
        file: gifFile,
        caption: 'Animated GIF derived from the walkthrough video.',
      });
    }
  }
  rmSync(palettePath, { force: true });

  return derivatives;
}

async function persistFailureArtifacts({ context, page, devSession, ready, error }) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

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
        path: resolve(ARTIFACT_DIR, 'failure.png'),
        fullPage: true,
      });
    } catch {
      // Best-effort artifact capture.
    }
  }

  if (context) {
    try {
      await context.tracing.stop({
        path: resolve(ARTIFACT_DIR, 'playwright-trace.zip'),
      });
    } catch {
      // Best-effort artifact capture.
    }
  }

  console.error(`Saved demo-pack failure artifacts to ${ARTIFACT_DIR}`);
}

function writeTextArtifact(fileName, content) {
  writeFileSync(resolve(ARTIFACT_DIR, fileName), content, 'utf8');
}

function tryRunCommand(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        resolvePromise(false);
        return;
      }
      console.warn(`${command} failed: ${error instanceof Error ? error.message : String(error)}`);
      resolvePromise(false);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(true);
        return;
      }
      console.warn(`${command} exited with code ${code}: ${stderr.trim()}`);
      resolvePromise(false);
    });
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
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit);
      resolvePromise(false);
    }, timeoutMs);
    const handleExit = () => {
      clearTimeout(timer);
      child.off('exit', handleExit);
      resolvePromise(true);
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

async function waitForApi(backendUrl, path) {
  await poll(async () => {
    const response = await fetch(`${backendUrl}${path}`, {
      headers: {
        Authorization: BACKEND_AUTH_HEADER,
      },
    });
    if (!response.ok) {
      throw new Error(`Expected backend ${path} to return 2xx, got ${response.status}`);
    }
  }, `backend ${backendUrl}${path} to be reachable`);
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor();
}

async function pauseForMotion(durationMs) {
  await delay(durationMs);
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
