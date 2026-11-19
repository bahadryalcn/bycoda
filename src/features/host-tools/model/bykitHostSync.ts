import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { retryOnLocalHostAvailable } from "../../connections/public/localHostRetry";
import type { RemoteMachine } from "../../connections";
import { toolPreferences } from "./toolPreferences";

/**
 * Publishes the Settings > Tools bykit switch to this desktop's Host, which adds the bykit
 * instructions to agent turns only while it is on. Runs once on load, then after each change;
 * a push that finds the local Host missing or failing retries on a short backoff and when the
 * Host reports recovery, always with the switch's current value.
 */
export function startBykitHostSync(): () => void {
  const preference = toolPreferences.bykitInstructions;
  let sent: boolean | undefined;
  let running: Promise<void> | undefined;
  const retry = retryOnLocalHostAvailable(() => push());
  const push = () => {
    const enabled = preference.load();
    if (enabled === sent || running) return;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) {
        retry.later();
        return;
      }
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { bykitInstructions: enabled },
        false,
        true,
      );
      sent = enabled;
      retry.reset();
    })()
      .catch((error) => {
        console.warn("Publishing the bykit setting failed", error);
        retry.later();
      })
      .finally(() => {
        running = undefined;
        if (sent !== undefined && preference.load() !== sent) push();
      });
  };
  push();
  const unsubscribe = preference.subscribe(push);
  return () => {
    unsubscribe();
    retry.stop();
  };
}
