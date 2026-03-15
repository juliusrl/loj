import React from 'react';
import { useResourceClient } from './resourceClient.js';
import { getResourceStore } from './resourceStore.js';
import { matchesResourceTarget } from './resourceTarget.js';
import { useCollectionView } from './useCollectionView.js';

export interface ResourcePaginationState {
  page: number;
  totalPages: number;
}

export interface UseResourceOptions {
  pageSize?: number;
}

export interface UseResourceResult<T extends { id: string }> {
  data: T[];
  allData: T[];
  loading: boolean;
  error: unknown;
  filters: Record<string, string>;
  setFilters: (next: Record<string, string>) => void;
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  setSort: (next: { field: string; direction: 'asc' | 'desc' } | null) => void;
  pagination: ResourcePaginationState;
  setPagination: (page: number) => void;
  getById: (id: string) => T | undefined;
  createItem: (input: Partial<T>) => Promise<T>;
  updateItem: (id: string, input: Partial<T>) => Promise<T>;
  deleteItem: (id: string) => Promise<void>;
  refresh: () => void | Promise<void>;
}

interface ResourceStore<T extends { id: string }> {
  getSnapshot(): { items: T[]; error: unknown; pendingCount: number; resolvedOnce: boolean };
  subscribe(listener: () => void): () => void;
  getById(id: string): T | undefined;
  load(force?: boolean): Promise<T[]>;
  createItem(input: Partial<T>): Promise<T>;
  updateItem(id: string, input: Partial<T>): Promise<T>;
  deleteItem(id: string): Promise<void>;
}

export function useResource<T extends { id: string }>(
  api: string,
  options: UseResourceOptions = {},
): UseResourceResult<T> {
  const pageSize = options.pageSize ?? 20;
  const client = useResourceClient();
  const store = React.useMemo(() => getResourceStore<T>(client, api), [api, client]);
  const [, setRevision] = React.useState(0);

  React.useEffect(() => {
    return store.subscribe(() => {
      setRevision((value) => value + 1);
    });
  }, [store]);

  React.useEffect(() => {
    void store.load(false).catch(() => undefined);
  }, [store]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRefresh = (event: any) => {
      const target = event?.detail?.target;
      if (matchesResourceTarget(api, target)) {
        void store.load(true).catch(() => undefined);
      }
    };
    window.addEventListener('rdsl:refresh', handleRefresh as EventListener);
    window.addEventListener('rdsl:invalidate', handleRefresh as EventListener);
    return () => {
      window.removeEventListener('rdsl:refresh', handleRefresh as EventListener);
      window.removeEventListener('rdsl:invalidate', handleRefresh as EventListener);
    };
  }, [api, store]);

  const snapshot = store.getSnapshot();
  const collection = useCollectionView(snapshot.items, { pageSize, paginate: true });

  const getById = React.useCallback((id: string) => {
    return store.getById(id);
  }, [store]);

  const createItem = React.useCallback((input: Partial<T>) => {
    return store.createItem(input);
  }, [store]);

  const updateItem = React.useCallback((id: string, input: Partial<T>) => {
    return store.updateItem(id, input);
  }, [store]);

  const deleteItem = React.useCallback((id: string) => {
    return store.deleteItem(id);
  }, [store]);

  const refresh = React.useCallback(() => {
    return store.load(true).then(() => undefined);
  }, [store]);

  return {
    data: collection.data,
    allData: snapshot.items,
    loading: snapshot.pendingCount > 0 || !snapshot.resolvedOnce,
    error: snapshot.error,
    filters: collection.filters,
    setFilters: collection.setFilters,
    sort: collection.sort,
    setSort: collection.setSort,
    pagination: collection.pagination,
    setPagination: collection.setPagination,
    getById,
    createItem,
    updateItem,
    deleteItem,
    refresh,
  };
}
