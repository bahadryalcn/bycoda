import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { ClampText } from "../../../shared/ui/ClampText";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import {
  CircleAlert,
  Clock,
  FolderTree,
  MessageMultiple,
  UserRound,
} from "../../../shared/ui/icons";
import type { InboxItem } from "../model/githubTasks";
import { InboxPerson, inboxLabelItems } from "./InboxPresentation";
import { InboxProviderMark } from "./InboxProviderMark";

/**
 * Hover preview of one inbox row: the full title, reference, source, people, labels and
 * times the narrow row cannot show. Everything here is also in the item's detail view.
 */
export function InboxCardPreview({
  item,
  reference,
  kindLabel,
  source,
  status,
  attention,
  sessionLabel,
}: {
  item: InboxItem;
  reference: string;
  kindLabel: string;
  source: string;
  /** The row's status mark (StatusText), reused so both read the same. */
  status: ReactNode;
  attention: string;
  sessionLabel: string;
}) {
  useLocale();
  const updated = Date.parse(item.updatedAt);
  const created = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  const people = item.assignees.slice(0, 3);
  const morePeople = item.assignees.length - people.length;
  const iconClass = "icon-xs shrink-0";
  return (
    <>
      <Text as="div" size="caption" tone="secondary" className="flex min-w-0 items-center gap-1.5">
        <InboxProviderMark provider={item.provider} tone="secondary" className={iconClass} />
        <Text as="span" size="inherit" tone="primary" weight="medium" className="shrink-0">
          {reference}
        </Text>
        <Text as="span" size="inherit" tone="muted" truncate className="min-w-0 flex-1">
          {kindLabel}
        </Text>
        <span className="min-w-0 shrink">{status}</span>
      </Text>
      <ClampText
        as="p"
        lines={3}
        expandable={false}
        size="secondary"
        tone="primary"
        weight="medium"
        leading="snug"
        dir="auto"
        className="break-words"
      >
        {item.title}
      </ClampText>
      {/* Every row shares one icon column, so values line up like the session preview. */}
      <DescriptionList hideTerms size="sm" className="items-center gap-y-1.5">
        {source ? (
          <DescriptionItem
            term={t("Project")}
            icon={<FolderTree className={iconClass} strokeWidth={1.75} />}
          >
            <Text as="span" truncate size="inherit" tone="primary" className="min-w-0">
              {source}
            </Text>
          </DescriptionItem>
        ) : null}
        <DescriptionItem
          term={t("Assignees")}
          icon={<UserRound className={iconClass} strokeWidth={1.75} />}
        >
          {people.length ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              {people.map((person) => (
                <InboxPerson
                  key={person.accountId ?? person.login}
                  name={person.login}
                  avatarUrl={person.avatarUrl}
                  size="sm"
                  className="max-w-full"
                />
              ))}
              {morePeople > 0 ? (
                <Text as="span" size="inherit" tone="muted">
                  +{morePeople}
                </Text>
              ) : null}
            </span>
          ) : (
            <Text as="span" size="inherit" tone="muted">
              {t("Unassigned")}
            </Text>
          )}
        </DescriptionItem>
        {attention ? (
          <DescriptionItem
            term={t("Status")}
            icon={<CircleAlert className={iconClass} strokeWidth={1.75} />}
          >
            <Text as="span" size="inherit" tone="primary">
              {attention}
            </Text>
          </DescriptionItem>
        ) : null}
        {sessionLabel ? (
          <DescriptionItem
            term={t("Sessions")}
            icon={<MessageMultiple className={iconClass} strokeWidth={1.75} />}
          >
            <Text as="span" size="inherit" tone="primary">
              {sessionLabel}
            </Text>
          </DescriptionItem>
        ) : null}
      </DescriptionList>
      {item.labels.length ? (
        <BadgeList
          items={inboxLabelItems(item.labels)}
          label={t("Labels")}
          size="xs"
          rows={2}
          className="[--badge-list-item-max:12rem]"
        />
      ) : null}
      {Number.isFinite(updated) ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          {...surfaceAttributes(
            { frame: "pane", edge: "top" },
            "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-2",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
            <Clock className={iconClass} strokeWidth={1.75} />
            <Timestamp value={updated} prefix={t("Updated")} />
          </span>
          {Number.isFinite(created) ? (
            <Timestamp
              value={created}
              format="date"
              prefix={t("Created")}
              tone="muted"
              className="tabular-nums"
            />
          ) : null}
        </Text>
      ) : null}
    </>
  );
}
