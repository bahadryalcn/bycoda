import type { Block } from "../model/session";
import { ArrowUp, CircleDashed, Pencil, Trash2 } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";

/** Footer of a queued follow-up bubble: delivery state plus edit, remove and send. */
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
  return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Tooltip label={deliveryDescription} asChild>
          <Text
            as="span"
            size="caption"
            tone="secondary"
            className="flex items-center gap-1.5"
            role={delivery ? "status" : undefined}
          >
            <CircleDashed className="icon-sm" strokeWidth={1.75} />
            {deliveryLabel}
          </Text>
        </Tooltip>
        <Tooltip label={deliveryActive ? heldActionTitle : undefined} asChild>
          <span className="flex items-center gap-1">
          {onEditDraft ? (
            <Button
              motion="none"
              variant="ghost"
              type="button"
              iconOnly
              label={t("Edit draft")}
              disabled={deliveryActive}
              onClick={() => onEditDraft(block)}
            >
              <Pencil className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
          <Button
            motion="none"
            variant="ghost"
            type="button"
            iconOnly
            label={t("Remove draft")}
            disabled={deliveryActive}
            onClick={() => onRemoveDraft?.(block)}
          >
            <Trash2 className="icon-sm" strokeWidth={1.75} />
          </Button>
          <Button
            motion="none"
            variant="ghost"
            type="button"
            iconOnly
            label={t("Send draft")}
            disabled={deliveryActive}
            onClick={() => onSendDraft?.(block)}
          >
            <ArrowUp className="icon-sm" strokeWidth={2} />
          </Button>
          </span>
        </Tooltip>
      </div>
  );
}
