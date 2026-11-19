import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  useDecorativeMotionEnabled,
  useWindowHasFocus,
} from "../../settings/public/decorativeMotion";
import { loadCrewTheme, subscribeCrewTheme } from "../../settings/public/settings";
import { drawPacingUncle } from "./pacingUncleArt";
import {
  canvasWorkerEnabled,
  subscribeCanvasWorkerEnabled,
} from "../../../shared/lib/canvas-worker/host";
import { observeResize } from "../../../shared/lib/observeResize";
import { createPacingCanvasHost, PACING_RENDERER_ID } from "./pacingCanvasHost";

const workerSnapshot = () => canvasWorkerEnabled(PACING_RENDERER_ID);

/** About 1000 / `PACING_FPS` from the art module. */
const FRAME_MS = 83;

/**
 * A small decorative walker that follows the crew theme; the activity text
 * remains the accessible status.
 */
export function PacingUncle({ visible = true }: { visible?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const motion = useDecorativeMotionEnabled();
  // Behind another application the walker holds its pose, like the other canvas loops.
  const focused = useWindowHasFocus();
  const theme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const workerEnabled = useSyncExternalStore(
    subscribeCanvasWorkerEnabled,
    workerSnapshot,
    workerSnapshot,
  );
  // The renderer outlives pauses: gates are read by the long-lived effect below, never its deps.
  const gates = useRef({ motion, focused, visible, theme });
  const sync = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Hands the latest motion, focus, visibility and crew theme to the live walker, which only re-arms its timer and repaints.
  useEffect(() => {
    gates.current = { motion, focused, visible, theme };
    sync.current?.();
  }, [motion, focused, visible, theme]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Owns the canvas, worker host and observers for as long as the renderer kind stays the same; disposes them on change or unmount.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const worker = workerEnabled ? createPacingCanvasHost(canvas) : null;
    let last: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let intersects = typeof IntersectionObserver === "undefined";
    let width = 0;
    let workerBackingWidth = 300;
    const height = 32;
    const paint = () =>
      worker
        ? worker.draw({ width, height, elapsed: elapsed.current, theme: gates.current.theme })
        : drawPacingUncle(ctx, width, height, elapsed.current, gates.current.theme);
    // A 12 Hz timer, not a per-vsync frame chain: the pixel art only changes 12 times a
    // second, and unchanged frames (pauses, idle beads) do not touch the canvas at all.
    const tick = () => {
      const now = performance.now();
      if (last !== null) elapsed.current += Math.min(now - last, 250) / 1000;
      last = now;
      paint();
      timer = setTimeout(tick, FRAME_MS);
    };
    const update = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      last = null;
      const nextWidth = canvas.clientWidth;
      if (nextWidth !== width || (worker ? workerBackingWidth : canvas.width) === 300) {
        width = nextWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (worker) {
          workerBackingWidth = Math.round(width * dpr);
          worker.resize({ width, height, ratio: dpr });
        } else {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
      paint();
      const { motion, focused, visible } = gates.current;
      if (motion && focused && visible && intersects && width > 0) {
        last = performance.now();
        timer = setTimeout(tick, FRAME_MS);
      }
    };
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersects = entry.isIntersecting;
            update();
          });
    const stopResize = worker ? observeResize(canvas, update) : null;
    const resize =
      // oxlint-disable-next-line bycoda/shared-resize-observer -- Default-off pilot preserves the existing observer and callback sequence; worker path uses observeResize.
      worker || typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    intersection?.observe(canvas);
    resize?.observe(canvas);
    window.addEventListener("resize", update);
    update();
    sync.current = update;
    return () => {
      sync.current = null;
      if (timer !== null) clearTimeout(timer);
      intersection?.disconnect();
      resize?.disconnect();
      stopResize?.();
      worker?.dispose();
      window.removeEventListener("resize", update);
    };
  }, [workerEnabled]);
  const canvas = (
    <canvas
      ref={ref}
      data-pacing-uncle
      aria-hidden="true"
      className="pointer-events-none block h-8 w-full select-none"
    />
  );
  return workerEnabled ? <span className="relative block">{canvas}</span> : canvas;
}
