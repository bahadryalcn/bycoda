import { memo } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { MESSAGING_PROVIDER_LABELS, threadKey, threadUnread } from "../model/messageThreads";
import type { MessageThread } from "../model/messagingTypes";
import { MessagingProviderMark } from "./MessagingProviderMark";

const PREVIEW_GRAPHEMES = 160;
const PARTICIPANTS_GRAPHEMES = 80;

const MessageThreadRow = memo(function MessageThreadRow({
  thread,
  active,
  accountLabel,
  now,
  onSelect,
}: {
  thread: MessageThread;
  active: boolean;
  accountLabel: string | null;
  now: number;
  onSelect: (thread: MessageThread) => void;
}) {
  const locale = useLocale();
  const unread = threadUnread(thread);
  const time =
    thread.updatedAt > 0 && now > 0
      ? formatRelativeTime(thread.updatedAt, { locale, style: "short", now })
      : "";
  const title = thread.title || t("(No subject)");
  const preview = truncateGraphemes(thread.preview.replace(/\s+/g, " ").trim(), PREVIEW_GRAPHEMES);
  const participants = truncateGraphemes(thread.participants.join(", "), PARTICIPANTS_GRAPHEMES);
  const source = [participants, accountLabel].filter(Boolean).join(" · ");
  const provider = t(MESSAGING_PROVIDER_LABELS[thread.provider]);
  return (
    <ActionHost selected={active} className="w-full min-w-0">
      <Button
        variant="item"
        layout="stacked"
        className="w-full min-w-0"
        type="button"
        tooltip={thread.title}
        tooltipWhen="overflow"
        aria-current={active ? "true" : undefined}
        selected={active}
        aria-label={[provider, title, source, preview, time, unread ? t("Unread") : ""]
          .filter(Boolean)
          .join(", ")}
        onClick={() => onSelect(thread)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <MessagingProviderMark
            provider={thread.provider}
            className="block icon-sm shrink-0 text-(--ui-text-secondary)"
          />
          <span
            dir="auto"
            className={`min-w-0 flex-1 truncate text-ui-secondary leading-snug text-(--ui-tone-neutral-fg) ${unread ? "font-medium" : "font-normal"}`}
          >
            {title}
          </span>
          {time ? (
            <span className="shrink-0 text-ui-micro tabular-nums text-(--ui-text-secondary)">
              {time}
            </span>
          ) : null}
          {unread ? <StatusDot tone="accent" label={t("Unread")} /> : null}
        </span>
        {preview ? (
          <span
            dir="auto"
            className="min-w-0 line-clamp-2 wrap-anywhere text-ui-micro text-(--ui-text-secondary)"
          >
            {preview}
          </span>
        ) : null}
        {source ? (
          <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
            {source}
          </span>
        ) : null}
      </Button>
    </ActionHost>
  );
});

export function MessageThreadList({
  threads,
  selectedKey,
  stateKey,
  accountLabels,
  onSelect,
}: {
  threads: readonly MessageThread[];
  selectedKey: string | null;
  stateKey: string;
  /** Account names to show per row; null when only one account exists. */
  accountLabels: ReadonlyMap<string, string> | null;
  onSelect: (thread: MessageThread) => void;
}) {
  useLocale();
  // Reads 0 before it subscribes (server render); rows then omit the time.
  const now = useMinuteNow();
  return (
    <ContinuousList
      fill
      className="p-1.5 overscroll-none"
      label={t("Conversations")}
      items={threads}
      stateKey={stateKey}
      itemKey={threadKey}
      requiredKey={selectedKey}
      estimateSize={72}
      renderItem={(thread) => (
        <div role="listitem">
          <MessageThreadRow
            thread={thread}
            active={threadKey(thread) === selectedKey}
            accountLabel={accountLabels?.get(thread.accountId) ?? null}
            now={now}
            onSelect={onSelect}
          />
        </div>
      )}
    />
  );
}
