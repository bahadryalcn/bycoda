import { t, formatDate, formatNumber } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineMessage } from "../../../../../shared/ui/InlineError";
import { DataTable, DataTableRow } from "../../../../../shared/ui/SortableDataTable";
import type { YouTubeOperation } from "../../../model/youtubeManagement";

export function asYoutubeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function label(key: string): string {
  switch (key) {
    case "title":
      return t("Title");
    case "day":
      return t("Day");
    case "id":
      return t("ID");
    case "name":
      return t("Name");
    case "handle":
      return t("Handle");
    case "status":
      return t("Status");
    case "description":
      return t("Description");
    case "channelId":
      return t("Channel ID");
    case "videoId":
      return t("Video ID");
    case "privacyStatus":
    case "privacy":
      return t("Privacy");
    case "text":
      return t("Text");
    case "authorName":
      return t("Author");
    case "views":
      return t("Views");
    case "estimatedMinutesWatched":
      return t("Watch time (minutes)");
    case "subscribersGained":
      return t("Subscribers gained");
    case "subscribersLost":
      return t("Subscribers lost");
    case "estimatedRevenue":
      return t("Estimated earnings");
    case "publishedAt":
      return t("Published");
    case "scheduledStartTime":
      return t("Start time");
    case "rtmpUrl":
      return t("RTMP URL");
    case "credentialRef":
      return t("Stream credential reference");
    case "searchCalls":
      return t("Search calls");
    case "uploadCalls":
      return t("Video uploads");
    case "units":
      return t("Data API units");
    case "limits":
      return t("Limits");
    default:
      return key.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
}

function cell(value: unknown, key?: string): string {
  if (key === "privacy" || key === "privacyStatus") {
    if (value === "public") return t("Public");
    if (value === "private") return t("Private");
    if (value === "unlisted") return t("Unlisted");
  }
  if (key === "status") {
    if (value === "ready") return t("Ready");
    if (value === "testing") return t("Testing");
    if (value === "live") return t("Live");
    if (value === "complete" || value === "done") return t("Completed");
    if (value === "rejected") return t("Failed");
  }
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? t("Yes") : t("No");
  if (typeof value === "string")
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDate(new Date(value)) : value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ");
  return "";
}

const hiddenKeys = new Set([
  "accountId",
  "confirm",
  "next",
  "nextStartIndex",
  "requiredScopes",
  "reasonCode",
  "reason",
  "costs",
]);

export function YouTubeFacts({ data }: { data: Record<string, unknown> }) {
  return (
    <DescriptionList size="sm">
      {Object.entries(data)
        .filter(([key]) => !hiddenKeys.has(key))
        .map(([key, value]) => {
          const nested = asYoutubeRecord(value);
          const entries = Array.isArray(value)
            ? value.map(asYoutubeRecord).filter((item) => item !== undefined)
            : [];
          if (nested)
            return (
              <DescriptionItem key={key} term={label(key)}>
                <YouTubeFacts data={nested} />
              </DescriptionItem>
            );
          if (entries.length)
            return (
              <DescriptionItem key={key} term={label(key)}>
                {entries.map((item, index) => (
                  <YouTubeFacts key={index} data={item} />
                ))}
              </DescriptionItem>
            );
          const display = cell(value, key);
          return display === "" ? null : (
            <DescriptionItem key={key} term={label(key)}>
              {display}
            </DescriptionItem>
          );
        })}
    </DescriptionList>
  );
}

export function youtubeResultNotice(status: unknown, reason: unknown): string | undefined {
  if (status === "needs_scope")
    return t(
      "Reconnect this account and select the required YouTube Analytics or earnings permission.",
    );
  if (status === "needs_human" || reason === "needs_human" || reason === "youtube_live_not_enabled")
    return t(
      "YouTube needs your attention. Complete verification in YouTube, then check the account again.",
    );
  if (status === "awaiting_approval") return t("Waiting for your approval.");
  if (status === "unknown")
    return t("YouTube outcome is uncertain. Verify it on YouTube before trying again.");
  if (status === "rejected")
    return t("YouTube declined this operation. Check permissions and settings.");
  if (status === "done") return t("Completed");
  return undefined;
}

export function YouTubeResult({
  result,
  busy,
  review,
  onPickItem,
  reconcile,
}: {
  result: unknown;
  busy: boolean;
  review?: (operation: YouTubeOperation) => void;
  onPickItem?: (item: Record<string, unknown>) => void;
  reconcile?: (operation: YouTubeOperation, status: "done" | "rejected") => void;
}) {
  const data = asYoutubeRecord(result);
  if (!data) return null;
  const notice = youtubeResultNotice(data.status, data.reason);
  const { status: _status, ...facts } = data;
  const list = [
    "items",
    "videos",
    "playlists",
    "comments",
    "broadcasts",
    "events",
    "rows",
    "subscriptions",
  ]
    .map((key) => data[key])
    .find(Array.isArray);
  const rows = list?.map(asYoutubeRecord).filter((row) => row !== undefined);
  const columns = Object.keys(rows?.[0] ?? {}).filter(
    (key) => !hiddenKeys.has(key) && rows?.some((row) => cell(row[key]) !== ""),
  );
  const summarized = onPickItem ? columns.filter((key) => key !== "id").slice(0, 4) : columns;
  const actionColumn = review || onPickItem;
  const costs = asYoutubeRecord(data.costs);
  return (
    <>
      {notice ? (
        <InlineMessage tone={data.status === "done" ? "success" : "warning"}>
          {notice}
        </InlineMessage>
      ) : null}
      {rows ? (
        rows.length ? (
          <DataTable
            caption={t("Results")}
            headers={[
              ...summarized.map((key) => ({ label: label(key) })),
              ...(actionColumn ? [{ label: t("Action"), hidden: true }] : []),
            ]}
          >
            {rows.map((row, index) => (
              <DataTableRow
                key={typeof row.id === "string" ? row.id : index}
                cells={[
                  ...summarized.map((key) => cell(row[key], key)),
                  ...(actionColumn
                    ? [
                        review && row.status === "awaiting_approval" ? (
                          <Button
                            key="review"
                            disabled={busy}
                            onClick={() => review(row as unknown as YouTubeOperation)}
                          >
                            {t("Review")}
                          </Button>
                        ) : onPickItem && typeof row.id === "string" ? (
                          <Button key="pick" disabled={busy} onClick={() => onPickItem(row)}>
                            {t("Use")}
                          </Button>
                        ) : reconcile && row.status === "unknown" ? (
                          <div key="reconcile">
                            <Button
                              disabled={busy}
                              onClick={() => reconcile(row as unknown as YouTubeOperation, "done")}
                            >
                              {t("Completed")}
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                reconcile(row as unknown as YouTubeOperation, "rejected")
                              }
                            >
                              {t("Failed")}
                            </Button>
                          </div>
                        ) : null,
                      ]
                    : []),
                ]}
              />
            ))}
          </DataTable>
        ) : (
          <EmptyState size="inline" context="list" title={t("No results")} />
        )
      ) : (
        <YouTubeFacts data={asYoutubeRecord(data.result) ?? (notice ? facts : data)} />
      )}
      {costs ? (
        <Disclosure summary={t("Details")} variant="row">
          <YouTubeFacts data={costs} />
        </Disclosure>
      ) : null}
    </>
  );
}
