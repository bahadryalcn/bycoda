import { useT } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { modelProfile } from "../../model/modelProfile";

/** Compact intelligence and cost of a model; the tooltip spells them out and flags estimates. */
export function ModelProfileBadge({ harness, model }: { harness: string; model: string }) {
  const t = useT();
  const profile = modelProfile(harness, model);
  return (
    <Tooltip
      label={t("Intelligence {p0} of 5", { p0: profile.intelligence })}
      details={[
        t("Cost {p0} of 4", { p0: profile.cost }),
        ...(profile.estimated ? [t("Estimated")] : []),
      ]}
    >
      <Badge size="xs" tone={profile.estimated ? "neutral" : "info"} appearance="subtle">
        {`${profile.intelligence}/5 · ${"$".repeat(profile.cost)}`}
      </Badge>
    </Tooltip>
  );
}
