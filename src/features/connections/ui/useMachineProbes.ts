import { useEffect, useRef, useState } from "react";
import { classifyRemoteError } from "../model/remoteFailure";
import {
  recordRemoteCapabilities,
  remoteRequest,
  reportRemoteMachineStatus,
} from "../model/connections";
import { REMOTE_PROVIDERS, type HostDescriptor, type RemoteMachine } from "../model/protocol";

/** What this page's own check learned about a machine. */
export type MachineProbe = "connected" | "provider" | "update" | "offline";

/** Checks every machine every 10 s while the window is visible and no setup job runs. */
export function useMachineProbes(machines: RemoteMachine[], busy: boolean) {
  const [status, setStatus] = useState<Record<string, MachineProbe>>({});
  const [needsUpdate, setNeedsUpdate] = useState<Record<string, boolean>>({});
  const machinesRef = useRef(machines);
  machinesRef.current = machines;
  const signature = machines.map((machine) => `${machine.id}:${machine.environmentId}`).join("|");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    const check = async () => {
      running = true;
      // Nobody sees the status while the window is hidden; the visibility
      // listener below re-checks as soon as it returns.
      if (!busy && !document.hidden)
        await Promise.all(
          machinesRef.current.map(async (machine) => {
            let label: MachineProbe = "connected";
            try {
              const host = await remoteRequest<HostDescriptor>(machine.id, "environment.describe", {
                supportedProviders: REMOTE_PROVIDERS,
              });
              if (host.environmentId !== machine.environmentId)
                throw new Error("Host identity changed. Add this machine again before continuing.");
              if (disposed) return;
              recordRemoteCapabilities(host.environmentId, host.capabilities);
              // The project rail shows the same machine; keep both in step.
              reportRemoteMachineStatus(machine.id, true);
              if (!host.providers.length) label = "provider";
              const update =
                !host.capabilities?.includes("workspace.run") ||
                !host.capabilities?.includes("git.worktreeCreate");
              if (update) label = "update";
              if (!disposed)
                setNeedsUpdate((current) => ({
                  ...current,
                  [machine.id]: update,
                }));
            } catch (reason) {
              // A busy or slow Host (for example while this computer builds) is not
              // offline: keep the last status and check again on the next round.
              if (disposed || classifyRemoteError(reason).kind === "temporary") return;
              label = "offline";
              reportRemoteMachineStatus(machine.id, false, reason);
            }
            if (!disposed) setStatus((current) => ({ ...current, [machine.id]: label }));
          }),
        );
      running = false;
      if (!disposed) timer = setTimeout(() => void check(), 10_000);
    };
    const onVisible = () => {
      if (document.hidden || running || disposed) return;
      clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signature, busy]);
  return { status, setStatus, needsUpdate };
}
