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

  // xterm measures its cell once, with whatever font is usable at that moment. A
  // web font that becomes usable later changes the glyph metrics without any
  // option change, leaving glyphs spread over stale cells. Assigning the same
  // family is not a change to xterm, so swap it away and back to re-measure.
  let disposed = false;
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  const remeasureFont = () => {
    if (disposed) return;
    const family = monoFont();
    term.options.fontFamily = "monospace";
    term.options.fontFamily = family;
    term.clearTextureAtlas();
    applySize();
  };
  fonts?.addEventListener("loadingdone", remeasureFont);
  // Covers a font that is still loading and one nobody requested yet.
  void fonts?.load(`${term.options.fontSize}px ${monoFont()}`).then(remeasureFont, () => undefined);

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
      disposed = true;
      fonts?.removeEventListener("loadingdone", remeasureFont);
      window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);
      host.removeEventListener("wheel", onZoomWheel, true);
    },
  };
}
