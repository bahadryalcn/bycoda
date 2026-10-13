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
          label={t("Automatically reconnect to remote machines")}
          description={t(
            "Retry a machine that stopped answering, in the background and when this window regains focus or the network returns. Turn it off to reconnect only with Reconnect, when you send a message, or when you open a remote project.",
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
