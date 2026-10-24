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
  text: string;
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
  useEffect(() => {
    if (focusRequest > 0) first.current?.focus();
  }, [focusRequest]);
  return (
    <div className="mt-1" data-delivery-review>
      <div className="flex flex-wrap items-center gap-1">
        <span className="min-w-0 max-w-full flex-1 basis-40 truncate text-ui-caption" title={text}>
          {text}
        </span>
        <Button
          ref={first}
          size="sm"
          variant="secondary"
          disabled={working}
          onClick={() => onChoose("delivered")}
        >
          {t("Already delivered")}
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
      <p id={warning} className="mt-0.5 text-ui-caption" data-delivery-review-warning>
        {lateSettlement
          ? t(
              "The provider has not answered yet and may still deliver this message. Sending it again could duplicate it. Wait, or stop the turn.",
            )
          : t(
              "Check the conversation first. Sending again duplicates a message that was delivered. Keeping it queued pauses the queue and does not resend it.",
            )}
      </p>
    </div>
  );
}
