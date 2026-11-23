import { useFormat, useT } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { Text } from "../../../shared/ui/Text";
import type { OwnerRequestRow as Row } from "./useOwnerNotifications";
import { usePresentationNow } from "./AgentClock";

/** Remaining milliseconds until the deadline, on the shared presentation clock (display only). */
function useRemaining(deadline: number): number {
  return deadline - usePresentationNow(true);
}

/**
 * A live approval or secret request in the pending card. It shows the title and the time left
 * only; the request is answered where it opens (its conversation or the shared confirmation).
 */
export function OwnerRequestRow({ row, onOpen }: { row: Row; onOpen: (row: Row) => void }) {
  const t = useT();
  const { formatDuration } = useFormat();
  const remaining = useRemaining(row.deadline);
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
      </Button>
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="notification-request-meta notification-request-footer px-3 pb-2"
      >
        <span className="notification-request-source">
          {t("{p0} left", {
            p0: formatDuration(Math.ceil(remaining / 1000) * 1000, { style: "clock" }),
          })}
        </span>
      </Text>
    </ActionHost>
  );
}
