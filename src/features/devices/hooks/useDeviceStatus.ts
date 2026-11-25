import { useEffect, useState } from "react";
import { useReloadOnMachineReconnect } from "../../connections/public/useReloadOnReconnect";
import { useGracedFailure } from "../../connections/public/transientFailure";
import type { DeviceHostStatus, DevicePanelApi } from "../types";

/** Opening a surface observes the runtime; starting it remains an explicit action.
 * Rechecks a failed observation when the machine recovers. */
export function useDeviceStatus(
  api: DevicePanelApi,
  visible: boolean,
  setStatus: (value: DeviceHostStatus | undefined) => void,
  listFailed = false,
) {
  const [reload, setReload] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(visible);
  useReloadOnMachineReconnect(api.environmentId, () => setReload((value) => value + 1), {
    active: visible && (!!failure || listFailed),
  });
  const { visibleError } = useGracedFailure({
    error: visible ? failure : undefined,
    loading: visible && loading,
    retry: () => setAttempt((value) => value + 1),
    defer: true,
  });
  // Observe the current Host on open, retry and machine recovery.
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setLoading(true);
    void api.status().then(
      (value) => {
        if (current) {
          setStatus(value);
          setFailure(undefined);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (current) {
          setStatus(undefined);
          // The RPC transport logs the failure even when the panel recovers during grace.
          setFailure(() => cause);
          setLoading(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [api, visible, setStatus, reload, attempt]);
  return { reload, visibleError, loading, clearFailure: () => setFailure(undefined) };
}
