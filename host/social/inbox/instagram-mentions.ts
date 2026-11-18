import type { HostStore } from "../../store";

type Store = Pick<HostStore, "db">;
export type InstagramMention = {
  mediaId: string;
  commentId?: string;
  at: number;
};

const MENTIONS_PAGE_SIZE = 25;
const mentionBucket = (accountId: string) => `instagram-mention:${accountId}`;

/** Meta's dedicated mention event may identify only media and comment IDs. */
export function parseInstagramMention(
  value: { media_id?: unknown; comment_id?: unknown } | undefined,
  at: number,
): InstagramMention | undefined {
  const mediaId = value?.media_id;
  const commentId = value?.comment_id;
  if (
    typeof mediaId !== "string" ||
    !/^\d{1,32}$/.test(mediaId) ||
    (commentId !== undefined && (typeof commentId !== "string" || !/^\d{1,32}$/.test(commentId)))
  )
    return undefined;
  return { mediaId, ...(commentId ? { commentId } : {}), at };
}

/** Keeps first delivery and does not create a replyable conversation or contact. */
export async function recordInstagramMention(
  store: Store,
  accountId: string,
  mention: InstagramMention,
): Promise<number> {
  const key = mention.commentId ? `comment:${mention.commentId}` : `media:${mention.mediaId}`;
  const inserted = await store.db
    .prepare("INSERT OR IGNORE INTO social_records (kind,id,value) VALUES (?,?,?)")
    .run(mentionBucket(accountId), key, JSON.stringify(mention));
  return Number(inserted.changes);
}

/** Bounded account-scoped history of notifications actually delivered to this Host. */
export async function readInstagramMentions(
  store: Store,
  accountId: string,
  cursor?: string,
): Promise<{ mentions: InstagramMention[]; next?: string; coverage: "webhook_only" }> {
  if (cursor !== undefined && (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))))
    throw new Error("Invalid Instagram mentions cursor.");
  const rows = await store.db
    .prepare(
      "SELECT rowid AS seq,value FROM social_records WHERE kind=? AND rowid<? ORDER BY rowid DESC LIMIT ?",
    )
    .all(
      mentionBucket(accountId),
      cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor),
      MENTIONS_PAGE_SIZE + 1,
    );
  const page = rows.slice(0, MENTIONS_PAGE_SIZE);
  return {
    mentions: page.map((row) => JSON.parse(String(row.value)) as InstagramMention),
    ...(rows.length > MENTIONS_PAGE_SIZE ? { next: String(page.at(-1)?.seq) } : {}),
    coverage: "webhook_only",
  };
}
