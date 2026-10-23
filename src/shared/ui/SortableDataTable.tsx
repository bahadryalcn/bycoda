import {
  SortableDataTable as ArcSortableDataTable,
  type SortableDataTableProps,
} from "./arc/sortable-data-table/sortable-data-table";
import { getLocale, useT } from "../i18n";

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
