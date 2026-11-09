import {
  SortableDataTable as ArcSortableDataTable,
  type SortableDataTableProps,
} from "./arc/sortable-data-table/sortable-data-table";
export type { DataColumn } from "./arc/sortable-data-table/sortable-data-table";
import { getLocale, useT } from "../i18n";

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
  return (
    <div className="bycoda-arc bycoda-arc-table">
      <ArcSortableDataTable locale={getLocale()} emptyMessage={t("No records")} {...props} />
    </div>
  );
}
