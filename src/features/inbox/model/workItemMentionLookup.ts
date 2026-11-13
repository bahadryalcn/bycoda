import type { InboxItem, InboxProvider } from "./githubTasks";
import {
  findWorkItemMentions,
  peekWorkItemMentionCandidates,
  workItemMentionCandidates,
  workItemMentionToken,
  type WorkItemMention,
} from "./workItemMentions";

// shortcut: session-lifetime memory of picked rows, cleared on reload; persist with the
// message if transcript chips must open instantly after a restart.
const picked = new Map<string, InboxItem>();

function mentionKey(mention: Pick<WorkItemMention, "provider" | "ref">): string {
  return `${mention.provider}:${mention.ref.toLowerCase()}`;
}

/** Parses one `@alias:ref` token; `null` when the alias names no provider. */
export function parseWorkItemMentionToken(token: string): WorkItemMention | null {
  return findWorkItemMentions(token.trim())[0] ?? null;
}

/** Remembers a row picked in the composer so its chip opens without a provider read. */
export function rememberWorkItemMention(item: InboxItem): void {
  const mention = parseWorkItemMentionToken(`@${workItemMentionToken(item)}`);
  if (mention) picked.set(mentionKey(mention), item);
}

/** Whether `item` is the work item the token names; repository-less refs match any repo. */
export function workItemMatchesMention(
  item: InboxItem,
  mention: Pick<WorkItemMention, "provider" | "ref">,
): boolean {
  if (item.provider !== mention.provider) return false;
  if (mention.provider === "jira" || mention.provider === "linear")
    return item.identifier?.toLowerCase() === mention.ref.toLowerCase();
  const match = /^(?:(.+)([#!])|#?)(\d+)$/.exec(mention.ref);
  if (!match || item.number !== Number(match[3])) return false;
  if (match[1] && item.repo.toLowerCase() !== match[1].toLowerCase()) return false;
  if (mention.provider === "gitlab" && match[2])
    return item.kind === (match[2] === "!" ? "pr" : "issue");
  return true;
}

function searchText(provider: InboxProvider, ref: string): string {
  if (provider === "jira" || provider === "linear") return ref;
  return /(\d+)$/.exec(ref)?.[1] ?? ref;
}

/** Synchronous hit from picked rows or cached Inbox lists. */
export function peekWorkItemMention(token: string, cwd: string): InboxItem | null {
  const mention = parseWorkItemMentionToken(token);
  if (!mention) return null;
  return (
    picked.get(mentionKey(mention)) ??
    peekWorkItemMentionCandidates(cwd, mention.provider).find((item) =>
      workItemMatchesMention(item, mention),
    ) ??
    null
  );
}

/** Finds the Inbox item behind a chat token; `null` when the provider has no match. */
export async function lookupWorkItemMention(
  token: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<InboxItem | null> {
  const known = peekWorkItemMention(token, cwd);
  if (known) return known;
  const mention = parseWorkItemMentionToken(token);
  if (!mention) return null;
  const found = await workItemMentionCandidates(
    cwd,
    mention.provider,
    searchText(mention.provider, mention.ref),
    [mention.provider],
    signal,
  );
  const item = found.find((entry) => workItemMatchesMention(entry, mention)) ?? null;
  if (item) picked.set(mentionKey(mention), item);
  return item;
}
