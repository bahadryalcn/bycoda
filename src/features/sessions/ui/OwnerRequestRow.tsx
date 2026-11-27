import { useFormat, useT } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { ArrowRight, Chatting } from "../../../shared/ui/icons";
import { NoticeGlyph } from "../../../shared/ui/Notice";
import { Text } from "../../../shared/ui/Text";
import type { OwnerRequestRow as Row } from "./useOwnerNotifications";
import { usePresentationNow } from "./AgentClock";
import { OwnerRequestSource } from "./OwnerRequestSource";

/** Remaining milliseconds until the deadline, on the shared presentation clock (display only). */
function useRemaining(deadline: number): number {
  return deadline - usePresentationNow(true);
}

/**
 * A live approval or secret request in the pending card: what it asks on top, the project and
 * conversation (or Assistant Room) that asked, then the time left beside its actions. The card
 * and Go take the owner to whoever asked; Answer opens the request in the shared dialog.
 */
export function OwnerRequestRow({
  row,
  onOpen,
  onAnswer,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  /** Opens an approval in the shared dialog; secret inputs show no Answer. */
  onAnswer: (row: Row) => void;
}) {
  const t = useT();
  const { formatDuration } = useFormat();
  const remaining = useRemaining(row.deadline);
  const canGo = Boolean(row.sessionId || row.threadId);
  return (
    <ActionHost
      as="article"
      variant="row"
      className="notification-request notification-owner-request flex-col items-stretch gap-0 overflow-clip"
    >
      <Button
        fullWidth
        variant="item"
        layout="stacked"
        type="button"
        onClick={() => onOpen(row)}
        className="notification-request-body"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <NoticeGlyph tone="warning" size="box" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <ClampText
              as="span"
              lines={2}
              expandable={false}
              size="secondary"
              tone="neutral"
              weight="medium"
              leading="snug"
              className="notification-request-title"
            >
              {row.title}
            </ClampText>
            <Text as="span" size="caption" tone="secondary" leading="inherit" className="min-w-0">
              <OwnerRequestSource sessionId={row.sessionId} threadId={row.threadId} cwd={row.cwd} />
            </Text>
          </span>
        </span>
      </Button>
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="notification-request-meta notification-request-footer ps-10 pe-3 pb-2"
      >
        <span className="tabular-nums">
          {t("{p0} left", {
            p0: formatDuration(Math.ceil(remaining / 1000) * 1000, { style: "clock" }),
          })}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-1">
          {canGo ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              startIcon={<ArrowRight className="icon-sm" />}
              onClick={() => onOpen(row)}
            >
              {t("Go")}
            </Button>
          ) : null}
          {row.kind === "approval" ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              startIcon={<Chatting className="icon-sm" />}
              onClick={() => onAnswer(row)}
            >
              {t("Answer")}
            </Button>
          ) : null}
        </span>
      </Text>
    </ActionHost>
  );
}
