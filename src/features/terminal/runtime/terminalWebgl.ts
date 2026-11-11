import type { IDisposable, Terminal } from "@xterm/xterm";

/**
 * How long a hidden terminal keeps its renderer. Rebuilding one (dynamic import, new context,
 * refit) in the frame that reopens the dock is a visible hitch, so it is kept for minutes.
 */
export const WEBGL_IDLE_DROP_MS = 5 * 60_000;

/**
 * Browsers cap live WebGL contexts (about 16) and force-lose the oldest, which stalls painting.
 * Beyond this many held contexts, the longest-hidden terminals release theirs at once instead of
 * waiting out the idle time.
 */
export const WEBGL_CONTEXT_CAP = 8;

/** Adapters holding a context, in load order. The value drops it when the terminal is hidden. */
const held = new Map<object, () => void>();

/**
 * A WebGL context is only held while the terminal is on screen; browsers cap
 * live contexts, and a context loss falls back to the DOM renderer. Disposing
 * this adapter only releases render resources, never the PTY.
 */
export function createTerminalWebgl(
  term: Terminal,
  canRender: () => boolean,
  onRendererChange: () => void = () => {},
) {
  let webgl: IDisposable | null = null;
  let context: WebGL2RenderingContext | null = null;
  let loading = false;
  let disposed = false;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;
  const id = {};

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
    held.delete(id);
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

  /** Frees the oldest hidden terminals' contexts until the cap holds again. */
  const enforceCap = () => {
    for (const [owner, dropIfHidden] of held) {
      if (held.size <= WEBGL_CONTEXT_CAP) return;
      if (owner !== id) dropIfHidden();
    }
  };

  const load = async () => {
    cancelDrop();
    if (webgl || loading || disposed) return;
    loading = true;
    let created: { dispose(): void } | undefined;
    let before: Set<HTMLCanvasElement> | undefined;
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      if (disposed || !canRender()) return;
      const addon = new WebglAddon();
      created = addon;
      addon.onContextLoss(() => {
        const current = webgl === addon;
        if (current) {
          webgl = null;
          context = null;
          held.delete(id);
        }
        addon.dispose();
        if (current && !disposed && canRender()) onRendererChange();
      });
      before = new Set(term.element?.querySelectorAll("canvas") ?? []);
      term.loadAddon(addon);
      webgl = addon;
      context = rendererContext(term, before);
      held.set(id, () => {
        if (!canRender()) drop();
      });
      enforceCap();
      // DOM and WebGL round character metrics differently. A retained PTY must
      // be fitted to the new renderer even when its host size did not change.
      onRendererChange();
      // A new renderer has no previous frame, even when the grid size is unchanged.
      term.refresh(0, term.rows - 1);
    } catch {
      // A renderer that failed to attach must not keep its WebGL context alive.
      try {
        (context ?? (before ? rendererContext(term, before) : null))
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext();
      } catch {
        // The context is already gone.
      }
      try {
        created?.dispose();
      } catch {
        // Already torn down by the failed activation.
      }
      webgl = null;
      context = null;
      held.delete(id);
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
