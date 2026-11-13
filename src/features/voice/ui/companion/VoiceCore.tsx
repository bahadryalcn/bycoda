import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useEffect, useRef } from "react";
import {
  prefersReducedMotion,
  useAudioFeedbackMotionEnabled,
} from "../../../settings/public/decorativeMotion";
import { AssistantAvatarMark } from "../../../assistant/public/avatar";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import styles from "./VoiceCore.module.css";

/** Spectrum lines around the centre; enough for a smooth ring at 84 px. */
const LINES = 40;
const INNER = 23;
/** Decorative frames are painted at most this often (~30 Hz). */
const PAINT_INTERVAL_MS = 33;
const TICKS = Array.from({ length: 60 }, (_, index) => {
  const angle = (index * 6 * Math.PI) / 180;
  const length = index % 5 === 0 ? 4 : 2;
  return {
    major: index % 5 === 0,
    x1: 50 + Math.sin(angle) * 48,
    y1: 50 - Math.cos(angle) * 48,
    x2: 50 + Math.sin(angle) * (48 - length),
    y2: 50 - Math.cos(angle) * (48 - length),
  };
});
const SPOKES = Array.from({ length: LINES }, (_, index) => {
  const angle = (index / LINES) * 2 * Math.PI;
  return { sin: Math.sin(angle), cos: Math.cos(angle) };
});

function arc(radius: number, from: number, to: number) {
  const point = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(radians)).toFixed(2)} ${(50 + radius * Math.sin(radians)).toFixed(2)}`;
  };
  return `M${point(from)}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}
const OUTER_ARC = arc(40, 0, 80);
const OUTER_TAIL = arc(40, 180, 230);
const BROKEN_A = arc(40, 15, 150);
const BROKEN_B = arc(40, 195, 330);

/** Spectrum length (0..1) per line for a moment of the given state. */
function spectrum(state: VoiceVisualState, input: number, time: number, index: number) {
  const wave = Math.abs(Math.sin(index * 0.5 + time / 280) * Math.cos(index * 0.17 - time / 470));
  if (state === "user") return input * (0.45 + wave * 0.55);
  if (state === "assistant") return wave;
  if (state === "listening") return 0.08 + wave * 0.08;
  return 0;
}

/**
 * The companion's voice core: the assistant's avatar inside rings that show who has the floor.
 * The spectrum follows the measured microphone level while you speak and moves while the
 * assistant replies; arcs turn faster while it thinks and stop when voice is off or muted.
 * Decorative only; the status text beside it is authoritative.
 */
export function VoiceCore({
  state,
  level,
  name,
  avatar,
}: {
  state: VoiceVisualState;
  level: { readonly current: number };
  /** Assistant name; empty before setup, when the centre shows a plain dot. */
  name: string;
  avatar: string | undefined;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const motion = useAudioFeedbackMotionEnabled();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- paints rings and spectrum from the live audio-level ref with an animation frame while visible
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const lines = [...element.querySelectorAll<SVGLineElement>("[data-spoke]")];
    const rings = [...element.querySelectorAll<SVGGElement>("[data-turn]")];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame: number | undefined;
    let meter: ReturnType<typeof setInterval> | undefined;
    let lastPaint = -Infinity;

    function paint(time: number) {
      const measured = level.current;
      const input = Number.isFinite(measured) ? Math.max(0, Math.min(1, measured)) : 0;
      const pose = state === "listening" && input > 0.04 ? "user" : state;
      element!.dataset.pose = pose;
      rings.forEach((ring) => {
        const period = Number(ring.dataset.turn) * (state === "thinking" ? 0.18 : 1);
        const degrees = ((time / period) * 360) % 360;
        ring.setAttribute(
          "transform",
          `rotate(${(ring.dataset.reverse ? -degrees : degrees).toFixed(1)} 50 50)`,
        );
      });
      lines.forEach((line, index) => {
        const length = 1 + spectrum(pose, input, time, index) * 9;
        const { sin, cos } = SPOKES[index];
        line.setAttribute("x2", (50 + sin * (INNER + length)).toFixed(2));
        line.setAttribute("y2", (50 - cos * (INNER + length)).toFixed(2));
        line.style.opacity = (0.35 + length / 14).toFixed(2);
      });
    }
    function tick(time: number) {
      frame = undefined;
      if (time - lastPaint >= PAINT_INTERVAL_MS) {
        lastPaint = time;
        paint(time);
      }
      frame = requestAnimationFrame(tick);
    }
    function refresh() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearInterval(meter);
      frame = undefined;
      const calm = prefersReducedMotion() || !motion;
      const hearing = state === "listening" || state === "user" || state === "assistant";
      const turning = hearing || state === "thinking" || state === "connecting";
      paint(1300);
      if (document.hidden || !visible) return;
      // Reduced motion keeps the input meter, without time-based decoration.
      if (calm) {
        if (hearing) meter = setInterval(() => paint(1300), 120);
      } else if (turning) frame = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", refresh);
    reduced.addEventListener("change", refresh);
    refresh();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearInterval(meter);
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      reduced.removeEventListener("change", refresh);
    };
  }, [state, level, motion]);

  const broken = state === "error";
  return (
    <span ref={root} className={styles.core} data-state={state} aria-hidden="true">
      <svg className={styles.art} viewBox="0 0 100 100" fill="none" focusable="false">
        {TICKS.map((tick, index) => (
          <line
            key={index}
            className={tick.major ? styles.tickMajor : styles.tick}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}
        {broken ? (
          <g className={styles.arc}>
            <path d={BROKEN_A} />
            <path d={BROKEN_B} />
          </g>
        ) : (
          <>
            <g data-turn="9000" className={styles.arc}>
              <path d={OUTER_ARC} />
              <path className={styles.tail} d={OUTER_TAIL} />
            </g>
            <g data-turn="20000" data-reverse="">
              <circle className={styles.dotted} cx="50" cy="50" r="33" />
            </g>
          </>
        )}
        <g className={styles.spectrum}>
          {SPOKES.map(({ sin, cos }, index) => (
            <line
              key={index}
              data-spoke
              x1={(50 + sin * INNER).toFixed(2)}
              y1={(50 - cos * INNER).toFixed(2)}
              x2={(50 + sin * (INNER + 1)).toFixed(2)}
              y2={(50 - cos * (INNER + 1)).toFixed(2)}
            />
          ))}
        </g>
        <circle className={styles.hub} cx="50" cy="50" r="21" />
        {!name && <circle className={styles.dot} cx="50" cy="50" r="4" />}
      </svg>
      {name ? (
        <AssistantAvatarMark
          {...surfaceAttributes({ variant: "fill-subtle", radius: "pill" }, styles.avatar)}
          value={avatar}
          name={name}
          size="secondary"
          tone="secondary"
          weight="medium"
          leading="none"
        />
      ) : null}
    </span>
  );
}
