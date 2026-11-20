import type { LinkedWorkItem } from "../../sessions/model/session";
import { inboxItemMatchesLinkedWorkItem } from "../../sessions/model/sessionWorkItem";
import { filterCodeHostScopes, type CodeHostScopes } from "./codeHostScopes";
import type { InboxItem } from "./githubTasks";
import { applyInboxFilters, type InboxFilters, type InboxSource } from "./inboxFilters";

export type VisibleInboxItemsInput = {
  items: readonly InboxItem[];
  pullRequestsOnly: boolean;
  githubKind?: "issue" | "pr" | null;
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
  githubKind,
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
  const kind = pullRequestsOnly ? "pr" : source === "github" ? githubKind : null;
  const visible = filterCodeHostScopes(
    applyInboxFilters(
      kind ? items.filter((item) => item.kind === kind) : items,
      filters,
      search,
      now,
      source,
    ),
    codeScopes.provider,
    codeScopes.scopes,
    codeScopes.hidden,
  );
  const ordered =
    pullRequestsOnly || githubKind
      ? [...visible].sort((a, b) =>
          prSort === "title"
            ? a.title.localeCompare(b.title)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        )
      : visible;
  if (pullRequestsOnly || !target || source !== "github" || (kind && target.kind !== kind))
    return ordered;
  const targeted =
    items.find((item) => inboxItemMatchesLinkedWorkItem(item, target)) ??
    (targetItem && inboxItemMatchesLinkedWorkItem(targetItem, target) ? targetItem : null);
  if (!targeted || ordered.includes(targeted)) return ordered;
  return [targeted, ...ordered];
}
