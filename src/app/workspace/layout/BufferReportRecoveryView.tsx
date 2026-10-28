import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";

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
};
function readableTime(value: number | null): string | null {
  if (value === null || Math.abs(value) > 8_640_000_000_000_000) return null;
  return new Date(value).toLocaleString();
}
export function BufferReportRecoveryView<R extends BufferReportDisplay>({
  recovery,
  reportKey,
  onShowCopies,
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
  const rows = recovery.records.filter(
    (row) =>
      (filter === "all" || row.held) &&
      `${row.windowLabel ?? ""} ${row.reportVersion}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  if (details) {
    const matched = details.buffers.filter((buffer) =>
      buffer.path.toLocaleLowerCase().includes(pathQuery.trim().toLocaleLowerCase()),
    );
    const page = matched.slice(pathPage * 50, (pathPage + 1) * 50);
    return (
      <section
        className="flex min-h-0 flex-col gap-2 p-3"
        aria-label={t("Earlier file report details")}
      >
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
        <SearchInput
          value={pathQuery}
          onChange={(event) => {
            setPathQuery(event.target.value);
            setPathPage(0);
          }}
          aria-label={t("Search reported files")}
          placeholder={t("Search reported files")}
        />
        <ul
          className="min-h-0 overflow-y-auto overscroll-contain divide-y divide-stroke"
          aria-label={t("Reported files")}
        >
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
        {!matched.length ? (
          <p role="status" className="text-ui-secondary text-(--ui-text-secondary)">
            {pathQuery
              ? t("No matching reported files.")
              : t("This report has no file list. Its state remains unknown.")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
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
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t(
            "Check recovery copies or the original window for edited text. Matching file names alone do not settle this report.",
          )}
        </p>
      </section>
    );
  }
  return (
    <section className="flex min-h-0 flex-col gap-2 p-3" aria-label={t("Earlier file reports")}>
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t("Inspect earlier file reports without changing files or removing their protection.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={t("Report filters")}
          value={filter}
          onValueChange={(value) => setFilter(value as "held" | "all")}
          options={[
            { value: "held", label: t("Needs recovery") },
            { value: "all", label: t("All reports") },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          loading={recovery.loading}
          onClick={() => void recovery.refresh()}
        >
          {recovery.loaded ? t("Refresh reports") : t("Check reports")}
        </Button>
      </div>
      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t("Search reports on this page")}
        placeholder={t("Search reports on this page")}
      />
      {recovery.error ? (
        <Alert tone="danger" role="alert">
          {t("Earlier reports could not be loaded. The previous page is kept; refresh to retry.")}
        </Alert>
      ) : null}
      <ul
        className="min-h-0 overflow-y-auto overscroll-contain divide-y divide-stroke"
        aria-label={t("Earlier file reports")}
      >
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
                  {row.held
                    ? t("Needs recovery")
                    : row.current
                      ? t("Current report")
                      : t("Earlier report")}{" "}
                  · {time ?? t("Time unavailable")}
                </p>
                {!row.inspectable ? (
                  <p className="text-ui-caption text-(--ui-text-secondary)">
                    {t("This report cannot be inspected in this version. It remains protected.")}
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
      {recovery.loaded && !rows.length ? (
        <p role="status" className="text-ui-secondary text-(--ui-text-secondary)">
          {filter === "held"
            ? t("No reports needing recovery on this page.")
            : t("No earlier reports on this page.")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
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
    </section>
  );
}
