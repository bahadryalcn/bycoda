import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { externalTunnelApi, ExternalTunnelController } from "../model/externalTunnelController";
import { remoteBackoffDelay } from "../model/remotePollingPolicy";
import type { RemoteMachine } from "../model/protocol";

/**
 * One machine's tunnel controller and its status poll. Mount it keyed by machine identity so
 * responses cannot cross hosts; `active` pauses the poll (a hidden or unselected view).
 */
export function useTunnelSession(machine: RemoteMachine, active: boolean) {
  const controllerRef = useRef<ExternalTunnelController | null>(null);
  if (!controllerRef.current)
    controllerRef.current = new ExternalTunnelController(
      machine.environmentId,
      externalTunnelApi(machine),
    );
  const controller = controllerRef.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [action, setAction] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Runs one mutation at a time; `action` names the control that shows the pending state. */
  const run = async (name: string, work: () => Promise<boolean>) => {
    if (controller.getSnapshot().pending) return false;
    setAction(name);
    try {
      return await work();
    } finally {
      setAction(null);
    }
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Holds this machine's tunnel controller and status poll until unmount, then closes the controller and cancels its timer.
  useEffect(() => {
    controller.activate();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    // Consecutive failed reads lengthen the wait, as the other machine pollers do.
    let failures = 0;
    const poll = async (fresh = false) => {
      if (disposed) return;
      if (activeRef.current && (!document.hidden || fresh)) {
        await controller.refresh(fresh);
        failures = controller.getSnapshot().phase === "error" ? failures + 1 : 0;
      }
      if (!disposed)
        timer = setTimeout(() => void poll(), failures ? remoteBackoffDelay(failures) : 3_000);
    };
    void poll(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.close();
    };
  }, [controller]);
  return {
    controller,
    state,
    action,
    run,
    overview: state.overview,
    ready: state.phase === "ready" && !state.pending,
  };
}

export type TunnelSession = ReturnType<typeof useTunnelSession>;
