import { useT } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { modelProfile } from "../../model/modelProfile";

/** Compact intelligence and cost of a model; the tooltip and screen-reader text spell them out and flag estimates. */
export function ModelProfileBadge({ harness, model }: { harness: string; model: string }) {
  const t = useT();
  const profile = modelProfile(harness, model);
  const label = t("Intelligence {p0} of 5", { p0: profile.intelligence });
  const details = [
    t("Cost {p0} of 4", { p0: profile.cost }),
    ...(profile.estimated ? [t("Estimated")] : []),
  ];
  return (
    <Tooltip label={label} details={details}>
      <Badge size="xs" tone={profile.estimated ? "neutral" : "info"} appearance="subtle">
        <span aria-hidden>{`${profile.intelligence}/5 · ${"$".repeat(profile.cost)}`}</span>
        <span className="sr-only">{[label, ...details].join(", ")}</span>
      </Badge>
    </Tooltip>
  );
}
