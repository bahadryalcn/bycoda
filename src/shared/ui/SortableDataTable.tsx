import {
  SortableDataTable as ArcSortableDataTable,
  type SortableDataTableProps,
} from "./arc/sortable-data-table/sortable-data-table";
import { t, useLocale, getLocale } from "../i18n";

export function SortableDataTable<T extends Record<string, unknown>>(
  props: SortableDataTableProps<T>,
) {
  useLocale();
  return (
    <div className="bycoda-arc bycoda-arc-table">
      <ArcSortableDataTable locale={getLocale()} emptyMessage={t("No records")} {...props} />
    </div>
  );
}
