import { useEffect } from "react";
import { hostToolRequest, type HostToolTarget } from "../../connections/public/hostFeatureClient";

/** A monitor lease belongs to one mounted panel and its captured Host target. */
export function useRuntimeTerminalMonitor(
  cwd: string,
  target: HostToolTarget,
  active: boolean,
  paused: boolean,
  id: string,
  sequence: { current: number },
  timer: { current: ReturnType<typeof setTimeout> | undefined },
  read: (showBusy?: boolean) => Promise<void>,
): void {
  useEffect(() => {
    clearTimeout(timer.current);
    if (active && !paused) void read(false).catch(() => {});
    return () => {
      clearTimeout(timer.current);
      const terminalMonitor = { id, active: false, sequence: ++sequence.current };
      void hostToolRequest(
        cwd,
        "runtime.logs",
        "runtimeLogs.read",
        { terminalMonitor, limit: 1 },
        target,
      ).catch(() => {});
    };
  }, [cwd, target, active, paused, id, sequence, timer, read]);
}
