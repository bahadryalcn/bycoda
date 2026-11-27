import { t, formatDate, formatNumber } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineMessage } from "../../../../../shared/ui/InlineError";
import { DataTable, DataTableRow } from "../../../../../shared/ui/SortableDataTable";
import type { YouTubeOperation } from "../../../model/youtubeManagement";
import { youtubeForms, youtubeSections, type YouTubeSection } from "./youtubeForms";

export function asYoutubeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function label(key: string): string {
  switch (key) {
    case "action":
      return t("Action");
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
    case "moderationStatus":
      return t("Status");
    case "description":
      return t("Description");
    case "channelId":
    case "authorChannelId":
    case "targetChannelId":
      return t("Channel ID");
    case "videoId":
      return t("Video ID");
    case "postId":
      return t("Community post ID");
    case "playlistId":
      return t("Playlist ID");
    case "playlistItemId":
      return t("Playlist item ID");
    case "categoryId":
      return t("Category ID");
    case "commentId":
      return t("Comment ID");
    case "parentId":
      return t("Parent comment ID");
    case "broadcastId":
      return t("Broadcast ID");
    case "messageId":
      return t("Message ID");
    case "replyToMessageId":
      return t("Reply to message ID");
    case "banId":
      return t("Ban ID");
    case "streamId":
      return t("Stream ID");
    case "chatId":
      return t("Live chat ID");
    case "privacyStatus":
    case "privacy":
      return t("Privacy");
    case "text":
      return t("Text");
    case "editedText":
      return t("Post text");
    case "message":
      return t("Message");
    case "authorName":
      return t("Author");
    case "url":
      return t("Link");
    case "links":
      return t("Links");
    case "country":
      return t("Country code");
    case "keywords":
      return t("Keywords");
    case "avatarUrl":
    case "avatarUploadId":
      return t("Avatar");
    case "bannerUrl":
    case "bannerUploadId":
      return t("Banner");
    case "uploadId":
      return t("Thumbnail");
    case "imageUploadIds":
      return t("Images");
    case "madeForKids":
      return t("Made for kids");
    case "containsSyntheticMedia":
      return t("Contains altered or synthetic content");
    case "tags":
      return t("Tags");
    case "position":
      return t("Position");
    case "kind":
      return t("Format");
    case "choices":
      return t("Poll options");
    case "input":
      return t("Input");
    case "patch":
      return t("Changes");
    case "reaction":
      return t("Reaction");
    case "enabled":
      return t("Enabled");
    case "changed":
      return t("Changed");
    case "wouldChange":
      return t("Would change");
    case "deleted":
      return t("Deleted");
    case "subscribed":
      return t("Subscribed");
    case "durationSeconds":
      return t("Duration (seconds)");
    case "currency":
      return t("Currency code");
    case "type":
      return t("Type");
    case "replyCount":
      return t("Replies");
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
    case "estimatedAdRevenue":
      return t("Estimated ad revenue");
    case "monetizedPlaybacks":
      return t("Monetized playbacks");
    case "cpm":
      return t("Ad cost per 1,000 impressions");
    case "insightTrafficSourceType":
      return t("Traffic source");
    case "comments":
      return t("Comments");
    case "likes":
      return t("Likes");
    case "publishedAt":
      return t("Published");
    case "publishAt":
      return t("Publish time");
    case "at":
    case "createdAt":
      return t("Created");
    case "scheduledStartTime":
      return t("Start time");
    case "rtmpUrl":
      return t("RTMP URL");
    case "credentialRef":
      return t("Stream credential reference");
    case "ingest":
      return t("Encoder setup");
    case "broadcast":
      return t("Live broadcast");
    case "monitorStreamEnabled":
      return t("Stream monitor enabled");
    case "displayAmount":
      return t("Amount");
    case "amountMicros":
      return t("Amount (millionths)");
    case "supporter":
      return t("Supporter");
    case "superChat":
      return t("Super Chat payment");
    case "isSticker":
      return t("Super Sticker payment");
    case "stage":
      return t("Stage");
    case "code":
      return t("Error code");
    case "searchCalls":
      return t("Search calls");
    case "uploadCalls":
      return t("Video uploads");
    case "units":
    case "writeQuotaUnits":
      return t("Data API units");
    case "limits":
      return t("Limits");
    default:
      return key.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
}

function actionText(value: string): string {
  if (value === "subscribe") return t("Subscribe");
  if (value === "unsubscribe") return t("Unsubscribe");
  if (value.startsWith("youtube.")) {
    for (const browser of [false, true]) {
      for (const { value: section } of youtubeSections(browser)) {
        const form = youtubeForms(section as YouTubeSection, browser).find(
          (item) => item.action === value,
        );
        if (form) return form.label;
      }
    }
  }
  return value;
}

function statusText(value: unknown): string | undefined {
  switch (value) {
    case "ready":
      return t("Ready");
    case "testing":
      return t("Testing");
    case "testStarting":
    case "liveStarting":
      return t("Starting");
    case "live":
      return t("Live");
    case "complete":
    case "done":
      return t("Completed");
    case "rejected":
      return t("Failed");
    case "awaiting_approval":
      return t("Waiting for your approval.");
    case "submitted":
      return t("Submitted");
    case "unknown":
      return t("Unknown");
    case "created":
      return t("Created");
    case "partial":
      return t("Partial");
    case "published":
      return t("Published");
    case "scheduled":
      return t("Scheduled");
    case "heldForReview":
      return t("Held for review");
    case "likelySpam":
      return t("Likely spam");
    case "eligible":
      return t("Eligible for monetization");
    case "ineligible":
      return t("Ineligible for monetization");
    case "active":
      return t("Active");
    case "pending":
      return t("Pending");
  }
}

function cell(value: unknown, key?: string): string {
  if (key === "privacy" || key === "privacyStatus") {
    if (value === "public") return t("Public");
    if (value === "private") return t("Private");
    if (value === "unlisted") return t("Unlisted");
  }
  if (key === "status" || key === "moderationStatus") {
    if (key === "moderationStatus" && value === "rejected") return t("Hidden");
    const localized = statusText(value);
    if (localized) return localized;
  }
  if (key === "action" && typeof value === "string") return actionText(value);
  if (key === "reaction") {
    if (value === "like") return t("Like");
    if (value === "heart") return t("Heart");
  }
  if (key === "kind") {
    if (value === "text") return t("Text");
    if (value === "image") return t("Image");
    if (value === "poll") return t("Poll");
  }
  if (key === "type") {
    if (value === "textMessageEvent") return t("Message");
    if (value === "superChatEvent") return t("Super Chat payment");
    if (value === "superStickerEvent") return t("Super Sticker payment");
  }
  if (typeof value === "number")
    return key === "createdAt" ? formatDate(new Date(value)) : formatNumber(value);
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

const listKeys = [
  "items",
  "videos",
  "playlists",
  "comments",
  "broadcasts",
  "events",
  "rows",
  "subscriptions",
];

/** The records of a list result, or undefined when the result is not a list. */
export function listRows(result: unknown): Record<string, unknown>[] | undefined {
  const data = asYoutubeRecord(result);
  const list = data && listKeys.map((key) => data[key]).find(Array.isArray);
  return list?.map(asYoutubeRecord).filter((row) => row !== undefined);
}

const titleKeys = ["title", "text", "message", "name", "handle", "authorName"];

/** One readable line for a list row: its title and a few short facts, never raw JSON. */
export function rowSummary(row: Record<string, unknown>): {
  title: string;
  meta: string[];
} {
  const titleKey = titleKeys.find((key) => typeof row[key] === "string" && row[key] !== "");
  const title = titleKey ? String(row[titleKey]) : String(row.id ?? "");
  const metaKeys = [
    "authorName",
    "privacyStatus",
    "privacy",
    "moderationStatus",
    "status",
    "displayAmount",
    "scheduledStartTime",
    "publishedAt",
    "views",
    "likes",
    "replyCount",
  ];
  const meta = metaKeys
    .filter((key) => key !== titleKey && cell(row[key], key) !== "")
    .map((key) => cell(row[key], key));
  return { title, meta: meta.slice(0, 3) };
}

export function YouTubeResult({
  result,
  busy,
  review,
  reconcile,
}: {
  result: unknown;
  busy: boolean;
  review?: (operation: YouTubeOperation) => void;
  reconcile?: (operation: YouTubeOperation, status: "done" | "rejected") => void;
}) {
  const data = asYoutubeRecord(result);
  if (!data) return null;
  const notice = youtubeResultNotice(data.status, data.reason);
  const { status: _status, ...facts } = data;
  const rows = listRows(result);
  const columns = Object.keys(rows?.[0] ?? {}).filter(
    (key) => !hiddenKeys.has(key) && rows?.some((row) => cell(row[key]) !== ""),
  );
  const summarized = columns;
  const actionColumn = review || reconcile;
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
