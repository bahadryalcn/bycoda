import { startTransition, useState, type Ref } from "react";
import { useT } from "../../shared/i18n";
import {
  ExpandingSearch,
  type ExpandingSearchHandle,
  type ExpandingSearchItem,
} from "../../shared/ui/ExpandingSearch";

const NO_SEARCH_ITEMS: ExpandingSearchItem[] = [];

/** What the field has sent up and not yet seen come back, so an echo is told from an outside reset. */
interface SearchEcho {
  query: string;
  sent: readonly string[];
}

/**
 * The sessions list's inline filter. It owns the text being typed, so a keystroke re-renders only
 * this field; the committed `query` reaches the Sidebar as a transition, which batches fast typing
 * and yields to input instead of re-running the whole list body per character.
 * An outside change to `query` (leaving the tab, clearing from the empty state) replaces the draft.
 */
export function SidebarSessionSearch({
  query,
  onQueryChange,
  onExpandedChange,
  ref,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  ref?: Ref<ExpandingSearchHandle>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(query);
  const [echo, setEcho] = useState<SearchEcho>({ query, sent: [] });
  if (echo.query !== query) {
    const index = echo.sent.indexOf(query);
    if (index >= 0) {
      setEcho({ query, sent: echo.sent.slice(index + 1) });
    } else {
      setEcho({ query, sent: [] });
      setDraft(query);
    }
  }
  const change = (next: string) => {
    setDraft(next);
    setEcho((current) => ({ ...current, sent: [...current.sent, next] }));
    startTransition(() => onQueryChange(next));
  };
  return (
    <ExpandingSearch
      ref={ref}
      inline
      constrainToSlot
      onExpandedChange={onExpandedChange}
      anchor="end"
      expandedWidth={248}
      items={NO_SEARCH_ITEMS}
      label={t("Search sessions")}
      activeLabel={t("Search sessions, filtering by “{p0}”", { p0: draft.trim() })}
      placeholder={t("Search sessions…")}
      query={draft}
      onQueryChange={change}
    />
  );
}
