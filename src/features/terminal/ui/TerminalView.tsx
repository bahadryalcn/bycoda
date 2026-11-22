import { actionContentScopeAttributes } from "../../../shared/ui/ActionHost";
import type { ISearchOptions } from "@xterm/addon-search";
import { loadAppearancePreferences } from "../../settings/model/appearancePreferences";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { getPtyStatus } from "../../../platform/tauri/pty";
import { shouldPollTerminalMeta } from "../model/terminalMetaPolling";
import { isTerminalTextEdit, terminalToolShortcut } from "../model/terminalKeys";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { defaultTerminalTitle, parseOsc7Cwd, type TerminalMetaPatch } from "../model/terminalTab";
import { isLightScheme } from "../../settings/model/appearance";
import { IS_MAC } from "../../../platform/tauri/platform";
import "@xterm/xterm/css/xterm.css";
import { activateTerminalLink } from "../model/terminalLinks";
import { TerminalSelectionMenu } from "./TerminalSelectionMenu";
import { type TerminalTool } from "./TerminalTools";
import { TerminalControls, type TerminalShellActions } from "./TerminalControls";
import type { SshEndpoint } from "../../connections/model/serverInventory";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useT } from "../../../shared/i18n";
import { useToast } from "../../../shared/ui/ToastRegion";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { reportFailure } from "../../../shared/ui/reportFailure";
import { describeRemoteError } from "../../connections/public/remoteFailure";
import { describeActionFailure, useGracedFailure } from "../../connections/public/transientFailure";
import { loadSshSnippets } from "../../connections/model/sshSnippets";
import { bindTerminalDomInput } from "../runtime/terminalDomInput";
import { createTerminalFitting } from "../runtime/terminalFitting";
import {
  createTerminalPtyRuntime,
  terminalPtyLaunch,
  type TerminalPtyRuntime,
} from "../runtime/terminalPtyRuntime";
import {
  createTerminalTheme,
  monoFont,
  registerTerminalOscColorReplies,
  terminalColors,
} from "../runtime/terminalTheme";
import { createTerminalTypography } from "../runtime/terminalTypography";
import { createTerminalVisibility } from "../runtime/terminalVisibility";
import { createTerminalWebgl } from "../runtime/terminalWebgl";

type Props = {
  toolbarTarget?: HTMLDivElement | null;
  sshConnectionName?: string;
  onSendToAgent?: (text: string) => Promise<void>;
  onSendToHost?: (text: string) => Promise<void>;
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

// Set once the backend says it cannot name a foreground process (Windows), so
// no terminal asks again.
let metaSupported = true;

function checkSavedCommand(serverId: string, initialCommand: string) {
  const command = initialCommand.trim();
  if (!command) return {};
  try {
    return {
      duplicate: loadSshSnippets(serverId).some((snippet) => snippet.command.trim() === command),
    };
  } catch (reason) {
    return { error: reason };
  }
}

async function reconnectTerminal(
  reconnect: () => unknown,
  fail: (reason: unknown) => void,
  settle: () => void,
) {
  try {
    await reconnect();
  } catch (reason) {
    fail(reason);
  } finally {
    settle();
  }
}

export function TerminalView({
  toolbarTarget,
  sshConnectionName,
  onSendToAgent,
  onSendToHost,
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
  const t = useT();
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
  const shellActions = useRef<TerminalShellActions | null>(null);
  const bindShellActions = useStableCallback((actions: TerminalShellActions | null) => {
    shellActions.current = actions;
  });
  const suspendShellSuggestions = useStableCallback(() => shellActions.current?.suspendAutomatic());
  const isActive = useStableCallback(() => active);
  const composingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const [snippets, setSnippets] = useState<{ initialCommand?: string } | null>(null);
  const toast = useToast();
  const alreadySaved = () => toast.show({ message: t("Command already saved."), tone: "info" });
  const handleSaveCommand = (initialCommand: string) => {
    if (!sshConnectionId) return;
    const { duplicate, error } = checkSavedCommand(sshConnectionId, initialCommand);
    if (error) void reportFailure(error, { toast }).catch(() => undefined);
    else if (duplicate) alreadySaved();
    else setSnippets({ initialCommand });
  };
  // Same signal as the WebGL addon: the terminal is actually on screen. Without
  // IntersectionObserver there is no signal, so assume visible.
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === "undefined");
  const isOnScreen = useStableCallback(() => onScreen);
  const getProfile = useStableCallback(() => profile);
  const getCwd = useStableCallback(() => cwd);
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [displayFontSize, setDisplayFontSize] = useState(
    fontSize ?? loadAppearancePreferences().terminalSize,
  );
  const [savedFontSize, setSavedFontSize] = useState(loadAppearancePreferences().terminalSize);
  const [searchDecorations, setSearchDecorations] = useState<ISearchOptions["decorations"]>();
  const changeFontSizeRef = useRef<(size: number) => void>(() => {});
  const resetFontSizeRef = useRef<() => void>(() => {});
  const [tool, setTool] = useState<TerminalTool>(null);
  const getTool = useStableCallback(() => tool);
  const [shellReady, setShellReady] = useState(false);
  const [inputError, setInputError] = useState<{ reason: unknown; message: string } | null>(null);
  const [startupError, setStartupError] = useState<unknown>();
  const [startupOutcome, setStartupOutcome] = useState<string>();
  const startupFailure = useGracedFailure({ error: startupError, scope: id });
  const startupMessage = startupOutcome ?? startupFailure.visibleError;
  // The raw reason of a connection failure is left to the central connection notice.
  const inputErrorShownCentrally = useConnectionErrorShownCentrally(inputError?.reason);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectPending = useRef(false);
  const resumeInputRef = useRef<() => void>(() => {});
  const ptyRuntimeRef = useRef<TerminalPtyRuntime | null>(null);
  const applySizeRef = useRef<() => void>(() => {});
  const getOnMetaChange = useStableCallback(() => onMetaChange);
  const runningProcessRef = useRef<string | null>(null);
  /** Refreshes the foreground-process title now (set by the status poll). */
  const metaPokeRef = useRef<() => void>(() => {});

  // Reason: publish the native lifecycle failure when its startup diagnostic becomes visible.
  useEffect(() => {
    if (startupMessage) lifecycleRef.current?.("failed");
  }, [startupMessage]);

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;

    const preferences = loadAppearancePreferences();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const colors = terminalColors(isLightScheme(), outer);
    outer.dataset.terminalCanvas = colors.canvasResolved ? "resolved" : "unresolved-backdrop";
    const term = new Terminal({
      cursorBlink: !reducedMotion?.matches,
      cursorStyle: "bar",
      fontFamily: monoFont(),
      fontSize: typographyRef.current.fontSize ?? preferences.terminalSize,
      fontWeight: preferences.terminalWeight,
      lineHeight: typographyRef.current.lineHeight ?? preferences.terminalLineHeight,
      minimumContrastRatio: colors.minimumContrastRatio,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: true,
      // The search addon registers its match highlights through xterm's
      // decoration API, which xterm gates behind this flag.
      allowProposedApi: true,
      smoothScrollDuration: 0,
      theme: colors.theme,
      macOptionIsMeta: IS_MAC,
      linkHandler: { activate: activateTerminalLink },
    });
    term.open(host);
    setDisplayFontSize(term.options.fontSize!);
    setSavedFontSize(preferences.terminalSize);
    setSearchDecorations(colors.searchDecorations);
    const onMotionChange = () => {
      term.options.cursorBlink = !reducedMotion?.matches;
    };
    reducedMotion?.addEventListener("change", onMotionChange);
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    termRef.current = term;
    setTerminal(term);
    setShellReady(false);
    setInputError(null);
    setStartupError(undefined);
    setStartupOutcome(undefined);
    setExitCode(undefined);
    setTool(null);

    // Created last (it needs the fitting and WebGL adapters), read lazily by them.
    let visibility: ReturnType<typeof createTerminalVisibility> | undefined;
    const canRender = () => visibility?.canRender() ?? false;

    // The single owner of this view's PTY: start, output/input flow and retirement.
    const pty = createTerminalPtyRuntime({
      id,
      privateTerminal,
      launch: terminalPtyLaunch({
        keyGenerationPath,
        sshConnectionId,
        sshEndpoint,
        shellIntegration,
        agentForwardingReviewId,
        expectedConfigurationDigest,
        httpProxyTicketId,
        cwd,
        profile: () => getProfile(),
      }),
      dimensions: () => ({ cols: term.cols, rows: term.rows }),
      writeOutput: (data, consumed) => term.write(data, consumed),
      isVisible: canRender,
      canStart: canStartRef,
      authorizeStart: authorizeStartRef,
      lifecycle: (state) => lifecycleRef.current?.(state),
      onExit: (code) => {
        ++editRevisionRef.current;
        shellActions.current?.suspendAutomatic();
        setTool(null);
        setShellReady(false);
        setExitCode(code ?? null);
        term.options.disableStdin = true;
        runningProcessRef.current = null;
        if (!privateTerminal) {
          getOnMetaChange()?.({
            title: defaultTerminalTitle(getCwd()),
            foreground: null,
          });
        }
      },
      onSpawned: () => setShellReady(true),
      onStartFailed: (error, attemptedLaunch) => {
        term.options.disableStdin = true;
        shellActions.current?.suspendAutomatic();
        setShellReady(false);
        if (attemptedLaunch) {
          const failure = describeActionFailure(error);
          if (failure.transient) setStartupError(error);
          else setStartupOutcome(failure.message);
        } else {
          setStartupError(error);
        }
      },
      onInputFailure: (reason) => {
        term.options.disableStdin = true;
        shellActions.current?.suspendAutomatic();
        setTool(null);
        setInputError({ reason, message: describeRemoteError(reason).message });
      },
    });
    ptyRuntimeRef.current = pty;
    pty.start();

    const domInput = bindTerminalDomInput({
      term,
      host,
      onCompositionStart: () => {
        ++editRevisionRef.current;
        composingRef.current = true;
        shellActions.current?.suspendAutomatic();
      },
      onCompositionEnd: () => {
        composingRef.current = false;
      },
    });

    resumeInputRef.current = () => {
      if (!pty.resumeInput()) return;
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
        shellActions.current?.invalidate(textEdit);
        if (getTool() === "remote") setTool(null);
      }
      void pty.enqueueInput(data).then((written) => {
        if (!written) return;
        if (
          integrated &&
          textEdit &&
          pty.live &&
          revision === editRevisionRef.current &&
          isActive() &&
          isOnScreen() &&
          !composingInput &&
          !composingRef.current &&
          term.buffer.active.type !== "alternate"
        )
          shellActions.current?.notifyInput();
      });
    });

    // xterm already decodes the stream, so cwd reports come from its parser
    // (split sequences included) instead of a second per-chunk decode here.
    // Replayed output for a not-yet-mounted terminal flows through term.write too.
    const oscCwd = term.parser.registerOscHandler(7, (data) => {
      if (privateTerminal) return false;
      const cwd = parseOsc7Cwd(data);
      const onMeta = getOnMetaChange();
      if (cwd && onMeta && !pty.detached) {
        const patch: TerminalMetaPatch = { cwd };
        if (!runningProcessRef.current) patch.title = defaultTerminalTitle(cwd);
        onMeta(patch);
      }
      return false;
    });
    const oscColorReplies = registerTerminalOscColorReplies(term, outer, (reply) => {
      void pty.enqueueInput(reply);
    });

    const theme = createTerminalTheme({
      term,
      outer,
      canRender,
      onSearchDecorations: setSearchDecorations,
    });
    const typography = createTerminalTypography({
      term,
      host,
      initialPreferences: preferences,
      typography: typographyRef,
      zoomSize: zoomSizeRef,
      onFontSizeChange: fontSizeCallback,
      onDisplayFontSize: setDisplayFontSize,
      onSavedFontSize: setSavedFontSize,
      applySize: () => applySizeRef.current(),
    });
    resetFontSizeRef.current = typography.resetFontSize;
    changeFontSizeRef.current = typography.changeFontSize;

    const fitting = createTerminalFitting({
      term,
      outer,
      host,
      lineHeight: typography.lineHeight,
      resize: (cols, rows) => pty.resize(cols, rows),
      isSpawned: () => pty.spawned,
      onEnterAlternateScreen: () => {
        ++editRevisionRef.current;
        shellActions.current?.suspendAutomatic();
      },
    });
    applySizeRef.current = fitting.applySize;

    const webgl = createTerminalWebgl(term, canRender, fitting.applySize);
    visibility = createTerminalVisibility({
      term,
      host,
      applySize: fitting.applySize,
      setOutputVisible: pty.setOutputVisible,
      reportPtyVisibility: pty.reportVisibility,
      applyThemeIfStale: theme.applyIfStale,
      loadWebgl: webgl.load,
      dropWebgl: webgl.dropSoon,
      onScreen: setOnScreen,
    });
    visibility.start();
    fitting.attach();

    return () => {
      // View-driven work stops first; the process is untouched until retire().
      pty.detach();
      suspendShellSuggestions();
      fitting.dispose();
      visibility?.dispose();
      webgl.dispose();
      applySizeRef.current = () => {};
      domInput.dispose();
      theme.dispose();
      reducedMotion?.removeEventListener("change", onMotionChange);
      resetFontSizeRef.current = () => {};
      changeFontSizeRef.current = () => {};
      typography.dispose();
      dataSub.dispose();
      oscCwd.dispose();
      oscColorReplies.dispose();
      // Render resources are released. This is the only decision to end the
      // PTY: it waits for a pending start, then kills what this runtime spawned.
      void pty.retire();
      term.dispose();
      termRef.current = null;
      ptyRuntimeRef.current = null;
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
    getTool,
    suspendShellSuggestions,
    isActive,
    isOnScreen,
    getProfile,
    getCwd,
    getOnMetaChange,
  ]);

  useEffect(() => {
    if (!active || !onScreen) {
      ++editRevisionRef.current;
      shellActions.current?.suspendAutomatic();
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
      if (!ptyRuntimeRef.current?.spawned) return;
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
          if (disposed || !ptyRuntimeRef.current?.spawned) return;
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
          getOnMetaChange()?.(
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
  }, [id, cwd, wantsMeta, onScreen, privateTerminal, getOnMetaChange]);

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
    setDisplayFontSize(term.options.fontSize!);
    applySizeRef.current();
  }, [fontSize, lineHeight]);

  return (
    <div
      {...actionContentScopeAttributes()}
      ref={outerRef}
      className="bycoda-terminal relative flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={(event) => {
        if (hostRef.current?.contains(event.target as Node)) termRef.current?.focus();
      }}
      onKeyDownCapture={(event) => {
        if (snippets) return;
        if (isImeComposition(event.nativeEvent)) return;
        const next = terminalToolShortcut(event, !privateTerminal || integrated);
        if (!next) return;
        // Scope shortcuts to this terminal (including split panes), before xterm
        // or workspace search handlers consume them.
        event.preventDefault();
        event.stopPropagation();
        if (
          next === "command" &&
          (!ptyRuntimeRef.current?.spawned || termRef.current?.buffer.active.type === "alternate")
        )
          return;
        if (next === "command" && integrated) {
          setTool("remote");
          shellActions.current?.requestCurrent();
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
      <TerminalControls
        toolbarTarget={toolbarTarget}
        sshConnectionName={sshConnectionName}
        fontSize={displayFontSize}
        savedFontSize={savedFontSize}
        onResetFontSize={() => resetFontSizeRef.current()}
        onFontSizeChange={(size) => changeFontSizeRef.current(size)}
        searchDecorations={searchDecorations}
        id={id}
        terminal={terminal}
        mode={tool}
        onModeChange={setTool}
        ready={shellReady}
        suggestionsAllowed={!privateTerminal}
        integrated={integrated}
        autoIntegration={shellIntegration === "auto"}
        bindShellActions={bindShellActions}
        sshConnectionId={sshConnectionId}
        onSshPromptReady={onSshPromptReady}
        onStartupReview={sshConnectionId ? onStartupReview : undefined}
        onEnableShellIntegration={
          sshConnectionId || sshEndpoint ? onEnableShellIntegration : undefined
        }
        snippets={snippets}
        onOpenSavedCommands={() => setSnippets({})}
        onSaveSelectedCommand={handleSaveCommand}
        onCloseSnippets={() => setSnippets(null)}
        onAlreadySaved={alreadySaved}
        onSendSelectedText={onSendToAgent}
      />
      {startupFailure.pending ? (
        <LoadingText className="shrink-0 px-3 py-2" aria-busy="true" />
      ) : startupMessage || exitCode !== undefined ? (
        <div className="shrink-0 px-3 py-2">
          <Alert tone={exitCode === 0 ? "info" : "warning"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ui-caption font-medium">
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
                    await reconnectTerminal(
                      onReconnect,
                      (reason) => {
                        void reportFailure(reason, {
                          toast: { show: ({ message }) => setStartupOutcome(message) },
                        }).catch(() => undefined);
                      },
                      () => {
                        reconnectPending.current = false;
                        setReconnecting(false);
                      },
                    );
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
            {startupMessage || (inputError != null && !inputErrorShownCentrally) ? (
              <p className="mbs-2 break-words text-ui-caption">
                {startupMessage ?? inputError?.message}
              </p>
            ) : null}
            {inputError != null ? (
              <p className="mbs-2 break-words text-ui-caption text-(--ui-text-muted)">
                {t(
                  "Input paused. Some input may not have reached the terminal. Check the shell before continuing.",
                )}
              </p>
            ) : null}
          </Alert>
        </div>
      ) : inputError !== null ? (
        <div className="shrink-0 px-3 py-2">
          <Alert tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ui-caption font-medium">{t("Input paused")}</span>
              <Button size="sm" variant="secondary" onClick={() => resumeInputRef.current()}>
                {t("Resume input")}
              </Button>
            </div>
            <p className="mbs-1 text-ui-caption">
              {t(
                "Input paused. Some input may not have reached the terminal. Check the shell before continuing.",
              )}
            </p>
            {inputErrorShownCentrally ? null : (
              <p className="mbs-2 break-words text-ui-caption text-(--ui-text-muted)">
                {inputError.message}
              </p>
            )}
          </Alert>
        </div>
      ) : null}
      <div ref={hostRef} className="bycoda-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden" />
      <TerminalSelectionMenu
        terminal={terminal}
        host={hostRef}
        active={
          active &&
          onScreen &&
          tool !== "search" &&
          (!privateTerminal || !!(onSendToAgent || sshConnectionId))
        }
        onSendToAgent={onSendToAgent}
        onSendToHost={onSendToHost}
        onSaveCommand={sshConnectionId ? handleSaveCommand : undefined}
        privateTerminal={privateTerminal}
        cwd={cwd}
      />
    </div>
  );
}
