import type { SocialAudienceStore } from "../store/social-audience-store";
import { str } from "../core/social-helpers";
import { INBOX_STATUSES, type InboxStatus, type InboxStatusRecord } from "./inbox-types";

const KIND = "inbox-status";
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/**
 * Typed view of the generic record calls for the `inbox-status` kind. SocialAudienceStore types
 * only audience kinds, so this cast is the single boundary. The row lives in `social_records`
 * like every other Social record.
 */
type StatusRecordApi = {
  getRecord(kind: typeof KIND, id: string): Promise<InboxStatusRecord | undefined>;
  putRecord(kind: typeof KIND, id: string, value: InboxStatusRecord): Promise<InboxStatusRecord>;
  listRecords(
    kind: typeof KIND,
    input: { cursor?: string; limit?: number },
  ): Promise<{ items: InboxStatusRecord[]; next?: string }>;
};

function statusRecords(store: SocialAudienceStore): StatusRecordApi {
  return store as unknown as StatusRecordApi;
}

export async function readInboxStatus(
  store: SocialAudienceStore,
  threadId: string,
): Promise<InboxStatusRecord | undefined> {
  return statusRecords(store).getRecord(KIND, threadId);
}

export async function writeInboxStatus(
  store: SocialAudienceStore,
  record: InboxStatusRecord,
): Promise<void> {
  await statusRecords(store).putRecord(KIND, record.threadId, record);
}

/**
 * Every stored status keyed by thread id. Pages the kind in fixed batches, so the cost grows with
 * the number of stored statuses, not with one query per visible thread.
 */
export async function readAllInboxStatuses(
  store: SocialAudienceStore,
): Promise<Map<string, InboxStatusRecord>> {
  const byThread = new Map<string, InboxStatusRecord>();
  let cursor: string | undefined;
  do {
    const page = await statusRecords(store).listRecords(KIND, { cursor, limit: 200 });
    for (const item of page.items) byThread.set(item.threadId, item);
    cursor = page.next;
  } while (cursor);
  return byThread;
}

/**
 * Status shown when the owner has not set one: a conversation whose last event we sent is
 * "replied", anything else is "unread".
 */
export function effectiveStatus(
  record: InboxStatusRecord | undefined,
  lastDirection: "inbound" | "outbound" | undefined,
): InboxStatus {
  if (record) return record.status;
  return lastDirection === "outbound" ? "replied" : "unread";
}

export function parseStatus(value: unknown): InboxStatus {
  if (typeof value === "string" && (INBOX_STATUSES as readonly string[]).includes(value))
    return value as InboxStatus;
  throw new Error("Invalid inbox status.");
}

/** Trimmed, de-duplicated tags. At most 10 tags of 40 characters each. */
export function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new Error("Invalid inbox tags.");
  return [...new Set(value.map((tag) => str(tag, "inbox tag", MAX_TAG_LENGTH)))];
}
