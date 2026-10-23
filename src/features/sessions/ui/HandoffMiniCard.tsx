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
    <div className="px-3 pt-2">
      <div
        className={`relative rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-2.5 py-2 ${
          onDismiss ? "pr-8" : ""
        }`}
      >
        <div className="flex w-full flex-col text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <Replace className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
              {t("Handoff")}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-secondary font-semibold leading-snug text-(--ui-tone-neutral-fg)">
            <HarnessIcon harness={card.from} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{HARNESS_TITLE[card.from]}</span>
            <ChevronRight
              className="size-3 shrink-0 text-(--ui-text-secondary)"
              strokeWidth={1.75}
            />
            <HarnessIcon harness={card.to} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{HARNESS_TITLE[card.to]}</span>
          </span>
          {card.request ? (
            <span className="mt-1 line-clamp-1 text-ui-micro text-(--ui-text-secondary)">
              {card.request}
            </span>
          ) : null}
          {files ? (
            <span className="mt-1 text-ui-micro leading-4 text-(--ui-text-secondary)">{files}</span>
          ) : null}
        </div>
        {onDismiss ? (
          <Button
            iconOnly
            label={t("Remove handoff")}
            variant="ghost"
            type="button"
            title={t("Remove")}
            aria-label={t("Remove handoff")}
            onClick={onDismiss}
            className="absolute right-1.5 top-1.5"
          >
            <X className="size-3" strokeWidth={2} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
