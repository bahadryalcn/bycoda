import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";
import { Search, X } from "../../../shared/ui/icons";
import { ShortcutKeys } from "../../../shared/ui/ShortcutKbd";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useT } from "../../../shared/i18n";

/**
 * The sidebar answer to a search that matched no session in this project: what was searched,
 * then the two ways forward (search every conversation, or clear the search).
 */
export function SessionsNoMatch({
  query,
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
  return (
    <div role="status" className="flex flex-col gap-2 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <Search aria-hidden className="icon-sm mt-0.5 shrink-0" tone="muted" strokeWidth={1.75} />
        <div className="min-w-0">
          <Text as="p" size="body" tone="inherit" weight="medium">
            {t("No matching sessions")}
          </Text>
          <OverflowTooltip label={query}>
            <Text as="p" size="caption" tone="secondary" truncate>
              “{query}”
            </Text>
          </OverflowTooltip>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 ps-6">
        {onSearchAll ? (
          <Button
            variant="secondary"
            size="sm"
            motion="none"
            type="button"
            onClick={onSearchAll}
            endIcon={<ShortcutKeys shortcut="mod+k" size="xs" />}
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
          startIcon={<X className="icon-sm" strokeWidth={1.75} />}
        >
          {t("Clear search")}
        </Button>
        {children}
      </div>
    </div>
  );
}
