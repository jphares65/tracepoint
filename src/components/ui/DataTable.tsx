"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "./cx";
import { ariaSort, nextSort, sortRows, type SortState, type SortValue } from "./data-table-core";
import { AsyncState, type AsyncStatus } from "./Feedback";

export type DataTableColumn<Row> = {
  key: string;
  header: string;
  /** Cell content. Defaults to String(sortValue). */
  render?: (row: Row) => ReactNode;
  /** Value used for sorting. A column without one is not sortable. */
  sortValue?: (row: Row) => SortValue;
  /** Serials, plates, asset tags, counts. */
  mono?: boolean;
  align?: "start" | "end";
  /** Hidden below this width in table mode. Card mode always shows it unless cardHidden. */
  minWidth?: "md" | "lg" | "xl";
  /** Leave out of the phone card. */
  cardHidden?: boolean;
};

export type DataTableProps<Row> = {
  /** Accessible name: "Department firearms". */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** The row is the link (blueprint §1 "Cards, tables & filters"). */
  onRowSelect?: (row: Row) => void;
  selectedRowId?: string | null;
  /** Loading, error and empty states. Defaults to "ready", or "empty" for no rows. */
  status?: AsyncStatus;
  noun: string;
  onRetry?: () => void;
  empty?: ReactNode;
  initialSort?: SortState;
  className?: string;
};

const HIDE_BELOW: Record<NonNullable<DataTableColumn<unknown>["minWidth"]>, string> = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/**
 * Sortable table with a pinned first column and a card list under 640px that shows
 * the same fields in column order. Contract: COMPONENTS.md#datatable
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  onRowSelect,
  selectedRowId,
  status,
  noun,
  onRetry,
  empty,
  initialSort = null,
  className,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const sorted = useMemo(
    () =>
      sortRows(rows, sort, (row, key) => columns.find((column) => column.key === key)?.sortValue?.(row)),
    [rows, sort, columns],
  );
  const resolvedStatus: AsyncStatus = status ?? (rows.length === 0 ? "empty" : "ready");

  function cell(column: DataTableColumn<Row>, row: Row) {
    if (column.render) return column.render(row);
    const value = column.sortValue?.(row);
    return value instanceof Date ? value.toLocaleDateString() : (value ?? "—");
  }

  function rowKeyDown(event: KeyboardEvent<HTMLElement>, row: Row) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowSelect?.(row);
    }
  }

  const [first, ...rest] = columns;

  return (
    <AsyncState status={resolvedStatus} noun={noun} onRetry={onRetry} empty={empty}>
      <div className={className}>
        {/* Table: 640px and up */}
        <div className="hidden overflow-x-auto rounded-card border border-line sm:block">
          <table className="w-full border-collapse text-left text-body">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-surface-raised">
              <tr>
                {columns.map((column, index) => {
                  const sortable = Boolean(column.sortValue);
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sortable ? ariaSort(sort, column.key) : undefined}
                      className={cx(
                        "whitespace-nowrap border-b border-line px-3 py-2 text-caption font-semibold uppercase tracking-wide text-fg-muted",
                        index === 0 && "sticky left-0 z-10 bg-surface-raised",
                        column.align === "end" && "text-right",
                        column.minWidth && HIDE_BELOW[column.minWidth],
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => setSort((current) => nextSort(current, column.key))}
                          className="inline-flex items-center gap-1 uppercase hover:text-fg"
                        >
                          {column.header}
                          {sort?.key === column.key ? (
                            sort.direction === "asc" ? (
                              <ArrowUp aria-hidden="true" className="h-3 w-3" />
                            ) : (
                              <ArrowDown aria-hidden="true" className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown aria-hidden="true" className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const id = getRowId(row);
                const selected = id === selectedRowId;
                return (
                  <tr
                    key={id}
                    tabIndex={onRowSelect ? 0 : undefined}
                    aria-selected={onRowSelect ? selected : undefined}
                    onClick={onRowSelect ? () => onRowSelect(row) : undefined}
                    onKeyDown={onRowSelect ? (event) => rowKeyDown(event, row) : undefined}
                    className={cx(
                      "group border-b border-line last:border-b-0",
                      onRowSelect && "cursor-pointer hover:bg-surface-raised focus-visible:bg-surface-raised",
                      selected ? "bg-accent-soft" : "bg-surface",
                    )}
                  >
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={cx(
                          "px-3 py-2.5 align-middle text-fg-secondary",
                          index === 0 && "sticky left-0 z-[1] bg-inherit text-fg",
                          column.mono && "font-mono",
                          column.align === "end" && "text-right tabular-nums",
                          column.minWidth && HIDE_BELOW[column.minWidth],
                        )}
                      >
                        {cell(column, row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Card list: under 640px */}
        <ul aria-label={caption} className="space-y-2 sm:hidden">
          {sorted.map((row) => {
            const id = getRowId(row);
            const selected = id === selectedRowId;
            const content = (
              <>
                <div className="text-body font-medium text-fg">{first ? cell(first, row) : null}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {rest
                    .filter((column) => !column.cardHidden)
                    .map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-caption text-fg-muted">{column.header}</dt>
                        <dd className={cx("truncate text-body text-fg-secondary", column.mono && "font-mono")}>{cell(column, row)}</dd>
                      </div>
                    ))}
                </dl>
              </>
            );
            return (
              <li key={id}>
                {onRowSelect ? (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onRowSelect(row)}
                    className={cx(
                      "block w-full rounded-card border p-3 text-left",
                      selected ? "border-accent bg-accent-soft" : "border-line bg-surface",
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="rounded-card border border-line bg-surface p-3">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </AsyncState>
  );
}
