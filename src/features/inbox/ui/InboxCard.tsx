import { memo, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { projectName } from "../../../shared/lib/paths";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { MessageMultiple } from "../../../shared/ui/icons";
import { ProjectLogoIcon } from "../../projects/public/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import {
  formatRelativeTime,
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  type InboxItem,
} from "../model/githubTasks";
import { prefetchInboxItem } from "../model/inboxPrefetch";
import { useInboxItemUnseen } from "../model/inboxSeen";
import { inboxLabelItems, inboxStatusMark } from "./InboxPresentation";
import { InboxStatusBadge } from "./InboxStatusBadge";

export const InboxCard = memo(function InboxCard({
  item,
  active,
  logoPath,
  mascotName,
  mascotColor,
  relatedSessionCount,
  onSelect,
}: {
  item: InboxItem;
  active: boolean;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
  relatedSessionCount: number;
  onSelect: (item: InboxItem) => void;
}) {
  useLocale();
  const visibilityRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const entryKey = inboxItemKey(item);
  const unseen = useInboxItemUnseen({ key: entryKey, updatedAt: item.updatedAt }, visible);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync unread subscription with the row viewport observer.
  useEffect(() => {
    const element = visibilityRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      const update = () => {
        const bounds = element.getBoundingClientRect();
        setVisible(bounds.bottom >= -300 && bounds.top <= window.innerHeight + 300);
      };
      update();
      window.addEventListener("scroll", update, true);
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("scroll", update, true);
        window.removeEventListener("resize", update);
      };
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "300px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const status = inboxStatusMark(item);
  const kindLabel =
    item.kind === "pr" ? (item.provider === "gitlab" ? "Merge request" : "Pull request") : "Issue";
  const time = formatRelativeTime(item.updatedAt);
  const name = projectName(item.projectPath);
  const tracker = item.provider === "linear" || item.provider === "jira";
  const jira = item.provider === "jira";
  const category = item.stateType?.trim().toLowerCase();
  const rowStatus = jira
    ? {
        ...status,
        tone:
          category === "done"
            ? ("success" as const)
            : category === "indeterminate"
              ? ("info" as const)
              : ("neutral" as const),
      }
    : status;
  const statusLabel =
    jira && item.state === item.state.toUpperCase()
      ? item.state.charAt(0) + item.state.slice(1).toLowerCase()
      : item.state;
  const source = tracker ? item.teamName || item.repo : item.repo || name;
  const attentionLabel =
    item.provider === "gitlab" || item.provider === "azuredevops"
      ? gitlabAttentionLabel(item.attentionReason ?? "")
      : "";

  // The label badges hold their own "+N" button, which cannot sit inside the row button: with
  // labels the source line is a sibling laid over the row (clicks outside the badges fall through
  // to the row) and the row keeps the line's height.
  const sourceLine = (
    <Text
      size="micro"
      tone={jira ? "muted" : "secondary"}
      className="flex min-w-0 flex-1 items-center gap-1.5"
    >
      {tracker || !item.projectPath ? null : logoPath ? (
        <ProjectLogoIcon path={logoPath} className="icon-sm shrink-0" imageClassName="icon-sm" />
      ) : (
        <ProjectMascot
          project={name}
          color={mascotColor}
          name={mascotName}
          className="icon-xs shrink-0"
        />
      )}
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {source}
      </Text>
    </Text>
  );

  return (
    <div ref={visibilityRef}>
      <ActionHost selected={active} className="w-full min-w-0">
        <Button
          variant="item"
          layout="stacked"
          className="w-full min-w-0"
          type="button"
          tooltip={item.title}
          tooltipWhen="overflow"
          aria-current={active ? "true" : undefined}
          selected={active}
          aria-label={[
            `${t(status.label)} ${t(kindLabel).toLocaleLowerCase()} ${inboxItemRef(item)}: ${item.title}`,
            source,
            attentionLabel ? t(attentionLabel) : "",
            unseen ? t("Unread") : "",
            item.labels.map((label) => label.name).join(", "),
            relatedSessionCount > 0
              ? t(relatedSessionCount === 1 ? "{p0} related thread" : "{p0} related threads", {
                  p0: relatedSessionCount,
                })
              : "",
          ]
            .filter(Boolean)
            .join(", ")}
          onClick={() => onSelect(item)}
          onMouseEnter={() => prefetchInboxItem(item)}
          onFocus={() => prefetchInboxItem(item)}
        >
          <ClampText
            as="span"
            lines={2}
            expandable={false}
            size="secondary"
            tone="neutral"
            weight={unseen ? "medium" : "regular"}
            leading="snug"
            className="min-w-0 wrap-anywhere"
          >
            {item.title}
          </ClampText>
          <span data-inbox-row-metadata className="flex min-w-0 items-start gap-2">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {jira ? (
                <>
                  <Text size="micro" tone="secondary" className="shrink-0">
                    {inboxItemRef(item)}
                  </Text>
                  <span className="flex min-w-0 max-w-full">
                    <InboxStatusBadge mark={rowStatus} label={statusLabel} />
                  </span>
                </>
              ) : (
                <>
                  <Badge
                    size="xs"
                    tone={status.tone}
                    appearance="subtle"
                    icon={<status.Icon strokeWidth={1.75} />}
                    aria-hidden="true"
                  />
                  <Text size="micro" tone="secondary" truncate className="min-w-0">
                    {t(kindLabel)} {inboxItemRef(item)} · {tracker ? item.state : t(status.label)}
                    {attentionLabel ? ` · ${t(attentionLabel)}` : ""}
                  </Text>
                </>
              )}
            </span>
            {relatedSessionCount > 0 || time || unseen ? (
              <span className="flex shrink-0 items-center gap-1.5">
                {relatedSessionCount > 0 ? (
                  <Tooltip
                    label={t(
                      relatedSessionCount === 1 ? "{p0} related thread" : "{p0} related threads",
                      { p0: relatedSessionCount },
                    )}
                    asChild
                  >
                    <Badge
                      variant="count"
                      size="xs"
                      icon={<MessageMultiple className="icon-xs" strokeWidth={1.75} />}

                      className="shrink-0"
                    >
                      {relatedSessionCount}
                    </Badge>
                  </Tooltip>
                ) : null}
                {time ? (
                  <Text size="micro" tone="secondary" className="whitespace-nowrap tabular-nums">
                    {time}
                  </Text>
                ) : null}
                {unseen ? <StatusDot data-inbox-unread tone="accent" label={t("Unread")} /> : null}
              </span>
            ) : null}
          </span>
          {item.labels.length > 0 ? (
            <span aria-hidden="true" className="mt-1 block h-4" />
          ) : (
            <span className="mt-1 flex min-w-0 items-center gap-2">{sourceLine}</span>
          )}
        </Button>
        {item.labels.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-[calc(var(--space-3)+1px)] bottom-[calc(var(--space-2)+1px)] flex h-4 items-center gap-2">
            {sourceLine}
            <span className="pointer-events-auto min-w-0 w-[45%] shrink-0 [&>div>ul]:justify-end">
              <BadgeList label={t("Labels")} size="xs" items={inboxLabelItems(item.labels)} />
            </span>
          </div>
        ) : null}
      </ActionHost>
    </div>
  );
});
