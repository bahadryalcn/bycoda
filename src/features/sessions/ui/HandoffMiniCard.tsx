import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { ChevronRight, Replace, X } from "../../../shared/ui/icons";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

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
  const files =
    card.files != null && card.files > 0
      ? `${card.files} ${card.files === 1 ? "file" : "files"}`
      : null;

  return (
    <div className="px-3 pt-2" data-handoff-card>
      <div className="flex min-w-0 items-center gap-2 rounded-(--ui-radius-card) border border-(--ui-card-border) bg-(--ui-card-surface) px-2 py-1">
        <Replace className="icon-sm shrink-0" tone="secondary" aria-hidden />
        <Text size="caption" tone="secondary" className="shrink-0">
          {t("Handoff")}
        </Text>
        <Text
          size="secondary"
          tone="neutral"
          weight="medium"
          className="flex min-w-0 items-center gap-1.5"
        >
          <HarnessIcon harness={card.from} className="icon-sm shrink-0" />
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {HARNESS_TITLE[card.from]}
          </Text>
          <ChevronRight className="icon-sm shrink-0" tone="secondary" aria-hidden />
          <HarnessIcon harness={card.to} className="icon-sm shrink-0" />
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {HARNESS_TITLE[card.to]}
          </Text>
        </Text>
        {card.request ? (
          <Text size="caption" tone="secondary" truncate className="min-w-0 flex-1">
            {card.request}
          </Text>
        ) : (
          <span className="flex-1" />
        )}
        {files ? (
          <Text size="caption" tone="secondary" className="shrink-0 tabular-nums">
            {files}
          </Text>
        ) : null}
        {onDismiss ? (
          <Button
            iconOnly
            label={t("Remove handoff")}
            variant="ghost"
            type="button"
            tooltip={t("Remove")}
            aria-label={t("Remove handoff")}
            onClick={onDismiss}
            className="shrink-0"
          >
            <X className="icon-sm" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
