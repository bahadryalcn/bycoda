import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import { disabledModelIds, subscribeModels } from "./models";

/**
 * Publishes the models turned off in Settings to this desktop's Host, which hides them from the
 * catalog it serves phones. Runs once on load, then after each change; a failed push retries on
 * the next change.
 */
export function startModelEnabledHostSync(): () => void {
  let sent = "";
  let running: Promise<void> | undefined;
  const push = () => {
    const disabled = disabledModelIds();
    const body = JSON.stringify(disabled);
    if (body === sent || running) return;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) return;
      await remoteRequest(machine.id, "host.settings.save", { disabledModels: disabled }, false, true);
      sent = body;
    })()
      .catch((error) => console.warn("Publishing enabled models failed", error))
      .finally(() => {
        running = undefined;
        if (sent !== "" && JSON.stringify(disabledModelIds()) !== sent) push();
      });
  };
  push();
  return subscribeModels(push);
}
