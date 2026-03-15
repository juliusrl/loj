import React from 'react';

export interface CollectionPaginationState {
  page: number;
  totalPages: number;
}

export interface CollectionSortState {
  field: string;
  direction: 'asc' | 'desc';
}

export interface UseCollectionViewOptions {
  pageSize?: number;
  paginate?: boolean;
}

export interface UseCollectionViewResult<T extends { id: string }> {
  data: T[];
  allData: T[];
  filters: Record<string, string>;
  setFilters: (next: Record<string, string>) => void;
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

function filterItems<T extends { id: string }>(items: readonly T[], filters: Record<string, string>): T[] {
  return items.filter((item) =>
    Object.entries(filters).every(([key, rawFilter]) => {
      const filterValue = rawFilter.trim();
      if (filterValue === '') return true;
      const value = (item as Record<string, unknown>)[key];
      return String(value ?? '').toLowerCase().includes(filterValue.toLowerCase());
    })
  );
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

export function useCollectionView<T extends { id: string }>(
  items: readonly T[],
  options: UseCollectionViewOptions = {},
): UseCollectionViewResult<T> {
  const pageSize = options.pageSize ?? 20;
  const paginate = options.paginate ?? true;
  const [filters, setFiltersState] = React.useState<Record<string, string>>({});
  const [sort, setSortState] = React.useState<CollectionSortState | null>(null);
  const [page, setPage] = React.useState(1);

  const filteredItems = React.useMemo(() => filterItems(items, filters), [items, filters]);
  const sortedItems = React.useMemo(() => sortItems(filteredItems, sort), [filteredItems, sort]);
  const totalPages = paginate ? Math.max(1, Math.ceil(sortedItems.length / pageSize)) : 1;
  const currentPage = paginate ? Math.min(page, totalPages) : 1;
  const data = React.useMemo(() => {
    if (!paginate) {
      return sortedItems;
    }
    const start = (currentPage - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [currentPage, pageSize, paginate, sortedItems]);

  React.useEffect(() => {
    if (currentPage !== page) {
      setPage(currentPage);
    }
  }, [currentPage, page]);

  const setFilters = React.useCallback((next: Record<string, string>) => {
    setFiltersState(next);
    setPage(1);
  }, []);

  const setSort = React.useCallback((next: CollectionSortState | null) => {
    setSortState(next);
    setPage(1);
  }, []);

  const setPagination = React.useCallback((nextPage: number) => {
    setPage(paginate ? Math.max(1, nextPage) : 1);
  }, [paginate]);

  return {
    data,
    allData: items as T[],
    filters,
    setFilters,
    sort,
    setSort,
    pagination: {
      page: currentPage,
      totalPages,
    },
    setPagination,
  };
}
