import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveClientNavigationLocation, resolveHostApiBase } from '../src/index.js';
import { createReactDslViteHostTemplate } from '../src/template.js';
import { resolveReactDslViteHostConfig } from '../src/vite.js';

describe('resolveClientNavigationLocation', () => {
  it('returns an in-app location for same-origin links', () => {
    expect(resolveClientNavigationLocation({
      href: '/users/1/edit?mode=full',
      currentUrl: 'http://127.0.0.1:4174/users',
    })).toBe('/users/1/edit?mode=full');
  });

  it('ignores external or non-navigational links', () => {
    expect(resolveClientNavigationLocation({
      href: 'https://example.com/users',
      currentUrl: 'http://127.0.0.1:4174/users',
    })).toBeNull();
    expect(resolveClientNavigationLocation({
      href: 'mailto:test@example.com',
      currentUrl: 'http://127.0.0.1:4174/users',
    })).toBeNull();
  });
});

describe('resolveHostApiBase', () => {
  it('prefers an explicit global bootstrap value when present', () => {
    expect(resolveHostApiBase('http://127.0.0.1:3001', 'http://localhost:9000')).toBe('http://localhost:9000');
  });

  it('falls back to the configured host value', () => {
    expect(resolveHostApiBase('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
  });
});

describe('resolveReactDslViteHostConfig', () => {
  it('builds a stable default Vite host config shape', () => {
    const hostDir = path.resolve('/repo/subprojects/rdsl/examples/user-admin/host');
    const projectDir = path.resolve(hostDir, '..');
    const repoRoot = path.resolve(projectDir, '..', '..');

    const result = resolveReactDslViteHostConfig({
      hostDir,
      projectDir,
      repoRoot,
    });

    expect(result.generatedDir).toBe('../generated');
    expect(result.generatedRoot).toBe(path.resolve(hostDir, '../generated'));
    expect(result.apiBase).toBe('http://127.0.0.1:3001');
    expect(result.appBasePath).toBe('/');
    expect(result.viteConfig.resolve.alias['@generated']).toBe(path.resolve(hostDir, '../generated'));
    expect(result.viteConfig.define.__RDSL_GENERATED_DIR__).toBe(JSON.stringify('../generated'));
    expect(result.viteConfig.define.__RDSL_APP_BASE_PATH__).toBe(JSON.stringify('/'));
    expect(result.viteConfig.base).toBe('/');
    expect(result.viteConfig.server.fs.allow).toEqual([projectDir, repoRoot]);
  });

  it('applies env overrides for generated dir, api base, and ports', () => {
    const hostDir = path.resolve('/repo/subprojects/rdsl/examples/user-admin/host');
    const projectDir = path.resolve(hostDir, '..');
    const repoRoot = path.resolve(projectDir, '..', '..');

    const result = resolveReactDslViteHostConfig({
      hostDir,
      projectDir,
      repoRoot,
      env: {
        RDSL_GENERATED_DIR: '../.rdsl-dev/generated',
        VITE_RDSL_API_BASE: 'http://localhost:4000',
        VITE_RDSL_APP_BASE_PATH: '/admin',
        HOST: '0.0.0.0',
        PORT: '9000',
        PREVIEW_PORT: '9001',
      },
    });

    expect(result.generatedRoot).toBe(path.resolve(hostDir, '../.rdsl-dev/generated'));
    expect(result.apiBase).toBe('http://localhost:4000');
    expect(result.appBasePath).toBe('/admin');
    expect(result.host).toBe('0.0.0.0');
    expect(result.port).toBe(9000);
    expect(result.previewPort).toBe(9001);
    expect(result.viteConfig.define.__RDSL_API_BASE__).toBe(JSON.stringify('http://localhost:4000'));
    expect(result.viteConfig.define.__RDSL_APP_BASE_PATH__).toBe(JSON.stringify('/admin'));
    expect(result.viteConfig.base).toBe('/admin/');
  });

  it('adds a Vite proxy when api base is path-shaped and a proxy target is configured', () => {
    const hostDir = path.resolve('/repo/subprojects/rdsl/examples/user-admin/host');
    const projectDir = path.resolve(hostDir, '..');
    const repoRoot = path.resolve(projectDir, '..', '..');

    const result = resolveReactDslViteHostConfig({
      hostDir,
      projectDir,
      repoRoot,
      env: {
        VITE_RDSL_API_BASE: '/api',
        RDSL_PROXY_API_TARGET: 'http://127.0.0.1:3001',
      },
    });

    expect(result.apiBase).toBe('/api');
    expect(result.viteConfig.server.proxy).toEqual({
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    });
  });

  it('passes proxy auth through to the Vite proxy when configured', () => {
    const hostDir = path.resolve('/repo/subprojects/rdsl/examples/user-admin/host');
    const projectDir = path.resolve(hostDir, '..');
    const repoRoot = path.resolve(projectDir, '..', '..');

    const result = resolveReactDslViteHostConfig({
      hostDir,
      projectDir,
      repoRoot,
      env: {
        VITE_RDSL_API_BASE: '/api',
        RDSL_PROXY_API_TARGET: 'http://127.0.0.1:3001',
        RDSL_PROXY_API_AUTH: 'admin:admin123',
      },
    });

    expect(result.viteConfig.server.proxy).toEqual({
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        auth: 'admin:admin123',
      },
    });
  });
});

describe('createReactDslViteHostTemplate', () => {
  it('returns a stable managed/starter file set', () => {
    const template = createReactDslViteHostTemplate({
      title: 'User Admin Host',
      packageName: 'user-admin-host',
    });

    expect(template.manifest.template).toBe('react-vite');
    expect(template.manifest.managedFiles).toContain('vite.config.ts');
    expect(template.manifest.starterFiles).toContain('src/host-config.tsx');
    expect(template.files.find((file) => file.path === 'index.html')?.mode).toBe('managed');
    expect(template.files.find((file) => file.path === 'package.json')?.mode).toBe('starter');
    expect(template.files.find((file) => file.path === '.rdsl-host/template.json')?.content).toContain(
      '"template": "react-vite"',
    );
  });

  it('embeds template options into starter and managed files', () => {
    const template = createReactDslViteHostTemplate({
      title: 'Inventory Console',
      packageName: 'inventory-console-host',
      defaultGeneratedDir: '../.rdsl-dev/generated',
      defaultApiBase: 'http://localhost:4100',
      defaultAppBasePath: '/console',
      defaultHost: '0.0.0.0',
      defaultPort: 8100,
      defaultPreviewPort: 8101,
    });

    expect(template.files.find((file) => file.path === 'index.html')?.content).toContain(
      '<title>Inventory Console</title>',
    );
    expect(template.files.find((file) => file.path === 'package.json')?.content).toContain(
      '"name": "inventory-console-host"',
    );
    expect(template.files.find((file) => file.path === 'vite.config.ts')?.content).toContain(
      'defaultGeneratedDir: "../.rdsl-dev/generated"',
    );
    expect(template.files.find((file) => file.path === 'vite.config.ts')?.content).toContain(
      'defaultApiBase: "http://localhost:4100"',
    );
    expect(template.files.find((file) => file.path === 'vite.config.ts')?.content).toContain(
      'defaultAppBasePath: "/console"',
    );
    expect(template.files.find((file) => file.path === 'vite.config.ts')?.content).toContain(
      "defaultPort: 8100",
    );
    expect(template.files.find((file) => file.path === 'src/host-config.tsx')?.content).toContain(
      'function formatMessage(message: ToastMessage): string',
    );
    expect(template.files.find((file) => file.path === 'src/host-config.tsx')?.content).toContain(
      'formatMessage={formatMessage}',
    );
    expect(template.files.find((file) => file.path === 'src/HostApp.tsx')?.content).toContain(
      '{import.meta.env.DEV ? <HostStatus /> : null}',
    );
    expect(template.files.find((file) => file.path === 'src/main.tsx')?.content).toContain(
      'configureAppBasePath(__RDSL_APP_BASE_PATH__);',
    );
  });

  it('keeps the dev host status badge from intercepting page clicks', () => {
    const template = createReactDslViteHostTemplate();
    const hostStyles = template.files.find((file) => file.path === 'src/styles.css')?.content ?? '';

    expect(hostStyles).toContain('.rdsl-host-status {');
    expect(hostStyles).toContain('pointer-events: none;');
    expect(hostStyles).toContain('.rdsl-host-status-toggle {');
    expect(hostStyles).toContain('pointer-events: auto;');
  });
});
