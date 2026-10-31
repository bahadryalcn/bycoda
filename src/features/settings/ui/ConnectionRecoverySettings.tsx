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
    <Group title={t("Options")}>
      <Row
        id="remote-auto-reconnect"
        persistence={{ mode: "automatic" }}
        label={t("Connection recovery")}
        info={t(
          "Reconnect saved computers when the network returns. You can still reconnect manually when this is off.",
        )}
      >
        <Toggle
          label={t("Automatically reconnect to remote machines")}
          on={on}
          onChange={saveRemoteAutoReconnect}
        />
      </Row>
    </Group>
  );
}
