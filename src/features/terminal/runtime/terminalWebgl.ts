import type { IDisposable, Terminal } from "@xterm/xterm";

/**
 * How long a hidden terminal keeps its renderer. Quick hide/show cycles (such as
 * toggling the dock) reuse one context instead of building a new one each time.
 */
export const WEBGL_IDLE_DROP_MS = 10_000;

/**
 * A WebGL context is only held while the terminal is on screen; browsers cap
 * live contexts, and a context loss falls back to the DOM renderer. Disposing
 * this adapter only releases render resources, never the PTY.
 */
export function createTerminalWebgl(term: Terminal, canRender: () => boolean) {
  let webgl: IDisposable | null = null;
  let context: WebGL2RenderingContext | null = null;
  let loading = false;
  let disposed = false;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelDrop = () => {
    if (dropTimer === null) return;
    clearTimeout(dropTimer);
    dropTimer = null;
  };

  const drop = () => {
    cancelDrop();
    const addon = webgl;
    const gl = context;
    webgl = null;
    context = null;
    if (!addon) return;
    addon.dispose();
    // xterm leaves the context to garbage collection. Freeing it now keeps
    // repeated hide/show cycles from piling up contexts until the browser
    // force-loses them, which stalls painting for the whole window.
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // The context is already gone.
    }
  };

  /** Drop after a grace period, so a terminal shown again soon keeps its renderer. */
  const dropSoon = () => {
    if (!webgl || dropTimer !== null) return;
    dropTimer = setTimeout(() => {
      dropTimer = null;
      if (!canRender()) drop();
    }, WEBGL_IDLE_DROP_MS);
  };

  const load = async () => {
    cancelDrop();
    if (webgl || loading || disposed) return;
    loading = true;
    let created: { dispose(): void } | undefined;
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      if (disposed || !canRender()) return;
      const addon = new WebglAddon();
      created = addon;
      addon.onContextLoss(() => {
        if (webgl === addon) {
          webgl = null;
          context = null;
        }
        addon.dispose();
      });
      const before = new Set(term.element?.querySelectorAll("canvas") ?? []);
      term.loadAddon(addon);
      webgl = addon;
      context = rendererContext(term, before);
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
      context = null;
    } finally {
      loading = false;
    }
  };

  return {
    load,
    drop,
    dropSoon,
    dispose() {
      disposed = true;
      drop();
    },
  };
}

/** The WebGL2 context of the canvas the addon just attached. Its other canvases are 2D. */
function rendererContext(
  term: Terminal,
  before: ReadonlySet<HTMLCanvasElement>,
): WebGL2RenderingContext | null {
  for (const canvas of term.element?.querySelectorAll("canvas") ?? []) {
    if (before.has(canvas)) continue;
    // Every new canvas already holds a context, so this returns the existing
    // WebGL2 one (or null for a 2D canvas) and never creates a context.
    const gl = canvas.getContext("webgl2");
    if (gl) return gl;
  }
  return null;
}

export type TerminalWebgl = ReturnType<typeof createTerminalWebgl>;
