export function normalizeProjectPath(fileName: string): string {
  const slashNormalized = fileName.replace(/\\/g, '/');
  const driveMatch = slashNormalized.match(/^[A-Za-z]:/);
  const drivePrefix = driveMatch ? driveMatch[0] : '';
  const withoutDrive = drivePrefix ? slashNormalized.slice(drivePrefix.length) : slashNormalized;
  const isAbsolute = withoutDrive.startsWith('/');
  const parts = withoutDrive.split('/');
  const normalizedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (normalizedParts.length > 0 && normalizedParts[normalizedParts.length - 1] !== '..') {
        normalizedParts.pop();
        continue;
      }
      if (!isAbsolute) {
        normalizedParts.push(part);
      }
      continue;
    }
    normalizedParts.push(part);
  }

  const normalized = normalizedParts.join('/');
  if (isAbsolute) {
    return `${drivePrefix}/${normalized}`.replace(/\/+$/, normalized ? '' : '/');
  }
  if (drivePrefix) {
    return normalized ? `${drivePrefix}/${normalized}` : `${drivePrefix}/`;
  }
  return normalized || '.';
}

export function dirnameProjectPath(fileName: string): string {
  const normalized = normalizeProjectPath(fileName);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return '.';
  if (lastSlash === 0) return normalized.slice(0, 1);
  return normalized.slice(0, lastSlash);
}

export function resolveProjectPath(fromDir: string, relativePath: string): string {
  return normalizeProjectPath(`${fromDir}/${relativePath}`);
}

export function toProjectRelativePath(projectRoot: string, filePath: string): string | null {
  const normalizedRoot = normalizeProjectPath(projectRoot);
  const normalizedFile = normalizeProjectPath(filePath);

  if (normalizedRoot === '.') {
    return normalizedFile.startsWith('../') ? null : normalizedFile;
  }
  if (normalizedFile === normalizedRoot) {
    return '.';
  }
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return null;
}
