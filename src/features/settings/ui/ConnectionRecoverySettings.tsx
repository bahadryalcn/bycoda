import { t, useLocale } from "../../../shared/i18n";
import { useSyncExternalStore } from "react";

import {
  loadRemoteAutoReconnect,
  saveRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../model/settings";

import { Group, Row, Toggle } from "../../../shared/ui/settings";

export function RemoteReconnectGroup() {
  useLocale();
  const on = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  return (
    <Group title={null}>
      <Row
        id="remote-auto-reconnect"
        persistence={{ mode: "automatic" }}
        label={t("Automatically reconnect to machines")}
        info={t("You can still reconnect manually when this is off.")}
      >
        <Toggle
          label={t("Automatically reconnect to machines")}
          on={on}
          onChange={saveRemoteAutoReconnect}
        />
      </Row>
    </Group>
  );
}
