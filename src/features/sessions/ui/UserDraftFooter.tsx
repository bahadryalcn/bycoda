import type { Block } from "../model/session";
import { ArrowUp, CircleDashed, Pencil, Trash2 } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Divider } from "../../../shared/ui/Divider";
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
    <>
      <Divider className="mt-2" />
      <div className="mt-2 flex items-center justify-between gap-4">
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
        <span className="flex items-center gap-1">
          {onEditDraft ? (
            <Button
              motion="none"
              variant="ghost"
              type="button"
              tooltip={deliveryActive ? heldActionTitle : undefined}
              aria-label={t("Edit draft")}
              disabled={deliveryActive}
              onClick={() => onEditDraft(block)}
            >
              <Pencil className="icon-sm" strokeWidth={1.75} />
              {t("Edit")}
            </Button>
          ) : null}
          <Button
            motion="none"
            variant="ghost"
            type="button"
            tooltip={deliveryActive ? heldActionTitle : undefined}
            aria-label={t("Remove draft")}
            disabled={deliveryActive}
            onClick={() => onRemoveDraft?.(block)}
          >
            <Trash2 className="icon-sm" strokeWidth={1.75} />
            {t("Remove")}
          </Button>
          <Button
            motion="none"
            variant="ghost"
            type="button"
            tooltip={deliveryActive ? heldActionTitle : undefined}
            aria-label={t("Send draft")}
            disabled={deliveryActive}
            onClick={() => onSendDraft?.(block)}
          >
            {t("Send")}
            <ArrowUp className="icon-sm" strokeWidth={2} />
          </Button>
        </span>
      </div>
    </>
  );
}
