import { useEffect, useRef } from "react";
import type { VoiceVisual } from "../model/voiceSettings";
import type { VoiceVisualState } from "../model/voiceVisualState";
import styles from "./VoiceVisualizer.module.css";

export type VoiceVisualizerProps = {
  visual: VoiceVisual;
  state: VoiceVisualState;
  working?: boolean;
  level?: { readonly current: number };
  small?: boolean;
  /** Settings-only demonstration. Never represents live microphone or playback. */
  preview?: boolean;
};

// Original bycoda geometry, from public/brand/bycoda/app-icon.svg.
const MARK_FRAME =
  "M40.000 4.800C41.014 4.800 42.055 4.958 43.042 5.228C44.029 5.497 45.005 5.935 45.921 6.418C46.838 6.901 47.710 7.523 48.541 8.124C49.373 8.725 50.144 9.408 50.910 10.024C51.677 10.639 52.393 11.268 53.141 11.819C53.889 12.369 54.618 12.875 55.400 13.326C56.182 13.778 56.984 14.156 57.835 14.529C58.686 14.901 59.588 15.207 60.505 15.563C61.421 15.919 62.398 16.246 63.335 16.665C64.271 17.085 65.246 17.529 66.122 18.081C66.998 18.633 67.866 19.259 68.593 19.979C69.320 20.699 69.977 21.522 70.484 22.400C70.991 23.278 71.375 24.259 71.635 25.248C71.895 26.238 72.003 27.302 72.044 28.337C72.084 29.372 71.980 30.438 71.876 31.459C71.771 32.480 71.565 33.489 71.415 34.461C71.266 35.432 71.079 36.367 70.976 37.290C70.874 38.213 70.800 39.097 70.800 40.000C70.800 40.903 70.874 41.787 70.976 42.710C71.079 43.633 71.266 44.568 71.415 45.539C71.565 46.511 71.771 47.520 71.876 48.541C71.980 49.562 72.084 50.628 72.044 51.663C72.003 52.698 71.895 53.762 71.635 54.752C71.375 55.741 70.991 56.722 70.484 57.600C69.977 58.478 69.320 59.301 68.593 60.021C67.866 60.741 66.998 61.367 66.122 61.919C65.246 62.471 64.271 62.915 63.335 63.335C62.398 63.754 61.421 64.081 60.505 64.437C59.588 64.793 58.686 65.099 57.835 65.471C56.984 65.844 56.182 66.222 55.400 66.674C54.618 67.125 53.889 67.631 53.141 68.181C52.393 68.732 51.677 69.361 50.910 69.976C50.144 70.592 49.373 71.275 48.541 71.876C47.710 72.477 46.838 73.099 45.921 73.582C45.005 74.065 44.029 74.503 43.042 74.772C42.055 75.042 41.014 75.200 40.000 75.200C38.986 75.200 37.945 75.042 36.958 74.772C35.971 74.503 34.995 74.065 34.079 73.582C33.162 73.099 32.290 72.477 31.459 71.876C30.627 71.275 29.856 70.592 29.090 69.976C28.323 69.361 27.607 68.732 26.859 68.181C26.111 67.631 25.382 67.125 24.600 66.674C23.818 66.222 23.016 65.844 22.165 65.471C21.314 65.099 20.412 64.793 19.495 64.437C18.579 64.081 17.602 63.754 16.665 63.335C15.729 62.915 14.754 62.471 13.878 61.919C13.002 61.367 12.134 60.741 11.407 60.021C10.680 59.301 10.023 58.478 9.516 57.600C9.009 56.722 8.625 55.741 8.365 54.752C8.105 53.762 7.997 52.698 7.956 51.663C7.916 50.628 8.020 49.562 8.124 48.541C8.229 47.520 8.435 46.511 8.585 45.539C8.734 44.568 8.921 43.633 9.024 42.710C9.126 41.787 9.200 40.903 9.200 40.000C9.200 39.097 9.126 38.213 9.024 37.290C8.921 36.367 8.734 35.432 8.585 34.461C8.435 33.489 8.229 32.480 8.124 31.459C8.020 30.438 7.916 29.372 7.956 28.337C7.997 27.302 8.105 26.238 8.365 25.248C8.625 24.259 9.009 23.278 9.516 22.400C10.023 21.522 10.680 20.699 11.407 19.979C12.134 19.259 13.002 18.633 13.878 18.081C14.754 17.529 15.729 17.085 16.665 16.665C17.602 16.246 18.579 15.919 19.495 15.563C20.412 15.207 21.314 14.901 22.165 14.529C23.016 14.156 23.818 13.778 24.600 13.326C25.382 12.875 26.111 12.369 26.859 11.819C27.607 11.268 28.323 10.639 29.090 10.024C29.856 9.408 30.627 8.725 31.459 8.124C32.290 7.523 33.162 6.901 34.079 6.418C34.995 5.935 35.971 5.497 36.958 5.228C37.945 4.958 38.986 4.800 40.000 4.800Z";
const DROP = "M40 10C32 15 34 22 40 24C46 22 48 15 40 10Z";
const STATIC_STATES = new Set<VoiceVisualState>(["off", "muted", "error"]);
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
    let frame: number | undefined;
    let disposed = false;

    function paint(time: number, still: boolean) {
      const pose =
        preview && !still ? (Math.floor(time / 3600) % 2 ? "assistant" : "listening") : state;
      element!.dataset.state = pose;
      const measured = level?.current ?? 0;
      const input = Number.isFinite(measured) ? Math.max(0, Math.min(1, measured)) : 0;
      const amplitude = still ? 0.62 : pose === "user" ? input : rhythm(time, 0);
      const active = pose === "user" || pose === "assistant";
      const pulse = still ? 0.6 : (1 + Math.sin(time / 520)) / 2;
      const turn = still ? 45 : (time / (pose === "connecting" ? 8 : 4)) % 360;
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
          opacity = index % 2 ? 0.25 : 1;
        } else if (pose === "listening") {
          scale = 0.85 + wave * 0.12;
          opacity = 0.35 + wave * 0.5;
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
          pose === "listening"
            ? still
              ? index % 2
                ? -1.5
                : 1.5
              : Math.sin(time / 420 - index * 0.8) * 2
            : 0;
        bar.setAttribute("height", String(height));
        bar.setAttribute("y", String(40 - height / 2 + lift));
        bar.style.opacity =
          pose === "thinking"
            ? index === (still ? 1 : Math.floor(time / 220) % 4)
              ? "1"
              : "0.3"
            : "1";
      });
      waves.forEach((wave, layer) => {
        const amp = pose === "listening" ? 3 : active ? 5 + amplitude * 20 : 0;
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
              : 25 + (pose === "listening" ? pulse : 0),
        ),
      );
      ring?.setAttribute("r", String(pose === "user" ? 32 + amplitude * 4 : 32));
      arc?.setAttribute("transform", `rotate(${turn} 40 40)`);
    }

    function tick(time: number) {
      frame = undefined;
      if (disposed || document.hidden || !visible || reduced.matches) return;
      paint(time, false);
      frame = requestAnimationFrame(tick);
    }
    function refresh() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      const running =
        !disposed &&
        !document.hidden &&
        visible &&
        !reduced.matches &&
        (preview || !STATIC_STATES.has(state));
      element!.dataset.animating = String(running);
      paint(1300, true);
      if (running) frame = requestAnimationFrame(tick);
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
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      reduced.removeEventListener("change", refresh);
    };
  }, [visual, state, level, preview]);

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
            <path d={MARK_FRAME} strokeWidth="3" />
            <g data-petals>
              {[0, 60, 120, 180, 240, 300].map((angle) => (
                <g key={angle} transform={`rotate(${angle} 40 40)`}>
                  <path data-drop className={styles.drop} d={DROP} />
                </g>
              ))}
            </g>
            <path
              transform="translate(8 8) scale(.8)"
              strokeWidth="3.8"
              d="M32 33l-7 7 7 7M48 33l7 7-7 7M43 31l-6 18"
            />
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
