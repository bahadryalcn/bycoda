import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { SearchInput } from "../../../shared/ui/SearchInput";
import "./SettingsCollection.css";

/**
 * Compact search, optional filter controls and a scoped count in one band above a
 * settings collection. Filtering stays with the caller; this only presents it.
 */
export function CollectionToolbar({
  label,
  query,
  onQueryChange,
  count,
  className,
  children,
}: {
  /** Accessible name and placeholder of the search field. */
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Scoped result text such as "Showing 3 of 12". Announced politely. */
  count?: ReactNode;
  className?: string;
  /** Filter controls shown beside the search field. */
  children?: ReactNode;
}) {
  return (
    <div
      {...surfaceAttributes(
        { separator: "block" },
        ["settings-collection-toolbar", className].filter(Boolean).join(" "),
      )}
    >
      <div className="settings-collection-search">
        <SearchInput
          appearance="field"
          aria-label={label}
          placeholder={label}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {children ? <div className="settings-collection-tools">{children}</div> : null}
      {count ? (
        <Text
          size="caption"
          tone="secondary"
          leading="inherit"
          role="status"
          className="settings-collection-count"
        >
          {count}
        </Text>
      ) : null}
    </div>
  );
}
