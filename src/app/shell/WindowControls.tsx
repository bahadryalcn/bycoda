import { useT } from "../../shared/i18n";
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
      <button
        type="button"
        title={t("Minimize")}
        aria-label={t("Minimize window")}
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className="flex w-10 items-center justify-center text-(--ui-text-secondary) transition-colors hover:bg-(--ui-surface-hover) hover:text-content focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-text-secondary) active:bg-(--ui-surface-pressed)"
      >
        <Minus className="icon-sm" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={isMaximized || isFullscreen ? t("Restore") : t("Maximize")}
        aria-label={isMaximized || isFullscreen ? t("Restore window") : t("Maximize window")}
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className="flex w-10 items-center justify-center text-(--ui-text-secondary) transition-colors hover:bg-(--ui-surface-hover) hover:text-content focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-text-secondary) active:bg-(--ui-surface-pressed)"
      >
        {isMaximized || isFullscreen ? (
          <Copy className="icon-sm" strokeWidth={1.75} />
        ) : (
          <Square className="icon-sm" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title={t("Close")}
        aria-label={t("Close window")}
        data-tauri-drag-region="false"
        onClick={handleClose}
        className="flex w-10 items-center justify-center text-(--ui-text-secondary) transition-colors hover:bg-danger hover:text-on-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-text-secondary) active:bg-danger"
      >
        <X className="icon-sm" strokeWidth={1.75} />
      </button>
    </div>
  );
}
