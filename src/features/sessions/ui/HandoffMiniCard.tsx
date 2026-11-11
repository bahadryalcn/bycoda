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
        <Replace className="icon-sm shrink-0 text-(--ui-text-secondary)" aria-hidden />
        <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">{t("Handoff")}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
          <HarnessIcon harness={card.from} className="icon-sm shrink-0" />
          <span className="min-w-0 truncate">{HARNESS_TITLE[card.from]}</span>
          <ChevronRight className="icon-sm shrink-0 text-(--ui-text-secondary)" aria-hidden />
          <HarnessIcon harness={card.to} className="icon-sm shrink-0" />
          <span className="min-w-0 truncate">{HARNESS_TITLE[card.to]}</span>
        </span>
        {card.request ? (
          <span className="min-w-0 flex-1 truncate text-ui-caption text-(--ui-text-secondary)">
            {card.request}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {files ? (
          <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
            {files}
          </span>
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
