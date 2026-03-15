import React from 'react';
import { useResourceClient } from './resourceClient.js';
import { matchesResourceTarget } from './resourceTarget.js';

export interface UseReadModelOptions {
  enabled?: boolean;
}

export interface UseReadModelResult<T extends { id: string }> {
  data: T[];
  allData: T[];
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readModelLeaf(api: string): string {
  const parts = api.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'item';
}

function normalizeReadModelItems<T extends { id: string }>(api: string, payload: unknown): T[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : null;

  if (!rows) {
    throw new Error(`Invalid read-model response for ${api}: expected an array or { items: [] }`);
  }

  const syntheticPrefix = readModelLeaf(api);
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Invalid read-model row for ${api}: expected an object`);
    }
    return {
      ...row,
      id: row.id == null ? `${syntheticPrefix}-${index + 1}` : String(row.id),
    } as T;
  });
}

function buildReadModelUrl(api: string, query: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const trimmed = String(value ?? '').trim();
    if (trimmed !== '') {
      params.set(key, trimmed);
    }
  }
  const queryString = params.toString();
  if (queryString === '') {
    return api;
  }
  return api.includes('?') ? `${api}&${queryString}` : `${api}?${queryString}`;
}

export function useReadModel<T extends { id: string }>(
  api: string,
  query: Record<string, string>,
  options: UseReadModelOptions = {},
): UseReadModelResult<T> {
  const client = useResourceClient();
  const enabled = options.enabled ?? true;
  const [allData, setAllData] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const requestUrl = React.useMemo(() => buildReadModelUrl(api, query), [api, query]);

  const load = React.useCallback(async () => {
    if (!enabled) {
      setAllData([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const payload = await client.get<unknown>(requestUrl);
      setAllData(normalizeReadModelItems<T>(api, payload));
      setError(null);
    } catch (nextError) {
      setAllData([]);
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [api, client, enabled, requestUrl]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRefresh = (event: Event) => {
      const target = (event as CustomEvent<{ target?: unknown }>).detail?.target;
      if (matchesResourceTarget(api, target)) {
        void load();
      }
    };
    window.addEventListener('rdsl:refresh', handleRefresh);
    window.addEventListener('rdsl:invalidate', handleRefresh);
    return () => {
      window.removeEventListener('rdsl:refresh', handleRefresh);
      window.removeEventListener('rdsl:invalidate', handleRefresh);
    };
  }, [api, load]);

  const refresh = React.useCallback(async () => {
    await load();
  }, [load]);

  return {
    data: allData,
    allData,
    loading,
    error,
    refresh,
  };
}
