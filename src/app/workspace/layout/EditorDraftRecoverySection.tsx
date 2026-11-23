import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Check, Search } from "../../../shared/ui/icons";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { useT } from "../../../shared/i18n";
import { formatRelative } from "../../../features/sessions/model/recentSessions";
import { basename } from "../../../platform/tauri/fs";
import {
  editorDraftRecoveryKey,
  type useEditorDraftRecovery,
} from "../files/useEditorDraftRecovery";
import type { EditorDraftRecoveryMetadata } from "../../../features/files/data/editorDraftRecovery";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { surfaceAttributes } from "../../../shared/ui/Surface";

export type EditorDraftRecoverySectionProps = {
  recovery: ReturnType<typeof useEditorDraftRecovery>;
  records: readonly EditorDraftRecoveryMetadata[];
};
export function EditorDraftRecoverySection({ recovery, records }: EditorDraftRecoverySectionProps) {
  const t = useT();
  const now = useMinuteNow();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"unsaved" | "all">("unsaved");
  const { refresh } = recovery;
  // Refresh when opening the recovery view so later captures appear automatically.
  useEffect(() => {
    void refresh().catch(console.error);
  }, [refresh]);
  const candidates = records;
  const unsaved = candidates.filter(
    (row) => row.state === "retained" && row.serializedTextDigest !== row.baselineDigest,
  );
  const canFilter = unsaved.length !== candidates.length;
  const scoped = mode === "all" ? candidates : unsaved;
  const needle = query.trim().toLocaleLowerCase();
  const rows = scoped
    .filter((row) => `${row.path} ${row.windowLabel}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
  return (
    <section className="recovery-pane" aria-label={t("File recovery copies")}>
      {canFilter || scoped.length > 8 || query ? <div className="recovery-toolbar">
        {canFilter ? (
        <SegmentedControl
          label={t("File recovery filters")}
          value={mode}
          onValueChange={(value) => setMode(value as "unsaved" | "all")}
          options={[
            { value: "unsaved", label: t("Unsaved drafts"), accessory: unsaved.length },
            { value: "all", label: t("All copies"), accessory: candidates.length },
          ]}
        />
        ) : null}
        {scoped.length > 8 || query ? (
        <SearchInputGroup appearance="field" className="recovery-toolbar-search">
          <Search className="icon-sm shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            aria-label={t("Search file recovery copies")}
            placeholder={t("Filter by file name or window")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </SearchInputGroup>
        ) : null}
      </div> : null}
      {recovery.error ? (
        <InlineError retry={{ pending: recovery.loading, onRetry: () => void recovery.refresh() }}>
          {t("Couldn’t load file recovery copies")}
        </InlineError>
      ) : null}
      <div className="recovery-body">
        {rows.length ? (
          <ul {...surfaceAttributes({ dividers: "pane" })}>
            {rows.map((row) => {
              const key = editorDraftRecoveryKey(row);
              const pending = recovery.pendingKeys.has(key);
              const failed = recovery.errors.has(key);
              const name = basename(row.path);
              const directory = row.path.slice(0, -name.length).replace(/[\\/]$/, "");
              return (
                <li key={key} className="flex flex-wrap items-start gap-2 py-2">
                  <div className="min-w-0 basis-48 flex-1">
                    <Text
                      as="p"
                      size="secondary"
                      tone="inherit"
                      weight="medium"
                      truncate
                    >
                      {name}
                    </Text>
                    <Text
                      as="p"
                      size="caption"
                      tone="secondary"
                    >
                      <MiddleTruncate mode="path">{directory}</MiddleTruncate>
                    </Text>
                    <Text as="p" size="caption" tone="secondary">
                      {row.state === "save-reported" || row.serializedTextDigest === row.baselineDigest ? (
                        <Check
                          className="icon-xs me-(--ui-space-1) inline"
                          role="img"
                          aria-label={row.state === "save-reported" ? t("Save reported") : t("Matches captured disk baseline")}
                        />
                      ) : null}
                      {row.windowLabel} · {formatRelative(row.updatedAt, now)}
                    </Text>
                    {failed ? (
                      <InlineError>{t("The copy could not be opened.")}</InlineError>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() => void recovery.restore(row).catch(() => {})}
                  >
                    {failed ? t("Retry") : t("Open")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : recovery.loading ? (
          <Text role="status" as="p" size="secondary" tone="secondary" className="py-3">
            {t("Checking file recovery copies…")}
          </Text>
        ) : query ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No matching file copies")}
            description={t("No file recovery copy matches “{p0}”.", { p0: query.trim() })}
            action={{ label: t("Clear search"), onClick: () => setQuery("") }}
            secondaryAction={
              mode === "unsaved" && candidates.length > unsaved.length
                ? { label: t("Search all copies"), onClick: () => setMode("all") }
                : undefined
            }
          />
        ) : mode === "unsaved" && candidates.length > 0 ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No unsaved file drafts.")}
            description={t("{p0} other recovery copies are available.", {
              p0: candidates.length,
            })}
            action={{ label: t("Show all copies"), onClick: () => setMode("all") }}
          />
        ) : (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("No file recovery copies.")}
            description={t("Recovery copies of unsaved editor text appear here.")}
          />
        )}
      </div>
    </section>
  );
}
