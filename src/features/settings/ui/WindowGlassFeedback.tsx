import { invoke } from "@tauri-apps/api/core";
import { useState, useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { syncNativeGlass } from "../model/appearance";
import {
  readNativeGlassError,
  readNativeGlassPending,
  readNativeGlassRestartRequired,
  subscribeNativeGlassStatus,
} from "../model/nativeGlassStatus";
import { SettingsFeedback } from "./settingsControls";

/** Shown under the Window glass row: a failed window sync with Retry, or the restart it needs. */
export function WindowGlassFeedback({ light }: { light: boolean }) {
  const error = useSyncExternalStore(subscribeNativeGlassStatus, readNativeGlassError);
  const pending = useSyncExternalStore(subscribeNativeGlassStatus, readNativeGlassPending);
  const restartRequired = useSyncExternalStore(
    subscribeNativeGlassStatus,
    readNativeGlassRestartRequired,
  );
  if (error) {
    return (
      <SettingsFeedback
        state="error"
        action={{
          label: t("Retry"),
          pending: pending,
          onClick: () => {
            if (!readNativeGlassPending()) syncNativeGlass(light ? "light" : "dark");
          },
        }}
      >
        {t("Window transparency could not be applied.")}
      </SettingsFeedback>
    );
  }
  if (restartRequired) return <RestartNotice />;
  return null;
}

/** The window is created opaque or transparent at launch, so applying the change needs a restart.
 * It runs the same save-and-confirm quit as a manual quit, then relaunches. */
function RestartNotice() {
  const [restart, setRestart] = useState<"idle" | "pending" | "failed">("idle");
  const request = () => {
    setRestart("pending");
    invoke("request_app_restart").then(
      () => setRestart("idle"),
      () => setRestart("failed"),
    );
  };
  return (
    <SettingsFeedback
      state={restart === "failed" ? "error" : "warning"}
      action={{
        label: restart === "failed" ? t("Retry") : t("Restart now"),
        pending: restart === "pending",
        onClick: request,
      }}
    >
      {restart === "failed"
        ? t("bycoda could not restart. Restart it manually to apply the window glass change.")
        : t("Restart bycoda to apply the window glass change.")}
    </SettingsFeedback>
  );
}
