import type { Block } from "../model/session";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";

/**
 * The row under a queued follow-up bubble: its delivery badge, the draft actions and, when the
 * message did not arrive, the reason. It sits beside the bubble's column, not inside it.
 */
export function UserDraftFooter({
  block,
  delivery,
  deliveryLabel,
  deliveryDescription,
  deliveryActive,
  heldActionTitle,
  onEditDraft,
  onRemoveDraft,
  onSendDraft,
}: {
  block: Block;
  delivery: Block["followUpDelivery"];
  deliveryLabel?: string;
  deliveryDescription?: string;
  deliveryActive: boolean;
  heldActionTitle?: string;
  onEditDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onSendDraft?: (block: Block) => boolean | void;
}) {
  const t = useT();
  const heldReason = deliveryActive
    ? (heldActionTitle ?? t("Wait for the current action to finish."))
    : undefined;
  const tone =
    delivery === "undelivered" ? "danger" : delivery === "uncertain" ? "warning" : "neutral";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Tooltip label={deliveryDescription} asChild>
        <span role={delivery ? "status" : undefined}>
          <Badge
            size="sm"
            appearance="subtle"
            tone={tone}
            icon={delivery === "pending" ? <Spinner size="xs" /> : undefined}
          >
            {deliveryLabel}
          </Badge>
        </span>
      </Tooltip>
      <span className="flex items-center gap-1">
        {onEditDraft ? (
          <Button
            motion="none"
            variant="ghost"
            size="sm"
            aria-label={t("Edit draft")}
            type="button"
            disabled={deliveryActive}
            disabledReason={heldReason}
            onClick={() => onEditDraft(block)}
          >
            {t("Edit draft")}
          </Button>
        ) : null}
        <Button
          motion="none"
          variant="ghost"
          size="sm"
          aria-label={t("Remove draft")}
          type="button"
          disabled={deliveryActive}
          disabledReason={heldReason}
          onClick={() => onRemoveDraft?.(block)}
        >
          {t("Remove draft")}
        </Button>
        <Button
          motion="none"
          variant="secondary"
          size="sm"
          aria-label={t("Send draft")}
          type="button"
          disabled={deliveryActive}
          disabledReason={heldReason}
          onClick={() => onSendDraft?.(block)}
        >
          {t("Send draft")}
        </Button>
      </span>
      {delivery === "undelivered" || delivery === "uncertain" ? (
        <Text as="span" size="caption" tone="secondary" className="basis-full text-end font-sans">
          {deliveryDescription}
        </Text>
      ) : null}
    </div>
  );
}
