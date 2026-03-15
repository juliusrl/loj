import React from 'react';
import type { DataTableAction, DataTableColumn, SortState } from './DataTable.js';

export interface GroupedDataTableGroup<T extends { id: string }> {
  id: string;
  values: Record<string, unknown>;
  rows: T[];
}

export interface GroupedDataTableProps<T extends { id: string }> {
  columns: readonly DataTableColumn<T>[];
  groupBy: readonly string[];
  groups: Array<GroupedDataTableGroup<T>>;
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

export function GroupedDataTable<T extends { id: string }>({
  columns,
  groupBy,
  groups,
  loading = false,
  sort = null,
  onSortChange,
  actions = [],
  selectedRowId = null,
  onSelectRow,
  selectionName = 'rdsl-grouped-table-selection',
}: GroupedDataTableProps<T>) {
  const groupColumns = columns.filter((column) => groupBy.includes(column.key));
  const rowColumns = columns.filter((column) => !groupBy.includes(column.key));
  const hasSelection = Boolean(onSelectRow);

  return (
    <div className="rdsl-grouped-data-table">
      {loading ? <div className="rdsl-empty">Loading...</div> : null}
      {!loading && groups.length === 0 ? <div className="rdsl-empty">No records</div> : null}
      {!loading
        ? groups.map((group) => {
            const firstRow = group.rows[0];
            return (
              <section key={group.id} className="rdsl-grouped-data-table-group">
                <div className="rdsl-grouped-data-table-summary">
                  {groupColumns.map((column) => {
                    const value = group.values[column.key];
                    return (
                      <div key={column.key} className="rdsl-grouped-data-table-summary-item">
                        <strong>{column.label}</strong>
                        <span>{column.render ? column.render(value, firstRow) : formatValue(value, column.format)}</span>
                      </div>
                    );
                  })}
                </div>
                <table>
                  <thead>
                    <tr>
                      {hasSelection ? <th>Select</th> : null}
                      {rowColumns.map((column) => {
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
                    {group.rows.map((record) => (
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
                        {rowColumns.map((column) => {
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
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })
        : null}
    </div>
  );
}
