import { EmptyState } from "../../../shared/ui/EmptyState";
import type { ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";
import { ShortcutKeys } from "../../../shared/ui/ShortcutKbd";
import { useT } from "../../../shared/i18n";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";

/**
 * The sidebar answer to a search that matched no session in this project: what was searched,
 * then the two ways forward (search every conversation, or clear the search).
 */
export function SessionsNoMatch({
  onSearchAll,
  onClear,
  children,
}: {
  query: string;
  onSearchAll?: () => void;
  onClear: () => void;
  /** Extra recovery actions, such as clearing filters that also hide sessions. */
  children?: ReactNode;
}) {
  const t = useT();
  const searchShortcut = useKeybindingShortcut("App: Search");
  return (
    <div role="status" className="flex flex-col gap-2 px-3 py-2">
      <EmptyState size="inline" context="list" kind="filtered" description={t("No matching sessions")} />
      <div className="flex flex-wrap items-center gap-1">
        {onSearchAll ? (
          <Button
            variant="ghost"
            size="sm"
            motion="none"
            type="button"
            onClick={onSearchAll}
            endIcon={
              searchShortcut ? <ShortcutKeys shortcut={searchShortcut} size="xs" /> : undefined
            }
          >
            {t("Search all conversations")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          type="button"
          onClick={onClear}
        >
          {t("Clear search")}
        </Button>
        {children}
      </div>
    </div>
  );
}
