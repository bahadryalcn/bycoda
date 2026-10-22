import {
  ExpandingSearch as ArcExpandingSearch,
  type ExpandingSearchProps,
} from "./arc/expanding-search/expanding-search";
import { t, useLocale } from "../i18n";

export type {
  ExpandingSearchItem,
  ExpandingSearchProps,
} from "./arc/expanding-search/expanding-search";

/** Navigation search; filtering and persisted form selection have separate owners. */
export function ExpandingSearch(props: ExpandingSearchProps) {
  useLocale();
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
