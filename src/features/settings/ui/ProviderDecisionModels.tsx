import { useId, useMemo } from "react";
import { t } from "../../../shared/i18n";
import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { decisionModelsClient, DecisionModelsSettings } from "../../decision-models";
import { settingDomId } from "./settingsControls";

/**
 * Providers > Decision models. Runs on this computer's Host, or the first Host listed. The page
 * renders its own framed groups, so this wrapper is only the titled section and search anchor.
 */
export function ProviderDecisionModels() {
  const { machines } = useRemoteMachines();
  const host = machines.find(isLocalSyncMachine) ?? machines[0];
  const hostId = host?.id;
  const client = useMemo(() => (hostId ? decisionModelsClient(hostId) : null), [hostId]);
  const headingId = useId();
  if (!client) return null;
  return (
    <section
      id={settingDomId("decision-models")}
      data-setting-id="decision-models"
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
    >
      <h2 id={headingId} className="settings-section-title">
        {t("Decision models")}
      </h2>
      <DecisionModelsSettings client={client} />
    </section>
  );
}
