import { Button } from "../../shared/ui/Button";
import { useRef, useState, useSyncExternalStore } from "react";
import { FULLSCREEN_SHORTCUT } from "../../platform/tauri/platform";
import { setNativeFullscreen } from "../../platform/tauri/fullscreen";
import { refreshWindowState, useNativeWindowState } from "../../platform/tauri/windowState";
import {
  keybindingShortcutLabel,
  subscribeKeybindings,
} from "../../features/settings/model/settings";
import { useT } from "../../shared/i18n";
import { Maximize2, Minimize2 } from "../../shared/ui/icons";
import { TransientNotice } from "../../shared/ui/TransientNotice";

const shortcutLabel = () => keybindingShortcutLabel("App: Toggle Full Screen", FULLSCREEN_SHORTCUT);

export function FullscreenButton() {
  const t = useT();
  const shortcut = useSyncExternalStore(subscribeKeybindings, shortcutLabel, shortcutLabel);
  const fullscreen = useNativeWindowState()?.fullscreen ?? false;
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    try {
      await setNativeFullscreen();
      await refreshWindowState().catch(() => null);
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
