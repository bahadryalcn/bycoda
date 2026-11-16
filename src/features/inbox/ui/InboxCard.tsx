import { memo, useEffect, useRef, useState } from "react";
import { projectName } from "../../../shared/lib/paths";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { MessageMultiple } from "../../../shared/ui/icons";
import {
  formatRelativeTime,
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  type InboxItem,
} from "../model/githubTasks";
import { prefetchInboxItem } from "../model/inboxPrefetch";
import { useInboxItemUnseen } from "../model/inboxSeen";
import { InboxCardPreview } from "./InboxCardPreview";
import { inboxStatusMark } from "./InboxPresentation";

export const InboxCard = memo(function InboxCard({
  item,
  active,
  relatedSessionCount,
  onSelect,
}: {
  item: InboxItem;
  active: boolean;
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
  const source = tracker ? item.teamName || item.repo : item.repo || projectName(item.projectPath);
  const attentionLabel =
    item.provider === "gitlab" || item.provider === "azuredevops"
      ? gitlabAttentionLabel(item.attentionReason ?? "")
      : "";

  const sessionLabel =
    relatedSessionCount > 0
      ? t(relatedSessionCount === 1 ? "{p0} related thread" : "{p0} related threads", {
          p0: relatedSessionCount,
        })
      : "";
  const statusWord = jira
    ? statusLabel
    : `${t(status.label)}${attentionLabel ? ` · ${t(attentionLabel)}` : ""}`;
  const reference = inboxItemRef(item);
  const secondary = [reference, source].filter(Boolean).join(" · ");
  const statusMark = (rowMetadata?: boolean) => (
    <StatusText
      data-inbox-row-metadata={rowMetadata ? "" : undefined}
      tone={statusTextTone(rowStatus.tone)}
      icon={<rowStatus.Icon strokeWidth={1.75} />}
      className={rowMetadata ? "min-w-0 max-w-[60%] shrink-0" : "min-w-0 max-w-full"}
    >
      <Text as="span" size="inherit" tone="inherit" truncate className="min-w-0">
        {statusWord}
      </Text>
    </StatusText>
  );
  // No title tooltip on the row: the hover card carries the full title and details.
  const hover = useHoverCard({
    side: "right",
    align: "start",
    width: 300,
    "aria-label": item.title,
    className: "grid gap-2 p-3",
  });

  return (
    <div ref={visibilityRef}>
      <ActionHost
        selected={active}
        data-seen={unseen ? undefined : "true"}
        className="w-full min-w-0"
      >
        <Button
          variant="item"
          layout="stacked"
          type="button"
          className="w-full min-w-0 gap-0.5"
          {...hover.trigger}
          aria-current={active ? "true" : undefined}
          selected={active}
          aria-label={[
            `${t(status.label)} ${t(kindLabel).toLocaleLowerCase()} ${reference}: ${item.title}`,
            source,
            attentionLabel ? t(attentionLabel) : "",
            unseen ? t("Unread") : "",
            item.labels.map((label) => label.name).join(", "),
            sessionLabel,
          ]
            .filter(Boolean)
            .join(", ")}
          onMouseEnter={() => prefetchInboxItem(item)}
          onFocus={(event) => {
            hover.trigger.onFocus(event);
            prefetchInboxItem(item);
          }}
          onClick={() => {
            hover.close();
            onSelect(item);
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Text
              as="span"
              dir="auto"
              size="secondary"
              tone="primary"
              leading="snug"
              weight={unseen ? "medium" : "regular"}
              truncate
              className="min-w-0 flex-1"
            >
              {item.title}
            </Text>
            {time ? (
              <Text as="span" size="micro" tone="secondary" className="shrink-0 tabular-nums">
                {time}
              </Text>
            ) : null}
            {unseen ? <StatusDot data-inbox-unread tone="accent" label={t("Unread")} /> : null}
          </span>
          <Text
            as="span"
            size="micro"
            tone="secondary"
            className="flex min-w-0 items-center gap-1.5"
          >
            <Text as="span" size="inherit" tone="muted" truncate className="min-w-0 flex-1">
              {secondary}
            </Text>
            {relatedSessionCount > 0 ? (
              <Badge
                variant="count"
                size="xs"
                icon={<MessageMultiple className="icon-xs" strokeWidth={1.75} />}
                className="shrink-0"
              >
                {relatedSessionCount}
              </Badge>
            ) : null}
            {statusMark(true)}
          </Text>
        </Button>
        {hover.card(() => (
          <InboxCardPreview
            item={item}
            reference={reference}
            kindLabel={t(kindLabel)}
            source={source}
            status={statusMark()}
            attention={attentionLabel ? t(attentionLabel) : ""}
            sessionLabel={sessionLabel}
          />
        ))}
      </ActionHost>
    </div>
  );
});

function statusTextTone(tone: BadgeTone): StatusTextTone {
  if (tone === "success") return "done";
  if (tone === "danger") return "failed";
  if (tone === "info") return "running";
  if (tone === "warning") return "needs-you";
  return "idle";
}
