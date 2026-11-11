import { useId, useMemo } from "react";
import { t } from "../../../shared/i18n";
import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { decisionModelsClient, DecisionModelsSettings } from "../../decision-models";
import { Heading } from "../../../shared/ui/Heading";
import { SettingsFeedback, settingDomId } from "./settingsControls";

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
  return (
    <section
      id={settingDomId("decision-models")}
      data-setting-id="decision-models"
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
    >
      <Heading id={headingId} className="settings-section-title">
        {t("Decision models")}
      </Heading>
      {client ? (
        <DecisionModelsSettings client={client} />
      ) : (
        <SettingsFeedback state="empty" presentation="inset">
          {t("Decision models run on a Host. Connect this computer's Host to set them up.")}
        </SettingsFeedback>
      )}
    </section>
  );
}
