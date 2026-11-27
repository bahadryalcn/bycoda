import { useEffect, useState } from "react";

/**
 * The webview's passive microphone permission state, or undefined while unknown. Inspecting it
 * never requests capture; WebViews without the Permissions API stay unknown until a real test.
 */
export function useMicrophonePermission(): PermissionState | undefined {
  const [permission, setPermission] = useState<PermissionState>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe the permission status without requesting capture, and remove the listener when settings close.
  useEffect(() => {
    let live = true;
    let status: PermissionStatus | undefined;
    const update = () => {
      if (live && status) setPermission(status.state);
    };
    void (async () => {
      try {
        const value = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (!value || !live) return;
        status = value;
        update();
        status.addEventListener("change", update);
      } catch {
        // Unsupported permission names stay unknown; there is no capture probe.
      }
    })();
    return () => {
      live = false;
      status?.removeEventListener("change", update);
    };
  }, []);
  return permission;
}
