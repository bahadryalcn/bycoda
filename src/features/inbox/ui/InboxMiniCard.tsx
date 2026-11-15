import { InlineAction } from "../../../shared/ui/ActionHost";
import { providerLabel } from "../../../shared/lib/providerLabel";
import { t, useLocale } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { X } from "../../../shared/ui/icons";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import type { InboxComposerCard } from "../model/githubTasks";
import { InboxProviderMark } from "./InboxProviderMark";

type Props = {
  card: InboxComposerCard;
  onDismiss?: () => void;
};

export function InboxMiniCard({ card, onDismiss }: Props) {
  useLocale();
  const kindLabel =
    card.kind === "pr"
      ? t(card.provider === "gitlab" ? "Merge request" : "Pull request")
      : t("Issue");
  const serviceLabel = providerLabel(card.provider);

  return (
    <div className="px-3 pt-2">
      <CollectionRow
        leading={<InboxProviderMark provider={card.provider} className="icon-sm" />}
        title={card.title}
        secondary={[`${kindLabel} · ${card.identifier}`, card.source].filter(Boolean).join(" · ")}
        action={
          onDismiss ? (
            <InlineAction
              label={t("Remove {p0} {p1}", { p0: kindLabel, p1: card.identifier })}
              type="button"
              onClick={onDismiss}
            >
              <X className="icon-xs" strokeWidth={1.75} />
            </InlineAction>
          ) : undefined
        }
        primary={{
          tooltip: t("Open in {p0}", { p0: serviceLabel }),
          type: "button",
          "aria-label": t("Open {p0} {p1} in {p2}", {
            p0: kindLabel,
            p1: card.identifier,
            p2: serviceLabel,
          }),
          disabled: !card.url,
        }}
        onOpen={() => {
          if (card.url) openUrlSafely(card.url);
        }}
      />
    </div>
  );
}
