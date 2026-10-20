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
    <div>
      <Group title={t("Connection recovery")}>
        <Row
          id="remote-auto-reconnect"
          persistence={{ mode: "automatic" }}
          label={t("Automatically reconnect to remote machines")}
          description={t(
            "Reconnect saved computers when the network returns. You can still reconnect manually when this is off.",
          )}
        >
          <Toggle
            label={t("Automatically reconnect to remote machines")}
            on={on}
            onChange={saveRemoteAutoReconnect}
          />
        </Row>
        <details className="p-3 text-[12px] text-(--ui-text-muted)">
          <summary className="cursor-pointer">{t("How reconnection works")}</summary>
          <p className="mbs-2 leading-relaxed">
            {t(
              "Retry saved remote connections in the background, when this window regains focus, or when the network returns. Turning this off still allows Reconnect, sending a message, and opening a remote project to reconnect. Retrying uses the saved address and account; it does not fix missing SSH access or provider sign-in.",
            )}
          </p>
        </details>
      </Group>
    </div>
  );
}
