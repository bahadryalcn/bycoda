import type { Ref } from "react";
import { useT } from "../../../shared/i18n";
import { Bot, Trash2 } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { delegationNoticeSections } from "../model/delegationNotice";
import type { QueuedMessage } from "../model/session";

/**
 * A subagent notice waiting in the queue. The Host wrote it, not the owner, so it has no
 * reorder handle and no edit; it can only be removed.
 */
export function QueuedDelegationRow({
  message,
  itemRef,
  disabled,
  disabledReason,
  onRemove,
}: {
  message: QueuedMessage;
  itemRef: Ref<HTMLDivElement>;
  disabled: boolean;
  /** Shown while `disabled`, naming why the notice cannot be removed. */
  disabledReason?: string;
  onRemove: () => void;
}) {
  const t = useT();
  if (message.author?.kind !== "delegation") return null;
  const sections = delegationNoticeSections(message.text, message.author);
  const titles = [...new Set(sections.map((section) => section.title).filter(Boolean))].join(", ");
  const count = sections.length;
  const completions = sections.every((section) => section.reason === "completion");
  const label = completions
    ? count === 1
      ? t("1 subagent result waiting")
      : t("{p0} subagent results waiting", { p0: count })
    : count === 1
      ? t("1 subagent message waiting")
      : t("{p0} subagent messages waiting", { p0: count });
  return (
    <Text
      ref={itemRef}
      as="div"
      size="caption"
      tone="inherit"
      data-queue-notice={message.id}
      className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 ps-1"
    >
      <Bot className="icon-sm shrink-0" aria-hidden />
      <OverflowTooltip label={titles || label}>
        <Text as="div" size="inherit" tone="secondary" truncate>
          {label}
          {titles ? (
            <Text size="inherit" tone="muted">
              {" · "}
              {titles}
            </Text>
          ) : null}
        </Text>
      </OverflowTooltip>
      <Button
        variant="ghost"
        iconOnly
        label={t("Remove queued message")}
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={onRemove}
      >
        <Trash2 className="icon-sm" />
      </Button>
    </Text>
  );
}
