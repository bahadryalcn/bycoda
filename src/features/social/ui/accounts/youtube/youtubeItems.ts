import { rowSummary } from "./YouTubeResult";
import type { YouTubeDraft, YouTubeSection, YouTubeView } from "./youtubeForms";

export type YouTubePick = {
  /** Draft values the chosen row fills. */
  values: Record<string, string>;
  /** The task form to open for the chosen row. */
  action: string;
  /** Current values of the chosen row that the opened form starts from; untouched ones are not sent. */
  baseline?: Record<string, string>;
  /** Human name of the chosen row. */
  title: string;
};

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * What choosing a list row means: which draft keys it fills and which task opens next.
 * Rows without an id, and rows that only inform (Super Chats), have no target.
 */
export function youtubePick(
  section: YouTubeSection,
  view: YouTubeView | undefined,
  draft: YouTubeDraft,
  row: Record<string, unknown>,
): YouTubePick | undefined {
  const id = text(row.id);
  if (!id) return undefined;
  const title = rowSummary(row).title;
  if (section === "community") {
    const status = row.status === "published" || row.status === "scheduled" ? row.status : "";
    return {
      values: {
        postId: id,
        ...(text(row.text) ? { editedText: String(row.text) } : {}),
        ...(status ? { status } : {}),
      },
      action: "youtube.community.edit",
      title,
    };
  }
  if (section === "comments")
    return { values: { commentId: id }, action: "youtube.comment.moderate", title };
  if (section === "subscriptions")
    return {
      values: { targetChannelId: text(row.channelId) ?? id },
      action: "youtube.subscription.preview",
      title,
    };
  if (view === "videos")
    return {
      values: { videoId: id },
      action: "youtube.video.update",
      baseline: youtubePrefill("youtube.video.update", row),
      title,
    };
  if (view === "playlists")
    return typeof draft.playlistId === "string" && draft.playlistId
      ? { values: { playlistItemId: id }, action: "youtube.playlist.move", title }
      : {
          values: { playlistId: id },
          action: "youtube.playlist.update",
          baseline: youtubePrefill("youtube.playlist.update", row),
          title,
        };
  if (view === "broadcasts")
    return { values: { broadcastId: id }, action: "youtube.broadcast.transition", title };
  if (view === "chat")
    return {
      values: {
        messageId: id,
        ...(text(row.authorChannelId) ? { channelId: String(row.authorChannelId) } : {}),
      },
      action: "youtube.liveChat.delete",
      title,
    };
  return undefined;
}

const privacyValue = (value: unknown) =>
  value === "public" || value === "unlisted" || value === "private" ? value : undefined;
const flag = (value: unknown) => (typeof value === "boolean" ? String(value) : undefined);
const plain = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * The current values an edit form starts from, read from a list row or the channel read: only
 * fields the source reports, as the draft strings the form fields hold.
 */
export function youtubePrefill(
  action: string,
  source: Record<string, unknown>,
): Record<string, string> {
  const entries: [string, string | undefined][] =
    action === "youtube.video.update"
      ? [
          ["title", text(source.title)],
          ["description", plain(source.description)],
          ["privacy", privacyValue(source.privacy ?? source.privacyStatus)],
          ["categoryId", text(source.categoryId)],
          [
            "tags",
            Array.isArray(source.tags)
              ? source.tags.filter((tag) => typeof tag === "string").join("\n")
              : undefined,
          ],
          ["madeForKids", flag(source.madeForKids)],
          ["containsSyntheticMedia", flag(source.containsSyntheticMedia)],
        ]
      : action === "youtube.playlist.update"
        ? [
            ["title", text(source.title)],
            ["description", plain(source.description)],
            ["privacy", privacyValue(source.privacy ?? source.privacyStatus)],
          ]
        : action === "youtube.channel.update"
          ? [
              ["description", plain(source.description)],
              ["keywords", plain(source.keywords)],
              ["country", text(source.country)],
              ["madeForKids", flag(source.madeForKids)],
            ]
          : [];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * The draft to send for an edit form: a prefilled value the owner left untouched is dropped, so a
 * patch carries only real changes. Identifiers and fields without a prefill pass through.
 */
export function youtubeChanged(
  draft: YouTubeDraft,
  baseline: Record<string, string>,
): YouTubeDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== baseline[key]),
  );
}

/** Select options for an identifier field from a list result; the current value stays selectable. */
export function youtubeRefOptions(
  rows: Record<string, unknown>[] | undefined,
  current: string,
): { value: string; label: string }[] {
  const options = (rows ?? []).flatMap((row) =>
    typeof row.id === "string" ? [{ value: row.id, label: rowSummary(row).title }] : [],
  );
  return current && !options.some((option) => option.value === current)
    ? [{ value: current, label: current }, ...options]
    : options;
}
