import { errorText } from "../../shared/lib/errors";
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
import { Toast } from "../../shared/ui/ToastRegion";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../shared/ui/ErrorDetails";

const shortcutLabel = () => keybindingShortcutLabel("App: Toggle Full Screen", FULLSCREEN_SHORTCUT);

/** Never rejects: a failure is handed to `onError`. */
async function runFullscreenToggle(onError: (message: string) => void): Promise<void> {
  try {
    await setNativeFullscreen();
    await refreshWindowState().catch(() => null);
  } catch (failure) {
    onError(errorText(failure));
  }
}

/** Native full-screen state, its toggle and the failure notice the caller renders. */
export function useFullscreenToggle() {
  const t = useT();
  const shortcut = useSyncExternalStore(subscribeKeybindings, shortcutLabel, shortcutLabel);
  const fullscreen = useNativeWindowState()?.fullscreen ?? false;
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    await runFullscreenToggle(setError);
    pending.current = false;
  };
  const notice = error ? (
    <Toast
      tone="danger"
      durationMs={null}
      message={errorHeadline(error)}
      extra={fitsOneLine(error) ? undefined : <ErrorDetails detail={error} />}
      onDismiss={() => setError(null)}
    />
  ) : null;
  return {
    fullscreen,
    label: fullscreen ? t("Exit full screen") : t("Full screen"),
    shortcut,
    toggle: () => void toggle(),
    notice,
  };
}

export function FullscreenButton() {
  const { fullscreen, label, shortcut, toggle, notice } = useFullscreenToggle();
  const Icon = fullscreen ? Minimize2 : Maximize2;

  return (
    <>
      {notice}
      <Button
        iconOnly
        label={label}
        variant="ghost"
        motion="none"
        type="button"
        shortcut={shortcut}
        aria-pressed={fullscreen}
        data-tauri-drag-region="false"
        onClick={toggle}
      >
        <Icon className="icon-sm" strokeWidth={1.75} />
      </Button>
    </>
  );
}
