import React from 'react';
import type { CollectionPaginationState, CollectionSortState } from './useCollectionView.js';

export interface GroupedCollectionViewGroup<T extends { id: string }> {
  id: string;
  values: Record<string, unknown>;
  rows: T[];
}

export interface UseGroupedCollectionViewOptions {
  pageSize?: number;
  paginate?: boolean;
}

export interface UseGroupedCollectionViewResult<T extends { id: string }> {
  groups: Array<GroupedCollectionViewGroup<T>>;
  allGroups: Array<GroupedCollectionViewGroup<T>>;
  sort: CollectionSortState | null;
  setSort: (next: CollectionSortState | null) => void;
  pagination: CollectionPaginationState;
  setPagination: (page: number) => void;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function sortItems<T extends { id: string }>(
  items: readonly T[],
  sort: CollectionSortState | null,
): T[] {
  if (!sort) return [...items];
  const sorted = [...items];
  sorted.sort((left, right) => {
    const comparison = compareValues(
      (left as Record<string, unknown>)[sort.field],
      (right as Record<string, unknown>)[sort.field],
    );
    return sort.direction === 'asc' ? comparison : comparison * -1;
  });
  return sorted;
}

function groupItems<T extends { id: string }>(
  items: readonly T[],
  groupBy: readonly string[],
): Array<GroupedCollectionViewGroup<T>> {
  if (groupBy.length === 0) {
    return items.map((item) => ({
      id: String(item.id),
      values: {},
      rows: [item],
    }));
  }

  const groups = new Map<string, GroupedCollectionViewGroup<T>>();
  for (const item of items) {
    const values = Object.fromEntries(groupBy.map((field) => [field, (item as Record<string, unknown>)[field]]));
    const id = JSON.stringify(groupBy.map((field) => [field, values[field]]));
    const existing = groups.get(id);
    if (existing) {
      existing.rows.push(item);
      continue;
    }
    groups.set(id, {
      id,
      values,
      rows: [item],
    });
  }
  return Array.from(groups.values());
}

export function useGroupedCollectionView<T extends { id: string }>(
  items: readonly T[],
  groupBy: readonly string[],
  options: UseGroupedCollectionViewOptions = {},
): UseGroupedCollectionViewResult<T> {
  const pageSize = options.pageSize ?? 20;
  const paginate = options.paginate ?? true;
  const [sort, setSortState] = React.useState<CollectionSortState | null>(null);
  const [page, setPage] = React.useState(1);

  const sortedItems = React.useMemo(() => sortItems(items, sort), [items, sort]);
  const allGroups = React.useMemo(() => groupItems(sortedItems, groupBy), [sortedItems, groupBy]);
  const totalPages = paginate ? Math.max(1, Math.ceil(allGroups.length / pageSize)) : 1;
  const currentPage = paginate ? Math.min(page, totalPages) : 1;
  const groups = React.useMemo(() => {
    if (!paginate) {
      return allGroups;
    }
    const start = (currentPage - 1) * pageSize;
    return allGroups.slice(start, start + pageSize);
  }, [allGroups, currentPage, pageSize, paginate]);

  React.useEffect(() => {
    if (currentPage !== page) {
      setPage(currentPage);
    }
  }, [currentPage, page]);

  const setSort = React.useCallback((next: CollectionSortState | null) => {
    setSortState(next);
    setPage(1);
  }, []);

  const setPagination = React.useCallback((nextPage: number) => {
    setPage(paginate ? Math.max(1, nextPage) : 1);
  }, [paginate]);

  return {
    groups,
    allGroups,
    sort,
    setSort,
    pagination: {
      page: currentPage,
      totalPages,
    },
    setPagination,
  };
}
