import { useEffect, useMemo, useRef, useState } from "react";
import { t, useLocale, warmSourceMessages } from "../../../shared/i18n";
import { ExpandingSearch } from "../../../shared/ui/ExpandingSearch";
import { searchSettings, type SettingsSectionId } from "../model/settings";

/** Jumps to any setting by name, including ones on another page. */
export function SettingsSearch({
  onReveal,
}: {
  onReveal: (section: SettingsSectionId, settingId: string | null) => void;
}) {
  const locale = useLocale();
  const [indexedLocale, setIndexedLocale] = useState<typeof locale | null>(null);
  const [query, setQuery] = useState("");
  const revealFrame = useRef<number | null>(null);
  const ready = indexedLocale === locale;
  const matches = useMemo(() => (ready ? searchSettings(query) : []), [query, locale, ready]);
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Warm the shared search index during browser idle time after the language changes.
  useEffect(() => {
    const warm = () => {
      warmSourceMessages();
      setIndexedLocale(locale);
    };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(warm, { timeout: 2_000 });
      return () => window.cancelIdleCallback(idle);
    }
    const timeout = window.setTimeout(warm, 0);
    return () => window.clearTimeout(timeout);
  }, [locale]);

  return (
    <ExpandingSearch
      className="settings-search"
      variant="ghost"
      expandedWidth={240}
      label={t("Search settings")}
      clearLabel={t("Clear settings search")}
      resultsLabel={t("Settings search results")}
      emptyLabel={ready ? t("No matching settings") : t("Loading…")}
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
