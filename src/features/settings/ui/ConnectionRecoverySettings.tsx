import { t, useLocale } from "../../../shared/i18n";
import { useSyncExternalStore } from "react";

import {
  loadRemoteAutoReconnect,
  saveRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../model/settings";

import { Group, Row, Toggle } from "./settingsControls";

export function RemoteReconnectGroup() {
  useLocale();
  const on = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  return (
    <div className="pt-8">
      <Group title={t("Connection recovery")}>
        <Row
          id="remote-auto-reconnect"
          scope={t("This desktop · remote machine connections")}
          persistence={{ mode: "automatic" }}
          label={t("Automatically reconnect to remote machines")}
          description={t(
            "Retry saved remote connections in the background, when this window regains focus, or when the network returns. Turning this off still allows Reconnect, sending a message, and opening a remote project to reconnect. Retrying uses the saved address and account; it does not fix missing SSH access or provider sign-in.",
          )}
        >
          <Toggle
            label={t("Automatically reconnect to remote machines")}
            on={on}
            onChange={saveRemoteAutoReconnect}
          />
        </Row>
      </Group>
    </div>
  );
}
