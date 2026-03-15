import path from 'node:path';

export interface ReactDslViteHostEnv {
  RDSL_GENERATED_DIR?: string | undefined;
  VITE_RDSL_API_BASE?: string | undefined;
  VITE_RDSL_APP_BASE_PATH?: string | undefined;
  RDSL_PROXY_API_TARGET?: string | undefined;
  RDSL_PROXY_API_AUTH?: string | undefined;
  HOST?: string | undefined;
  PORT?: string | undefined;
  PREVIEW_PORT?: string | undefined;
}

export interface ResolveReactDslViteHostConfigOptions {
  hostDir: string;
  projectDir: string;
  repoRoot: string;
  env?: ReactDslViteHostEnv;
  defaultGeneratedDir?: string;
  defaultApiBase?: string;
  defaultAppBasePath?: string;
  defaultHost?: string;
  defaultPort?: number;
  defaultPreviewPort?: number;
}

export interface ReactDslViteHostConfigResult {
  generatedDir: string;
  generatedRoot: string;
  apiBase: string;
  appBasePath: string;
  host: string;
  port: number;
  previewPort: number;
  viteConfig: {
    base: string;
    resolve: {
      alias: {
        '@generated': string;
      };
    };
    define: {
      __RDSL_GENERATED_DIR__: string;
      __RDSL_API_BASE__: string;
      __RDSL_APP_BASE_PATH__: string;
    };
    server: {
      host: string;
      port: number;
      fs: {
        allow: string[];
      };
      proxy?: Record<string, {
        target: string;
        changeOrigin: true;
        auth?: string;
      }>;
    };
    preview: {
      host: string;
      port: number;
    };
    build: {
      outDir: string;
      emptyOutDir: true;
    };
  };
}

export function resolveReactDslViteHostConfig(
  options: ResolveReactDslViteHostConfigOptions,
): ReactDslViteHostConfigResult {
  const env = options.env ?? {};
  const generatedDir = env.RDSL_GENERATED_DIR?.trim() || options.defaultGeneratedDir || '../generated';
  const generatedRoot = path.resolve(options.hostDir, generatedDir);
  const apiBase = env.VITE_RDSL_API_BASE?.trim() || options.defaultApiBase || 'http://127.0.0.1:3001';
  const appBasePath = normalizeAppBasePath(env.VITE_RDSL_APP_BASE_PATH?.trim() || options.defaultAppBasePath || '/');
  const proxyApiTarget = env.RDSL_PROXY_API_TARGET?.trim() || undefined;
  const proxyApiAuth = env.RDSL_PROXY_API_AUTH?.trim() || undefined;
  const host = env.HOST?.trim() || options.defaultHost || '127.0.0.1';
  const port = parsePort(env.PORT, options.defaultPort ?? 5173);
  const previewPort = parsePort(env.PREVIEW_PORT, options.defaultPreviewPort ?? 4173);
  const allowedRoots = Array.from(new Set([options.projectDir, options.repoRoot]));
  const proxy = createProxyConfig(apiBase, proxyApiTarget, proxyApiAuth);

  return {
    generatedDir,
    generatedRoot,
    apiBase,
    appBasePath,
    host,
    port,
    previewPort,
    viteConfig: {
      resolve: {
        alias: {
          '@generated': generatedRoot,
        },
      },
      define: {
        __RDSL_GENERATED_DIR__: JSON.stringify(path.relative(options.hostDir, generatedRoot).replace(/\\/g, '/')),
        __RDSL_API_BASE__: JSON.stringify(apiBase),
        __RDSL_APP_BASE_PATH__: JSON.stringify(appBasePath),
      },
      base: appBasePath === '/' ? '/' : `${appBasePath}/`,
      server: {
        host,
        port,
        fs: {
          allow: allowedRoots,
        },
        ...(proxy ? { proxy } : {}),
      },
      preview: {
        host,
        port: previewPort,
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
      },
    },
  };
}

function normalizeAppBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) || '/' : prefixed;
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createProxyConfig(
  apiBase: string,
  proxyApiTarget: string | undefined,
  proxyApiAuth: string | undefined,
): Record<string, { target: string; changeOrigin: true; auth?: string }> | undefined {
  if (!proxyApiTarget || !apiBase.startsWith('/')) {
    return undefined;
  }

  return {
    [apiBase]: {
      target: proxyApiTarget,
      changeOrigin: true,
      ...(proxyApiAuth ? { auth: proxyApiAuth } : {}),
    },
  };
}
