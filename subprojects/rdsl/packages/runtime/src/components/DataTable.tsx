import React from 'react';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  format?: 'date';
  render?: (value: unknown, record: T) => React.ReactNode;
}

export interface DataTableAction<T> {
  label: string;
  href?: (row: T) => string;
  onClick?: (row: T) => void | Promise<void>;
  variant?: 'default' | 'danger';
}

export interface SortState {
  field: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<T extends { id: string }> {
  columns: readonly DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  actions?: readonly DataTableAction<T>[];
  selectedRowId?: string | null;
  onSelectRow?: (row: T) => void;
  selectionName?: string;
}

function formatValue(value: unknown, format?: 'date'): React.ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  if (format !== 'date') return String(value);
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function nextSortState(current: SortState | null | undefined, field: string): SortState | null {
  if (!current || current.field !== field) {
    return { field, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { field, direction: 'desc' };
  }
  return null;
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  loading = false,
  sort = null,
  onSortChange,
  actions = [],
  selectedRowId = null,
  onSelectRow,
  selectionName = 'rdsl-table-selection',
}: DataTableProps<T>) {
  const hasSelection = Boolean(onSelectRow);

  return (
    <div className="rdsl-data-table">
      <table>
        <thead>
          <tr>
            {hasSelection ? <th>Select</th> : null}
            {columns.map((column) => {
              const sortable = Boolean(column.sortable && onSortChange);
              const activeSort = sort?.field === column.key ? sort.direction : null;
              return (
                <th key={column.key}>
                  {sortable ? (
                    <button
                      type="button"
                      className="rdsl-table-sort"
                      onClick={() => onSortChange?.(nextSortState(sort, column.key))}
                    >
                      {column.label}
                      {activeSort ? ` ${activeSort === 'asc' ? '↑' : '↓'}` : ''}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            {actions.length > 0 ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + (actions.length > 0 ? 1 : 0) + (hasSelection ? 1 : 0)}>Loading...</td>
            </tr>
          ) : null}
          {!loading && data.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (actions.length > 0 ? 1 : 0) + (hasSelection ? 1 : 0)}>No records</td>
            </tr>
          ) : null}
          {!loading
            ? data.map((record) => (
                <tr key={record.id}>
                  {hasSelection ? (
                    <td>
                      <input
                        type="radio"
                        name={selectionName}
                        checked={selectedRowId === String(record.id)}
                        onChange={() => onSelectRow?.(record)}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => {
                    const value = (record as Record<string, unknown>)[column.key];
                    return (
                      <td key={column.key}>
                        {column.render ? column.render(value, record) : formatValue(value, column.format)}
                      </td>
                    );
                  })}
                  {actions.length > 0 ? (
                    <td>
                      <div className="rdsl-table-actions">
                        {actions.map((action) => {
                          const className = action.variant === 'danger'
                            ? 'rdsl-btn rdsl-btn-danger'
                            : 'rdsl-btn rdsl-btn-secondary';
                          if (action.href) {
                            return (
                              <a key={action.label} className={className} href={action.href(record)}>
                                {action.label}
                              </a>
                            );
                          }
                          return (
                            <button
                              key={action.label}
                              type="button"
                              className={className}
                              onClick={() => action.onClick?.(record)}
                            >
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}
