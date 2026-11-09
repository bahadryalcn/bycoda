import { SOCIAL_PLATFORMS, type SocialPlatform } from "../../../src/features/social/model/social";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";
import type { SocialActionContext } from "../core/social-actions";
import { exact, finite, str } from "../core/social-helpers";
import {
  effectiveStatus,
  parseStatus,
  parseTags,
  readAllInboxStatuses,
  readInboxStatus,
  writeInboxStatus,
} from "./inbox-status";
import { findVisibleThread, lastEvent, loadInboxView, type InboxView } from "./inbox-threads";
import {
  type InboxItem,
  type InboxStatus,
  type InboxUnifiedResult,
  type UnreadableAccount,
} from "./inbox-types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PREVIEW_GRAPHEMES = 160;

type UnifiedFilter = {
  status?: InboxStatus;
  platform?: SocialPlatform;
  accountId?: string;
  query: string;
};

type Cursor = { at: number; threadId: string };

export type UnifiedQuery = { filter: UnifiedFilter; cursor?: Cursor; limit: number };

/** Validates `inbox.unified` input. Every field is optional; unknown fields are rejected. */
export function parseUnifiedInput(input: Record<string, unknown>): UnifiedQuery {
  exact(input, ["filter", "cursor", "limit"]);
  const raw = (input.filter ?? {}) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid inbox filter.");
  exact(raw, ["status", "channel", "accountId", "query"]);
  const filter: UnifiedFilter = { query: "" };
  if (raw.status !== undefined) filter.status = parseStatus(raw.status);
  if (raw.channel !== undefined) {
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(String(raw.channel)))
      throw new Error("Invalid inbox channel.");
    filter.platform = raw.channel as SocialPlatform;
  }
  if (raw.accountId !== undefined) filter.accountId = str(raw.accountId, "account");
  if (raw.query !== undefined) {
    if (typeof raw.query !== "string" || raw.query.length > 200)
      throw new Error("Invalid inbox search.");
    filter.query = raw.query.trim().toLocaleLowerCase();
  }
  const limit = Math.floor(finite(input.limit ?? DEFAULT_LIMIT, "inbox limit", 1, MAX_LIMIT));
  return { filter, cursor: parseCursor(input.cursor), limit };
}

/** Cursor = "<at>|<threadId>" of the last item of the previous page. */
function parseCursor(value: unknown): Cursor | undefined {
  if (value === undefined) return undefined;
  const text = str(value, "inbox cursor", 300);
  const separator = text.indexOf("|");
  const at = Number(text.slice(0, separator));
  if (separator < 1 || !Number.isSafeInteger(at)) throw new Error("Invalid inbox cursor.");
  return { at, threadId: str(text.slice(separator + 1), "inbox cursor", 200) };
}

type Row = {
  threadId: string;
  accountId: string;
  platform: SocialPlatform;
  kind: "comment" | "message";
  title: string;
  preview: string;
  at: number;
  status: InboxStatus;
  tags: string[];
  contactPlatformId?: string;
};

/** One page of the unified inbox across every account the principal can read. */
export async function unifiedInbox(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<InboxUnifiedResult> {
  const query = parseUnifiedInput(input);
  const view = await loadInboxView(ctx);
  const statuses = await readAllInboxStatuses(ctx.store);
  const rows = view.threads
    .filter((thread) => accountMatches(view, thread.accountId, query.filter))
    .map((thread): Row => {
      // loadInboxView keeps only threads whose account is in accountById.
      const platform = view.accountById.get(thread.accountId)?.platform as SocialPlatform;
      const contact = view.contactById.get(thread.contactId);
      const last = lastEvent(thread);
      const record = statuses.get(thread.id);
      return {
        threadId: thread.id,
        accountId: thread.accountId,
        platform,
        kind: thread.kind,
        title: contact?.name ?? thread.platformThreadId,
        preview: truncateGraphemes(last?.text ?? "", PREVIEW_GRAPHEMES),
        at: last?.at ?? thread.lastInboundAt,
        status: effectiveStatus(record, last?.direction),
        tags: record?.tags ?? [],
        contactPlatformId: contact?.platformId,
      };
    })
    .filter((row) => matchesRow(row, query.filter))
    .sort((a, b) => b.at - a.at || (a.threadId < b.threadId ? 1 : a.threadId > b.threadId ? -1 : 0))
    .filter(
      (row) =>
        !query.cursor ||
        row.at < query.cursor.at ||
        (row.at === query.cursor.at && row.threadId < query.cursor.threadId),
    );
  const page = rows.slice(0, query.limit);
  const items = await Promise.all(page.map((row) => toItem(ctx, row)));
  const last = page.at(-1);
  return {
    items,
    unreadable: unreadableAccounts(view, ctx.now(), query.filter),
    ...(rows.length > query.limit && last ? { next: `${last.at}|${last.threadId}` } : {}),
  };
}

function accountMatches(view: InboxView, accountId: string, filter: UnifiedFilter): boolean {
  if (filter.accountId !== undefined && accountId !== filter.accountId) return false;
  if (
    filter.platform !== undefined &&
    view.accountById.get(accountId)?.platform !== filter.platform
  )
    return false;
  return true;
}

function matchesRow(row: Row, filter: UnifiedFilter): boolean {
  if (filter.status !== undefined && row.status !== filter.status) return false;
  if (!filter.query) return true;
  return `${row.title} ${row.preview} ${row.tags.join(" ")}`
    .toLocaleLowerCase()
    .includes(filter.query);
}

/** Person lookup runs for the page only, not for every visible conversation. */
async function toItem(ctx: SocialActionContext, row: Row): Promise<InboxItem> {
  const person =
    row.contactPlatformId === undefined
      ? undefined
      : await ctx.store.findPersonByHandle(row.accountId, row.contactPlatformId);
  return {
    threadId: row.threadId,
    accountId: row.accountId,
    platform: row.platform,
    kind: row.kind,
    ...(person ? { person: { id: person.id, name: person.name } } : {}),
    title: row.title,
    preview: row.preview,
    at: row.at,
    status: row.status,
    tags: row.tags,
  };
}

/**
 * Accounts that give no conversations at all. An account is unreadable only when both inbox and
 * comment reading are unavailable; a partly readable account is not reported.
 */
function unreadableAccounts(
  view: InboxView,
  now: number,
  filter: UnifiedFilter,
): UnreadableAccount[] {
  const result: UnreadableAccount[] = [];
  for (const account of view.accounts) {
    if (!accountMatches(view, account.id, filter)) continue;
    const capabilities = accountCapabilities(account, now);
    const inbox = capabilities.find((item) => item.operation === "inbox.read");
    const comments = capabilities.find((item) => item.operation === "comments.read");
    if (inbox?.status === "available" || comments?.status === "available") continue;
    const source = inbox ?? comments;
    result.push({
      accountId: account.id,
      platform: account.platform,
      reasonCode: source?.reasonCode ?? "unknown",
      reason: source?.reason ?? "",
    });
  }
  return result;
}

/** Owner or assigned principal sets the status and tags of one conversation. Status is data only. */
export async function setInboxStatus(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<{ threadId: string; status: InboxStatus; tags: string[] }> {
  exact(input, ["threadId", "status", "tags"]);
  const view = await loadInboxView(ctx);
  const thread = findVisibleThread(view, str(input.threadId, "conversation"));
  const status = parseStatus(input.status);
  const previous = await readInboxStatus(ctx.store, thread.id);
  const tags = input.tags === undefined ? (previous?.tags ?? []) : parseTags(input.tags);
  await writeInboxStatus(ctx.store, { threadId: thread.id, status, tags, updatedAt: ctx.now() });
  return { threadId: thread.id, status, tags };
}
