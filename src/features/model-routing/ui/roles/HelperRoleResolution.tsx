import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingChoice } from "../../../../shared/model/host-contracts/model-routing";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import type { HelperModelRole } from "../../model/helperModelRouting";
import { useModelRoutingPreview } from "../../model/useModelRoutingPreview";

/**
 * Helpers fall back immediately instead of holding a run when no entry is eligible. That
 * fallback is only claimed when the Host answered; a timeout or failure is shown as unchecked.
 */
export function HelperRoleResolution({
  machineId,
  role,
  choice,
  version,
  problemsOnly = false,
}: {
  machineId: string;
  role: HelperModelRole;
  choice: ModelRoutingChoice;
  version: number;
  /** Hide the routine "Now uses" line and the pending state; show only what needs attention. */
  problemsOnly?: boolean;
}) {
  useLocale();
  const query = useModelRoutingPreview(
    machineId,
    ["helper-role-preview", machineId, role, choice, version],
    {
      role,
      choice: choice.kind === "fixed" ? { kind: "fixed" } : choice,
      fixed: choice.kind === "fixed" ? choice.target : undefined,
    },
  );
  const result = query.data;
  if (problemsOnly && !query.isError && (query.isPending || result?.ok)) return null;
  return (
    <Text as="p" tone="secondary">
      {query.isError ? (
        t("Current model could not be checked. You can still edit this choice.")
      ) : result?.ok ? (
        <span className="inline-flex items-center gap-1">
          {t("Now uses")}
          <ModelLabel model={result.target.model} harness={result.target.harness} />
        </span>
      ) : !result ? (
        t("Checking current model…")
      ) : (
        t("Automatic uses this helper's own model selection.")
      )}
    </Text>
  );
}
