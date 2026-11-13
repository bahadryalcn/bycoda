import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../../shared/i18n";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { resolveModelRouting } from "../../model/modelRoutingClient";

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
  const query = useQuery({
    queryKey: ["model-routing-resolution", machineId, role, choice, fixed, revision],
    queryFn: () => resolveModelRouting(machineId, { role, choice, fixed }),
    retry: false,
    staleTime: 3000,
    refetchInterval: 60_000,
  });
  const result = query.data;
  if (problemsOnly && !query.isError && (!result || result.ok)) return null;
  return (
    <Text as="p" tone="secondary">
      {query.isError ? (
        t("Current model could not be checked. You can still edit this choice.")
      ) : !result ? (
        t("Checking current model…")
      ) : result.ok ? (
        <span className="inline-flex items-center gap-1">
          {t("Now uses")}
          <ModelLabel model={result.target.model} harness={result.target.harness} />
        </span>
      ) : result.reason === "notConfigured" ? (
        t("No model order configured. Uses the item's own model.")
      ) : (
        t("No eligible model right now. Runs wait for an eligible model.")
      )}
    </Text>
  );
}
