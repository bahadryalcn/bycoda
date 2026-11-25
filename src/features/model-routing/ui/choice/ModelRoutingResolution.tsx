import { t, useLocale } from "../../../../shared/i18n";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { useModelRoutingPreview } from "../../model/useModelRoutingPreview";
import { useModelSource } from "../../../sessions/public/modelSource";
import { entryProviderAccount } from "../order/useEntryAccount";

/** Preview only: failure never prevents editing or saving the containing form. */
export function ModelRoutingResolution({
  machineId,
  role,
  choice,
  fixed,
  revision,
  problemsOnly = false,
  compact = false,
}: {
  machineId: string;
  role: ModelRoutingRole;
  choice?: ModelRoutingItemChoice;
  fixed?: ModelRoutingTarget;
  revision?: unknown;
  /** Hide the routine "Now uses" line and the pending state; show only what needs attention. */
  problemsOnly?: boolean;
  /** Settings job rows show the current Host account beside the model. */
  compact?: boolean;
}) {
  useLocale();
  const source = useModelSource();
  const query = useModelRoutingPreview(
    machineId,
    ["model-routing-resolution", machineId, role, choice, fixed, revision],
    { role, choice, fixed },
  );
  const result = query.data;
  const account = compact && result?.ok ? entryProviderAccount(result.target, source) : undefined;
  const name =
    compact && result?.ok
      ? source.resolve(result.target.harness, result.target.model).name
      : undefined;
  if (problemsOnly && !query.isError && (!result || result.ok)) return null;
  return (
    <Text as="p" size={compact ? "caption" : undefined} tone="secondary">
      {query.isError ? (
        t("Current model could not be checked. You can still edit this choice.")
      ) : !result ? (
        t("Checking current model…")
      ) : result.ok ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          {t("Now uses")}
          <ModelLabel
            model={result.target.model}
            harness={result.target.harness}
            name={account && name ? t("{p0} · {p1}", { p0: name, p1: account.label }) : name}
          />
        </span>
      ) : result.reason === "notConfigured" ? (
        t("No model order configured. Uses the item's own model.")
      ) : (
        t("No eligible model right now. Runs wait for an eligible model.")
      )}
    </Text>
  );
}
