import { useEffect, useRef } from "react";
import { useDecorativeMotionEnabled } from "../model/decorativeMotion";
import {
  useLiveBackground,
  useLiveBackgroundIntensity,
  type LiveBackground,
} from "../model/liveBackground";
import {
  CLOSED_MOUTH,
  createLiveBackgroundScene,
  createMouthDriver,
  type LiveBackgroundPalette,
  type LiveBackgroundScene,
} from "./liveBackgroundScenes";

const FRAME_INTERVAL = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;
/** A still frame for reduced motion still shows a populated scene. */
const STILL_TIME = 12;

/** Reads a token through a probe so color-mix() and var() arrive resolved. */
function resolveColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}

function channels(color: string): readonly [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** Reuses the previous channels when the resolved tokens did not change. */
function readPalette(probe: HTMLElement, previous?: LiveBackgroundPalette): LiveBackgroundPalette {
  const content = resolveColor(probe, "--color-content");
  const accent = resolveColor(probe, "--color-accent");
  probe.style.fontFamily = "var(--font-mono)";
  const monoFont = getComputedStyle(probe).fontFamily || "monospace";
  if (
    previous &&
    previous.content === content &&
    previous.accent === accent &&
    previous.monoFont === monoFont
  ) {
    return previous;
  }
  return {
    content,
    accent,
    contentRgb: channels(content),
    accentRgb: channels(accent),
    monoFont,
  };
}

/** Settings preview: talk for a few seconds, then pause, like a reply arriving. */
function demoSpeechLength(time: number): number {
  const cycle = time % 6;
  return cycle < 3.5
    ? Math.floor((time - cycle) * 40 + cycle * 40 * (0.5 + 0.5 * Math.sin(cycle * 9)))
    : -1;
}

/**
 * Animated layer for chat panes. It follows the decorative-motion setting:
 * when motion is off or the system asks for reduced motion it paints one
 * still frame instead of running a loop.
 *
 * `speech` is the length of the reply being streamed (-1 when idle); each new
 * burst of text moves the lips drawn into the scene.
 */
export function LiveBackgroundCanvas({
  effect,
  intensity,
  active = true,
  speech = -1,
  demoSpeech = false,
  className = "",
}: {
  effect: LiveBackground;
  intensity: number;
  active?: boolean;
  speech?: number;
  demoSpeech?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  // Streamed text changes every frame; the loop reads it without restarting.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const animate = useDecorativeMotionEnabled();

  useEffect(() => {
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (effect === "none" || !canvas || !probe) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let palette = readPalette(probe);
    let scene: LiveBackgroundScene = createLiveBackgroundScene(effect, palette);
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let time = STILL_TIME;
    const mouth = createMouthDriver();

    const paint = (delta: number) => {
      if (width === 0 || height === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const length = demoSpeech ? demoSpeechLength(time) : speechRef.current;
      scene.draw(ctx, time, delta, animate ? mouth.update(time, delta, length) : CLOSED_MOUTH);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      scene.resize(width, height);
      // Advance once so a still frame shows trails and ripples, not an empty grid.
      paint(animate ? 0 : STILL_TIME);
    };

    const running = () => animate && active && !document.hidden;

    const tick = (now: number) => {
      frame = 0;
      if (!running()) return;
      frame = requestAnimationFrame(tick);
      if (last !== 0 && now - last < FRAME_INTERVAL) return;
      // Long pauses (hidden tabs, sleep) resume smoothly instead of jumping.
      const delta = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      time += delta;
      paint(delta);
    };

    const start = () => {
      if (frame !== 0 || !running()) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const refreshPalette = () => {
      const next = readPalette(probe, palette);
      if (next === palette) return;
      palette = next;
      scene = createLiveBackgroundScene(effect, palette);
      width = 0;
      height = 0;
      resize();
    };

    resize();
    start();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // Theme, accent and tint changes land as root class/style updates.
    const themeObserver = new MutationObserver(refreshPalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    document.addEventListener("visibilitychange", start);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, [effect, animate, active, demoSpeech]);

  if (effect === "none") return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none overflow-hidden ${className}`}
      style={{ opacity: intensity }}
    >
      <canvas ref={canvasRef} className="block size-full" />
      <span ref={probeRef} className="hidden" />
    </div>
  );
}

/** The chat-pane layer driven by the saved appearance setting. */
export function LiveBackgroundLayer({ active, speech }: { active: boolean; speech: number }) {
  const effect = useLiveBackground();
  const intensity = useLiveBackgroundIntensity();
  // Hidden panes release their canvas; the scene is rebuilt when shown again.
  if (!active) return null;
  return (
    <LiveBackgroundCanvas
      effect={effect}
      intensity={intensity}
      speech={speech}
      className="absolute inset-0 -z-1"
    />
  );
}
