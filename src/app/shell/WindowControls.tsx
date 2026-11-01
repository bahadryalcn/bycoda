import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { createContext, useContext, useState } from "react";
import { TransientNotice } from "../../shared/ui/TransientNotice";
import { setNativeFullscreen } from "../../platform/tauri/fullscreen";
import { refreshWindowState, useNativeWindowState } from "../../platform/tauri/windowState";

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

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await refreshWindowState().catch(() => null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const handleMinimize = () => void runAction(() => getCurrentWindow().minimize());
  const handleToggleMaximize = () => void runAction(toggleWindowMaximize);
  const handleClose = () => void runAction(() => getCurrentWindow().close());

  return (
    <div
      data-window-controls
      className="flex h-full shrink-0 items-stretch border-s border-stroke"
      data-tauri-drag-region="false"
    >
      {error ? (
        <TransientNotice
          tone="danger"
          durationMs={null}
          message={error}
          onDismiss={() => setError(null)}
        />
      ) : null}
      <Button
        iconOnly
        label={t("Minimize window")}
        tooltip={t("Minimize")}
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
        label={isMaximized || isFullscreen ? t("Restore window") : t("Maximize window")}
        tooltip={isMaximized || isFullscreen ? t("Restore") : t("Maximize")}
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
        tone="danger"
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
