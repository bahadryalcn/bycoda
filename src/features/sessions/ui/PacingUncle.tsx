import { useEffect, useRef } from "react";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";
import { drawPacingUncle } from "./pacingUncleArt";

/** A small decorative walker; the activity text remains the accessible status. */
export function PacingUncle({ visible = true }: { visible?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const motion = useDecorativeMotionEnabled();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let last = 0;
    let frame: number | null = null;
    let intersects = true;
    let width = 0;
    const height = 32;
    const paint = () => drawPacingUncle(ctx, width, height, elapsed.current);
    const tick = (now: number) => {
      if (now - last >= 50) {
        if (last) elapsed.current += Math.min(now - last, 100) / 1000;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      last = 0;
      const nextWidth = canvas.clientWidth;
      if (nextWidth !== width || canvas.width === 300) {
        width = nextWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      paint();
      if (motion && visible && intersects && !document.hidden && width > 0)
        frame = requestAnimationFrame(tick);
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
    document.addEventListener("visibilitychange", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      intersection?.disconnect();
      resize?.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("resize", update);
    };
  }, [motion, visible]);
  return (
    <canvas
      ref={ref}
      data-pacing-uncle
      aria-hidden="true"
      className="pointer-events-none block h-8 w-full select-none"
    />
  );
}
