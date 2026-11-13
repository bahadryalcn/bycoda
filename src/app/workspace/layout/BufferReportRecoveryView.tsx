import { Text } from "../../../shared/ui/Text";
import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError } from "../../../shared/ui/InlineError";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { RefreshCw, Search } from "../../../shared/ui/icons";
import { surfaceAttributes } from "../../../shared/ui/Surface";

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
  partial?: string | null;
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
  scopeKey?: string;
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
  scopeKey = "reports",
  onShowCopies,
  sourceControl,
}: Props<R>) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"held" | "all">("held");
  const [pathQuery, setPathQuery] = useState("");
  if (!recovery.visible)
    return (
      <Text role="status" as="p" size="secondary" tone="secondary" className="p-3">
        {t("Unlock project groups to inspect earlier file reports.")}
      </Text>
    );
  if (!recovery.available)
    return (
      <Text role="status" as="p" size="secondary" tone="secondary" className="p-3">
        {t("Earlier file reports are available in the desktop application.")}
      </Text>
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
    const pathRows = matched.map((buffer, index) => ({ buffer, index }));
    return (
      <section className="recovery-pane" aria-label={t("Earlier file report details")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text as="p" size="secondary" tone="inherit" weight="medium">
            {details.record.windowLabel ?? t("Earlier window")} · {t("Report")}{" "}
            {details.record.reportVersion}
          </Text>
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
          <Search className="icon-sm shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            value={pathQuery}
            onChange={(event) => {
              setPathQuery(event.target.value);
            }}
            aria-label={t("Search reported files")}
            placeholder={t("Search reported files")}
          />
        </SearchInputGroup>
        <Text role="status" as="div" size="caption" tone="secondary" className="recovery-status">
          <span>{t("{p0} reported files", { p0: details.buffers.length })}</span>
          {pathQuery ? <span>{t("{p0} match", { p0: matched.length })}</span> : null}
        </Text>
        <div className="recovery-body">
          {pathRows.length ? (
            <ContinuousList
              items={pathRows}
              stateKey={`buffer-recovery:${scopeKey}:paths:${reportKey(details.record)}`}
              itemKey={({ buffer, index }) => `${index}:${buffer.path}`}
              estimateSize={56}
              label={t("Reported files")}
              renderItem={({ buffer }) => (
                <div role="listitem" className="flex flex-wrap items-start gap-2 py-2">
                  <Text
                    size="secondary"
                    tone="inherit"
                    className="min-w-0 flex-1 select-text [overflow-wrap:anywhere]"
                  >
                    {buffer.path}
                  </Text>
                  <Text size="caption" tone="secondary">
                    {buffer.dirty ? t("Unsaved changes reported") : t("No changes reported")}
                  </Text>
                </div>
              )}
            />
          ) : (
            <Text role="status" as="p" size="secondary" tone="secondary" className="py-3">
              {pathQuery
                ? t("No matching reported files.")
                : t("This report has no file list. Its state remains unknown.")}
            </Text>
          )}
        </div>
        <div {...surfaceAttributes({ frame: "stroke", edge: "top" }, "recovery-footer")}>
          <Text as="p" size="caption" tone="secondary">
            {t(
              "Check recovery copies or the original window for edited text. Matching file names alone do not settle this report.",
            )}
          </Text>
          <div className="recovery-actions">
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
          <Search className="icon-sm shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("Search loaded reports")}
            placeholder={t("Search loaded reports")}
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
      <Text role="status" as="div" size="caption" tone="secondary" className="recovery-status">
        {recovery.loaded ? (
          <>
            <span>
              {t("{p0} loaded reports · {p1} need recovery", {
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
      </Text>
      <div className="recovery-body">
        {rows.length ? (
          <ContinuousList
            items={rows}
            stateKey={`buffer-recovery:${scopeKey}:reports:${filter}`}
            itemKey={reportKey}
            requiredKey={recovery.pending}
            estimateSize={112}
            label={t("Earlier file reports")}
            renderItem={(row) => {
              const key = reportKey(row);
              const time = readableTime(row.updatedAt);
              return (
                <div role="listitem" className="flex flex-wrap items-start gap-2 py-2">
                  <div className="min-w-0 basis-48 flex-1">
                    <Text
                      as="p"
                      size="secondary"
                      tone="inherit"
                      weight="medium"
                      className="break-words"
                    >
                      {row.windowLabel ?? t("Earlier window")} · {t("Report")} {row.reportVersion}
                    </Text>
                    <Text as="p" size="caption" tone="secondary">
                      <Text
                        size="inherit"
                        tone={row.held ? "warning" : "inherit"}
                        weight={row.held ? "medium" : undefined}
                      >
                        {row.held
                          ? t("Needs recovery")
                          : row.current
                            ? t("Current report")
                            : t("Earlier report")}
                      </Text>{" "}
                      · {time ?? t("Time unavailable")}
                    </Text>
                    {!row.inspectable ? (
                      <Text as="p" size="caption" tone="secondary">
                        {t(
                          "This report cannot be inspected in this version. It remains protected.",
                        )}
                      </Text>
                    ) : null}
                    {recovery.readError === key ? (
                      <InlineError>
                        {t("This report could not be inspected. Refresh the list and retry.")}
                      </InlineError>
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
                      void recovery.inspect(row);
                    }}
                  >
                    {recovery.readError === key ? t("Retry inspection") : t("Inspect report")}
                  </Button>
                </div>
              );
            }}
          />
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
            description={t("No loaded report matches “{p0}”.", { p0: query.trim() })}
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
            title={t("No reports needing recovery.")}
            description={t("{p0} other loaded reports are available.", {
              p0: recovery.records.length,
            })}
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                {t("Show all reports")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("No earlier file reports.")}
            description={t("Inspecting a report never changes files or removes its protection.")}
          />
        )}
      </div>
      <div {...surfaceAttributes({ frame: "stroke", edge: "top" }, "recovery-footer")}>
        <Text as="p" size="caption" tone="secondary">
          {t("Inspect earlier file reports without changing files or removing their protection.")}
        </Text>
        <CollectionFooter
          loading={recovery.loading}
          error={
            recovery.error
              ? t("Earlier reports could not be loaded. Loaded reports remain available.")
              : null
          }
          partial={recovery.partial}
          onRetry={() => void recovery.refresh()}
          hasMore={recovery.hasNext}
          onLoadMore={() => void recovery.next()}
        />
      </div>
    </section>
  );
}
