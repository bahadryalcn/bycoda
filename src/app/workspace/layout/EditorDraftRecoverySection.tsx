import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LiveText } from "../../../shared/ui/LiveText";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Check, EyeOff, File, RefreshCw, Search } from "../../../shared/ui/icons";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
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
  const { confirm, dialog } = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const now = useMinuteNow();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"unsaved" | "all">("unsaved");
  const { refresh } = recovery;
  // Refresh when opening the recovery view so later captures appear automatically.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- refreshes the native draft journal when recovery opens
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
  const confirmHide = async (row: EditorDraftRecoveryMetadata) => {
    const hidden = await confirm({
      title: t("Hide recovery copy?"),
      message: t("The copy stays saved and will disappear from this list."),
      details: row.path,
      confirmLabel: t("Hide from list"),
      danger: false,
      onConfirm: async () => {
        try {
          await recovery.hide(row);
        } catch (error) {
          if (error === "NATIVE_EDITOR_DRAFT_REVISION_CONFLICT")
            throw new Error(t("This copy changed. Refresh the list before hiding it."));
          throw new Error(t("Could not hide the recovery copy. Try again."));
        }
      },
    });
    if (hidden) {
      setAnnouncement(t("Recovery copy hidden."));
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  };
  return (
    <section className="recovery-pane" aria-label={t("File recovery copies")}>
      <div className="recovery-toolbar">
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
              ref={searchRef}
              focusOwner="group"
              aria-label={t("Search file recovery copies")}
              placeholder={t("Filter by file name or window")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </SearchInputGroup>
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          label={t("Refresh copies")}
          disabled={recovery.pendingKeys.size > 0}
          disabledReason={t("A recovery operation is in progress")}
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          <RefreshCw className="icon-sm" strokeWidth={1.75} />
        </Button>
      </div>
      {recovery.error ? (
        <InlineError
          details={recovery.error}
          retry={{ pending: recovery.loading, onRetry: () => void recovery.refresh() }}
        >
          {t("Couldn’t load file recovery copies")}
        </InlineError>
      ) : null}
      {announcement ? <LiveText text={announcement} className="sr-only" /> : null}
      <div className="recovery-body file-recovery-body">
        {rows.length ? (
          <ul {...surfaceAttributes({ dividers: "pane" })}>
            {rows.map((row) => {
              const key = editorDraftRecoveryKey(row);
              const pending = recovery.pendingKeys.has(key);
              const failed = recovery.errors.has(key);
              const fileName = basename(row.path);
              const directory = row.path.slice(0, -fileName.length).replace(/[\\/]$/, "");
              return (
                <li key={key} className="file-recovery-row">
                  <div className="file-recovery-detail">
                    <File className="file-recovery-icon icon-sm" aria-hidden="true" />
                    <div className="min-w-0">
                      <Text as="p" size="secondary" tone="inherit" weight="medium">
                        <MiddleTruncate>{fileName}</MiddleTruncate>
                      </Text>
                      <Text as="p" size="caption" tone="secondary" className="select-text">
                        <MiddleTruncate mode="path">{directory}</MiddleTruncate>
                      </Text>
                      <Text as="p" size="caption" tone="secondary">
                        {row.state === "save-reported" ||
                        row.serializedTextDigest === row.baselineDigest ? (
                          <Check
                            className="icon-xs me-(--ui-space-1) inline"
                            role="img"
                            aria-label={
                              row.state === "save-reported"
                                ? t("Save reported")
                                : t("Matches disk snapshot")
                            }
                          />
                        ) : null}
                        {row.windowLabel} · {formatRelative(row.updatedAt, now)}
                      </Text>
                      {failed ? (
                        <InlineError>
                          {t(
                            "The copy could not be opened. Retry uses the same prepared copy; refresh if the source changed.",
                          )}
                        </InlineError>
                      ) : null}
                    </div>
                  </div>
                  <div className="file-recovery-actions">
                    <Button
                      variant="secondary"
                      aria-label={failed ? t("Retry opening copy") : t("Open copy in new tab")}
                      loading={pending}
                      onClick={() => void recovery.restore(row).catch(() => {})}
                    >
                      {failed ? t("Retry") : t("Open")}
                    </Button>
                    <Button
                      variant="ghost"
                      iconOnly
                      label={t("Hide from list")}
                      disabled={pending || recovery.loading}
                      disabledReason={t("A recovery operation is in progress")}
                      onClick={() => void confirmHide(row).catch(() => {})}
                    >
                      <EyeOff className="icon-sm" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : recovery.loading ? (
          <div className="py-3">
            <LoadingText size="secondary" tone="secondary">
              {t("Checking file recovery copies…")}
            </LoadingText>
          </div>
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
      {dialog}
    </section>
  );
}
