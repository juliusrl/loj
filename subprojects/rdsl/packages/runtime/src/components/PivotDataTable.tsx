import React from 'react';
import type { DataTableAction, DataTableColumn } from './DataTable.js';

export interface PivotDataTableGroup<T extends { id: string }> {
  id: string;
  values: Record<string, unknown>;
  rows: T[];
}

export interface PivotDataTableProps<T extends { id: string }> {
  columns: readonly DataTableColumn<T>[];
  groupBy: readonly string[];
  pivotBy: string;
  groups: Array<PivotDataTableGroup<T>>;
  loading?: boolean;
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

function collectPivotValues<T extends { id: string }>(
  groups: Array<PivotDataTableGroup<T>>,
  pivotBy: string,
): string[] {
  const values: string[] = [];
  for (const group of groups) {
    for (const row of group.rows) {
      const value = (row as Record<string, unknown>)[pivotBy];
      const key = value == null ? '—' : String(value);
      if (!values.includes(key)) {
        values.push(key);
      }
    }
  }
  return values;
}

export function PivotDataTable<T extends { id: string }>({
  columns,
  groupBy,
  pivotBy,
  groups,
  loading = false,
  actions = [],
  selectedRowId = null,
  onSelectRow,
  selectionName = 'rdsl-pivot-table-selection',
}: PivotDataTableProps<T>) {
  const groupColumns = columns.filter((column) => groupBy.includes(column.key));
  const pivotColumns = columns.filter((column) => !groupBy.includes(column.key) && column.key !== pivotBy);
  const pivotValues = React.useMemo(() => collectPivotValues(groups, pivotBy), [groups, pivotBy]);
  const hasSelection = Boolean(onSelectRow);

  return (
    <div className="rdsl-pivot-data-table">
      {loading ? <div className="rdsl-empty">Loading...</div> : null}
      {!loading && groups.length === 0 ? <div className="rdsl-empty">No records</div> : null}
      {!loading
        ? groups.map((group) => {
            const firstRow = group.rows[0];
            return (
              <section key={group.id} className="rdsl-pivot-data-table-group">
                <div className="rdsl-pivot-data-table-summary">
                  {groupColumns.map((column) => {
                    const value = group.values[column.key];
                    return (
                      <div key={column.key} className="rdsl-pivot-data-table-summary-item">
                        <strong>{column.label}</strong>
                        <span>{column.render ? column.render(value, firstRow) : formatValue(value, column.format)}</span>
                      </div>
                    );
                  })}
                </div>
                <table>
                  <thead>
                    <tr>
                      {pivotValues.map((value) => (
                        <th key={value}>{value}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {pivotValues.map((value) => {
                        const rows = group.rows.filter((row) => {
                          const rowValue = (row as Record<string, unknown>)[pivotBy];
                          return (rowValue == null ? '—' : String(rowValue)) === value;
                        });
                        return (
                          <td key={value}>
                            {rows.length === 0 ? (
                              <div className="rdsl-empty">—</div>
                            ) : (
                              <div className="rdsl-pivot-data-table-cell">
                                {rows.map((record) => (
                                  <div key={record.id} className="rdsl-pivot-data-table-entry">
                                    {hasSelection ? (
                                      <label className="rdsl-pivot-data-table-entry-field">
                                        <strong>Select</strong>
                                        <input
                                          type="radio"
                                          name={selectionName}
                                          checked={selectedRowId === String(record.id)}
                                          onChange={() => onSelectRow?.(record)}
                                        />
                                      </label>
                                    ) : null}
                                    {pivotColumns.map((column) => {
                                      const columnValue = (record as Record<string, unknown>)[column.key];
                                      return (
                                        <div key={column.key} className="rdsl-pivot-data-table-entry-field">
                                          <strong>{column.label}</strong>
                                          <span>{column.render ? column.render(columnValue, record) : formatValue(columnValue, column.format)}</span>
                                        </div>
                                      );
                                    })}
                                    {actions.length > 0 ? (
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
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })
        : null}
    </div>
  );
}
