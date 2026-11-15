import { useEffect, useEffectEvent } from "react";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";

/**
 * Re-runs a failed load once when the machine behind `cwd` answers again.
 * `active` means a load is currently failed: healthy screens never re-run. A
 * local path has no machine and never reloads. Pair it with a visible
 * "Try again" so the user is never left waiting on the signal alone.
 */
export function useReloadOnReconnect(
  cwd: string | undefined,
  reload: () => void,
  options: { active: boolean },
): void {
  useReloadOnMachineReconnect(
    cwd ? parseRemotePath(cwd)?.environmentId : undefined,
    reload,
    options,
  );
}

/** `useReloadOnReconnect` for a screen that knows its machine, not a path. */
export function useReloadOnMachineReconnect(
  environmentId: string | undefined,
  reload: () => void,
  { active }: { active: boolean },
): void {
  const run = useEffectEvent(reload);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- listens to the machine recovery signal only while a load is failed.
  useEffect(() => {
    if (!active || !environmentId) return;
    return subscribeRemoteRecovered((recovered) => {
      if (!recovered || recovered === environmentId) run();
    });
  }, [active, environmentId]);
}
