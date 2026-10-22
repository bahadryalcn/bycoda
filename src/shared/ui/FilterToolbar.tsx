import {
  FilterToolbar as ArcFilterToolbar,
  type FilterToolbarProps,
} from "./arc/filter-toolbar/filter-toolbar";
import { t, useLocale } from "../i18n";

export function FilterToolbar(props: FilterToolbarProps) {
  useLocale();
  return (
    <div className="bycoda-arc bycoda-arc-filters">
      <ArcFilterToolbar label={t("Active filters")} {...props} />
    </div>
  );
}
