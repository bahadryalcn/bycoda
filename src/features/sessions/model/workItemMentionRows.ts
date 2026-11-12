import type { RankedFile } from "../../files";
import {
  parseWorkItemQuery,
  rankWorkItemMentions,
  workItemAliasHints,
  workItemMentionToken,
  type InboxItem,
  type InboxProvider,
} from "../../inbox/public/workItemMentions";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";

export const WORK_ITEM_MENTION_PREFIX = "work-item/";
export const WORK_ITEM_HINT_PREFIX = "work-item-hint/";

export const WORK_ITEM_PROVIDER_NAMES: Readonly<Record<InboxProvider, string>> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear",
  gitlab: "GitLab",
  azuredevops: "Azure DevOps",
};

export type WorkItemMentionTarget =
  | { kind: "item"; provider: InboxProvider; item: InboxItem; token: string }
  | { kind: "hint"; provider: InboxProvider; aliases: readonly string[]; token: string };

export type WorkItemMentionRow = RankedFile & { workItem: WorkItemMentionTarget };

export function workItemMentionOf(file: { path: string }): WorkItemMentionTarget | undefined {
  return (file as Partial<WorkItemMentionRow>).workItem;
}

/** Connected aliases remain discoverable; explicit aliases scope results to one provider. */
export function workItemMentionRows(
  items: readonly InboxItem[],
  query: string,
  connected: readonly InboxProvider[],
): WorkItemMentionRow[] {
  const parsed = parseWorkItemQuery(query);
  if (parsed && !connected.includes(parsed.provider)) return [];
  const hints: WorkItemMentionRow[] = parsed
    ? []
    : workItemAliasHints(query, connected).map((hint) => ({
        name: WORK_ITEM_PROVIDER_NAMES[hint.provider],
        path: `${WORK_ITEM_HINT_PREFIX}${hint.provider}`,
        relative: `${hint.aliases[0]}:`,
        score: 0,
        positions: [],
        workItem: {
          kind: "hint",
          provider: hint.provider,
          aliases: hint.aliases,
          token: `${hint.aliases[0]}:`,
        },
      }));
  if (!parsed && !query.trim()) return hints;
  const needle = parsed?.rest ?? query;
  const ranked = rankWorkItemMentions(
    items.filter((item) => connected.includes(item.provider)),
    needle,
    parsed?.provider,
  ).slice(0, 10 - hints.length);
  return [
    ...hints,
    ...ranked.map((item): WorkItemMentionRow => {
      const token = workItemMentionToken(item);
      const name = `${item.identifier ?? `#${item.number}`} ${item.title}`;
      return {
        name,
        path: `${WORK_ITEM_MENTION_PREFIX}${token}`,
        relative: token,
        score: 0,
        positions: fuzzyMatch(needle, name)?.positions ?? [],
        workItem: { kind: "item", provider: item.provider, item, token },
      };
    }),
  ];
}
