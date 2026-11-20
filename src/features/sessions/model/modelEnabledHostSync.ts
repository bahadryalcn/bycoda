import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { retryOnLocalHostAvailable } from "../../connections/public/localHostRetry";
import type { RemoteMachine } from "../../connections";
import { disabledModelIds, subscribeModels } from "./models";

/**
 * Publishes the models turned off in Settings to this desktop's Host, which hides them from the
 * catalog it serves phones. Runs once on load, then after each change; a push that finds the
 * local Host missing or failing retries on a short backoff and when the Host reports recovery,
 * always with the current list.
 */
export function startModelEnabledHostSync(): () => void {
  let sent = "";
  let epoch = 0;
  let running: Promise<void> | undefined;
  const retry = retryOnLocalHostAvailable(
    () => push(),
    () => {
      sent = "";
      epoch++;
    },
  );
  const push = () => {
    const disabled = disabledModelIds();
    const body = JSON.stringify(disabled);
    if (body === sent || running) return;
    const attemptEpoch = epoch;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) {
        retry.later();
        return;
      }
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { disabledModels: disabled },
        false,
        true,
      );
      if (attemptEpoch === epoch) sent = body;
      retry.reset();
    })()
      .catch((error) => {
        console.warn("Publishing enabled models failed", error);
        retry.later();
      })
      .finally(() => {
        running = undefined;
        if (JSON.stringify(disabledModelIds()) !== body || attemptEpoch !== epoch) push();
      });
  };
  push();
  const unsubscribe = subscribeModels(push);
  return () => {
    unsubscribe();
    retry.stop();
  };
}
