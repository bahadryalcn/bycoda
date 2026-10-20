import { Button } from "../../shared/ui/Button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FULLSCREEN_SHORTCUT } from "../../platform/tauri/platform";
import { setNativeFullscreen } from "../../platform/tauri/fullscreen";
import {
  keybindingShortcutLabel,
  subscribeKeybindings,
} from "../../features/settings/model/settings";
import { t, useLocale } from "../../shared/i18n";
import { Maximize2, Minimize2 } from "../../shared/ui/icons";
import { TransientNotice } from "../../shared/ui/TransientNotice";

const shortcutLabel = () => keybindingShortcutLabel("App: Toggle Full Screen", FULLSCREEN_SHORTCUT);

export function FullscreenButton() {
  useLocale();
  const shortcut = useSyncExternalStore(subscribeKeybindings, shortcutLabel, shortcutLabel);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const unlisteners: (() => void)[] = [];
    const win = getCurrentWindow();
    const refresh = async () => {
      const current = ++revision;
      try {
        const full = await win.isFullscreen();
        if (mounted && current === revision) setFullscreen(full);
      } catch {}
    };
    refreshRef.current = refresh;
    void refresh();
    for (const listen of [
      () => win.onResized(() => void refresh()),
      () => win.onFocusChanged(() => void refresh()),
    ]) {
      void listen()
        .then((unlisten) => {
          if (mounted) unlisteners.push(unlisten);
          else unlisten();
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
      refreshRef.current = async () => {};
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    try {
      await setNativeFullscreen();
      await refreshRef.current();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pending.current = false;
    }
  };
  const label = fullscreen ? t("Restore window") : t("Full screen");
  const Icon = fullscreen ? Minimize2 : Maximize2;

  return (
    <>
      {error ? <TransientNotice message={error} onDismiss={() => setError(null)} /> : null}
      <Button
        iconOnly
        label={label}
        variant="ghost"
        motion="none"
        type="button"
        title={shortcut ? `${label} (${shortcut})` : label}
        aria-label={label}
        aria-pressed={fullscreen}
        data-tauri-drag-region="false"
        onClick={() => void toggle()}
        className="size-7"
      >
        <Icon className="size-3.5" strokeWidth={1.75} />
      </Button>
    </>
  );
}
