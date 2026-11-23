import { errorText } from "../../shared/lib/errors";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { Toast } from "../../shared/ui/ToastRegion";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../shared/ui/ErrorDetails";
import { setNativeFullscreen } from "../../platform/tauri/fullscreen";
import { refreshWindowState, useNativeWindowState } from "../../platform/tauri/windowState";
import { surfaceAttributes } from "../../shared/ui/Surface";
import {
  loadMinimizeToTray,
  subscribeMinimizeToTray,
} from "../../features/settings/model/settings";
import { hideCurrentWindow } from "../model/appLifecycle";

export async function toggleWindowMaximize(): Promise<void> {
  const win = getCurrentWindow();
  if (await win.isFullscreen()) await setNativeFullscreen(false);
  else await win.toggleMaximize();
}

// Detached workspaces own their controls in the persistent Working bar.
export const WindowControlsVisible = createContext(true);

export function WindowControls() {
  const visible = useContext(WindowControlsVisible);
  return visible ? <NativeWindowControls /> : null;
}

function NativeWindowControls() {
  const t = useT();
  // Shared with every other window-state reader: one native listener per window.
  const native = useNativeWindowState();
  const isMaximized = native?.maximized ?? false;
  const isFullscreen = native?.fullscreen ?? false;
  const [error, setError] = useState<string | null>(null);
  const minimizeToTray = useSyncExternalStore(
    subscribeMinimizeToTray,
    loadMinimizeToTray,
    () => false,
  );

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await refreshWindowState().catch(() => null);
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const handleMinimize = () =>
    void runAction(minimizeToTray ? hideCurrentWindow : () => getCurrentWindow().minimize());
  const handleToggleMaximize = () => void runAction(toggleWindowMaximize);
  const handleClose = () => void runAction(() => getCurrentWindow().close());

  return (
    <div
      data-window-controls
      {...surfaceAttributes(
        { frame: "pane", edge: "inline-start" },
        "flex h-full shrink-0 items-stretch",
      )}
      data-tauri-drag-region="false"
    >
      {error ? (
        <Toast
          tone="danger"
          durationMs={null}
          message={errorHeadline(error)}
          extra={fitsOneLine(error) ? undefined : <ErrorDetails detail={error} />}
          onDismiss={() => setError(null)}
        />
      ) : null}
      <Button
        iconOnly
        label={minimizeToTray ? t("Minimize to tray") : t("Minimize window")}
        variant="caption"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleMinimize}
      >
        <Minus className="icon-sm" strokeWidth={1.75} />
      </Button>
      <Button
        iconOnly
        label={
          isFullscreen
            ? t("Exit full screen")
            : isMaximized
              ? t("Restore window")
              : t("Maximize window")
        }
        variant="caption"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
      >
        {isMaximized || isFullscreen ? (
          <Copy className="icon-sm" strokeWidth={1.75} />
        ) : (
          <Square className="icon-sm" strokeWidth={1.75} />
        )}
      </Button>
      <Button
        iconOnly
        label={t("Close window")}
        variant="caption"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleClose}
      >
        <X className="icon-sm" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
