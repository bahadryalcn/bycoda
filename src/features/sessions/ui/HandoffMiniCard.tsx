import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { Surface } from "../../../shared/ui/Surface";
import { useT } from "../../../shared/i18n";
import { Replace, X } from "../../../shared/ui/icons";
import type { HarnessId } from "../model/session";
import { HandoffFileCount, HarnessRoute } from "./HarnessRoute";

type Card = {
  from: HarnessId;
  to: HarnessId;
  request?: string;
  files?: number;
};

type Props = {
  card: Card;
  onDismiss?: () => void;
};

export function HandoffMiniCard({ card, onDismiss }: Props) {
  const t = useT();

  return (
    <div className="px-3 pt-2" data-handoff-card>
      <Surface variant="card" padding="none" className="flex min-w-0 items-center gap-2 px-2 py-1">
        <Replace className="icon-sm shrink-0" tone="secondary" aria-label={t("Handoff")} />
        <Text size="secondary" tone="neutral" weight="medium" className="flex min-w-0">
          <HarnessRoute from={card.from} to={card.to} />
        </Text>
        {card.request ? (
          <Text size="caption" tone="secondary" truncate className="min-w-0 flex-1">
            {card.request}
          </Text>
        ) : (
          <span className="flex-1" />
        )}
        <HandoffFileCount files={card.files} className="shrink-0 tabular-nums" />
        {onDismiss ? (
          <Button
            iconOnly
            label={t("Remove handoff")}
            variant="ghost"
            type="button"
            onClick={onDismiss}
            className="shrink-0"
          >
            <X className="icon-sm" aria-hidden />
          </Button>
        ) : null}
      </Surface>
    </div>
  );
}
