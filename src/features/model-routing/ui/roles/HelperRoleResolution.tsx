import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../shared/i18n";
import { withTimeout } from "../../../../shared/lib/withTimeout";
import type { ModelRoutingChoice } from "../../../../shared/model/host-contracts/model-routing";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import type { HelperModelRole } from "../../model/helperModelRouting";
import { resolveModelRouting } from "../../model/modelRoutingClient";

/** Helpers fall back immediately instead of holding a run when no entry is eligible. */
export function HelperRoleResolution({
  machineId,
  role,
  choice,
  version,
}: {
  machineId: string;
  role: HelperModelRole;
  choice: ModelRoutingChoice;
  version: number;
}) {
  const query = useQuery({
    queryKey: ["helper-role-preview", machineId, role, choice, version],
    queryFn: () =>
      withTimeout(
        resolveModelRouting(machineId, {
          role,
          choice: choice.kind === "fixed" ? { kind: "fixed" } : choice,
          fixed: choice.kind === "fixed" ? choice.target : undefined,
        }),
        500,
        "Helper model preview",
      ),
    retry: false,
    staleTime: 3000,
    refetchInterval: 60_000,
  });
  const result = query.data;
  return (
    <Text as="p" tone="secondary">
      {result?.ok ? (
        <span className="inline-flex items-center gap-1">
          {t("Now uses")}
          <ModelLabel model={result.target.model} harness={result.target.harness} />
        </span>
      ) : query.isPending ? (
        t("Checking current model…")
      ) : (
        t("Automatic uses this helper's own model selection.")
      )}
    </Text>
  );
}
