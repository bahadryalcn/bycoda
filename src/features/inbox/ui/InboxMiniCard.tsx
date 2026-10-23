import { Button } from "../../../shared/ui/Button";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { t, useLocale } from "../../../shared/i18n";
import { CircleDot, GitPullRequest, X } from "../../../shared/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { InboxComposerCard } from "../model/githubTasks";
import { InboxProviderMark } from "./InboxProviderMark";
import { InboxLabel } from "./InboxPresentation";

type Props = {
  card: InboxComposerCard;
  onDismiss?: () => void;
};

export function InboxMiniCard({ card, onDismiss }: Props) {
  useLocale();
  const KindIcon = card.kind === "pr" ? GitPullRequest : CircleDot;
  const kindLabel =
    card.kind === "pr" ? (card.provider === "gitlab" ? "Merge request" : "Pull request") : "Issue";
  const serviceLabel = providerLabel(card.provider);

  return (
    <div className="px-3 pt-2">
      <div className="relative rounded-(--radius-control) border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-2.5 py-2 pr-8">
        <Button
          variant="ghost"
          type="button"
          title={t("Open in {p0}", { p0: serviceLabel })}
          aria-label={t("Open {p0} {p1} in {p2}", {
            p0: kindLabel,
            p1: card.identifier,
            p2: serviceLabel,
          })}
          disabled={!card.url}
          onClick={() => {
            if (card.url) void openUrl(card.url);
          }}
          className="w-full flex-col text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <InboxProviderMark provider={card.provider} className="icon-sm shrink-0" />
            <KindIcon className="icon-xs shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
              {kindLabel} · {card.identifier}
            </span>
          </span>
          <span className="mt-1 line-clamp-1 text-ui-secondary font-medium leading-snug text-(--ui-tone-neutral-fg)">
            {card.title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2">
            {card.source ? (
              <span className="min-w-0 flex-1 truncate text-ui-micro text-(--ui-text-secondary)">
                {card.source}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            {card.labels.length > 0 ? (
              <span className="flex min-w-0 shrink-0 items-center gap-1">
                {card.labels.map((label) => (
                  <InboxLabel key={label.name} label={label} compact />
                ))}
              </span>
            ) : null}
          </span>
        </Button>
        {onDismiss ? (
          <Button
            iconOnly
            label={t("Remove {p0} {p1}", { p0: kindLabel, p1: card.identifier })}
            variant="ghost"
            type="button"
            title={t("Remove")}
            aria-label={t("Remove {p0} {p1}", { p0: kindLabel, p1: card.identifier })}
            onClick={onDismiss}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
