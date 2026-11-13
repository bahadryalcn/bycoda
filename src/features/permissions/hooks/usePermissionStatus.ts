import { useEffect, useRef, useState } from "react";
import {
  listenSystemPermissionsChanged,
  systemPermissionsStatus,
  type PermissionId,
  type SystemPermissionsReport,
} from "../../../platform/tauri/systemPermissions";
import { PERMISSION_IDS, unknownPermission } from "../model/permissions";

/** Reads never prompt. Polling belongs only to a mounted setup sheet. */
export function usePermissionStatus(
  ids: readonly PermissionId[] = PERMISSION_IDS,
  setupOpen = false,
) {
  const [report, setReport] = useState<SystemPermissionsReport>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  async function refresh() {
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = await systemPermissionsStatus();
      if (mounted.current && request === generation.current) {
        setReport(next);
        setFailed(false);
      }
    } catch {
      if (mounted.current && request === generation.current) {
        setReport(undefined);
        setFailed(true);
      }
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- syncs with the window focus listener, the native system-permissions-changed event and the setup poll timer while mounted
  useEffect(() => {
    // Keep OS facts fresh on focus and native changes without requesting access.
    mounted.current = true;
    const read = () => {
      void refresh();
    };
    read();
    window.addEventListener("focus", read);
    const dispose = listenSystemPermissionsChanged((next) => {
      generation.current++;
      setReport(next);
      setFailed(false);
      setLoading(false);
    });
    const timer = setupOpen ? window.setInterval(read, 1000) : undefined;
    return () => {
      mounted.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- numeric request counter, not a DOM ref; bumping it on cleanup drops replies to reads started by this effect run
      generation.current++;
      dispose();
      window.removeEventListener("focus", read);
      window.clearInterval(timer);
    };
  }, [setupOpen]);
  return {
    report,
    loading,
    failed,
    refresh,
    entries: ids.map(
      (id) => report?.entries.find((entry) => entry.id === id) ?? unknownPermission(id),
    ),
  };
}
