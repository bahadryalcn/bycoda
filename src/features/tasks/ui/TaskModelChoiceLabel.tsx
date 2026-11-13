import { t } from "../../../shared/i18n";
import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";
import { useModelRouting } from "../../model-routing/public/choice";

/** Show routing intent alongside the concrete model retained for this item. */
export function TaskModelChoiceLabel({
  choice,
  machineId,
}: {
  choice?: ModelRoutingItemChoice;
  machineId: string;
}) {
  const routing = useModelRouting(machineId, choice?.kind === "pool");
  switch (choice?.kind) {
    case "default":
      return t("Default");
    case "order":
      return t("Model order");
    case "pool":
      return routing.state?.pools.find((pool) => pool.id === choice.poolId)?.name ?? t("Pool");
    default:
      return t("Fixed");
  }
}
