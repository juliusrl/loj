function normalizeTarget(target: string): string {
  return target.trim().replace(/^\/+|\/+$/g, '');
}

function apiLeaf(api: string): string {
  const normalized = normalizeTarget(api);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function matchesResourceTarget(api: string, target: unknown): boolean {
  if (typeof target !== 'string' || target.trim() === '') return false;
  const normalizedTarget = normalizeTarget(target);
  const normalizedApi = normalizeTarget(api);
  const leaf = apiLeaf(api);

  return [
    normalizedApi,
    leaf,
    `${leaf}.list`,
    `resource.${leaf}`,
    `resource.${leaf}.list`,
  ].includes(normalizedTarget);
}
