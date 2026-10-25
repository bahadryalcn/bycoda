import { terminalOutputBuffer } from "../model/outputBuffer";
import { terminalInput } from "../model/terminalInput";
import { themePalette } from "../../../shared/theme/palette";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/model/appearancePreferences";
import { Terminal, type IDisposable } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getPtyStatus,
  killPty,
  resizePty,
  readyPtyBridge,
  setPtyVisible,
  spawnPty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import { isOscColorQuery, oscColorReply } from "../model/terminalChrome";
import { shouldPollTerminalMeta } from "../model/terminalMetaPolling";
import {
  isMacTerminalClearShortcut,
  isTerminalTextEdit,
  macTerminalShortcutData,
  terminalToolShortcut,
} from "../model/terminalKeys";
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
import { TerminalTools, type TerminalTool } from "./TerminalTools";
import type { SshEndpoint } from "../../connections/model/serverInventory";
import { useSshShellIntegration } from "../model/sshShellIntegration";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { t } from "../../../shared/i18n";

const ServerSnippets = lazy(() =>
  import("../../connections/ui/ServerSnippets").then((module) => ({
    default: module.ServerSnippets,
  })),
);

type Props = {
  /** Surface-specific typography, independent of the code editor's text size. */
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  lineHeight?: number;
  id: string;
  cwd: string;
  /** Terminal profile to start in; the user's default when absent. */
  profile?: string;
  /** Canonical SSH-only connection. No local profile, cwd or launch replay. */
  sshConnectionId?: string;
  /** Quick connections remain ephemeral and use the same native SSH engine. */
  sshEndpoint?: SshEndpoint;
  shellIntegration?: "auto" | "bash" | "zsh" | "powershell";
  /** Native one-use approval for this ephemeral launch. Never restored. */
  agentForwardingReviewId?: string;
  expectedConfigurationDigest?: string;
  httpProxyTicketId?: string;
  /** A structured native integration prompt, never inferred from terminal text. */
  onSshPromptReady?: () => void;
  /** Lifecycle facts only; private terminal bytes and prompts remain in this view. */
  onLifecycle?: (state: "opened-on-computer" | "exited" | "failed" | "closed") => void;
  /** Optional reviewed source guard immediately before a new native spawn. */
  canStart?: () => boolean;
  /** A pending mobile request must still be authorized immediately before native spawn. */
  authorizeStart?: () => Promise<boolean>;
  onStartupReview?: () => Promise<void>;
  onEnableShellIntegration?: (shell?: "bash" | "zsh" | "powershell") => void;
  /** Explicit local ssh-keygen in a private PTY; never restored or replayed. */
  keyGenerationPath?: string;
  active: boolean;
  onReturnToServers?: () => void;
  onReconnect?: () => Promise<void>;
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

function terminalTheme(light: boolean, scope?: HTMLElement, opaque = false) {
  return {
    background: opaque
      ? cssColor(
          "var(--terminal-canvas, var(--ui-surface))",
          light ? themePalette.hexfafafa : themePalette.hex171717,
          scope,
        )
      : themePalette.hex00000000,
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
  const font = loadAppearancePreferences().terminalFont.trim();
  if (font) return `${JSON.stringify(font)}, monospace`;
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

export function TerminalView({
  fontSize,
  onFontSizeChange,
  lineHeight,
  id,
  cwd,
  profile,
  sshConnectionId,
  sshEndpoint,
  shellIntegration,
  agentForwardingReviewId,
  expectedConfigurationDigest,
  httpProxyTicketId,
  onSshPromptReady,
  onLifecycle,
  canStart,
  authorizeStart,
  onStartupReview,
  onEnableShellIntegration,
  keyGenerationPath,
  active,
  onReturnToServers,
  onReconnect,
  onMetaChange,
}: Props) {
  const typographyRef = useRef({ fontSize, lineHeight });
  const lifecycleRef = useRef(onLifecycle);
  const canStartRef = useRef(canStart);
  const authorizeStartRef = useRef(authorizeStart);
  useLayoutEffect(() => {
    authorizeStartRef.current = authorizeStart;
  }, [authorizeStart]);
  useLayoutEffect(() => {
    canStartRef.current = canStart;
  }, [canStart]);
  useLayoutEffect(() => {
    lifecycleRef.current = onLifecycle;
  }, [onLifecycle]);
  const fontSizeCallback = useRef(onFontSizeChange);
  useLayoutEffect(() => {
    fontSizeCallback.current = onFontSizeChange;
  }, [onFontSizeChange]);
  const zoomSizeRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    typographyRef.current = { fontSize, lineHeight };
    zoomSizeRef.current = null;
  }, [fontSize, lineHeight]);
  const privateTerminal = Boolean(sshConnectionId || sshEndpoint || keyGenerationPath);
  const integrated = Boolean(
    (shellIntegration === "auto" ||
      shellIntegration === "bash" ||
      shellIntegration === "zsh" ||
      shellIntegration === "powershell") &&
    (sshConnectionId || sshEndpoint),
  );
  const remoteShell = useSshShellIntegration(id, integrated);
  const promptCallback = useRef(onSshPromptReady);
  useLayoutEffect(() => {
    promptCallback.current = onSshPromptReady;
  }, [onSshPromptReady]);
  const promptedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      integrated &&
      remoteShell.state?.id === id &&
      remoteShell.state.status === "ready" &&
      remoteShell.state.promptReady === true &&
      promptedId.current !== id
    ) {
      promptedId.current = id;
      promptCallback.current?.();
    }
  }, [id, integrated, remoteShell.state]);
  const remoteShellRef = useRef(remoteShell);
  remoteShellRef.current = remoteShell;
  const activeRef = useRef(active);
  activeRef.current = active;
  const composingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const invalidateRemoteShell = remoteShell.invalidate;
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  // Same signal as the WebGL addon: the terminal is actually on screen. Without
  // IntersectionObserver there is no signal, so assume visible.
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === "undefined");
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [tool, setTool] = useState<TerminalTool>(null);
  const [shellReady, setShellReady] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectPending = useRef(false);
  const resumeInputRef = useRef<() => void>(() => {});
  const spawned = useRef(false);
  const applySizeRef = useRef<() => void>(() => {});
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const runningProcessRef = useRef<string | null>(null);
  /** Refreshes the foreground-process title now (set by the status poll). */
  const metaPokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;

    let preferences = loadAppearancePreferences();
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: monoFont(),
      fontSize: typographyRef.current.fontSize ?? preferences.terminalSize,
      fontWeight: preferences.terminalWeight,
      lineHeight: typographyRef.current.lineHeight ?? preferences.terminalLineHeight,
      minimumContrastRatio: typographyRef.current.lineHeight ? 4.5 : 1,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: true,
      smoothScrollDuration: 0,
      theme: terminalTheme(isLightScheme(), outer, Boolean(typographyRef.current.lineHeight)),
      macOptionIsMeta: IS_MAC,
      linkHandler: { activate: activateTerminalLink },
    });
    term.open(host);
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    termRef.current = term;
    setTerminal(term);
    setShellReady(false);
    setInputError(null);
    setExitCode(undefined);
    setTool(null);
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
        if (closed || !visible || document.hidden) return;
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          if (webgl === addon) webgl = null;
          addon.dispose();
        });
        term.loadAddon(addon);
        webgl = addon;
        // A new renderer has no previous frame, even when the grid size is unchanged.
        term.refresh(0, term.rows - 1);
      } catch {
        webgl = null;
      } finally {
        webglLoading = false;
      }
    };
    const output = terminalOutputBuffer(
      (data, consumed) => term.write(data, consumed),
      undefined,
      true,
    );
    let visible = typeof IntersectionObserver === "undefined";
    // The native side holds a hidden terminal's output instead of streaming it.
    let reportedVisible: boolean | undefined;
    const reportPtyVisibility = () => {
      if (closed || !spawned.current) return;
      const next = visible && !document.hidden;
      if (next === reportedVisible) return;
      reportedVisible = next;
      void setPtyVisible(id, next).catch(() => {
        if (reportedVisible === next) reportedVisible = undefined;
      });
    };

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
    let exited = false;
    const start = async () => {
      if (closed) return;
      unsubscribe = subscribePty(
        id,
        (data, consumed) => {
          if (closed) {
            consumed?.();
            return;
          }
          output.append(data, consumed);
        },
        (code) => {
          if (closed) return;
          exited = true;
          spawned.current = false;
          ++editRevisionRef.current;
          remoteShellRef.current.suspendAutomatic();
          setTool(null);
          input.dispose();
          setShellReady(false);
          setExitCode(code ?? null);
          lifecycleRef.current?.("exited");
          term.options.disableStdin = true;
          runningProcessRef.current = null;
          if (!privateTerminal) {
            onMetaChangeRef.current?.({
              title: defaultTerminalTitle(cwdRef.current),
              foreground: null,
            });
          }
          const status = code == null ? "" : ` (${code})`;
          output.append(`
[process exited${status}]\r\n`);
        },
        true,
      );
      await readyPtyBridge();
      if (closed) return;
      if (canStartRef.current && !canStartRef.current())
        throw new Error("Reviewed terminal source changed or became private");
      if (authorizeStartRef.current && !(await authorizeStartRef.current()))
        throw new Error("Reviewed terminal authority expired or was revoked");
      if (closed || (canStartRef.current && !canStartRef.current()))
        throw new Error("Reviewed terminal source changed or became private");
      didStart = true;
      if (keyGenerationPath)
        return invoke("ssh_key_generate", {
          id,
          path: keyGenerationPath,
          cols: term.cols,
          rows: term.rows,
        });
      if (sshConnectionId) {
        return invoke<void>("ssh_terminal_spawn", {
          id,
          connectionId: sshConnectionId,
          cols: term.cols,
          rows: term.rows,
          ...(shellIntegration ? { shellIntegration } : {}),
          ...(agentForwardingReviewId ? { agentForwardingReviewId } : {}),
          ...(expectedConfigurationDigest ? { expectedConfigurationDigest } : {}),
          ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
        });
      }
      if (sshEndpoint)
        return invoke<void>("ssh_terminal_quick_spawn", {
          id,
          endpoint: sshEndpoint,
          cols: term.cols,
          rows: term.rows,
          ...(shellIntegration ? { shellIntegration } : {}),
          ...(agentForwardingReviewId ? { agentForwardingReviewId } : {}),
          ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
        });
      return spawnPty(id, cwd, term.cols, term.rows, profileRef.current ?? loadTerminalProfile());
    };

    const starting = (stoppingPtys.get(id) ?? Promise.resolve())
      .then(start)
      .then(() => {
        if (!closed && !exited) {
          spawned.current = true;
          reportPtyVisibility();
          setShellReady(true);
          const command = privateTerminal ? undefined : takeTerminalCommand(id);
          if (command) return writePty(id, `${command}\r`);
        }
      })
      .catch((error) => {
        lifecycleRef.current?.("failed");
        spawned.current = false;
        if (!closed) {
          const message = error instanceof Error ? error.message : String(error);
          exited = true;
          term.options.disableStdin = true;
          remoteShellRef.current.suspendAutomatic();
          setShellReady(false);
          setExitCode(null);
          setInputError(message);
          term.writeln(`\x1b[31m${message}\x1b[0m`);
        }
        throw error;
      });
    void starting.catch(() => undefined);
    void starting.then(
      () => {
        if (!closed && !exited) lifecycleRef.current?.("opened-on-computer");
      },
      () => {},
    );

    const input = terminalInput(
      async (data) => {
        await starting;
        if (closed || exited) throw new Error("Terminal is disconnected.");
        await writePty(id, data);
      },
      (error) => {
        if (closed) return;
        term.options.disableStdin = true;
        remoteShellRef.current.suspendAutomatic();
        setTool(null);
        const message = error instanceof Error ? error.message : String(error);
        setInputError(message);
      },
    );
    resumeInputRef.current = () => {
      if (closed || exited) return;
      input.resume();
      term.options.disableStdin = false;
      setInputError(null);
      term.focus();
    };

    const dataSub = term.onData((data) => {
      // A submitted command may start a foreground process: refresh the title soon.
      if (data.includes("\r")) setTimeout(() => metaPokeRef.current(), 400);
      const revision = ++editRevisionRef.current;
      const composingInput = composingRef.current;
      // Do not inject a snapshot chord between native history/completion/search
      // keystrokes. PSReadLine/Readline own those navigation groups.
      const textEdit = isTerminalTextEdit(data);
      if (integrated) {
        invalidateRemoteShell(textEdit);
        setTool((current) => (current === "remote" ? null : current));
      }
      void input.enqueue(data).then((written) => {
        if (!written) return;
        if (
          integrated &&
          textEdit &&
          !closed &&
          !exited &&
          revision === editRevisionRef.current &&
          activeRef.current &&
          onScreenRef.current &&
          !composingInput &&
          !composingRef.current &&
          term.buffer.active.type !== "alternate"
        )
          remoteShellRef.current.notifyInput();
      });
    });
    const onCompositionStart = () => {
      ++editRevisionRef.current;
      composingRef.current = true;
      remoteShellRef.current.suspendAutomatic();
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
    };
    host.addEventListener("compositionstart", onCompositionStart);
    host.addEventListener("compositionend", onCompositionEnd);

    const replyOsc = (code: 10 | 11 | 12, hex: string) => {
      const reply = oscColorReply(code, hex);
      if (reply) {
        void input.enqueue(reply);
      }
      return true;
    };
    // xterm already decodes the stream, so cwd reports come from its parser
    // (split sequences included) instead of a second per-chunk decode here.
    // Replayed output for a not-yet-mounted terminal flows through term.write too.
    const oscCwd = term.parser.registerOscHandler(7, (data) => {
      if (privateTerminal) return false;
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

    // Root class/style mutations (drag, resize, sliders) arrive in bursts and
    // mostly leave the palette alone: probe once per frame, assign only a change
    // (it repaints and rebuilds the WebGL atlas), and defer hidden terminals.
    let appliedTheme = "";
    let themeStale = false;
    let themeFrame = 0;
    const applyTheme = () => {
      themeStale = false;
      const theme = terminalTheme(
        isLightScheme(),
        outer,
        Boolean(typographyRef.current.lineHeight),
      );
      const key = JSON.stringify(theme);
      if (key === appliedTheme) return;
      appliedTheme = key;
      term.options.theme = theme;
    };
    const onSchemeChange = () => {
      if (!visible || document.hidden) {
        themeStale = true;
        return;
      }
      if (themeFrame) return;
      themeFrame = requestAnimationFrame(() => {
        themeFrame = 0;
        if (!closed) applyTheme();
      });
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
    const themeObserver = new MutationObserver(onSchemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const onTypographyChange = () => {
      const next = loadAppearancePreferences();
      if (next.terminalSize !== preferences.terminalSize) zoomSizeRef.current = null;
      preferences = next;
      term.options.fontFamily = monoFont();
      term.options.fontSize =
        zoomSizeRef.current ?? typographyRef.current.fontSize ?? next.terminalSize;
      term.options.fontWeight = next.terminalWeight;
      term.options.lineHeight = typographyRef.current.lineHeight ?? next.terminalLineHeight;
      applySizeRef.current();
    };
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);

    // Capture before xterm and the webview can scroll a TUI or zoom the whole app.
    const onZoomWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const size = Math.max(8, Math.min(40, term.options.fontSize! + (event.deltaY < 0 ? 1 : -1)));
      if (size === term.options.fontSize) return;
      zoomSizeRef.current = size;
      term.options.fontSize = size;
      fontSizeCallback.current?.(size);
      applySizeRef.current();
    };
    host.addEventListener("wheel", onZoomWheel, { capture: true, passive: false });

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
      if (next) {
        ++editRevisionRef.current;
        remoteShellRef.current.suspendAutomatic();
      }
      applyTerminalChrome(term, outer, next);
      if (!next)
        resetGridStretch(term, typographyRef.current.lineHeight ?? preferences.terminalLineHeight);
      lastCols = 0;
      lastRows = 0;
      schedule();
    };

    const applySize = () => {
      if (closed) return;
      const next = fitTerminal(
        term,
        host,
        fitMode(),
        typographyRef.current.lineHeight ?? preferences.terminalLineHeight,
      );
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
    let visibilityRevision = 0;
    const syncOutputVisibility = () => {
      const revision = ++visibilityRevision;
      if (!visible || document.hidden) {
        output.setVisible(false);
        reportPtyVisibility();
        dropWebgl();
        return;
      }
      // Fit before replay: hidden output must not wrap at the previous panel size.
      // ResizeObserver and IntersectionObserver delivery order is not guaranteed.
      applySize();
      output.setVisible(true);
      reportPtyVisibility();
      if (themeStale) applyTheme();
      // xterm parses writes asynchronously. Redraw only after the queued output,
      // including alternate-screen switches, has reached its buffer.
      term.write("", () => {
        if (closed || revision !== visibilityRevision || !visible || document.hidden) return;
        applySize();
        term.refresh(0, term.rows - 1);
        void loadWebgl();
      });
    };
    syncOutputVisibility();
    document.addEventListener("visibilitychange", syncOutputVisibility);
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries[entries.length - 1]?.isIntersecting ?? false;
            setOnScreen(visible);
            syncOutputVisibility();
          });
    visibility?.observe(host);
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
      input.dispose();
      remoteShellRef.current.suspendAutomatic();
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
      host.removeEventListener("compositionstart", onCompositionStart);
      host.removeEventListener("compositionend", onCompositionEnd);
      window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
      themeObserver.disconnect();
      if (themeFrame) cancelAnimationFrame(themeFrame);
      window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, onTypographyChange);
      host.removeEventListener("wheel", onZoomWheel, true);
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
        .then(
          () => {
            lifecycleRef.current?.("closed");
          },
          (error) => {
            lifecycleRef.current?.("failed");
            throw error;
          },
        )
        .finally(() => {
          if (stoppingPtys.get(id) === stopping) stoppingPtys.delete(id);
        });
      stoppingPtys.set(id, stopping);
      term.dispose();
      termRef.current = null;
      spawned.current = false;
    };
  }, [
    id,
    sshConnectionId,
    sshEndpoint,
    shellIntegration,
    agentForwardingReviewId,
    expectedConfigurationDigest,
    httpProxyTicketId,
    integrated,
    keyGenerationPath,
    privateTerminal,
    invalidateRemoteShell,
  ]);

  useEffect(() => {
    if (!active || !onScreen) {
      ++editRevisionRef.current;
      remoteShellRef.current.suspendAutomatic();
    }
  }, [active, onScreen]);

  // Identity-stable: the callers pass an inline arrow, so depending on the
  // prop itself would tear down and re-arm the poll — and repeat lookup — on
  // every parent render.
  const wantsMeta = !!onMetaChange;

  useEffect(() => {
    if (privateTerminal || !wantsMeta || !onScreen || !metaSupported) return;
    // The first idle reply must clear metadata retained while hidden/reattached.
    let lastForeground: string | null | undefined;
    let inFlight = false;
    let disposed = false;
    // Polls of an unchanged title back off; focus, typing Enter or a change reset it.
    let unchanged = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (!spawned.current) return;
      // Process lookup can fall back to `ps`; an off-screen terminal or a
      // window in the background has no title anyone is reading.
      if (
        !shouldPollTerminalMeta({
          onScreen,
          documentHidden: document.hidden,
          documentFocused: document.hasFocus(),
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
            clearTimeout(timer);
            return;
          }
          const fg = foreground?.trim() || null;
          runningProcessRef.current = fg;
          if (fg === lastForeground) {
            unchanged += 1;
            return;
          }
          unchanged = 0;
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
    const schedule = () => {
      clearTimeout(timer);
      if (disposed || !metaSupported) return;
      timer = setTimeout(
        () => {
          refresh();
          schedule();
        },
        unchanged >= 3 ? 7500 : 2500,
      );
    };
    const poke = () => {
      unchanged = 0;
      refresh();
      schedule();
    };
    metaPokeRef.current = poke;
    poke();
    document.addEventListener("visibilitychange", poke);
    window.addEventListener("focus", poke);
    return () => {
      disposed = true;
      clearTimeout(timer);
      metaPokeRef.current = () => {};
      document.removeEventListener("visibilitychange", poke);
      window.removeEventListener("focus", poke);
    };
  }, [id, cwd, wantsMeta, onScreen, privateTerminal]);

  useEffect(() => {
    if (!active) return;
    applySizeRef.current();
    // Keyboard tab navigation owns focus until the user enters the panel.
    if (document.activeElement?.matches('[role="tab"]:focus-visible')) return;
    termRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const preferences = loadAppearancePreferences();
    term.options.fontSize = fontSize ?? preferences.terminalSize;
    term.options.lineHeight = lineHeight ?? preferences.terminalLineHeight;
    term.options.minimumContrastRatio = lineHeight ? 4.5 : 1;
    applySizeRef.current();
  }, [fontSize, lineHeight]);

  return (
    <div
      ref={outerRef}
      className="bycoda-terminal relative flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => termRef.current?.focus()}
      onKeyDownCapture={(event) => {
        if (snippetsOpen) return;
        if (event.nativeEvent.isComposing) return;
        const next = terminalToolShortcut(event, !privateTerminal || integrated);
        if (!next) return;
        // Scope shortcuts to this terminal (including split panes), before xterm
        // or workspace search handlers consume them.
        event.preventDefault();
        event.stopPropagation();
        if (
          next === "command" &&
          (!spawned.current || termRef.current?.buffer.active.type === "alternate")
        )
          return;
        if (next === "command" && integrated) {
          setTool("remote");
          void remoteShell.request(remoteShell.source);
          return;
        }
        if (tool === next) {
          const input = outerRef.current?.querySelector<HTMLInputElement>(
            "[data-terminal-tools] input",
          );
          input?.focus();
          input?.select();
        }
        setTool(next);
      }}
    >
      <TerminalTools
        terminalId={id}
        terminal={terminal}
        mode={tool}
        onModeChange={setTool}
        ready={shellReady}
        suggestionsAllowed={!privateTerminal}
        remoteShell={integrated ? remoteShell : undefined}
        onStartupReview={sshConnectionId ? onStartupReview : undefined}
        onEnableShellIntegration={
          !integrated && (sshConnectionId || sshEndpoint) ? onEnableShellIntegration : undefined
        }
        onSavedCommands={
          integrated && sshConnectionId
            ? () => {
                setSnippetsOpen(true);
                void remoteShell.request();
              }
            : undefined
        }
      />
      {snippetsOpen && sshConnectionId ? (
        <Modal
          title={t("Saved SSH commands")}
          onClose={() => {
            setSnippetsOpen(false);
            remoteShell.dismiss();
            termRef.current?.focus();
          }}
          fitViewport
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-(--ui-text-muted)">
            <Button
              variant="ghost"
              size="sm"
              loading={remoteShell.waiting}
              onClick={() => void remoteShell.request()}
            >
              {t("Refresh")}
            </Button>
            <span>
              {(remoteShell.error ? t(remoteShell.error) : "") ||
                t("Insert commands at an empty shell prompt. Press Enter in the terminal to run.")}
            </span>
          </div>
          <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
            <ServerSnippets
              serverId={sshConnectionId}
              serverName={
                remoteShell.state
                  ? `${remoteShell.state.user}@${remoteShell.state.host}`
                  : undefined
              }
              onInsert={
                remoteShell.state?.status === "suggestions" && remoteShell.state.prefix === ""
                  ? async (value) => {
                      const snapshot = remoteShell.state;
                      if (
                        !snapshot?.requestId ||
                        snapshot.prefix !== "" ||
                        snapshot.status !== "suggestions"
                      )
                        throw new Error("Request a fresh snapshot at an empty shell prompt");
                      await invoke("ssh_terminal_command_insert", {
                        id,
                        requestId: snapshot.requestId,
                        value,
                      });
                      remoteShell.dismiss();
                      setSnippetsOpen(false);
                      termRef.current?.focus();
                    }
                  : undefined
              }
            />
          </Suspense>
        </Modal>
      ) : null}
      {exitCode !== undefined ? (
        <div className="shrink-0 px-3 py-2">
          <Alert
            tone={exitCode === 0 ? "info" : "warning"}
            role={exitCode === 0 ? "status" : "alert"}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">
                {t("Terminal closed")}
                {exitCode != null ? ` · ${t("Exit code")}: ${exitCode}` : ""}
              </span>
              {onReconnect ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={reconnecting}
                  onClick={async () => {
                    if (reconnectPending.current) return;
                    reconnectPending.current = true;
                    setReconnecting(true);
                    try {
                      await onReconnect();
                    } catch (reason) {
                      setInputError(String(reason));
                    } finally {
                      reconnectPending.current = false;
                      setReconnecting(false);
                    }
                  }}
                >
                  {t("Reconnect")}
                </Button>
              ) : onReturnToServers ? (
                <Button size="sm" variant="secondary" onClick={onReturnToServers}>
                  {t("Back to servers")}
                </Button>
              ) : null}
            </div>
            {inputError ? <p className="mbs-2 break-words text-xs">{inputError}</p> : null}
            {inputError ? (
              <details className="mbs-2 text-xs">
                <summary className="cursor-pointer">{t("Connection details")}</summary>
                <p className="mbs-2 break-words">
                  {t(
                    "Input paused. Some input may not have reached the terminal. Check the shell before continuing.",
                  )}
                </p>
              </details>
            ) : null}
          </Alert>
        </div>
      ) : inputError !== null ? (
        <div className="shrink-0 px-3 py-2">
          <Alert tone="warning" role="alert">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">{t("Input paused")}</span>
              <Button size="sm" variant="secondary" onClick={() => resumeInputRef.current()}>
                {t("Resume input")}
              </Button>
            </div>
            <p className="mbs-1 text-xs">
              {t(
                "Input paused. Some input may not have reached the terminal. Check the shell before continuing.",
              )}
            </p>
            <details className="mbs-2 text-xs">
              <summary className="cursor-pointer">{t("Connection details")}</summary>
              <p className="mbs-2 break-words">{inputError}</p>
            </details>
          </Alert>
        </div>
      ) : null}
      <div ref={hostRef} className="bycoda-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden" />
      <TerminalSelectionMenu
        terminal={terminal}
        host={hostRef}
        active={active && onScreen && tool !== "search" && !privateTerminal}
        cwd={cwd}
      />
    </div>
  );
}
