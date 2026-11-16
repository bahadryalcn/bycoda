import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import { toolPreferences } from "./toolPreferences";

/**
 * Publishes the Settings > Tools bykit switch to this desktop's Host, which adds the bykit
 * instructions to agent turns only while it is on. Runs once on load, then after each change;
 * a failed push retries on the next change.
 */
export function startBykitHostSync(): () => void {
  const preference = toolPreferences.bykitInstructions;
  let sent: boolean | undefined;
  let running: Promise<void> | undefined;
  const push = () => {
    const enabled = preference.load();
    if (enabled === sent || running) return;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) return;
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { bykitInstructions: enabled },
        false,
        true,
      );
      sent = enabled;
    })()
      .catch((error) => console.warn("Publishing the bykit setting failed", error))
      .finally(() => {
        running = undefined;
        if (sent !== undefined && preference.load() !== sent) push();
      });
  };
  push();
  return preference.subscribe(push);
}
