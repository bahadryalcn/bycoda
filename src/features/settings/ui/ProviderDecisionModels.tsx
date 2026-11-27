import { useMemo } from "react";
import { t } from "../../../shared/i18n";
import type { RemoteMachine } from "../../connections/public/protocol";
import {
  SettingsHostNotice,
  SettingsHostPicker,
  useSettingsHostScope,
} from "../../connections/public/settingsHosts";
import { decisionModelsClient, DecisionModelsSettings } from "../../decision-models";
import { settingDomId } from "../../../shared/ui/settings";

/**
 * Settings > Decision models. Opens on this computer's Host and never binds to another machine
 * by itself: a remote Host is used only after the owner picks it, and a Host that is loading,
 * offline or removed is reported instead of replaced. The page renders its own framed groups,
 * so this wrapper is only the titled section, the Host picker and the search anchor.
 */
export function ProviderDecisionModels() {
  const scope = useSettingsHostScope();
  const host = scope.selected;
  const local = scope.entry?.isLocal === true;
  return (
    <section
      id={settingDomId("decision-models")}
      data-setting-id="decision-models"
      tabIndex={-1}
      aria-label={t("Decision models")}
      className="settings-topics"
    >
      {scope.options.length > 1 || scope.missing ? <SettingsHostPicker scope={scope} /> : null}
      {/* Only a connected machine reaches the editor; any other state is reported instead. */}
      {host ? (
        <HostDecisionModels key={host.id} host={host} remote={!local} />
      ) : (
        <SettingsHostNotice scope={scope} />
      )}
    </section>
  );
}

/** The Host's identity owns the client and every open dialog, scan and draft below it. */
function HostDecisionModels({ host, remote }: { host: RemoteMachine; remote: boolean }) {
  const client = useMemo(() => decisionModelsClient(host.id), [host.id]);
  return (
    <DecisionModelsSettings client={client} hostId={host.id} hostName={host.name} remote={remote} />
  );
}
