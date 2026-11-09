import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection };

export type DataColumn<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => ReactNode;
  /** Right-aligns the column with tabular numerals. Detected when every value is a number. */
  numeric?: boolean;
  /** Fixed width such as 120 or "20%". Other columns are measured once and held, so sorting never reflows them. */
  width?: number | string;
  /** Hides the column when the table's own width drops below "md" (44rem) or "sm" (34rem); it never depends on the viewport. */
  hideBelow?: "md" | "sm";
};

export type SortableDataTableProps<T extends Record<string, unknown>> = {
  locale?: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: keyof T | ((row: T) => string);
  caption?: string;
  scrollKey?: string;
  emptyMessage?: string;
  /** Sort applied on the first render. */
  defaultSort?: SortState;
  sortState?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Adds a checkbox column, row click selection, and a count line with a clear action. */
  selectable?: boolean;
  selectedKeys?: string[];
  defaultSelectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Noun for the count line, as in "6 projects". */
  itemName?: { one: string; other: string };
  /** Opens a row on click (outside controls) and on Enter while the row has focus. Replaces click-to-select; checkboxes still select. */
  onRowActivate?: (key: string, row: T) => void;
  /** Row currently open elsewhere; highlighted like a selection and marked `aria-current`. */
  activeKey?: string;
  /** Set false when the caller already shows the selection count and clear action. Default true. */
  selectionFooter?: boolean;
  /** Accessible name of the select-all checkbox. */
  selectAllLabel?: string;
  /** Accessible name of a row checkbox. */
  rowLabel?: (row: T) => string;
  /** Rendered under the rows, for example a `CollectionFooter` with a load-more action. */
  footer?: ReactNode;
};
