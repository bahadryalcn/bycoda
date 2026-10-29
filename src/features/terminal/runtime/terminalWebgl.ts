import type { IDisposable, Terminal } from "@xterm/xterm";

/**
 * A WebGL context is only held while the terminal is on screen; browsers cap
 * live contexts, and a context loss falls back to the DOM renderer. Disposing
 * this adapter only releases render resources, never the PTY.
 */
export function createTerminalWebgl(term: Terminal, canRender: () => boolean) {
  let webgl: IDisposable | null = null;
  let loading = false;
  let disposed = false;

  const drop = () => {
    webgl?.dispose();
    webgl = null;
  };

  const load = async () => {
    if (webgl || loading || disposed) return;
    loading = true;
    let created: { dispose(): void } | undefined;
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      if (disposed || !canRender()) return;
      const addon = new WebglAddon();
      created = addon;
      addon.onContextLoss(() => {
        if (webgl === addon) webgl = null;
        addon.dispose();
      });
      term.loadAddon(addon);
      webgl = addon;
      // A new renderer has no previous frame, even when the grid size is unchanged.
      term.refresh(0, term.rows - 1);
    } catch {
      // A renderer that failed to attach must not keep its WebGL context alive.
      try {
        created?.dispose();
      } catch {
        // Already torn down by the failed activation.
      }
      webgl = null;
    } finally {
      loading = false;
    }
  };

  return {
    load,
    drop,
    dispose() {
      disposed = true;
      drop();
    },
  };
}

export type TerminalWebgl = ReturnType<typeof createTerminalWebgl>;
