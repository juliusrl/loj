export const CANONICAL_RDSL_SOURCE_SUFFIX = '.web.loj';
export const LEGACY_RDSL_SOURCE_SUFFIX = '.rdsl';
export const RDSL_SOURCE_SUFFIXES = [
  CANONICAL_RDSL_SOURCE_SUFFIX,
  LEGACY_RDSL_SOURCE_SUFFIX,
] as const;

export function isRdslSourceFile(fileName: string): boolean {
  return RDSL_SOURCE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

export function isLegacyRdslSourceFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(LEGACY_RDSL_SOURCE_SUFFIX);
}

export function isRdslImportPath(path: string): boolean {
  return path.endsWith('/') || isRdslSourceFile(path);
}

export function stripRdslSourceSuffix(fileName: string): string {
  for (const suffix of RDSL_SOURCE_SUFFIXES) {
    if (fileName.toLowerCase().endsWith(suffix.toLowerCase())) {
      return fileName.slice(0, -suffix.length);
    }
  }
  return fileName;
}

export function describeRdslSourceSuffixes(): string {
  return `${CANONICAL_RDSL_SOURCE_SUFFIX} or ${LEGACY_RDSL_SOURCE_SUFFIX}`;
}
