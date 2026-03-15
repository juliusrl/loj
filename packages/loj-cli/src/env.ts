import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ProjectDevEnvironmentOverrides {
  hostHost?: string;
  hostPort?: number;
  hostPreviewPort?: number;
  apiBase?: string;
  proxyAuth?: string;
  serverHost?: string;
  serverPort?: number;
}

export interface ProjectTargetEnvironment {
  alias: string;
  files: string[];
  values: Record<string, string>;
  effectiveValues: Record<string, string>;
}

export interface ProjectEnvironment {
  files: string[];
  sharedFiles: string[];
  sharedValues: Record<string, string>;
  targets: Record<string, ProjectTargetEnvironment>;
  devOverrides: ProjectDevEnvironmentOverrides;
}

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadProjectEnvironment(
  projectDir: string,
  targetAliases: string[],
  shellEnv: Record<string, string | undefined> = process.env,
): { environment: ProjectEnvironment } | { error: string } {
  const sharedBase = loadEnvironmentLayer(projectDir, '.env');
  if ('error' in sharedBase) {
    return sharedBase;
  }
  const sharedLocal = loadEnvironmentLayer(projectDir, '.env.local');
  if ('error' in sharedLocal) {
    return sharedLocal;
  }

  const sharedValues = {
    ...sharedBase.values,
    ...sharedLocal.values,
  };
  const sharedFiles = [...sharedBase.files, ...sharedLocal.files];
  const files = [...sharedFiles];
  const targets: Record<string, ProjectTargetEnvironment> = {};

  for (const alias of targetAliases) {
    const base = loadEnvironmentLayer(projectDir, `.env.${alias}`);
    if ('error' in base) {
      return base;
    }
    const local = loadEnvironmentLayer(projectDir, `.env.${alias}.local`);
    if ('error' in local) {
      return local;
    }

    const targetValues = {
      ...base.values,
      ...local.values,
    };
    const targetFiles = [...base.files, ...local.files];
    const effectiveValues = {
      ...sharedValues,
      ...targetValues,
    };

    files.push(...targetFiles);
    targets[alias] = {
      alias,
      files: targetFiles,
      values: targetValues,
      effectiveValues,
    };
  }

  const devOverrides = parseProjectDevEnvironmentOverrides(sharedValues, shellEnv);
  if ('error' in devOverrides) {
    return devOverrides;
  }

  return {
    environment: {
      files,
      sharedFiles,
      sharedValues,
      targets,
      devOverrides: devOverrides.overrides,
    },
  };
}

export function collectProjectEnvironmentFileNames(targetAliases: string[]): Set<string> {
  const fileNames = new Set<string>(['.env', '.env.local']);
  for (const alias of targetAliases) {
    fileNames.add(`.env.${alias}`);
    fileNames.add(`.env.${alias}.local`);
  }
  return fileNames;
}

export function createProcessEnvironmentOverlay(
  fileValues: Record<string, string>,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const overlay: Record<string, string> = {};
  for (const [key, value] of Object.entries(fileValues)) {
    if (baseEnv[key] !== undefined) {
      continue;
    }
    overlay[key] = value;
  }
  return overlay;
}

export function createEnvironmentSignature(values: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function loadEnvironmentLayer(
  projectDir: string,
  relativePath: string,
): { files: string[]; values: Record<string, string> } | { error: string } {
  const absolutePath = resolve(projectDir, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      files: [],
      values: {},
    };
  }

  try {
    const source = readFileSync(absolutePath, 'utf8');
    const parsed = parseDotEnvSource(source, relativePath);
    if ('error' in parsed) {
      return parsed;
    }
    return {
      files: [relativePath],
      values: parsed.values,
    };
  } catch (error) {
    return {
      error: `Failed to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parseDotEnvSource(
  source: string,
  fileLabel: string,
): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) {
      return {
        error: `${fileLabel}:${index + 1} must look like KEY=value`,
      };
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!VALID_ENV_KEY.test(key)) {
      return {
        error: `${fileLabel}:${index + 1} has an invalid environment key: ${key}`,
      };
    }

    const rawValue = normalized.slice(equalsIndex + 1).trim();
    const parsedValue = parseDotEnvValue(rawValue, fileLabel, index + 1);
    if ('error' in parsedValue) {
      return parsedValue;
    }

    values[key] = parsedValue.value;
  }

  return { values };
}

function parseDotEnvValue(
  rawValue: string,
  fileLabel: string,
  lineNumber: number,
): { value: string } | { error: string } {
  if (rawValue.length === 0) {
    return { value: '' };
  }

  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"') || rawValue.length === 1) {
      return {
        error: `${fileLabel}:${lineNumber} has an unterminated double-quoted value`,
      };
    }
    return {
      value: rawValue.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\'),
    };
  }

  if (rawValue.startsWith('\'')) {
    if (!rawValue.endsWith('\'') || rawValue.length === 1) {
      return {
        error: `${fileLabel}:${lineNumber} has an unterminated single-quoted value`,
      };
    }
    return {
      value: rawValue.slice(1, -1),
    };
  }

  return {
    value: stripUnquotedInlineComment(rawValue),
  };
}

function stripUnquotedInlineComment(rawValue: string): string {
  const commentIndex = rawValue.search(/\s#/);
  if (commentIndex < 0) {
    return rawValue.trim();
  }
  return rawValue.slice(0, commentIndex).trim();
}

function parseProjectDevEnvironmentOverrides(
  sharedValues: Record<string, string>,
  shellEnv: Record<string, string | undefined>,
): { overrides: ProjectDevEnvironmentOverrides } | { error: string } {
  const hostHost = resolveOptionalString(shellEnv.LOJ_DEV_HOST_HOST, sharedValues.LOJ_DEV_HOST_HOST);
  const apiBase = resolveOptionalString(shellEnv.LOJ_DEV_API_BASE, sharedValues.LOJ_DEV_API_BASE);
  const proxyAuth = resolveOptionalString(shellEnv.LOJ_DEV_PROXY_AUTH, sharedValues.LOJ_DEV_PROXY_AUTH);
  const serverHost = resolveOptionalString(shellEnv.LOJ_DEV_SERVER_HOST, sharedValues.LOJ_DEV_SERVER_HOST);
  const hostPort = parseOptionalPort(
    shellEnv.LOJ_DEV_HOST_PORT,
    sharedValues.LOJ_DEV_HOST_PORT,
    'LOJ_DEV_HOST_PORT',
  );
  if ('error' in hostPort) {
    return hostPort;
  }
  const hostPreviewPort = parseOptionalPort(
    shellEnv.LOJ_DEV_HOST_PREVIEW_PORT,
    sharedValues.LOJ_DEV_HOST_PREVIEW_PORT,
    'LOJ_DEV_HOST_PREVIEW_PORT',
  );
  if ('error' in hostPreviewPort) {
    return hostPreviewPort;
  }
  const serverPort = parseOptionalPort(
    shellEnv.LOJ_DEV_SERVER_PORT,
    sharedValues.LOJ_DEV_SERVER_PORT,
    'LOJ_DEV_SERVER_PORT',
  );
  if ('error' in serverPort) {
    return serverPort;
  }

  return {
    overrides: {
      ...(hostHost ? { hostHost } : {}),
      ...(hostPort.port !== undefined ? { hostPort: hostPort.port } : {}),
      ...(hostPreviewPort.port !== undefined ? { hostPreviewPort: hostPreviewPort.port } : {}),
      ...(apiBase ? { apiBase } : {}),
      ...(proxyAuth ? { proxyAuth } : {}),
      ...(serverHost ? { serverHost } : {}),
      ...(serverPort.port !== undefined ? { serverPort: serverPort.port } : {}),
    },
  };
}

function resolveOptionalString(primary: string | undefined, fallback: string | undefined): string | undefined {
  const resolved = primary ?? fallback;
  if (resolved === undefined) {
    return undefined;
  }
  const trimmed = resolved.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalPort(
  primary: string | undefined,
  fallback: string | undefined,
  variableName: string,
): { port?: number } | { error: string } {
  const resolved = primary ?? fallback;
  if (resolved === undefined || resolved.trim().length === 0) {
    return {};
  }
  const parsed = Number(resolved);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      error: `${variableName} must be a positive integer`,
    };
  }
  return { port: parsed };
}
