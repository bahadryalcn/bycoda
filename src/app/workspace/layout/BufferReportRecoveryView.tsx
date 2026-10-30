import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { RefreshCw, Search } from "../../../shared/ui/icons";

export type BufferReportDisplay = {
  windowLabel: string | null;
  reportVersion: number;
  updatedAt: number | null;
  held: boolean;
  current: boolean;
  inspectable: boolean;
};
export type BufferReportRecoveryModel<R extends BufferReportDisplay> = {
  visible: boolean;
  available: boolean;
  records: readonly R[];
  details: { record: R; buffers: readonly { path: string; dirty: boolean }[] } | null;
  loading: boolean;
  loaded: boolean;
  error: boolean;
  readError: string | null;
  pending: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  refresh(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  inspect(record: R): Promise<void>;
  detailsAreCurrent(): boolean;
  closeDetails(): void;
};
type Props<R extends BufferReportDisplay> = {
  recovery: BufferReportRecoveryModel<R>;
  reportKey(record: R): string;
  onShowCopies?(paths: readonly string[]): void;
  /** Where the reports come from; the owner renders it, the view places it in its toolbar. */
  sourceControl?: ReactNode;
};
function readableTime(value: number | null): string | null {
  if (value === null || Math.abs(value) > 8_640_000_000_000_000) return null;
  return new Date(value).toLocaleString();
}
export function BufferReportRecoveryView<R extends BufferReportDisplay>({
  recovery,
  reportKey,
  onShowCopies,
  sourceControl,
}: Props<R>) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"held" | "all">("held");
  const [pathQuery, setPathQuery] = useState("");
  const [pathPage, setPathPage] = useState(0);
  if (!recovery.visible)
    return (
      <p role="status" className="p-3 text-ui-secondary text-(--ui-text-secondary)">
        {t("Unlock project groups to inspect earlier file reports.")}
      </p>
    );
  if (!recovery.available)
    return (
      <p role="status" className="p-3 text-ui-secondary text-(--ui-text-secondary)">
        {t("Earlier file reports are available in the desktop application.")}
      </p>
    );
  const details = recovery.details;
  const needle = query.trim().toLocaleLowerCase();
  const matchesQuery = (row: R) =>
    `${row.windowLabel ?? ""} ${row.reportVersion}`.toLocaleLowerCase().includes(needle);
  const heldCount = recovery.records.filter((row) => row.held).length;
  const scoped = filter === "all" ? recovery.records : recovery.records.filter((row) => row.held);
  const rows = scoped.filter(matchesQuery);
  if (details) {
    const matched = details.buffers.filter((buffer) =>
      buffer.path.toLocaleLowerCase().includes(pathQuery.trim().toLocaleLowerCase()),
    );
    const page = matched.slice(pathPage * 50, (pathPage + 1) * 50);
    return (
      <section className="recovery-pane" aria-label={t("Earlier file report details")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui-secondary font-medium">
            {details.record.windowLabel ?? t("Earlier window")} · {t("Report")}{" "}
            {details.record.reportVersion}
          </p>
          <Button variant="ghost" size="sm" onClick={recovery.closeDetails}>
            {t("Back to reports")}
          </Button>
        </div>
        <Alert tone="warning">
          {t(
            "This report contains file names and edit status, not the edited text. Its protection has not been removed.",
          )}
        </Alert>
        <SearchInputGroup appearance="field">
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            value={pathQuery}
            onChange={(event) => {
              setPathQuery(event.target.value);
              setPathPage(0);
            }}
            aria-label={t("Search reported files")}
            placeholder={t("Search reported files")}
          />
        </SearchInputGroup>
        <div role="status" className="recovery-status text-ui-caption text-(--ui-text-secondary)">
          <span>{t("{p0} reported files", { p0: details.buffers.length })}</span>
          {pathQuery ? <span>{t("{p0} match", { p0: matched.length })}</span> : null}
        </div>
        <div className="recovery-body">
          {page.length ? (
            <ul className="divide-y divide-stroke" aria-label={t("Reported files")}>
              {page.map((buffer, index) => (
                <li
                  key={`${pathPage * 50 + index}:${buffer.path}`}
                  className="flex flex-wrap items-start gap-2 py-2"
                >
                  <span className="min-w-0 flex-1 select-text text-ui-secondary [overflow-wrap:anywhere]">
                    {buffer.path}
                  </span>
                  <span className="text-ui-caption text-(--ui-text-secondary)">
                    {buffer.dirty ? t("Unsaved changes reported") : t("No changes reported")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="py-3 text-ui-secondary text-(--ui-text-secondary)">
              {pathQuery
                ? t("No matching reported files.")
                : t("This report has no file list. Its state remains unknown.")}
            </p>
          )}
        </div>
        <div className="recovery-footer border-t border-stroke">
          <p className="text-ui-caption text-(--ui-text-secondary)">
            {t(
              "Check recovery copies or the original window for edited text. Matching file names alone do not settle this report.",
            )}
          </p>
          <div className="recovery-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={pathPage === 0}
              onClick={() => setPathPage((old) => Math.max(0, old - 1))}
            >
              {t("Previous")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={(pathPage + 1) * 50 >= matched.length}
              onClick={() => setPathPage((old) => old + 1)}
            >
              {t("Next")}
            </Button>
            {onShowCopies && details.buffers.length ? (
              <Button
                className="recovery-actions-end"
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (recovery.detailsAreCurrent())
                    onShowCopies(details.buffers.map((buffer) => buffer.path));
                }}
              >
                {t("Find file recovery copies")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="recovery-pane" aria-label={t("Earlier file reports")}>
      <div className="recovery-toolbar">
        {sourceControl}
        <SegmentedControl
          label={t("Report filters")}
          value={filter}
          onValueChange={(value) => setFilter(value as "held" | "all")}
          options={[
            { value: "held", label: t("Needs recovery") },
            { value: "all", label: t("All reports") },
          ]}
        />
        <SearchInputGroup appearance="field" className="recovery-toolbar-search">
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("Search reports on this page")}
            placeholder={t("Search reports on this page")}
          />
        </SearchInputGroup>
        <Button
          variant="ghost"
          size="sm"
          startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} />}
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          {recovery.loaded ? t("Refresh reports") : t("Check reports")}
        </Button>
      </div>
      <div role="status" className="recovery-status text-ui-caption text-(--ui-text-secondary)">
        {recovery.loaded ? (
          <>
            <span>
              {t("{p0} reports on this page · {p1} need recovery", {
                p0: recovery.records.length,
                p1: heldCount,
              })}
            </span>
            {rows.length !== scoped.length ? (
              <span>{t("Showing {p0} of {p1}", { p0: rows.length, p1: scoped.length })}</span>
            ) : null}
          </>
        ) : (
          <span>{t("Reports are not loaded yet.")}</span>
        )}
      </div>
      {recovery.error ? (
        <Alert tone="danger" role="alert">
          <span>
            {t("Earlier reports could not be loaded. The previous page is kept; refresh to retry.")}
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
          <ul className="divide-y divide-stroke" aria-label={t("Earlier file reports")}>
            {rows.map((row) => {
              const key = reportKey(row);
              const time = readableTime(row.updatedAt);
              return (
                <li key={key} className="flex flex-wrap items-start gap-2 py-2">
                  <div className="min-w-0 basis-48 flex-1">
                    <p className="break-words text-ui-secondary font-medium">
                      {row.windowLabel ?? t("Earlier window")} · {t("Report")} {row.reportVersion}
                    </p>
                    <p className="text-ui-caption text-(--ui-text-secondary)">
                      <span className={row.held ? "font-medium text-warning" : ""}>
                        {row.held
                          ? t("Needs recovery")
                          : row.current
                            ? t("Current report")
                            : t("Earlier report")}
                      </span>{" "}
                      · {time ?? t("Time unavailable")}
                    </p>
                    {!row.inspectable ? (
                      <p className="text-ui-caption text-(--ui-text-secondary)">
                        {t(
                          "This report cannot be inspected in this version. It remains protected.",
                        )}
                      </p>
                    ) : null}
                    {recovery.readError === key ? (
                      <p role="alert" className="text-ui-caption text-danger">
                        {t("This report could not be inspected. Refresh the list and retry.")}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      recovery.loading ||
                      !row.inspectable ||
                      (!!recovery.pending && recovery.pending !== key)
                    }
                    loading={recovery.pending === key}
                    onClick={() => {
                      setPathQuery("");
                      setPathPage(0);
                      void recovery.inspect(row);
                    }}
                  >
                    {recovery.readError === key ? t("Retry inspection") : t("Inspect report")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : !recovery.loaded ? (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("Reports are not loaded yet.")}
            description={t(
              "Check reports to see earlier file reports. This does not change files or remove protection.",
            )}
          />
        ) : query ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No matching reports")}
            description={t("No report on this page matches “{p0}”.", { p0: query.trim() })}
            action={
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                {t("Clear search")}
              </Button>
            }
          />
        ) : filter === "held" && recovery.records.length > 0 ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No reports needing recovery on this page.")}
            description={t("{p0} other reports on this page are available.", {
              p0: recovery.records.length,
            })}
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                {t("Show all reports")}
              </Button>
            }
          />
        ) : filter === "held" && (recovery.hasNext || recovery.hasPrevious) ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No reports needing recovery on this page.")}
            description={t("Use Next or Previous to check other pages.")}
          />
        ) : (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("No earlier reports on this page.")}
            description={t("Inspecting a report never changes files or removes its protection.")}
          />
        )}
      </div>
      <div className="recovery-footer border-t border-stroke">
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("Inspect earlier file reports without changing files or removing their protection.")}
        </p>
        <div className="recovery-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={!recovery.hasPrevious || recovery.loading}
            onClick={() => void recovery.previous()}
          >
            {t("Previous")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!recovery.hasNext || recovery.loading}
            onClick={() => void recovery.next()}
          >
            {t("Next")}
          </Button>
        </div>
      </div>
    </section>
  );
}
