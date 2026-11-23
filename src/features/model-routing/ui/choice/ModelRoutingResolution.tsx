import { t, useLocale } from "../../../../shared/i18n";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { useModelRoutingPreview } from "../../model/useModelRoutingPreview";

/** Preview only: failure never prevents editing or saving the containing form. */
export function ModelRoutingResolution({
  machineId,
  role,
  choice,
  fixed,
  revision,
  problemsOnly = false,
}: {
  machineId: string;
  role: ModelRoutingRole;
  choice?: ModelRoutingItemChoice;
  fixed?: ModelRoutingTarget;
  revision?: unknown;
  /** Hide the routine "Now uses" line and the pending state; show only what needs attention. */
  problemsOnly?: boolean;
}) {
  useLocale();
  const query = useModelRoutingPreview(
    machineId,
    ["model-routing-resolution", machineId, role, choice, fixed, revision],
    { role, choice, fixed },
  );
  const result = query.data;
  // No loading line: the answer appears when it arrives. Only a failure or a problem is worth a line.
  if (!query.isError && !result) return null;
  if (problemsOnly && !query.isError && (!result || result.ok)) return null;
  return (
    <Text as="p" tone="secondary">
      {query.isError ? (
        t("Current model could not be checked. You can still edit this choice.")
      ) : !result ? null : result.ok ? (
        <span className="inline-flex items-center gap-1">
          {t("Now uses")}
          <ModelLabel model={result.target.model} harness={result.target.harness} />
        </span>
      ) : result.reason === "notConfigured" ? (
        t("No model order configured. Uses the item's own model.")
      ) : (
        <span className="inline-flex items-center gap-1">
          {t("No eligible model right now.")}
          <InfoPopover label={t("What happens now")}>
            {t("Runs wait for an eligible model.")}
          </InfoPopover>
        </span>
      )}
    </Text>
  );
}
