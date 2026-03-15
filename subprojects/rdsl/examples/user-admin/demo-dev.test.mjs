import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDevPlan, resolveDemoDevConfig } from './demo-dev.mjs';

test('resolveDemoDevConfig returns stable defaults', () => {
  const config = resolveDemoDevConfig({});

  assert.equal(config.generatedDir, '.rdsl-dev/generated');
  assert.equal(config.generatedDirFromHost, '../.rdsl-dev/generated');
  assert.equal(config.apiBindHost, '127.0.0.1');
  assert.equal(config.apiBase, 'http://127.0.0.1:3001');
  assert.equal(config.hostBindHost, '127.0.0.1');
  assert.equal(config.hostPort, 5173);
  assert.equal(config.previewPort, 4173);
});

test('resolveDemoDevConfig applies environment overrides', () => {
  const config = resolveDemoDevConfig({
    RDSL_DEMO_API_BIND: '0.0.0.0',
    RDSL_DEMO_API_PORT: '4100',
    RDSL_DEMO_API_BASE: 'http://localhost:4100',
    RDSL_DEMO_HOST_BIND: '0.0.0.0',
    RDSL_DEMO_HOST_PORT: '8100',
    RDSL_DEMO_HOST_PREVIEW_PORT: '8101',
  });

  assert.equal(config.apiBindHost, '0.0.0.0');
  assert.equal(config.apiPort, 4100);
  assert.equal(config.apiBase, 'http://localhost:4100');
  assert.equal(config.hostBindHost, '0.0.0.0');
  assert.equal(config.hostPort, 8100);
  assert.equal(config.previewPort, 8101);
});

test('createDemoDevPlan returns the expected three-process dev topology', () => {
  const plan = createDemoDevPlan(resolveDemoDevConfig({
    RDSL_DEMO_API_PORT: '4100',
    RDSL_DEMO_HOST_PORT: '8100',
  }));

  assert.equal(plan.hostUrl, 'http://127.0.0.1:8100');
  assert.equal(plan.apiUrl, 'http://127.0.0.1:4100');
  assert.equal(plan.services.length, 3);
  assert.deepEqual(
    plan.services.map((service) => service.label),
    ['mock-api', 'rdsl-dev', 'host'],
  );

  const generated = plan.services.find((service) => service.label === 'rdsl-dev');
  assert.ok(generated);
  assert.equal(generated.args[1], 'dev');
  assert.equal(generated.args[2], 'app.web.loj');
  assert.deepEqual(generated.args.slice(-2), ['--out-dir', '.rdsl-dev/generated']);

  const host = plan.services.find((service) => service.label === 'host');
  assert.ok(host);
  assert.equal(host.env.RDSL_GENERATED_DIR, '../.rdsl-dev/generated');
  assert.equal(host.env.VITE_RDSL_API_BASE, 'http://127.0.0.1:4100');
  assert.equal(host.env.PORT, '8100');
});
