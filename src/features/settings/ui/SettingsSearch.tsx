import { useEffect, useMemo, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ExpandingSearch } from "../../../shared/ui/ExpandingSearch";
import { searchSettings, type SettingsSectionId } from "../model/settings";

/** Jumps to any setting by name, including ones on another page. */
export function SettingsSearch({
  onReveal,
}: {
  onReveal: (section: SettingsSectionId, settingId: string | null) => void;
}) {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const revealFrame = useRef<number | null>(null);
  const matches = useMemo(() => searchSettings(query), [query, locale]);
  const results = useMemo(
    () =>
      matches.map((result) => ({
        id: `${result.section}:${result.settingId ?? "*"}`,
        title: result.label,
        meta: result.settingId ? result.sectionLabel : t("Page"),
      })),
    [matches, locale],
  );
  useEffect(
    () => () => {
      if (revealFrame.current != null) cancelAnimationFrame(revealFrame.current);
    },
    [],
  );

  return (
    <ExpandingSearch
      className="settings-search w-48 max-w-full"
      label={t("Search settings")}
      clearLabel={t("Clear settings search")}
      resultsLabel={t("Settings search results")}
      emptyLabel={t("No matching settings")}
      items={[]}
      query={query}
      onQueryChange={setQuery}
      results={results}
      onSelect={(item) => {
        const result = matches.find(
          (candidate) => `${candidate.section}:${candidate.settingId ?? "*"}` === item.id,
        );
        if (!result) return;
        if (revealFrame.current != null) cancelAnimationFrame(revealFrame.current);
        revealFrame.current = requestAnimationFrame(() => {
          revealFrame.current = null;
          onReveal(result.section, result.settingId);
        });
      }}
    />
  );
}
