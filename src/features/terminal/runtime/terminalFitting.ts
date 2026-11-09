import type { IDisposable, Terminal } from "@xterm/xterm";
import {
  applyTerminalChrome,
  fitTerminal,
  resetGridStretch,
  type TerminalFitMode,
} from "../model/terminalLayout";

/**
 * Grid fitting for one xterm instance: shell/TUI (alternate screen) modes, the
 * stretched TUI grid, resize observation and PTY size reporting. It reports
 * sizes through `resize`; it never starts, stops or replaces a process.
 */
export function createTerminalFitting(options: {
  term: Terminal;
  outer: HTMLElement;
  host: HTMLElement;
  /** Line height the shell grid is fitted and restored with. */
  lineHeight: () => number;
  /** Report a new grid to the PTY. Rejection re-arms the next report. */
  resize: (cols: number, rows: number) => Promise<void>;
  /** The terminal has no live process yet: fit on every render. */
  isSpawned: () => boolean;
  /** The alternate screen took over: pending native-shell assistance is stale. */
  onEnterAlternateScreen: () => void;
}) {
  const { term, outer, host } = options;
  let disposed = false;
  let lastCols = 0;
  let lastRows = 0;
  let raf = 0;
  let tuiMode = false;
  let frame = 0;
  let observer: ResizeObserver | undefined;
  const subscriptions: IDisposable[] = [];

  const fitMode = (): TerminalFitMode =>
    term.buffer.active.type === "alternate" ? "tui" : "shell";

  const applySize = () => {
    if (disposed) return;
    const next = fitTerminal(term, host, fitMode(), options.lineHeight());
    if (!next) return;
    const { cols, rows } = next;
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    void options.resize(cols, rows).catch(() => {
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

  const syncAltScreenMode = () => {
    const next = fitMode() === "tui";
    if (next === tuiMode) return;
    tuiMode = next;
    if (next) options.onEnterAlternateScreen();
    applyTerminalChrome(term, outer, next);
    if (!next) resetGridStretch(term, options.lineHeight());
    lastCols = 0;
    lastRows = 0;
    schedule();
  };

  return {
    applySize,
    /** Hook xterm render/buffer events and observe the host. Call once. */
    attach() {
      subscriptions.push(
        term.onRender(() => {
          if (!options.isSpawned()) applySize();
        }),
        term.buffer.onBufferChange(syncAltScreenMode),
      );
      syncAltScreenMode();
      frame = requestAnimationFrame(applySize);
      observer = new ResizeObserver(schedule);
      observer.observe(host);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      outer.classList.remove("bycoda-terminal--alt-screen");
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
