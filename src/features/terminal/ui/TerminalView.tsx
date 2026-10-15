import { terminalOutputBuffer } from "../model/outputBuffer";
import { themePalette } from "../../../shared/theme/palette";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/model/appearancePreferences";
import { Terminal, type IDisposable } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useRef, useState } from "react";
import {
  getPtyStatus,
  killPty,
  resizePty,
  spawnPty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import { isOscColorQuery, oscColorReply } from "../model/terminalChrome";
import { shouldPollTerminalMeta } from "../model/terminalMetaPolling";
import { isMacTerminalClearShortcut, macTerminalShortcutData } from "../model/terminalKeys";
import { defaultTerminalTitle, parseOsc7Cwd, type TerminalMetaPatch } from "../model/terminalTab";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import {
  applyTerminalChrome,
  fitTerminal,
  resetGridStretch,
  type TerminalFitMode,
} from "../model/terminalLayout";
import { IS_MAC } from "../../../platform/tauri/platform";
import { loadTerminalProfile } from "../model/terminalProfiles";
import "@xterm/xterm/css/xterm.css";
import { takeTerminalCommand } from "../model/terminalLaunchCommand";
import { activateTerminalLink } from "../model/terminalLinks";
import { TerminalSelectionMenu } from "./TerminalSelectionMenu";

type Props = {
  id: string;
  cwd: string;
  /** Terminal profile to start in; the user's default when absent. */
  profile?: string;
  active: boolean;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
};

function cssColor(expr: string, fallback: string, scope?: HTMLElement): string {
  const probe = document.createElement("span");
  probe.style.color = expr;
  (scope ?? document.body).appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  if (!color) return fallback;
  // xterm's parser and OSC replies need sRGB channels, including for modern
  // theme colors such as color-mix() and oklch().
  if (/^(?:color|oklch|oklab|lab|lch)\(/.test(color)) {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return fallback;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }
  return color;
}

function cssHexColor(expr: string, fallback: string, scope?: HTMLElement): string {
  const color = cssColor(expr, fallback, scope);
  if (/^#[\da-f]{6}$/i.test(color)) return color;
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return fallback;
  }
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const ANSI_DARK = {
  black: themePalette.hex1d2428,
  red: themePalette.dangerDark,
  green: themePalette.successDark,
  yellow: themePalette.warningDark,
  blue: themePalette.infoDark,
  magenta: themePalette.featureDark,
  cyan: themePalette.hex22d3ee,
  white: themePalette.hexe8eef2,
  brightBlack: themePalette.hex64748b,
  brightRed: themePalette.hexfca5a5,
  brightGreen: themePalette.hex86efac,
  brightYellow: themePalette.hexfde68a,
  brightBlue: themePalette.search,
  brightMagenta: themePalette.hexd8b4fe,
  brightCyan: themePalette.hex67e8f9,
  brightWhite: themePalette.hexf8fafc,
};

// One-Light-family palette tuned for a near-white canvas.
const ANSI_LIGHT = {
  black: themePalette.hex383a42,
  red: themePalette.hexe45649,
  green: themePalette.hex50a14f,
  yellow: themePalette.hexc18401,
  blue: themePalette.hex4078f2,
  magenta: themePalette.hexa626a4,
  cyan: themePalette.hex0184bc,
  white: themePalette.hexfafafa,
  brightBlack: themePalette.hex7c8591,
  brightRed: themePalette.hexdf6b60,
  brightGreen: themePalette.hex68b567,
  brightYellow: themePalette.hexd19a2f,
  brightBlue: themePalette.hex5c89f5,
  brightMagenta: themePalette.hexb54bb3,
  brightCyan: themePalette.hex1f9cc9,
  brightWhite: themePalette.solidInk,
};

function terminalTheme(light: boolean, scope?: HTMLElement) {
  return {
    background: themePalette.hex00000000,
    foreground: cssColor(
      "var(--terminal-text, var(--color-content))",
      light ? themePalette.hex2e2e2e : themePalette.hexe8eef2,
      scope,
    ),
    cursor: cssColor(
      "var(--color-accent)",
      light ? themePalette.hex4078f2 : themePalette.hex4da3f5,
      scope,
    ),
    cursorAccent: cssColor(
      "var(--terminal-canvas, var(--color-background-base))",
      light ? themePalette.solidInk : themePalette.scrim,
      scope,
    ),
    selectionBackground: cssColor(
      "var(--color-selection-strong)",
      light ? themePalette.rgba_0_0_0_0_18 : themePalette.rgba_255_255_255_0_18,
      scope,
    ),
    selectionInactiveBackground: cssColor(
      "var(--color-selection-subtle)",
      light ? themePalette.rgba_0_0_0_0_08 : themePalette.rgba_255_255_255_0_08,
      scope,
    ),
    ...(light ? ANSI_LIGHT : ANSI_DARK),
  };
}

function monoFont(): string {
  const fromCss = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return fromCss || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
}

/**
 * Teardown still in flight per PTY id. A view that mounts with an id another
 * view (or a StrictMode replay of itself) is still stopping must wait, or the
 * late kill lands on the replacement shell and drops its data handler.
 */
const stoppingPtys = new Map<string, Promise<void>>();

function oscColors(scope?: HTMLElement) {
  const light = isLightScheme();
  return {
    fg: cssHexColor(
      "var(--terminal-text, var(--color-content))",
      light ? themePalette.hex2e2e2e : themePalette.hexebebeb,
      scope,
    ),
    bg: cssHexColor(
      "var(--terminal-canvas, var(--color-background-base))",
      light ? themePalette.hexf7f7f7 : themePalette.hex171717,
      scope,
    ),
    cursor: cssHexColor(
      "var(--color-accent)",
      light ? themePalette.hex4078f2 : themePalette.hex4da3f5,
      scope,
    ),
  };
}

// Set once the backend says it cannot name a foreground process (Windows), so
// no terminal asks again.
let metaSupported = true;

export function TerminalView({ id, cwd, profile, active, onMetaChange }: Props) {
  // Same signal as the WebGL addon: the terminal is actually on screen. Without
  // IntersectionObserver there is no signal, so assume visible.
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === "undefined");
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const spawned = useRef(false);
  const applySizeRef = useRef<() => void>(() => {});
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const runningProcessRef = useRef<string | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: monoFont(),
      fontSize: loadAppearancePreferences().codeSize,
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: true,
      smoothScrollDuration: 0,
      theme: terminalTheme(isLightScheme(), outer),
      macOptionIsMeta: IS_MAC,
      linkHandler: { activate: activateTerminalLink },
    });
    term.open(host);
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    termRef.current = term;
    setTerminal(term);
    let closed = false;

    const onCopy = (event: ClipboardEvent) => {
      const text = term.getSelection();
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      term.paste(text);
    };
    // A WebGL context is only held while the terminal is on screen; browsers
    // cap live contexts, and a context loss falls back to the DOM renderer.
    let webgl: IDisposable | null = null;
    let webglLoading = false;
    const dropWebgl = () => {
      webgl?.dispose();
      webgl = null;
    };
    const loadWebgl = async () => {
      if (webgl || webglLoading || closed) return;
      webglLoading = true;
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (closed || !visible) return;
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          if (webgl === addon) webgl = null;
          addon.dispose();
        });
        term.loadAddon(addon);
        webgl = addon;
      } catch {
        webgl = null;
      } finally {
        webglLoading = false;
      }
    };
    const output = terminalOutputBuffer((data) => term.write(data));
    let visible = typeof IntersectionObserver === "undefined";
    const syncOutputVisibility = () => output.setVisible(visible && !document.hidden);
    syncOutputVisibility();
    document.addEventListener("visibilitychange", syncOutputVisibility);
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries[entries.length - 1]?.isIntersecting ?? false;
            setOnScreen(visible);
            syncOutputVisibility();
            if (visible) void loadWebgl();
            else dropWebgl();
          });
    visibility?.observe(host);

    host.addEventListener("copy", onCopy);
    host.addEventListener("paste", onPaste);

    term.attachCustomKeyEventHandler((event) => {
      const shortcutData = IS_MAC ? macTerminalShortcutData(event) : null;
      if (shortcutData) {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopPropagation();
          term.input(shortcutData);
        }
        return false;
      }
      if (IS_MAC && isMacTerminalClearShortcut(event)) {
        if (event.isComposing) return false;
        if (event.type === "keydown") {
          event.preventDefault();
          term.clear();
        }
        return false;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return true;
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (term.hasSelection()) return false;
        if (event.metaKey && !event.ctrlKey) return false;
        return true;
      }
      if (key === "v") return false;
      return true;
    });

    let unsubscribe = () => {};
    let didStart = false;
    const start = () => {
      if (closed) return;
      unsubscribe = subscribePty(
        id,
        (data) => {
          if (closed) return;
          output.append(data);
        },
        (code) => {
          if (closed) return;
          spawned.current = false;
          runningProcessRef.current = null;
          onMetaChangeRef.current?.({
            title: defaultTerminalTitle(cwdRef.current),
            foreground: null,
          });
          const status = code == null ? "" : ` (${code})`;
          output.append(`
[process exited${status}]\r\n`);
        },
      );
      didStart = true;
      return spawnPty(id, cwd, term.cols, term.rows, profileRef.current ?? loadTerminalProfile());
    };

    const starting = (stoppingPtys.get(id) ?? Promise.resolve())
      .then(start)
      .then(() => {
        if (!closed) {
          spawned.current = true;
          const command = takeTerminalCommand(id);
          if (command) return writePty(id, `${command}\r`);
        }
      })
      .catch((error) => {
        spawned.current = false;
        if (!closed) {
          const message = error instanceof Error ? error.message : String(error);
          term.writeln(`\x1b[31m${message}\x1b[0m`);
        }
        throw error;
      });
    void starting.catch(() => undefined);

    const dataSub = term.onData((data) => {
      void starting.then(() => (closed ? undefined : writePty(id, data))).catch(() => undefined);
    });

    const replyOsc = (code: 10 | 11 | 12, hex: string) => {
      const reply = oscColorReply(code, hex);
      if (reply) {
        void starting.then(() => (closed ? undefined : writePty(id, reply))).catch(() => undefined);
      }
      return true;
    };
    // xterm already decodes the stream, so cwd reports come from its parser
    // (split sequences included) instead of a second per-chunk decode here.
    // Replayed output for a not-yet-mounted terminal flows through term.write too.
    const oscCwd = term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7Cwd(data);
      const onMeta = onMetaChangeRef.current;
      if (cwd && onMeta && !closed) {
        const patch: TerminalMetaPatch = { cwd };
        if (!runningProcessRef.current) patch.title = defaultTerminalTitle(cwd);
        onMeta(patch);
      }
      return false;
    });
    const oscFg = term.parser.registerOscHandler(10, (data) =>
      isOscColorQuery(data) ? replyOsc(10, oscColors(outer).fg) : false,
    );
    const oscBg = term.parser.registerOscHandler(11, (data) =>
      isOscColorQuery(data) ? replyOsc(11, oscColors(outer).bg) : false,
    );
    const oscCursor = term.parser.registerOscHandler(12, (data) =>
      isOscColorQuery(data) ? replyOsc(12, oscColors(outer).cursor) : false,
    );

    const onSchemeChange = () => {
      term.options.theme = terminalTheme(isLightScheme(), outer);
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
    const themeObserver = new MutationObserver(onSchemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const onTypographyChange = () => {
      term.options.fontFamily = monoFont();
      term.options.fontSize = loadAppearancePreferences().codeSize;
      applySizeRef.current();
    };
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);

    term.attachCustomWheelEventHandler(() => {
      if (term.element?.classList.contains("enable-mouse-events")) return true;
      return term.buffer.active.type !== "alternate";
    });

    let lastCols = 0;
    let lastRows = 0;
    let raf = 0;
    let tuiMode = false;

    const fitMode = (): TerminalFitMode =>
      term.buffer.active.type === "alternate" ? "tui" : "shell";

    const syncAltScreenMode = () => {
      const next = fitMode() === "tui";
      if (next === tuiMode) return;
      tuiMode = next;
      applyTerminalChrome(term, outer, next);
      if (!next) resetGridStretch(term);
      lastCols = 0;
      lastRows = 0;
      schedule();
    };

    const applySize = () => {
      if (closed) return;
      const next = fitTerminal(term, host, fitMode());
      if (!next) return;
      const { cols, rows } = next;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      void starting
        .then(() => (closed ? undefined : resizePty(id, cols, rows)))
        .catch(() => {
          lastCols = 0;
          lastRows = 0;
        });
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applySize();
      });
    };

    applySizeRef.current = applySize;
    const renderSub = term.onRender(() => {
      if (!spawned.current) applySize();
    });
    const bufferSub = term.buffer.onBufferChange(syncAltScreenMode);
    syncAltScreenMode();
    const frame = requestAnimationFrame(applySize);
    const observer = new ResizeObserver(schedule);
    observer.observe(host);

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      visibility?.disconnect();
      document.removeEventListener("visibilitychange", syncOutputVisibility);
      output.dispose();
      dropWebgl();
      outer.classList.remove("bycoda-terminal--alt-screen");
      applySizeRef.current = () => {};
      host.removeEventListener("copy", onCopy);
      host.removeEventListener("paste", onPaste);
      window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
      themeObserver.disconnect();
      window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);
      dataSub.dispose();
      oscCwd.dispose();
      oscFg.dispose();
      oscBg.dispose();
      oscCursor.dispose();
      renderSub.dispose();
      bufferSub.dispose();
      const stopping = starting
        .catch(() => undefined)
        .then(() => {
          unsubscribe();
          return didStart ? killPty(id) : undefined;
        })
        .finally(() => {
          if (stoppingPtys.get(id) === stopping) stoppingPtys.delete(id);
        });
      stoppingPtys.set(id, stopping);
      term.dispose();
      termRef.current = null;
      spawned.current = false;
    };
  }, [id]);

  // Identity-stable: the callers pass an inline arrow, so depending on the
  // prop itself would tear down and re-arm the poll — and repeat lookup — on
  // every parent render.
  const wantsMeta = !!onMetaChange;

  useEffect(() => {
    if (!wantsMeta || !onScreen || !metaSupported) return;
    // The first idle reply must clear metadata retained while hidden/reattached.
    let lastForeground: string | null | undefined;
    let inFlight = false;
    let disposed = false;
    const refresh = () => {
      if (!spawned.current) return;
      // Process lookup can fall back to `ps`; an off-screen terminal or window
      // has no title to paint.
      if (
        !shouldPollTerminalMeta({
          onScreen,
          documentHidden: document.hidden,
          supported: metaSupported,
        })
      )
        return;
      if (inFlight) return;
      inFlight = true;
      void getPtyStatus(id)
        .then(({ foreground, supported }) => {
          if (disposed || !spawned.current) return;
          if (supported === false) {
            metaSupported = false;
            clearInterval(interval);
            return;
          }
          const fg = foreground?.trim() || null;
          runningProcessRef.current = fg;
          if (fg === lastForeground) return;
          lastForeground = fg;
          onMetaChangeRef.current?.(
            fg
              ? { title: fg, foreground: fg }
              : { title: defaultTerminalTitle(cwd), foreground: null },
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const interval = setInterval(refresh, 2500);
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, cwd, wantsMeta, onScreen]);

  useEffect(() => {
    if (!active) return;
    applySizeRef.current();
    termRef.current?.focus();
  }, [active]);

  return (
    <div
      ref={outerRef}
      className="bycoda-terminal flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => termRef.current?.focus()}
    >
      <div ref={hostRef} className="bycoda-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden" />
      <TerminalSelectionMenu
        terminal={terminal}
        host={hostRef}
        active={active && onScreen}
        cwd={cwd}
      />
    </div>
  );
}
