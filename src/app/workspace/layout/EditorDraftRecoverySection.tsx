import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput } from "../../../shared/ui/SearchInput";
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
  const rows = (mode === "all" ? candidates : unsaved)
    .filter((row) =>
      `${row.path} ${row.windowLabel}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
  return (
    <section className="flex min-h-0 flex-col gap-2 p-3" aria-label={t("File recovery copies")}>
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "Open a separate unsaved file tab. The original recovery copy stays available; files are not written until you save.",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {reported ? (
          <Button size="sm" variant="ghost" onClick={onClearReportPaths}>
            {t("Show all file copies")}
          </Button>
        ) : null}
        <SegmentedControl
          label={t("File recovery filters")}
          value={mode}
          onValueChange={(value) => setMode(value as "unsaved" | "all")}
          options={[
            { value: "unsaved", label: t("Unsaved drafts"), accessory: unsaved.length },
            { value: "all", label: t("All copies"), accessory: candidates.length },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          {t("Refresh copies")}
        </Button>
      </div>
      {reported ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t(
            "These copies match reported file names. Check their content; the earlier report remains protected.",
          )}
        </p>
      ) : null}
      <SearchInput
        aria-label={t("Search file recovery copies")}
        placeholder={t("Search file recovery copies")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {recovery.error ? (
        <Alert tone="danger" role="alert">
          {t("File recovery copies could not be refreshed. The previous list is kept; try again.")}
        </Alert>
      ) : null}
      <ul
        className="min-h-0 overflow-y-auto overscroll-contain divide-y divide-stroke"
        aria-label={t("File recovery copies")}
      >
        {rows.map((row) => {
          const key = editorDraftRecoveryKey(row);
          const pending = recovery.pendingKeys.has(key);
          return (
            <li key={key} className="flex flex-wrap items-start gap-2 py-2">
              <div className="min-w-0 basis-48 flex-1">
                <p className="break-words text-ui-secondary font-medium">{basename(row.path)}</p>
                <p className="select-text text-ui-caption text-(--ui-text-secondary) [overflow-wrap:anywhere]">
                  {row.path}
                </p>
                <p className="text-ui-caption text-(--ui-text-secondary)">
                  {row.state === "save-reported"
                    ? t("Save reported")
                    : row.serializedTextDigest === row.baselineDigest
                      ? t("Matches captured disk baseline")
                      : t("Unsaved draft")}{" "}
                  · {row.windowLabel} · {formatRelative(row.updatedAt, now)}
                </p>
                {recovery.errors.has(key) ? (
                  <p role="alert" className="text-ui-caption text-danger">
                    {t(
                      "The copy could not be opened. Retry uses the same prepared copy; refresh if the source changed.",
                    )}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={pending}
                onClick={() => void recovery.restore(row).catch(() => {})}
              >
                {recovery.errors.has(key) ? t("Retry opening copy") : t("Open copy in new tab")}
              </Button>
            </li>
          );
        })}
      </ul>
      {!rows.length ? (
        <p role="status" className="text-ui-secondary text-(--ui-text-secondary)">
          {recovery.loading
            ? t("Checking file recovery copies…")
            : query
              ? t("No matching file copies")
              : mode === "unsaved"
                ? t("No unsaved file drafts.")
                : t("No file recovery copies.")}
        </p>
      ) : null}
    </section>
  );
}
