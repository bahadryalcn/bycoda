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
  const query = useModelRoutingPreview(
    machineId,
    ["model-routing-resolution", machineId, role, choice, fixed, revision],
    { role, choice, fixed },
  );
  const result = query.data;
  if (!query.isError && (!result || (problemsOnly && result.ok))) return null;
  return (
    <Text as="p" size={compact ? "caption" : undefined} tone="secondary">
      {query.isError ? (
        t("Current model could not be checked. You can still edit this choice.")
      ) : !result ? null : result.ok ? (
        <ResolvedRoutingModel target={result.target} compact={compact} />
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

/** The resolved model identity, optionally including the Host account on compact job rows. */
export function ResolvedRoutingModel({
  target,
  compact = false,
}: {
  target: ModelRoutingTarget;
  compact?: boolean;
}) {
  useLocale();
  const source = useModelSource();
  const account = compact ? entryProviderAccount(target, source) : undefined;
  const name = compact ? source.resolve(target.harness, target.model).name : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {t("Now uses")}
      <ModelLabel
        model={target.model}
        harness={target.harness}
        name={account && name ? t("{p0} · {p1}", { p0: name, p1: account.label }) : name}
      />
    </span>
  );
}
