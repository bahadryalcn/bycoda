import type { Terminal } from "@xterm/xterm";

/**
 * On-screen tracking for one terminal. It decides when output is held or replayed,
 * when the native side is told, and when WebGL and a deferred theme update run;
 * the collaborators own those resources. Nothing here can end the process.
 */
export function createTerminalVisibility(options: {
  term: Terminal;
  host: HTMLElement;
  /** Fit before replay so held output does not wrap at a stale panel size. */
  applySize: () => void;
  setOutputVisible: (visible: boolean) => void;
  reportPtyVisibility: () => void;
  applyThemeIfStale: () => void;
  loadWebgl: () => Promise<void>;
  dropWebgl: () => void;
  onScreen: (visible: boolean) => void;
}) {
  const { term, host } = options;
  let disposed = false;
  let visible = typeof IntersectionObserver === "undefined";
  let revision = 0;
  let observer: IntersectionObserver | null = null;

  const sync = () => {
    const current = ++revision;
    if (!visible || document.hidden) {
      options.setOutputVisible(false);
      options.reportPtyVisibility();
      options.dropWebgl();
      return;
    }
    // Fit before replay: hidden output must not wrap at the previous panel size.
    // ResizeObserver and IntersectionObserver delivery order is not guaranteed.
    options.applySize();
    options.setOutputVisible(true);
    options.reportPtyVisibility();
    options.applyThemeIfStale();
    // xterm parses writes asynchronously. Redraw only after the queued output,
    // including alternate-screen switches, has reached its buffer.
    term.write("", () => {
      if (disposed || current !== revision || !visible || document.hidden) return;
      options.applySize();
      term.refresh(0, term.rows - 1);
      void options.loadWebgl();
    });
  };

  return {
    /** The terminal is actually painted: in view and the document is shown. */
    canRender: () => visible && !document.hidden,
    /** Sync once, then follow document and intersection changes. Call once. */
    start() {
      sync();
      document.addEventListener("visibilitychange", sync);
      observer =
        typeof IntersectionObserver === "undefined"
          ? null
          : new IntersectionObserver((entries) => {
              visible = entries[entries.length - 1]?.isIntersecting ?? false;
              options.onScreen(visible);
              sync();
            });
      observer?.observe(host);
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    },
  };
}
