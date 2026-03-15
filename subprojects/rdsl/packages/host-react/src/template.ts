export type ReactDslHostTemplateFileMode = 'managed' | 'starter';

export interface ReactDslHostTemplateFile {
  path: string;
  mode: ReactDslHostTemplateFileMode;
  content: string;
}

export interface ReactDslHostTemplateManifest {
  artifact: 'rdsl.host-template';
  template: 'react-vite';
  version: string;
  title: string;
  defaults: {
    generatedDir: string;
    apiBase: string;
    appBasePath: string;
    host: string;
    port: number;
    previewPort: number;
  };
  managedFiles: string[];
  starterFiles: string[];
}

export interface ReactDslHostTemplate {
  manifest: ReactDslHostTemplateManifest;
  files: ReactDslHostTemplateFile[];
}

export interface CreateReactDslViteHostTemplateOptions {
  title?: string;
  packageName?: string;
  defaultGeneratedDir?: string;
  defaultApiBase?: string;
  defaultAppBasePath?: string;
  defaultHost?: string;
  defaultPort?: number;
  defaultPreviewPort?: number;
}

const TEMPLATE_VERSION = '0.1.0';

export function createReactDslViteHostTemplate(
  options: CreateReactDslViteHostTemplateOptions = {},
): ReactDslHostTemplate {
  const title = options.title?.trim() || 'ReactDSL Host';
  const packageName = options.packageName?.trim() || 'reactdsl-host';
  const defaults = {
    generatedDir: options.defaultGeneratedDir?.trim() || '../generated',
    apiBase: options.defaultApiBase?.trim() || 'http://127.0.0.1:3001',
    appBasePath: options.defaultAppBasePath?.trim() || '/',
    host: options.defaultHost?.trim() || '127.0.0.1',
    port: normalizePort(options.defaultPort, 5173),
    previewPort: normalizePort(options.defaultPreviewPort, 4173),
  };

  const managedFiles = [
    '.rdsl-host/template.json',
    'index.html',
    'tsconfig.json',
    'vite.config.ts',
    'src/HostApp.tsx',
    'src/main.tsx',
    'src/styles.css',
    'src/vite-env.d.ts',
  ];
  const starterFiles = [
    'package.json',
    'src/host-config.tsx',
  ];

  const manifest: ReactDslHostTemplateManifest = {
    artifact: 'rdsl.host-template',
    template: 'react-vite',
    version: TEMPLATE_VERSION,
    title,
    defaults,
    managedFiles,
    starterFiles,
  };

  return {
    manifest,
    files: [
      {
        path: '.rdsl-host/template.json',
        mode: 'managed',
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      },
      {
        path: 'index.html',
        mode: 'managed',
        content: renderIndexHtml(title),
      },
      {
        path: 'package.json',
        mode: 'starter',
        content: renderPackageJson(packageName),
      },
      {
        path: 'tsconfig.json',
        mode: 'managed',
        content: renderTsconfig(),
      },
      {
        path: 'vite.config.ts',
        mode: 'managed',
        content: renderViteConfig(defaults),
      },
      {
        path: 'src/HostApp.tsx',
        mode: 'managed',
        content: renderHostApp(),
      },
      {
        path: 'src/host-config.tsx',
        mode: 'starter',
        content: renderHostConfig(),
      },
      {
        path: 'src/main.tsx',
        mode: 'managed',
        content: renderMainTsx(),
      },
      {
        path: 'src/styles.css',
        mode: 'managed',
        content: HOST_STYLES,
      },
      {
        path: 'src/vite-env.d.ts',
        mode: 'managed',
        content: renderViteEnv(),
      },
    ],
  };
}

function renderIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`;
}

function renderPackageJson(packageName: string): string {
  return `${JSON.stringify({
    name: packageName,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@loj-lang/rdsl-host-react': '^0.1.0',
      '@loj-lang/rdsl-runtime': '^0.1.0',
      react: '^19.2.4',
      'react-dom': '^19.2.4',
    },
    devDependencies: {
      '@types/react': '^19.2.4',
      '@types/react-dom': '^19.2.3',
      '@vitejs/plugin-react': '^5.0.4',
      typescript: '^5.7.0',
      vite: '^7.3.1',
    },
  }, null, 2)}\n`;
}

function renderTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/rdsl-client"]
  },
  "include": ["src/**/*", "vite.config.ts"]
}
`;
}

function renderViteConfig(defaults: ReactDslHostTemplateManifest['defaults']): string {
  return `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolveReactDslViteHostConfig } from '@loj-lang/rdsl-host-react/vite';

const hostDir = fileURLToPath(new URL('.', import.meta.url));
const projectDir = path.resolve(hostDir, '..');
const repoRoot = path.resolve(projectDir, '..', '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, hostDir, '');
  const resolved = resolveReactDslViteHostConfig({
    hostDir,
    projectDir,
    repoRoot,
    env,
    defaultGeneratedDir: ${JSON.stringify(defaults.generatedDir)},
    defaultApiBase: ${JSON.stringify(defaults.apiBase)},
    defaultAppBasePath: ${JSON.stringify(defaults.appBasePath)},
    defaultHost: ${JSON.stringify(defaults.host)},
    defaultPort: ${defaults.port},
    defaultPreviewPort: ${defaults.previewPort},
  });

  return {
    plugins: [react()],
    ...resolved.viteConfig,
  };
});
`;
}

function renderHostApp(): string {
  return `import React from 'react';
import { App } from '@generated/App';
import { BrowserNavigationBridge } from '@loj-lang/rdsl-host-react';
import { HostProviders, HostStatus, HostToasts } from './host-config';

export function HostApp() {
  return (
    <HostProviders>
      <div className="rdsl-host-shell">
        {import.meta.env.DEV ? <HostStatus /> : null}
        <BrowserNavigationBridge>
          <App />
        </BrowserNavigationBridge>
        <HostToasts />
      </div>
    </HostProviders>
  );
}
`;
}

function renderHostConfig(): string {
  return `import React from 'react';
import {
  ReactDslHostProviders,
  ReactDslHostStatus,
  ReactDslHostToasts,
  resolveHostApiBase,
} from '@loj-lang/rdsl-host-react';
import type { AuthState, ToastMessage } from '@loj-lang/rdsl-runtime';

declare global {
  interface Window {
    __RDSL_API_BASE__?: string;
  }
}

const DEFAULT_AUTH: AuthState = {
  currentUser: {
    id: 'demo-admin',
    role: 'admin',
    name: 'Demo Admin',
    email: 'demo-admin@example.com',
  },
};

function formatMessage(message: ToastMessage): string {
  if (typeof message === 'string') {
    return message;
  }
  return message.defaultMessage ?? message.key;
}

export function HostProviders({ children }: { children?: React.ReactNode }) {
  const apiBase = React.useMemo(
    () => resolveHostApiBase(__RDSL_API_BASE__, typeof window !== 'undefined' ? window.__RDSL_API_BASE__ : undefined),
    [],
  );
  const generatedDir = React.useMemo(() => __RDSL_GENERATED_DIR__, []);

  return (
    <ReactDslHostProviders
      apiBase={apiBase}
      generatedDir={generatedDir}
      auth={DEFAULT_AUTH}
      formatMessage={formatMessage}
    >
      {children}
    </ReactDslHostProviders>
  );
}

export const HostStatus = ReactDslHostStatus;
export const HostToasts = ReactDslHostToasts;
`;
}

function renderMainTsx(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/rdsl-client';
import { configureAppBasePath } from '@loj-lang/rdsl-runtime';
import { HostApp } from './HostApp';
import './styles.css';

configureAppBasePath(__RDSL_APP_BASE_PATH__);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element for ReactDSL host app');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HostApp />
  </React.StrictMode>,
);
`;
}

function renderViteEnv(): string {
  return `/// <reference types="vite/rdsl-client" />

declare const __RDSL_GENERATED_DIR__: string;
declare const __RDSL_API_BASE__: string;
declare const __RDSL_APP_BASE_PATH__: string;
`;
}

function normalizePort(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HOST_STYLES = `:root {
  color-scheme: light;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%),
    linear-gradient(180deg, #f4f7f6 0%, #edf3f0 100%);
  color: #17322f;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

a {
  color: inherit;
}

button,
input,
select {
  font: inherit;
}

#root {
  min-height: 100vh;
}

.rdsl-host-shell {
  min-height: 100vh;
}

.rdsl-host-status {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid rgba(23, 50, 47, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  box-shadow: 0 16px 40px rgba(23, 50, 47, 0.12);
  font-size: 12px;
  pointer-events: none;
}

.rdsl-host-status-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.rdsl-host-status-main span,
.rdsl-host-status-main strong {
  overflow-wrap: anywhere;
}

.rdsl-host-status-toggle {
  border: 0;
  background: rgba(21, 94, 239, 0.08);
  color: #155eef;
  border-radius: 999px;
  min-width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  flex: 0 0 auto;
  pointer-events: auto;
}

.rdsl-host-status-collapsed {
  max-width: none;
  padding: 8px 10px;
  align-items: center;
}

.rdsl-host-status-collapsed .rdsl-host-status-main {
  display: block;
}

.rdsl-host-toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  display: grid;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
}

.rdsl-host-toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  color: #ffffff;
  box-shadow: 0 18px 36px rgba(23, 50, 47, 0.22);
}

.rdsl-host-toast-success {
  background: #0f766e;
}

.rdsl-host-toast-error {
  background: #b42318;
}

.rdsl-host-toast-info {
  background: #155eef;
}

.rdsl-host-toast-close {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.rdsl-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: 100vh;
}

.rdsl-sidebar {
  padding: 28px 22px;
  background: #12322f;
  color: #f5fbfa;
}

.rdsl-sidebar-header h2 {
  margin: 0 0 24px;
  font-size: 26px;
  line-height: 1.1;
}

.rdsl-nav {
  display: grid;
  gap: 20px;
}

.rdsl-nav-group {
  display: grid;
  gap: 10px;
}

.rdsl-nav-group-title {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(245, 251, 250, 0.72);
}

.rdsl-nav-item {
  display: block;
  padding: 10px 12px;
  border-radius: 10px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.08);
}

.rdsl-nav-item:hover {
  background: rgba(255, 255, 255, 0.16);
}

.rdsl-main {
  padding: 88px 28px 32px;
}

.rdsl-page-header,
.rdsl-view-header {
  margin-bottom: 20px;
}

.rdsl-page-card,
.rdsl-view-card {
  padding: 22px;
  border: 1px solid rgba(23, 50, 47, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 20px 40px rgba(23, 50, 47, 0.08);
}

.rdsl-filter-bar,
.rdsl-form-grid {
  display: grid;
  gap: 14px;
  margin-bottom: 18px;
}

.rdsl-filter-bar {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.rdsl-filter-field,
.rdsl-form-field {
  display: grid;
  gap: 8px;
}

.rdsl-filter-field input,
.rdsl-filter-field select,
.rdsl-form-field input,
.rdsl-form-field select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(23, 50, 47, 0.16);
  border-radius: 10px;
  background: #ffffff;
}

.rdsl-form-hint {
  color: rgba(23, 50, 47, 0.6);
}

.rdsl-data-table {
  overflow-x: auto;
}

.rdsl-data-table table {
  width: 100%;
  border-collapse: collapse;
}

.rdsl-data-table th,
.rdsl-data-table td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(23, 50, 47, 0.1);
  text-align: left;
  vertical-align: middle;
}

.rdsl-table-sort,
.rdsl-btn,
.rdsl-pagination button {
  cursor: pointer;
}

.rdsl-table-sort,
.rdsl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 12px;
  border: 0;
  border-radius: 10px;
  text-decoration: none;
}

.rdsl-table-sort,
.rdsl-btn-secondary,
.rdsl-pagination button {
  background: rgba(15, 118, 110, 0.12);
  color: #0f5f58;
}

.rdsl-btn-danger {
  background: rgba(180, 35, 24, 0.12);
  color: #8f2017;
}

.rdsl-table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rdsl-pagination {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.rdsl-pagination button {
  border: 0;
  padding: 8px 12px;
  border-radius: 10px;
}

.rdsl-tag,
.rdsl-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.rdsl-dialog-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(11, 24, 23, 0.42);
}

.rdsl-dialog {
  width: min(420px, calc(100vw - 32px));
  padding: 22px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 22px 48px rgba(11, 24, 23, 0.22);
}

.rdsl-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.rdsl-loading,
.rdsl-error {
  padding: 28px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
}

@media (max-width: 960px) {
  .rdsl-layout {
    grid-template-columns: 1fr;
  }

  .rdsl-sidebar {
    padding-bottom: 14px;
  }

  .rdsl-main {
    padding: 126px 18px 24px;
  }

  .rdsl-host-status {
    left: 16px;
    right: 16px;
    max-width: none;
  }
}
`;
