import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { RefreshCw, Search } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { formatRelative } from "../../../features/sessions/model/recentSessions";
import { basename } from "../../../platform/tauri/fs";
import {
  editorDraftRecoveryKey,
  type useEditorDraftRecovery,
} from "../files/useEditorDraftRecovery";
import type { EditorDraftRecoveryMetadata } from "../../../features/files/data/editorDraftRecovery";
import { pathKey } from "../../../shared/lib/paths";

export type EditorDraftRecoverySectionProps = {
  recovery: ReturnType<typeof useEditorDraftRecovery>;
  records: readonly EditorDraftRecoveryMetadata[];
  reportPaths?: readonly string[];
  onClearReportPaths?(): void;
};
export function EditorDraftRecoverySection({
  recovery,
  records,
  reportPaths,
  onClearReportPaths,
}: EditorDraftRecoverySectionProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(clock);
  }, []);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"unsaved" | "all">("unsaved");
  const reported = useMemo(
    () => (reportPaths?.length ? new Set(reportPaths.map(pathKey)) : null),
    [reportPaths],
  );
  const candidates = reported ? records.filter((row) => reported.has(pathKey(row.path))) : records;
  const unsaved = candidates.filter(
    (row) => row.state === "retained" && row.serializedTextDigest !== row.baselineDigest,
  );
  const scoped = mode === "all" ? candidates : unsaved;
  const needle = query.trim().toLocaleLowerCase();
  const rows = scoped
    .filter((row) => `${row.path} ${row.windowLabel}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
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
            focusOwner="group"
            aria-label={t("Search file recovery copies")}
            placeholder={t("Search file recovery copies")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </SearchInputGroup>
        <Button
          variant="ghost"
          iconOnly
          label={t("Refresh copies")}
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          <RefreshCw className="icon-sm" strokeWidth={1.75} />
        </Button>
      </div>
      <div role="status" className="recovery-status text-ui-caption text-(--ui-text-secondary)">
        <span>
          {t("{p0} unsaved drafts · {p1} copies", { p0: unsaved.length, p1: candidates.length })}
        </span>
        {rows.length !== scoped.length ? (
          <span>{t("Showing {p0} of {p1}", { p0: rows.length, p1: scoped.length })}</span>
        ) : null}
        {reported ? (
          <>
            <span>
              {t(
                "These copies match reported file names. Check their content; the earlier report remains protected.",
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={onClearReportPaths}>
              {t("Show all file copies")}
            </Button>
          </>
        ) : null}
      </div>
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
      <div className="recovery-body">
        {rows.length ? (
          <ul className="divide-y divide-stroke" aria-label={t("File recovery copies")}>
            {rows.map((row) => {
              const key = editorDraftRecoveryKey(row);
              const pending = recovery.pendingKeys.has(key);
              const failed = recovery.errors.has(key);
              const isUnsaved =
                row.state !== "save-reported" && row.serializedTextDigest !== row.baselineDigest;
              return (
                <li key={key} className="flex flex-wrap items-start gap-2 py-2">
                  <div className="min-w-0 basis-48 flex-1">
                    <p className="break-words text-ui-secondary font-medium">
                      {basename(row.path)}
                    </p>
                    <p className="select-text text-ui-caption text-(--ui-text-secondary) [overflow-wrap:anywhere]">
                      {row.path}
                    </p>
                    <p className="text-ui-caption text-(--ui-text-secondary)">
                      <span className={isUnsaved ? "font-medium text-warning" : ""}>
                        {row.state === "save-reported"
                          ? t("Save reported")
                          : row.serializedTextDigest === row.baselineDigest
                            ? t("Matches captured disk baseline")
                            : t("Unsaved draft")}
                      </span>{" "}
                      · {row.windowLabel} · {formatRelative(row.updatedAt, now)}
                    </p>
                    {failed ? (
                      <InlineError>
                        {t(
                          "The copy could not be opened. Retry uses the same prepared copy; refresh if the source changed.",
                        )}
                      </InlineError>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() => void recovery.restore(row).catch(() => {})}
                  >
                    {failed ? t("Retry opening copy") : t("Open copy in new tab")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : recovery.loading ? (
          <p role="status" className="py-3 text-ui-secondary text-(--ui-text-secondary)">
            {t("Checking file recovery copies…")}
          </p>
        ) : query ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No matching file copies")}
            description={t("No file recovery copy matches “{p0}”.", { p0: query.trim() })}
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                  {t("Clear search")}
                </Button>
                {mode === "unsaved" && candidates.length > unsaved.length ? (
                  <Button variant="ghost" size="sm" onClick={() => setMode("all")}>
                    {t("Search all copies")}
                  </Button>
                ) : null}
              </>
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
            action={
              <Button variant="secondary" size="sm" onClick={() => setMode("all")}>
                {t("Show all copies")}
              </Button>
            }
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
      <div className="recovery-footer border-t border-stroke">
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t(
            "Open a separate unsaved file tab. The original recovery copy stays available; files are not written until you save.",
          )}
        </p>
      </div>
    </section>
  );
}
