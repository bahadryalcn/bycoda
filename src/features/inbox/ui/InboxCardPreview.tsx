import { t, useLocale } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { ClampText } from "../../../shared/ui/ClampText";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Clock, UserRound } from "../../../shared/ui/icons";
import type { InboxItem } from "../model/githubTasks";
import { InboxPerson, inboxLabelItems } from "./InboxPresentation";

/**
 * Hover preview of one inbox row: only what the narrow row cannot show, the full title,
 * assignees, labels and times. Reference, status, project and sessions stay on the row.
 */
export function InboxCardPreview({ item }: { item: InboxItem }) {
  useLocale();
  const updated = Date.parse(item.updatedAt);
  const created = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  const people = item.assignees.slice(0, 3);
  const morePeople = item.assignees.length - people.length;
  const iconClass = "icon-xs shrink-0";
  return (
    <>
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
      <DescriptionList hideTerms size="sm" className="items-center gap-y-1.5">
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
