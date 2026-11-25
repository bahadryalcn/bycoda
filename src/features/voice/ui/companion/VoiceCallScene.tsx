import { useEffect, useRef } from "react";
import { observeResize } from "../../../../shared/lib/observeResize";
import {
  useAudioFeedbackMotionEnabled,
  usePrefersReducedMotion,
  useMotionWindowVisible,
} from "../../../settings/public/decorativeMotion";
import { paintCallBackdrop, paintCallOrb, type VoiceCallArtworkState } from "./voiceCallArtwork";
import styles from "./VoiceCore.module.css";

/** Each draw is capped independently of monitor refresh rate. */
const FRAME_INTERVAL = 1000 / 30;
const RESTING_TIME = 2.4;
const STATE_FADE_SECONDS = 0.28;

/** Decorative call art driven by the same state and microphone level as the status. */
export function VoiceCallScene({
  part,
  state,
  level,
  className,
  expanded = false,
  size = "stage",
}: {
  part: "orb" | "backdrop";
  state: VoiceCallArtworkState;
  level: { readonly current: number };
  className?: string;
  expanded?: boolean;
  size?: "stage" | "strip";
}) {
  const element = useRef<HTMLCanvasElement>(null);
  const previousState = useRef<VoiceCallArtworkState>(undefined);
  const motion = useAudioFeedbackMotionEnabled();
  const reduced = usePrefersReducedMotion();
  const windowVisible = useMotionWindowVisible();
  const active = state !== "off" && state !== "muted" && state !== "error";

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- paints the call canvas and suspends its frame loop while out of view
  useEffect(() => {
    const canvas = element.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame: number | undefined;
    let lastPaint = -Infinity;
    let time = RESTING_TIME;
    let visible = true;
    let input = 0;
    let ink = getComputedStyle(canvas).color;
    const canAnimate = motion && !reduced && windowVisible && active;
    let previous: HTMLCanvasElement | undefined;
    if (
      canAnimate &&
      previousState.current &&
      previousState.current !== state &&
      canvas.width &&
      canvas.height
    ) {
      previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d")?.drawImage(canvas, 0, 0);
    }
    previousState.current = state;
    const paint = (animate: boolean) => {
      if (canvas.width === 0 || canvas.height === 0) return;
      const measured = level.current;
      const target =
        animate && (state === "listening" || state === "user") && Number.isFinite(measured)
          ? Math.max(0, Math.min(1, measured))
          : 0;
      input += (target - input) * 0.23;
      const seconds = animate ? time : RESTING_TIME;
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      if (part === "orb") paintCallOrb(context, width, state, seconds, input, ink, expanded);
      else paintCallBackdrop(context, width, height, state, seconds, input, expanded);
      if (previous) {
        const remaining = 1 - (time - RESTING_TIME) / STATE_FADE_SECONDS;
        if (animate && remaining > 0 && previous.width && previous.height) {
          context.globalAlpha = remaining * remaining;
          context.drawImage(previous, 0, 0, width, height);
          context.globalAlpha = 1;
        } else {
          previous = undefined;
        }
      }
    };
    const tick = (now: number) => {
      if (now - lastPaint >= FRAME_INTERVAL - 1) {
        time += Number.isFinite(lastPaint) ? Math.min(now - lastPaint, 70) / 1000 : 0;
        lastPaint = now;
        paint(true);
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      lastPaint = -Infinity;
      const animate = canAnimate && !document.hidden && visible;
      canvas.dataset.animating = String(animate);
      paint(animate);
      if (animate) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // The light pools are blurred by design and do not need a high-DPI buffer.
      const ratio =
        part === "orb"
          ? Math.min(devicePixelRatio, 2)
          : Math.min(1, 480 / Math.max(rect.width, rect.height));
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      paint(canAnimate && !document.hidden && visible);
    };
    const stopResize = observeResize(canvas, resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(canvas);
    const theme = new MutationObserver(() => {
      ink = getComputedStyle(canvas).color;
      paint(frame !== undefined);
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    resize();
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      stopResize();
      intersection.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [part, state, level, motion, reduced, windowVisible, active, expanded]);

  return (
    <canvas
      ref={element}
      aria-hidden="true"
      data-call-art={part}
      data-state={state}
      data-expanded={expanded || undefined}
      data-size={part === "orb" ? size : undefined}
      className={part === "orb" ? styles.callOrb : className}
    />
  );
}
