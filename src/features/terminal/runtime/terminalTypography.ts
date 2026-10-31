import type { Terminal } from "@xterm/xterm";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
  type AppearancePreferences,
} from "../../settings/model/appearancePreferences";
import { monoFont } from "./terminalTheme";

/**
 * Font, line height and per-terminal Ctrl+wheel zoom for one xterm instance.
 * Everything here changes render options in place; nothing touches the PTY.
 */
export function createTerminalTypography(options: {
  term: Terminal;
  host: HTMLElement;
  initialPreferences: AppearancePreferences;
  /** Surface-specific props; always the latest committed values. */
  typography: { readonly current: { fontSize?: number; lineHeight?: number } };
  /** Ctrl+wheel size, cleared whenever the owner or the saved size changes. */
  zoomSize: { current: number | null };
  onFontSizeChange: { readonly current: ((size: number) => void) | undefined };
  onDisplayFontSize: (size: number) => void;
  onSavedFontSize: (size: number) => void;
  applySize: () => void;
}) {
  const {
    term,
    host,
    typography,
    zoomSize,
    onFontSizeChange,
    onDisplayFontSize,
    onSavedFontSize,
    applySize,
  } = options;
  let preferences = options.initialPreferences;

  const onTypographyChange = () => {
    const next = loadAppearancePreferences();
    if (next.terminalSize !== preferences.terminalSize) zoomSize.current = null;
    preferences = next;
    term.options.fontFamily = monoFont();
    term.options.fontSize = zoomSize.current ?? typography.current.fontSize ?? next.terminalSize;
    term.options.fontWeight = next.terminalWeight;
    term.options.lineHeight = typography.current.lineHeight ?? next.terminalLineHeight;
    onDisplayFontSize(term.options.fontSize!);
    onSavedFontSize(next.terminalSize);
    applySize();
  };
  window.addEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);

  const changeFontSize = (requested: number) => {
    const size = Math.max(8, Math.min(40, requested));
    if (size === term.options.fontSize) return;
    zoomSize.current = size;
    term.options.fontSize = size;
    onDisplayFontSize(size);
    onFontSizeChange.current?.(size);
    applySize();
  };

  // Capture before xterm and the webview can scroll a TUI or zoom the whole app.
  const onZoomWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    changeFontSize(term.options.fontSize! + (event.deltaY < 0 ? 1 : -1));
  };
  host.addEventListener("wheel", onZoomWheel, {
    capture: true,
    passive: false,
  });

  term.attachCustomWheelEventHandler(() => {
    if (term.element?.classList.contains("enable-mouse-events")) return true;
    return term.buffer.active.type !== "alternate";
  });

  return {
    changeFontSize,
    /** Line height the grid should be fitted and restored with. */
    lineHeight(): number {
      return typography.current.lineHeight ?? preferences.terminalLineHeight;
    },
    resetFontSize() {
      const size = loadAppearancePreferences().terminalSize;
      zoomSize.current = null;
      term.options.fontSize = size;
      onDisplayFontSize(size);
      onFontSizeChange.current?.(size);
      applySize();
    },
    dispose() {
      window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);
      host.removeEventListener("wheel", onZoomWheel, true);
    },
  };
}
