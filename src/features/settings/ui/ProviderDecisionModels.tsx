import { useMemo } from "react";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { t } from "../../../shared/i18n";
import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { decisionModelsClient, DecisionModelsSettings } from "../../decision-models";
import { SettingsFeedback, settingDomId } from "./settingsControls";

/**
 * Providers > Decision models. Runs on this computer's Host, or the first Host listed. The page
 * renders its own framed groups, so this wrapper is only the titled section and search anchor.
 */
export function ProviderDecisionModels() {
  const { machines, loaded } = useRemoteMachines();
  const host = machines.find(isLocalSyncMachine) ?? machines[0];
  const hostId = host?.id;
  const client = useMemo(() => (hostId ? decisionModelsClient(hostId) : null), [hostId]);
  return (
    <section
      id={settingDomId("decision-models")}
      data-setting-id="decision-models"
      tabIndex={-1}
      aria-label={t("Decision models")}
      className="flex min-w-0 flex-col gap-4"
    >
      {client ? (
        <DecisionModelsSettings
          key={hostId}
          client={client}
          hostId={hostId}
          hostName={host!.name}
          remote={!isLocalSyncMachine(host!)}
        />
      ) : !loaded ? (
        <LoadingText delay={false}>{t("Loading…")}</LoadingText>
      ) : (
        <SettingsFeedback state="empty" presentation="inset">
          {t("Decision models run on a Host. Connect this computer's Host to set them up.")}
        </SettingsFeedback>
      )}
    </section>
  );
}
