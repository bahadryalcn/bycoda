import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { t, useLocale } from "../../../shared/i18n";
import { CircleDot, GitPullRequest, X } from "../../../shared/ui/icons";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import type { InboxComposerCard } from "../model/githubTasks";
import { InboxProviderMark } from "./InboxProviderMark";
import { inboxLabelItems } from "./InboxPresentation";

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
  const hasLabels = card.labels.length > 0;

  return (
    <div className="px-3 pt-2">
      <ActionHost className="flex min-w-0 items-start gap-1">
        {/* The label badges hold their own "+N" button, which cannot sit inside the open button:
            with labels the source line is a sibling laid over it (clicks outside the badges fall
            through to the button) and the button keeps the line's height. */}
        <div className="relative min-w-0 flex-1">
          <Button
            data-action-primary=""
            variant="item"
            layout="stacked"
            align="start"
            type="button"
            tooltip={t("Open in {p0}", { p0: serviceLabel })}
            aria-label={t("Open {p0} {p1} in {p2}", {
              p0: kindLabel,
              p1: card.identifier,
              p2: serviceLabel,
            })}
            disabled={!card.url}
            onClick={() => {
              if (card.url) openUrlSafely(card.url);
            }}
            className="w-full min-w-0"
          >
            <span className="line-clamp-2 wrap-anywhere text-ui-secondary font-medium leading-snug text-(--ui-tone-neutral-fg)">
              {card.title}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <InboxProviderMark provider={card.provider} className="icon-sm shrink-0" />
              <KindIcon
                className="icon-xs shrink-0 text-(--ui-text-secondary)"
                strokeWidth={1.75}
              />
              <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
                {kindLabel} · {card.identifier}
              </span>
            </span>
            {hasLabels ? (
              <span aria-hidden="true" className="mt-1 block h-4" />
            ) : card.source ? (
              <span className="mt-1 min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
                {card.source}
              </span>
            ) : null}
          </Button>
          {hasLabels ? (
            <div className="pointer-events-none absolute inset-x-[calc(var(--space-3)+1px)] bottom-[calc(var(--space-2)+1px)] flex h-4 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ui-micro text-(--ui-text-secondary)">
                {card.source}
              </span>
              <span className="pointer-events-auto min-w-0 max-w-[60%] shrink-0 [&>div>ul]:justify-end">
                <BadgeList label={t("Labels")} size="xs" items={inboxLabelItems(card.labels)} />
              </span>
            </div>
          ) : null}
        </div>
        {onDismiss ? (
          <InlineAction
            label={t("Remove {p0} {p1}", { p0: kindLabel, p1: card.identifier })}
            type="button"
            onClick={onDismiss}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </InlineAction>
        ) : null}
      </ActionHost>
    </div>
  );
}
