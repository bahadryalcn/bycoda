import type { ComponentProps, ReactNode } from "react";
import { Text } from "./Text";
import tableStyles from "./arc/sortable-data-table/sortable-data-table.module.css";
import {
  SortableDataTable as ArcSortableDataTable,
  type SortableDataTableProps,
} from "./arc/sortable-data-table/sortable-data-table";
export type { DataColumn } from "./arc/sortable-data-table/sortable-data-table";
import { useLocale, useT } from "../i18n";

/**
 * Table of comparable records with sortable columns, real numeric/date sorting, an empty message and optional grouping.
 * Wraps the scroll area; use `scrollKey` and controlled sort to keep position. Bound long data before passing it in.
 * @group data
 * @use Rows of records with several columns that users compare or sort (usage history, quotas).
 * @avoid Key-value facts about one item: DescriptionList. Short non-sortable lists: rows or a list component.
 * @replaces table
 * @arc sortable-data-table
 */
export function SortableDataTable<T extends Record<string, unknown>>(
  props: SortableDataTableProps<T>,
) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="bycoda-arc bycoda-arc-table">
      <ArcSortableDataTable locale={locale} emptyMessage={t("No records")} {...props} />
    </div>
  );
}

/**
 * Non-sortable table shell for rows that own interactive state; shares the data table's headers, dividers and hover treatment.
 * @group data
 * @use Comparable records whose row components own state; use DataTableRow for each record or group heading.
 * @avoid Sorting or selection: SortableDataTable. Label-value facts: DescriptionList.
 */
export function DataTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: { label: string; hidden?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="bycoda-arc bycoda-arc-table">
      <div className={tableStyles.scroller}>
        <table className={`${tableStyles.table} ${tableStyles.staticTable}`}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {headers.map(({ label, hidden }) => (
                <th key={label} scope="col">
                  <Text
                    size="caption"
                    weight="medium"
                    tone="muted"
                    className={hidden ? "sr-only" : undefined}
                  >
                    {label}
                  </Text>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Cells or a spanning group heading in DataTable; native table semantics stay in shared UI.
 * @group data
 * @use Stateful record rows inside DataTable, with optional detail content below the row.
 * @avoid Standalone lists: ListItem. Sorting: SortableDataTable.
 */
export function DataTableRow({
  cells,
  heading,
  columnCount,
  detail,
  ...props
}: ComponentProps<"tr"> & {
  cells?: ReactNode[];
  heading?: string;
  columnCount?: number;
  detail?: ReactNode;
}) {
  return (
    <>
      <tr {...props}>
        {heading ? (
          <th scope="rowgroup" colSpan={columnCount}>
            <Text size="caption" weight="medium" tone="muted">
              {heading}
            </Text>
          </th>
        ) : (
          cells?.map((cell, index) => <td key={index}>{cell}</td>)
        )}
      </tr>
      {detail ? (
        <tr>
          <td colSpan={cells?.length}>{detail}</td>
        </tr>
      ) : null}
    </>
  );
}
