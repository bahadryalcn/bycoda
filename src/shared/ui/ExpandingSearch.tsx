import {
  ExpandingSearch as ArcExpandingSearch,
  type ExpandingSearchProps,
} from "./arc/expanding-search/expanding-search";
import { useT } from "../i18n";

export type {
  ExpandingSearchHandle,
  ExpandingSearchItem,
  ExpandingSearchProps,
} from "./arc/expanding-search/expanding-search";

/**
 * Icon that expands into a search field with a ranked result panel (`items` or external `results`).
 * `inline` filters the caller's own list instead (no panel, Escape clears and folds, a dot marks an applied query)
 * and exposes `expand()` through its ref for `/` or Ctrl+F.
 * @group navigation
 * @use Quick jump to a setting or item by name, or a collapsible filter box in a sidebar header.
 * @avoid Always-visible form search or filter input: TextField. Choosing a form value: SearchableSelect. Command registries stay with their owners.
 * @arc expanding-search
 */
export function ExpandingSearch(props: ExpandingSearchProps) {
  const t = useT();
  return (
    <ArcExpandingSearch
      clearLabel={t("Clear search")}
      emptyLabel={t("No results")}
      emptyHint=""
      {...props}
      className={["bycoda-arc", props.className].filter(Boolean).join(" ")}
    />
  );
}
