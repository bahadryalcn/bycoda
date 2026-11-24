import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useId, useRef } from "react";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";

import type { DeliveryReviewOutcome } from "../model/deliveryReview";

export type { DeliveryReviewOutcome };

/**
 * The one inline decision for a send nobody confirmed. It never replays the
 * request by itself: "Send again" is the owner saying it did not arrive.
 * The duplicate risk is written out as text, and "Send again" is not offered
 * while the provider call may still answer (`lateSettlement`).
 */
export function DeliveryReviewChoice({
  text,
  working,
  lateSettlement = false,
  focusRequest,
  onChoose,
}: {
  text?: string;
  working: boolean;
  /** The provider has not answered yet: it may still deliver the message. */
  lateSettlement?: boolean;
  /** Increments when Resume asks the owner to choose. */
  focusRequest: number;
  onChoose: (outcome: DeliveryReviewOutcome) => void;
}) {
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);
  const warning = useId();
  const retryHint = t(
    "Check the conversation first. Sending again duplicates a message that was delivered. Keeping it queued pauses the queue and does not resend it.",
  );
  useEffect(() => {
    if (focusRequest > 0) first.current?.focus();
  }, [focusRequest]);
  return (
    <div className="mt-1.5" data-delivery-review>
      {text ? (
        <OverflowTooltip label={text}>
          <Text
            as="div"
            size="caption"
            tone="secondary"
            truncate
            {...surfaceAttributes(
              { frame: "card", radius: "control" },
              "min-w-0 max-w-full px-2.5 py-1.5",
            )}
          >
            {text}
          </Text>
        </OverflowTooltip>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          ref={first}
          size="sm"
          variant="secondary"
          disabled={working}
          onClick={() => onChoose("delivered")}
        >
          {t("Mark as delivered")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={working || lateSettlement}
          aria-describedby={warning}
          onClick={() => onChoose("retry")}
        >
          {t("Send again")}
        </Button>
        <Button size="sm" variant="ghost" disabled={working} onClick={() => onChoose("keep")}>
          {t("Keep queued, pause")}
        </Button>
        <Button size="sm" variant="ghost" disabled={working} onClick={() => onChoose("discard")}>
          {t("Discard")}
        </Button>
      </div>
      <Text
        id={warning}
        as="p"
        size="caption"
        tone={lateSettlement ? "warning" : "inherit"}
        className={lateSettlement ? "mt-1.5" : "sr-only"}
        data-delivery-review-warning
      >
        {lateSettlement
          ? t(
              "The provider has not answered yet and may still deliver this message. Sending it again could duplicate it. Wait, or stop the turn.",
            )
          : retryHint}
      </Text>
    </div>
  );
}
