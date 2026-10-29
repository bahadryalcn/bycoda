import type { LinkedWorkItem } from "../../sessions/model/session";
import { inboxItemMatchesLinkedWorkItem } from "../../sessions/model/sessionWorkItem";
import { filterCodeHostScopes, type CodeHostScopes } from "./codeHostScopes";
import type { InboxItem } from "./githubTasks";
import { applyInboxFilters, type InboxFilters, type InboxSource } from "./inboxFilters";

export type VisibleInboxItemsInput = {
  items: readonly InboxItem[];
  pullRequestsOnly: boolean;
  prSort: string;
  filters: InboxFilters;
  search: string;
  source: InboxSource;
  sourceAvailable: boolean;
  codeScopes: {
    provider: "gitlab" | "azuredevops" | null;
    scopes: CodeHostScopes | null;
    hidden: string[];
  };
  /** Linked session destination that stays listed even when filters would hide it. */
  target: LinkedWorkItem | null;
  /** The target looked up exactly when it is not in the loaded list. */
  targetItem: InboxItem | null;
  now: number;
};

/**
 * Rows shown in the Inbox list: provider and user filters, hidden code host
 * scopes, the pull request ordering and the linked target kept on top.
 */
export function visibleInboxItems({
  items,
  pullRequestsOnly,
  prSort,
  filters,
  search,
  source,
  sourceAvailable,
  codeScopes,
  target,
  targetItem,
  now,
}: VisibleInboxItemsInput): InboxItem[] {
  if (!sourceAvailable) return [];
  const visible = filterCodeHostScopes(
    applyInboxFilters(
      pullRequestsOnly ? items.filter((item) => item.kind === "pr") : items,
      filters,
      search,
      now,
      source,
    ),
    codeScopes.provider,
    codeScopes.scopes,
    codeScopes.hidden,
  );
  if (pullRequestsOnly)
    return [...visible].sort((a, b) =>
      prSort === "title"
        ? a.title.localeCompare(b.title)
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  if (!target || source !== "github") return visible;
  const targeted =
    items.find((item) => inboxItemMatchesLinkedWorkItem(item, target)) ??
    (targetItem && inboxItemMatchesLinkedWorkItem(targetItem, target) ? targetItem : null);
  if (!targeted || visible.includes(targeted)) return visible;
  return [targeted, ...visible];
}
