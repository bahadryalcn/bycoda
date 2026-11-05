import { useEffect } from "react";
import type { DeviceHostStatus, DevicePanelApi } from "../types";

/** Opening a surface observes the runtime; starting it remains an explicit action. */
export function useDeviceStatus(
  api: DevicePanelApi,
  visible: boolean,
  setStatus: (value: DeviceHostStatus | undefined) => void,
  setError: (value: string) => void,
  setBusy: (value: boolean) => void,
) {
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setBusy(true);
    void api.status().then(
      (value) => {
        if (current) {
          setStatus(value);
          setBusy(false);
        }
      },
      (cause: unknown) => {
        if (current) {
          setStatus(undefined);
          setError(String(cause));
          setBusy(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [api, visible, setStatus, setError, setBusy]);
}
