import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { CollectionToolbar } from "./SettingsCollection";

export type InboxScopeItem = {
  id: string;
  title: string;
  /** Secondary text, such as a project key or board kind. Also searched. */
  meta?: string;
};

/**
 * A provider's inbox scope (Jira projects and boards, Linear teams) as a searchable
 * checklist: search and count in the shared collection band, one row per item, the
 * provider-specific refresh beside the list. Checked items appear in the inbox.
 */
export function InboxScopeCollection({
  label,
  searchLabel,
  items,
  selectedIds,
  onChange,
  disabled = false,
  loading = false,
  summary,
  emptyLabel,
  noMatchLabel,
  actions,
}: {
  /** Accessible name of the list. */
  label: string;
  searchLabel: string;
  items: readonly InboxScopeItem[];
  selectedIds: readonly string[];
  /** Receives the complete selection after one toggle or bulk action. */
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Scoped count such as "2 of 5 projects selected". */
  summary: (selected: number, total: number) => string;
  /** Shown when the provider returned nothing, with how to recover. */
  emptyLabel: string;
  noMatchLabel: string;
  /** Local refresh/save control rendered beside the search field. */
  actions?: ReactNode;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const selected = new Set(selectedIds);
  const matching = items.filter(
    (item) => !needle || `${item.title} ${item.meta ?? ""}`.toLocaleLowerCase().includes(needle),
  );
  const selectedCount = items.filter((item) => selected.has(item.id)).length;
  const select = (ids: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(items.filter((item) => next.has(item.id)).map((item) => item.id));
  };

  return (
    <div
      {...surfaceAttributes(
        { variant: "card", frame: "settings", radius: "card" },
        "settings-collection",
      )}
    >
      <CollectionToolbar
        label={searchLabel}
        query={query}
        onQueryChange={setQuery}
        count={summary(selectedCount, items.length)}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || matching.length === 0}
          onClick={() =>
            select(
              matching.map((item) => item.id),
              true,
            )
          }
        >
          {t("Select all")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || matching.length === 0}
          onClick={() =>
            select(
              matching.map((item) => item.id),
              false,
            )
          }
        >
          {t("Clear")}
        </Button>
        {actions}
      </CollectionToolbar>
      <ScrollArea
        gutter="stable"
        {...surfaceAttributes({ separator: "block" }, "settings-collection-list")}
        role="group"
        aria-label={label}
        aria-busy={loading || undefined}
      >
        {matching.length === 0 ? (
          loading ? (
            <LoadingText
              size="caption"
              tone="secondary"
              leading="normal"
              className="settings-collection-empty"
            >
              {t("Loading…")}
            </LoadingText>
          ) : (
            <EmptyState
              size="inline"
              kind={query ? "filtered" : "empty"}
              className="settings-collection-empty"
              descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
              description={items.length === 0 ? emptyLabel : noMatchLabel}
              resetLabel={t("Clear search")}
              onReset={query ? () => setQuery("") : undefined}
            />
          )
        ) : null}
        {matching.map((item) => (
          <ActionHost key={item.id} {...surfaceAttributes({ radius: "none", separator: "block" })}>
            <Checkbox
              checked={selected.has(item.id)}
              disabled={disabled}
              onChange={(event) => select([item.id], event.target.checked)}
              label={
                <>
                  <span className="settings-collection-main">
                    <Text
                      as="span"
                      size="secondary"
                      tone="primary"
                      weight="regular"
                      leading="normal"
                      truncate
                      className="settings-collection-title"
                    >
                      {item.title}
                    </Text>
                    {item.meta ? (
                      <Text
                        as="span"
                        size="caption"
                        tone="muted"
                        leading="normal"
                        className="settings-collection-meta"
                      >
                        {item.meta}
                      </Text>
                    ) : null}
                  </span>
                </>
              }

              className={"settings-collection-row inbox-scope-row" + " w-full"}
            />
          </ActionHost>
        ))}
      </ScrollArea>
    </div>
  );
}
