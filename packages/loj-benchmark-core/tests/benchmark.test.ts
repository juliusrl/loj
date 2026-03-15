import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportPrompts, importAuthoringRun, runAuthoringBenchmark, runCli } from '../src/index.js';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = new URL('../../../benchmarks/authoring', import.meta.url).pathname;
const fixtureDir = new URL('../../../benchmarks/authoring/fixtures/docs-only-golden', import.meta.url).pathname;
const taskIds = readdirSync(join(corpusDir, 'tasks'))
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => entry.replace(/\.json$/, ''))
  .sort();

function readFixtureAttempt(taskId: string): string {
  const canonicalPath = join(fixtureDir, taskId, 'attempt-1.web.loj');
  const legacyPath = join(fixtureDir, taskId, 'attempt-1.rdsl');
  return readFileSync(existsSync(canonicalPath) ? canonicalPath : legacyPath, 'utf8');
}

function seedSubmissionSet(outDir: string): void {
  writeFileSync(
    join(outDir, 'run.json'),
    JSON.stringify(
      {
        artifact: 'rdsl.authoring-run',
        schemaVersion: '0.1.0',
        runId: 'seeded-fixture',
        lane: 'docs-only',
        model: 'fixture-seeded',
      },
      null,
      2,
    ),
    'utf8',
  );

  for (const taskId of taskIds) {
    const taskDir = join(outDir, taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'attempt-1.web.loj'), readFixtureAttempt(taskId), 'utf8');
  }
}

describe('benchmark harness', () => {
  it('exports docs-only prompts', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-prompts-'));
    const manifest = exportPrompts({ corpusDir, outDir });

    expect(manifest.prompts).toHaveLength(taskIds.length);
    expect(existsSync(join(outDir, 'user-admin-crud.md'))).toBe(true);
    expect(readFileSync(join(outDir, 'user-admin-crud.md'), 'utf8')).toContain('Return exactly one valid `.web.loj` document');
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(true);
  });

  it('runs the golden fixture corpus', () => {
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-report-'));
    const report = runAuthoringBenchmark({
      corpusDir,
      submissionsDir: fixtureDir,
      reportDir,
    });

    expect(report.summary.taskCount).toBe(taskIds.length);
    expect(report.summary.firstPassValidRate).toBe(1);
    expect(report.summary.failedTaskCount).toBe(0);
    expect(existsSync(join(reportDir, 'report.json'))).toBe(true);
    expect(existsSync(join(reportDir, 'summary.md'))).toBe(true);
  });

  it('counts repairs and retains failed attempts', () => {
    const submissionsDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-repair-'));
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-repair-report-'));
    seedSubmissionSet(submissionsDir);

    const taskDir = join(submissionsDir, 'user-admin-crud');
    writeFileSync(join(taskDir, 'attempt-1.web.loj'), 'app:\n  theme: neon\n', 'utf8');
    writeFileSync(
      join(taskDir, 'attempt-2.web.loj'),
      readFixtureAttempt('user-admin-crud'),
      'utf8',
    );

    const report = runAuthoringBenchmark({
      corpusDir,
      submissionsDir,
      reportDir,
    });

    const repairedTask = report.tasks.find((task) => task.taskId === 'user-admin-crud');
    expect(repairedTask?.status).toBe('repaired');
    expect(repairedTask?.repairsBeforeFirstValid).toBe(1);
    expect(report.summary.firstPassValidCount).toBe(taskIds.length - 1);
    expect(report.summary.failedTaskCount).toBe(0);
    expect(existsSync(join(reportDir, 'failures', 'user-admin-crud', 'attempt-1.web.loj'))).toBe(true);
    expect(existsSync(join(reportDir, 'failures', 'user-admin-crud', 'attempt-1.diagnostics.json'))).toBe(true);
  });

  it('scores create-view descriptor ref misuse as a failed attempt', () => {
    const submissionsDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-toast-invalid-'));
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-toast-invalid-report-'));
    seedSubmissionSet(submissionsDir);

    const taskId = 'toast-create-invites';
    const taskDir = join(submissionsDir, taskId);
    const invalidAttempt = readFixtureAttempt(taskId)
      .replace('form.email', 'record.email')
      .replace('user.name', 'params.id');

    writeFileSync(join(taskDir, 'attempt-1.web.loj'), invalidAttempt, 'utf8');

    const report = runAuthoringBenchmark({
      corpusDir,
      submissionsDir,
      reportDir,
    });

    const failedTask = report.tasks.find((task) => task.taskId === taskId);
    expect(failedTask?.status).toBe('failed');
    expect(failedTask?.winningAttempt).toBeNull();
    expect(failedTask?.attempts[0]?.compileSuccess).toBe(false);
    expect(failedTask?.attempts[0]?.errors.some((error) => error.message.includes('record.email'))).toBe(true);
    expect(failedTask?.attempts[0]?.errors.some((error) => error.message.includes('params.id'))).toBe(true);
    expect(report.summary.failedTaskCount).toBe(1);
    expect(existsSync(join(reportDir, 'failures', taskId, 'attempt-1.diagnostics.json'))).toBe(true);
  });

  it('imports a jsonl response bundle into a scored submission set', () => {
    const inputFile = join(mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-jsonl-')), 'responses.jsonl');
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-jsonl-out-'));
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-jsonl-report-'));

    const lines = taskIds.map((taskId, index) =>
      JSON.stringify({
        taskId,
        attempt: 1,
        output: `\`\`\`yaml\n${readFixtureAttempt(taskId).trim()}\n\`\`\``,
        usage: {
          input_tokens: 100 + index,
          output_tokens: 200 + index,
        },
        latency_ms: 4000 + index,
      }),
    );
    writeFileSync(inputFile, `${lines.join('\n')}\n`, 'utf8');

    const manifest = importAuthoringRun({
      adapter: 'jsonl',
      inputPath: inputFile,
      outDir,
      corpusDir,
      runId: 'jsonl-import',
      model: 'fixture-jsonl',
    });
    expect(manifest.attempts).toHaveLength(taskIds.length);
    expect(existsSync(join(outDir, 'user-admin-crud', 'attempt-1.meta.json'))).toBe(true);

    const report = runAuthoringBenchmark({
      corpusDir,
      submissionsDir: outDir,
      reportDir,
    });
    expect(report.summary.failedTaskCount).toBe(0);
    expect(report.summary.tokenUsage.totalTokens).toBeGreaterThan(0);
  });

  it('imports openai-like response exports and exposes the import CLI', () => {
    const inputDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-openai-raw-'));
    const outDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-openai-out-'));
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-openai-report-'));

    for (const [index, taskId] of taskIds.entries()) {
      writeFileSync(
        join(inputDir, `${taskId}-attempt-1.json`),
        JSON.stringify(
          {
            taskId,
            attempt: 1,
            response: {
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: readFixtureAttempt(taskId),
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 300 + index,
                output_tokens: 120 + index,
                total_tokens: 420 + index,
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(
      [
        'import',
        '--adapter',
        'openai-responses',
        '--input',
        inputDir,
        '--out-dir',
        outDir,
        '--corpus',
        corpusDir,
        '--run-id',
        'openai-import',
        '--model',
        'fixture-openai',
        '--json',
      ],
      {
        cwd: repoRoot,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    const manifest = JSON.parse(stdout.join(''));
    expect(manifest.adapter).toBe('openai-responses');
    expect(manifest.attempts).toHaveLength(taskIds.length);

    const report = runAuthoringBenchmark({
      corpusDir,
      submissionsDir: outDir,
      reportDir,
    });
    expect(report.summary.failedTaskCount).toBe(0);
    expect(report.run.provider).toBe('openai');
  });

  it('exposes a CLI that returns json output for successful runs', () => {
    const reportDir = mkdtempSync(join(tmpdir(), 'reactdsl-benchmark-cli-report-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = runCli(
      ['run', '--submissions', fixtureDir, '--corpus', corpusDir, '--report-dir', reportDir, '--json'],
      {
        cwd: repoRoot,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(JSON.parse(stdout.join('')).summary.failedTaskCount).toBe(0);
  });
});
