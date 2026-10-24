import { useEffect, useRef, useSyncExternalStore } from "react";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";
import { loadCrewTheme, subscribeCrewTheme } from "../../settings/model/settings";
import { drawPacingUncle } from "./pacingUncleArt";

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
  const theme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let last: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let intersects = typeof IntersectionObserver === "undefined";
    let width = 0;
    const height = 32;
    const paint = () => drawPacingUncle(ctx, width, height, elapsed.current, theme);
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
      if (nextWidth !== width || canvas.width === 300) {
        width = nextWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      paint();
      if (motion && visible && intersects && width > 0) {
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
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    intersection?.observe(canvas);
    resize?.observe(canvas);
    window.addEventListener("resize", update);
    update();
    return () => {
      if (timer !== null) clearTimeout(timer);
      intersection?.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [motion, visible, theme]);
  return (
    <canvas
      ref={ref}
      data-pacing-uncle
      aria-hidden="true"
      className="pointer-events-none block h-8 w-full select-none"
    />
  );
}
