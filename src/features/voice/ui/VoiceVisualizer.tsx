import { useEffect, useRef } from "react";
import {
  prefersReducedMotion,
  useDecorativeMotionEnabled,
} from "../../settings/public/decorativeMotion";
import brandGeometry from "../../../shared/lib/brandGeometry.json";
import type { VoiceVisual } from "../model/voiceSettings";
import type { VoiceVisualState } from "../model/voiceVisualState";
import styles from "./VoiceVisualizer.module.css";

export type VoiceVisualizerProps = {
  visual: VoiceVisual;
  state: VoiceVisualState;
  working?: boolean;
  level?: { readonly current: number };
  /** `icon` fits inside a button next to a text label. */
  small?: boolean | "icon";
  /** Settings-only demonstration. Never represents live microphone or playback. */
  preview?: boolean;
};

const STATIC_STATES = new Set<VoiceVisualState>(["off", "muted", "error"]);
/** Decorative frames are painted at most this often: the bars and arc change visibly at
 * ~30 Hz, while a per-vsync paint on a 240 Hz display mutated the SVG 60+ times a second. */
const PAINT_INTERVAL_MS = 33;
/** Connecting is status feedback, not decoration: with motion off it still steps. */
const PROGRESS_STEP_MS = 400;
const rhythm = (time: number, index: number) =>
  Math.abs(Math.sin(time / (110 + index * 37) + index * 1.7));

/** Decorative audio feedback. The companion's textual status is authoritative. */
export function VoiceVisualizer({
  visual,
  state,
  working = false,
  level,
  small = false,
  preview = false,
}: VoiceVisualizerProps) {
  const root = useRef<HTMLSpanElement>(null);
  // The decorative-motion setting stills this like the OS reduce-motion request does.
  const motion = useDecorativeMotionEnabled();
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const petals = element.querySelector<SVGGElement>("[data-petals]");
    const drops = [...element.querySelectorAll<SVGPathElement>("[data-drop]")];
    const bars = [...element.querySelectorAll<SVGRectElement>("[data-bar]")];
    const waves = [...element.querySelectorAll<SVGPathElement>("[data-wave]")];
    const core = element.querySelector<SVGCircleElement>("[data-core]");
    const ring = element.querySelector<SVGCircleElement>("[data-ring]");
    const arc = element.querySelector<SVGGElement>("[data-arc]");
    let visible = true;
    let lastPaint = -Infinity;
    let frame: number | undefined;
    let meter: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    /** Highlighted progress dot while connecting without decorative motion. */
    let step: number | undefined;

    function paint(time: number, still: boolean) {
      let pose =
        preview && !still ? (Math.floor(time / 3600) % 2 ? "assistant" : "listening") : state;
      const measured = level?.current ?? 0;
      const input = Number.isFinite(measured) ? Math.max(0, Math.min(1, measured)) : 0;
      if (!preview && pose === "listening" && input > 0.04) pose = "user";
      element!.dataset.state = pose;
      element!.dataset.hearing = String(
        !preview && (pose === "user" || pose === "listening") && input > 0.04,
      );
      const amplitude = pose === "user" && !preview ? input : still ? 0.62 : rhythm(time, 0);
      const active = pose === "user" || pose === "assistant";
      const pulse = still ? 0.6 : (1 + Math.sin(time / 520)) / 2;
      const turn = still ? 45 : (time / (pose === "connecting" ? 8 : 4)) % 360;
      const sequence = step ?? (still ? -1 : Math.floor(time / 220));
      petals?.setAttribute("transform", `rotate(${pose === "thinking" ? turn : 0} 40 40)`);
      drops.forEach((drop, index) => {
        const wave = still ? (index + 1) / 6 : (1 + Math.sin(time / 520 - index * 1.05)) / 2;
        let scale = 1;
        let opacity = 1;
        if (pose === "off" || pose === "muted") {
          scale = 0.8;
          opacity = 0.35;
        } else if (pose === "connecting") {
          scale = 0.7;
          opacity = sequence < 0 ? (index % 2 ? 0.25 : 1) : index % 6 === sequence % 6 ? 1 : 0.25;
        } else if (pose === "listening") {
          scale = preview ? 0.85 + wave * 0.12 : 0.8;
          opacity = preview ? 0.35 + wave * 0.5 : 0.45;
        } else if (pose === "thinking")
          opacity = index === (still ? 1 : Math.floor(time / 240) % 6) ? 1 : 0.2;
        else if (active)
          scale =
            0.7 +
            (pose === "user"
              ? amplitude
              : still
                ? [0.45, 0.9, 0.65, 0.35, 0.8, 0.5][index]
                : rhythm(time, index)) *
              0.6;
        drop.style.transform = `scale(${scale})`;
        drop.style.opacity = String(opacity);
      });
      bars.forEach((bar, index) => {
        const intensity = still ? [0.45, 0.9, 0.65, 0.35][index % 4] : rhythm(time, index);
        const height = active
          ? 10 + (pose === "user" ? amplitude * (0.6 + intensity * 0.4) : intensity) * 32
          : 10;
        const lift =
          pose === "listening" && preview
            ? still
              ? index % 2
                ? -1.5
                : 1.5
              : Math.sin(time / 420 - index * 0.8) * 2
            : 0;
        bar.setAttribute("height", String(height));
        bar.setAttribute("y", String(40 - height / 2 + lift));
        bar.style.opacity =
          pose === "connecting"
            ? sequence < 0 || index === sequence % 4
              ? "1"
              : "0.3"
            : pose === "thinking"
              ? index === (still ? 1 : Math.floor(time / 220) % 4)
                ? "1"
                : "0.3"
              : "1";
      });
      waves.forEach((wave, layer) => {
        const amp = pose === "listening" ? (preview ? 3 : 0) : active ? 5 + amplitude * 20 : 0;
        const phase = still ? 1.3 : time / (pose === "listening" ? 700 : 170);
        const points: string[] = [];
        for (let x = 8; x <= 152; x += 2) {
          const u = (x - 8) / 144;
          const y =
            40 +
            Math.sin(
              u * Math.PI * ((pose === "assistant" ? 2 : 3) + layer * 1.7) + phase + layer * 1.9,
            ) *
              amp *
              (1 - layer * 0.28) *
              Math.sin(Math.PI * u);
          points.push(`${x === 8 ? "M" : "L"}${x} ${y.toFixed(2)}`);
        }
        wave.setAttribute("d", points.join(" "));
      });
      core?.setAttribute(
        "r",
        String(
          pose === "thinking"
            ? 22
            : active
              ? 25 + amplitude * 4
              : 25 + (pose === "listening" && preview ? pulse : 0),
        ),
      );
      ring?.setAttribute("r", String(pose === "user" ? 32 + amplitude * 4 : 32));
      arc?.setAttribute("transform", `rotate(${turn} 40 40)`);
    }

    function tick(time: number) {
      frame = undefined;
      if (disposed || document.hidden || !visible || prefersReducedMotion() || !motion) return;
      // Repaint on the same timestamp stays allowed: callers re-sample the live meter.
      if (time === lastPaint || time - lastPaint >= PAINT_INTERVAL_MS) {
        lastPaint = time;
        paint(time, false);
      }
      frame = requestAnimationFrame(tick);
    }
    function refresh() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearInterval(meter);
      frame = undefined;
      step = undefined;
      const calm = prefersReducedMotion() || !motion;
      const running =
        !disposed && !document.hidden && visible && !calm && (preview || !STATIC_STATES.has(state));
      element!.dataset.animating = String(running);
      paint(1300, true);
      if (running) frame = requestAnimationFrame(tick);
      // Reduced motion keeps an input meter, without decorative time-based motion.
      if (
        !disposed &&
        !document.hidden &&
        visible &&
        calm &&
        !preview &&
        (state === "listening" || state === "user")
      )
        meter = setInterval(() => paint(1300, true), 120);
      // Without decorative motion, connecting steps one dot at a time instead of spinning.
      if (!disposed && !document.hidden && visible && calm && !preview && state === "connecting") {
        step = 0;
        paint(1300, true);
        meter = setInterval(() => {
          step = ((step ?? 0) + 1) % 12;
          paint(1300, true);
        }, PROGRESS_STEP_MS);
      }
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
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearInterval(meter);
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      reduced.removeEventListener("change", refresh);
    };
  }, [visual, state, level, preview, motion]);

  return (
    <span
      ref={root}
      className={styles.visualizer}
      data-visual={visual}
      data-state={state}
      data-small={small}
      data-working={working}
      aria-hidden="true"
    >
      <svg
        className={styles.art}
        viewBox={visual === "wave" ? "0 0 160 80" : "0 0 80 80"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {visual === "mark" && (
          <g>
            <path d={brandGeometry.rim} strokeWidth={brandGeometry.rimStroke} />
            <g data-petals>
              {[0, 60, 120, 180, 240, 300].map((angle) => (
                <g key={angle} transform={`rotate(${angle} 40 40)`}>
                  <path
                    data-drop
                    className={styles.drop}
                    d={brandGeometry.drop}
                    strokeWidth={brandGeometry.dropStroke}
                  />
                </g>
              ))}
            </g>
            <path fill="currentColor" stroke="none" d={brandGeometry.code} />
          </g>
        )}
        {visual === "wave" && (
          <g>
            {[0, 1, 2].map((index) => (
              <path
                key={index}
                data-wave
                className={styles.wave}
                d="M8 40H152"
                strokeWidth={index ? 1.5 : 2.5}
              />
            ))}
            <path className={styles.sweep} d="M65 40H95" strokeWidth="4" />
          </g>
        )}
        {visual === "dots" && (
          <g>
            {[0, 1, 2, 3].map((index) => (
              <rect
                key={index}
                data-bar
                x={14 + index * 14}
                y="35"
                width="10"
                height="10"
                rx="5"
                fill="currentColor"
                stroke="none"
              />
            ))}
          </g>
        )}
        {visual === "orb" && (
          <g>
            <circle
              data-core
              className={styles.core}
              cx="40"
              cy="40"
              r="25"
              fill="currentColor"
              stroke="none"
            />
            <circle data-ring className={styles.ring} cx="40" cy="40" r="32" strokeWidth="2" />
            <g className={styles.orbBars}>
              {[0, 1, 2, 3].map((index) => (
                <rect
                  key={index}
                  data-bar
                  x={26 + index * 8}
                  y="35"
                  width="4"
                  height="10"
                  rx="2"
                  fill="currentColor"
                  stroke="none"
                />
              ))}
            </g>
          </g>
        )}
        <g data-arc className={styles.arc} strokeWidth="3" transform="rotate(45 40 40)">
          <path d={visual === "wave" ? "M26 20A28 28 0 0 1 54 60" : "M40 5A35 35 0 0 1 75 40"} />
        </g>
        <g
          className={styles.off}
          strokeWidth="3"
          transform={visual === "wave" ? "translate(40 0)" : undefined}
        >
          <path d="M40 30v13M32 34a12 12 0 1 0 16 0" />
        </g>
        <g className={styles.badge} transform={visual === "wave" ? "translate(80 0)" : undefined}>
          <circle cx="64" cy="64" r="12" className={styles.badgeSurface} stroke="none" />
          <path className={styles.muted} d="M59 59l10 10M59 69l10-10" strokeWidth="2.5" />
          <path className={styles.error} d="M64 58v7M64 69v.1" strokeWidth="3" />
        </g>
      </svg>
      {working && <span className={styles.working} />}
    </span>
  );
}
