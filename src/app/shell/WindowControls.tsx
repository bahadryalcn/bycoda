import { t, useLocale } from "../../shared/i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { TransientNotice } from "../../shared/ui/TransientNotice";

export async function toggleWindowMaximize(): Promise<void> {
  const win = getCurrentWindow();
  if (await win.isFullscreen()) await win.setFullscreen(false);
  else await win.toggleMaximize();
}

export function WindowControls() {
  useLocale();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let mounted = true;
    let revision = 0;

    const win = getCurrentWindow();
    const refresh = async () => {
      const current = ++revision;
      try {
        const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
        if (mounted && current === revision) {
          setIsMaximized(maximized);
          setIsFullscreen(fullscreen);
        }
      } catch {}
    };
    refreshRef.current = refresh;
    void refresh();

    void win
      .onResized(() => void refresh())
      .then((unlistenFn) => {
        if (mounted) {
          unlisten = unlistenFn;
        } else {
          unlistenFn();
        }
      })
      .catch(() => {});
    void win
      .onFocusChanged(() => void refresh())
      .then((unlistenFn) => {
        if (mounted) unlistenFocus = unlistenFn;
        else unlistenFn();
      })
      .catch(() => {});

    return () => {
      mounted = false;
      refreshRef.current = async () => {};
      unlisten?.();
      unlistenFocus?.();
    };
  }, []);

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await refreshRef.current();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const handleMinimize = () => void runAction(() => getCurrentWindow().minimize());
  const handleToggleMaximize = () => void runAction(toggleWindowMaximize);
  const handleClose = () => void runAction(() => getCurrentWindow().close());

  return (
    <div
      className="flex h-full shrink-0 items-stretch border-s border-stroke"
      data-tauri-drag-region="false"
    >
      {error ? <TransientNotice message={error} onDismiss={() => setError(null)} /> : null}
      <button
        type="button"
        title={t("Minimize")}
        aria-label={t("Minimize window")}
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content/60 active:bg-content/20"
      >
        <Minus className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={isMaximized || isFullscreen ? t("Restore") : t("Maximize")}
        aria-label={isMaximized || isFullscreen ? t("Restore window") : t("Maximize window")}
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content/60 active:bg-content/20"
      >
        {isMaximized || isFullscreen ? (
          <Copy className="size-3" strokeWidth={1.75} />
        ) : (
          <Square className="size-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title={t("Close")}
        aria-label={t("Close window")}
        data-tauri-drag-region="false"
        onClick={handleClose}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-red-600 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content/60 active:bg-red-600"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
