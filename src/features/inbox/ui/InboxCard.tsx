import { memo, useEffect, useRef, useState } from "react";
import { projectName } from "../../../shared/lib/paths";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { MessageMultiple } from "../../../shared/ui/icons";
import {
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  type InboxItem,
} from "../model/githubTasks";
import { prefetchInboxItem } from "../model/inboxPrefetch";
import { useInboxItemUnseen } from "../model/inboxSeen";
import { InboxCardPreview } from "./InboxCardPreview";
import { InboxRelativeTime, hasInboxRelativeTime } from "./InboxRelativeTime";
import { inboxLabelItems, inboxStatusMark } from "./InboxPresentation";

export const InboxCard = memo(function InboxCard({
  item,
  active,
  relatedSessionCount,
  onSelect,
  comfortable = false,
}: {
  item: InboxItem;
  active: boolean;
  relatedSessionCount: number;
  onSelect: (item: InboxItem) => void;
  comfortable?: boolean;
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
    item.kind === "pr"
      ? item.provider === "gitlab"
        ? t("Merge request")
        : t("Pull request")
      : t("Issue");
  const hasTime = hasInboxRelativeTime(item.updatedAt);
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
      ? relatedSessionCount === 1
        ? t("{p0} related thread", { p0: relatedSessionCount })
        : t("{p0} related threads", { p0: relatedSessionCount })
      : "";
  const statusWord = jira
    ? statusLabel
    : `${status.label}${attentionLabel ? ` · ${attentionLabel}` : ""}`;
  const reference = inboxItemRef(item);
  const secondary = [reference, source].filter(Boolean).join(" · ");
  // The status word shows only where it carries more than the icon: a tracker's own workflow
  // status or a code host's attention reason. Every other row shows the icon.
  const showStatusWord = jira || !!attentionLabel;
  const statusMark = (
    <StatusText
      data-inbox-row-metadata=""
      tone={statusTextTone(rowStatus.tone)}
      icon={<rowStatus.Icon strokeWidth={1.75} />}
      className={showStatusWord ? "min-w-0 max-w-[60%] shrink-0" : "shrink-0"}
    >
      {showStatusWord ? (
        <Text as="span" size="inherit" tone="inherit" truncate className="min-w-0">
          {statusWord}
        </Text>
      ) : (
        <span className="sr-only">{statusWord}</span>
      )}
    </StatusText>
  );
  // No title tooltip on the row: the hover card carries the full title and details.
  const hover = useHoverCard({
    side: "right",
    align: "start",
    width: 300,
    "aria-label": item.title,
    className: "grid gap-2",
  });

  return (
    <div ref={visibilityRef}>
      <ActionHost
        selected={active}
        data-seen={unseen ? undefined : "true"}
        className={comfortable ? "w-full min-w-0 flex-col items-stretch gap-0" : "w-full min-w-0"}
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
            `${status.label} ${kindLabel.toLocaleLowerCase()} ${reference}: ${item.title}`,
            source,
            attentionLabel,
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
              truncate={!comfortable}
              lines={comfortable ? 2 : undefined}
              className="min-w-0 flex-1"
            >
              {item.title}
            </Text>
            {hasTime ? (
              <Text as="span" size="micro" tone="secondary" className="shrink-0 tabular-nums">
                <InboxRelativeTime at={item.updatedAt} />
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
            {statusMark}
          </Text>
        </Button>
        {comfortable && item.labels.length > 0 ? (
          <div className="min-w-0 px-2 pb-2">
            {/* ui-drift-ignore: row-text-badge -- the provider's own issue labels are the row's content, not a status tag; they carry the provider color dot. */}
            <BadgeList label={t("Labels")} size="xs" items={inboxLabelItems(item.labels)} />
          </div>
        ) : null}
        {hover.card(() => (
          <InboxCardPreview item={item} />
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
