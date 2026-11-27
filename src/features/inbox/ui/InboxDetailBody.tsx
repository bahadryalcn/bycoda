import type { ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { inboxItemKey, type InboxItem } from "../model/githubTasks";
import { InboxDetail } from "./InboxDetail";

type DetailProps = ComponentProps<typeof InboxDetail>;

/** The Inbox reading pane: the selected item's detail, or a prompt to pick one. */
export function InboxDetailBody({
  item,
  revision = 0,
  ...props
}: Pick<
  DetailProps,
  | "cwd"
  | "projects"
  | "relatedSessions"
  | "onDiscuss"
  | "onStart"
  | "repairSessions"
  | "onRepairChecks"
  | "onOpenSession"
  | "onItemChange"
  | "onJiraStatusChange"
> & { item: InboxItem | null; revision?: number }) {
  useLocale();
  if (!item) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState
          context="page"
          illustration="inbox-empty"
          title={t("Select an inbox item")}
          description={t("Pick an item from the list to see its details here.")}
        />
      </div>
    );
  }
  return <InboxDetail key={inboxItemKey(item)} item={item} revision={revision} {...props} />;
}
