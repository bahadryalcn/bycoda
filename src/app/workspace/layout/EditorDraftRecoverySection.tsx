import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LiveText } from "../../../shared/ui/LiveText";
import { EyeOff, File, RefreshCw, Search } from "../../../shared/ui/icons";
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
  const candidates = records;
  const unsaved = candidates.filter(
    (row) => row.state === "retained" && row.serializedTextDigest !== row.baselineDigest,
  );
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
        <SegmentedControl
          label={t("File recovery filters")}
          value={mode}
          onValueChange={(value) => setMode(value as "unsaved" | "all")}
          options={[
            { value: "unsaved", label: t("Unsaved drafts"), accessory: unsaved.length },
            { value: "all", label: t("All copies"), accessory: candidates.length },
          ]}
        />
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
        <Button
          variant="ghost"
          iconOnly
          label={t("Refresh copies")}
          disabled={recovery.pendingKeys.size > 0}
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          <RefreshCw className="icon-sm" strokeWidth={1.75} />
        </Button>
      </div>
      {rows.length !== scoped.length ? (
        <Text as="div" size="caption" tone="secondary" className="recovery-status">
          <LiveText text={t("Showing {p0} of {p1}", { p0: rows.length, p1: scoped.length })} />
        </Text>
      ) : null}
      {recovery.error ? (
        <Alert tone="danger">
          <span>
            {t(
              "File recovery copies could not be refreshed. The previous list is kept; try again.",
            )}
          </span>{" "}
          <Button
            variant="ghost"
            size="sm"
            loading={recovery.loading}
            onClick={() => void recovery.refresh()}
          >
            {t("Retry")}
          </Button>
        </Alert>
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
              const isUnsaved =
                row.state !== "save-reported" && row.serializedTextDigest !== row.baselineDigest;
              return (
                <li key={key} className="file-recovery-row">
                  <div className="file-recovery-detail">
                    <File className="file-recovery-icon icon-sm" aria-hidden="true" />
                    <div className="min-w-0">
                      <Text as="p" size="secondary" tone="inherit" weight="medium">
                        <MiddleTruncate>{fileName}</MiddleTruncate>
                      </Text>
                      <p className="select-text">
                        <MiddleTruncate size="caption" tone="secondary" mode="path">
                          {row.path.slice(0, row.path.length - fileName.length)}
                        </MiddleTruncate>
                      </p>
                      <Text as="p" size="caption" tone="secondary">
                        <Text
                          size="inherit"
                          tone={isUnsaved ? "warning" : "inherit"}
                          weight={isUnsaved ? "medium" : undefined}
                        >
                          {row.state === "save-reported"
                            ? t("Save reported")
                            : row.serializedTextDigest === row.baselineDigest
                              ? t("Matches disk snapshot")
                              : t("Unsaved draft")}
                        </Text>{" "}
                        · {row.windowLabel} · {formatRelative(row.updatedAt, now)}
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
      {dialog}
    </section>
  );
}
