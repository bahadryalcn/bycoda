import type { ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Inbox } from "../../../shared/ui/icons";
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
> & { item: InboxItem | null; revision?: number }) {
  useLocale();
  if (!item) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState icon={<Inbox aria-hidden="true" />} description={t("Select an inbox item")} />
      </div>
    );
  }
  return <InboxDetail key={inboxItemKey(item)} item={item} revision={revision} {...props} />;
}
