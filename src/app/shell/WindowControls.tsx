import { errorText } from "../../shared/lib/errors";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { TransientNotice } from "../../shared/ui/TransientNotice";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../shared/ui/ErrorDetails";
import { setNativeFullscreen } from "../../platform/tauri/fullscreen";
import { refreshWindowState, useNativeWindowState } from "../../platform/tauri/windowState";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { WindowTitleBarAbove } from "../../shared/ui/PaneHeader";
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

// Full-height caption buttons, flush with the title bar edge. They stay Buttons so the shared
// tooltip, focus ring and hover states apply; `data-tauri-drag-region="false"` keeps them out of
// the window drag area.
const CONTROL_CLASS = "h-full w-10 min-h-0 rounded-none";

// Detached workspaces own their controls in the persistent Working bar.
export const WindowControlsVisible = createContext(true);

/**
 * The part of a window below its chrome row. The window buttons live above it (the title bar
 * of a main window, the Working bar of a detached one), so headers inside draw none. Under a
 * title bar that spans the window they also reserve no traffic-light space and repeat no
 * Back/Forward or sidebar toggle.
 */
export function BelowWindowChrome({
  titleBarAbove,
  children,
}: {
  titleBarAbove: boolean;
  children: ReactNode;
}) {
  return (
    <WindowControlsVisible.Provider value={false}>
      <WindowTitleBarAbove.Provider value={titleBarAbove}>{children}</WindowTitleBarAbove.Provider>
    </WindowControlsVisible.Provider>
  );
}

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
        <TransientNotice
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
        tooltip={minimizeToTray ? undefined : t("Minimize")}
        tooltipSide="bottom"
        variant="ghost"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className={CONTROL_CLASS}
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
        tooltip={isFullscreen ? t("Exit full screen") : isMaximized ? t("Restore") : t("Maximize")}
        variant="ghost"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className={CONTROL_CLASS}
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
        tooltip={t("Close")}
        variant="ghost"
        motion="none"
        data-tauri-drag-region="false"
        onClick={handleClose}
        className={CONTROL_CLASS}
      >
        <X className="icon-sm" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
