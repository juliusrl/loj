export const CANONICAL_SDSL_SOURCE_SUFFIX = '.api.loj';
export const LEGACY_SDSL_SOURCE_SUFFIX = '.sdsl';
export const SDSL_SOURCE_SUFFIXES = [
  CANONICAL_SDSL_SOURCE_SUFFIX,
  LEGACY_SDSL_SOURCE_SUFFIX,
] as const;

export function isSdslSourceFile(fileName: string): boolean {
  return SDSL_SOURCE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

export function isLegacySdslSourceFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(LEGACY_SDSL_SOURCE_SUFFIX);
}

export function isSdslImportPath(path: string): boolean {
  return path.endsWith('/') || isSdslSourceFile(path);
}

export function stripSdslSourceSuffix(fileName: string): string {
  for (const suffix of SDSL_SOURCE_SUFFIXES) {
    if (fileName.toLowerCase().endsWith(suffix.toLowerCase())) {
      return fileName.slice(0, -suffix.length);
    }
  }
  return fileName;
}

export function describeSdslSourceSuffixes(): string {
  return `${CANONICAL_SDSL_SOURCE_SUFFIX} or ${LEGACY_SDSL_SOURCE_SUFFIX}`;
}
