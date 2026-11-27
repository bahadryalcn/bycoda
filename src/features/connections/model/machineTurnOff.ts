import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import { knownRemoteMachine } from "./connections";
import { invalidateConnection } from "./remoteLifecycle";

/** A machine was turned off: close its SSH tunnel and Host WebSocket now and detach in-flight
 * requests. The saved machine, credential, learned routes and cached sessions stay. A failed
 * close stays on screen with a Retry, because the machine may still be connected. */
export function closeTurnedOffMachine(
  environmentId: string,
  close: (machineId: string) => Promise<unknown> = (machineId) =>
    invoke("remote_close_connection", { machineId }),
): void {
  const machine = knownRemoteMachine(environmentId);
  if (!machine) return;
  invalidateConnection(environmentId);
  const toastId = `machine-close-${environmentId}`;
  const attempt = (): void => {
    void (async () => {
      try {
        await close(machine.id);
        toast.dismiss(toastId);
      } catch {
        toast.show({
          id: toastId,
          tone: "warning",
          title: t("Couldn’t close this machine’s connection"),
          message: t("It may still be connected. Retry to close it."),
          durationMs: null,
          action: { label: t("Retry"), onClick: attempt },
        });
      }
    })();
  };
  attempt();
}
