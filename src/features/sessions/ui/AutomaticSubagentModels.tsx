import { useT } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { SUBAGENT_TIERS } from "../../../shared/model/automaticSubagents";
import { delegateRefKey } from "../../../shared/model/host-contracts/delegation";
import type { ModelSetting } from "../model/models";

const labels = {
  best: "Best",
  strong: "Strong",
  medium: "Medium",
  light: "Light",
  unranked: "Unranked",
};

/** Read-only preview of the same resolver the Host uses; refs retain account identity. */
export function AutomaticSubagentModels({ setting }: { setting: ModelSetting }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 px-1.5 pb-1">
      {SUBAGENT_TIERS.map((tier) => {
        const models = setting.resolvedSubagents?.filter((ref) => ref.tier === tier) ?? [];
        return models.length ? (
          <Text as="p" key={tier} size="caption" tone="secondary" className="break-words">
            <Text size="inherit" weight="medium">
              {t(labels[tier])}:{" "}
            </Text>
            {models.map(delegateRefKey).join(", ")}
          </Text>
        ) : null;
      })}
    </div>
  );
}
