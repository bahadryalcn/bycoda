import { useEffect, useState } from "react";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useReloadOnMachineReconnect } from "../../connections/public/useReloadOnReconnect";
import type { DeviceHostStatus, DevicePanelApi } from "../types";

/** Opening a surface observes the runtime; starting it remains an explicit action.
 * Returns a counter that changes once when the machine answers again while this
 * status read or the caller's device list (listFailed) is failed; the list effect re-runs on it. */
export function useDeviceStatus(
  api: DevicePanelApi,
  visible: boolean,
  setStatus: (value: DeviceHostStatus | undefined) => void,
  setError: (value: string) => void,
  setBusy: (value: boolean) => void,
  listFailed = false,
): number {
  const [reload, setReload] = useState(0);
  const [statusFailed, setStatusFailed] = useState(false);
  useReloadOnMachineReconnect(api.environmentId, () => setReload((value) => value + 1), {
    active: statusFailed || listFailed,
  });
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setBusy(true);
    void api.status().then(
      (value) => {
        if (current) {
          setStatus(value);
          setStatusFailed(false);
          setBusy(false);
        }
      },
      (cause: unknown) => {
        if (current) {
          setStatus(undefined);
          setStatusFailed(true);
          setError(presentRemoteError(cause, { explicit: true }));
          setBusy(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [api, visible, setStatus, setError, setBusy, reload]);
  return reload;
}
