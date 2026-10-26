import { useEffect, useRef } from "react";
import "./LiveBackgroundCanvas.css";
import {
  decorativeMotionEnabled,
  subscribeDecorativeMotion,
  windowHasFocus,
} from "../model/decorativeMotion";
import {
  useLiveBackground,
  useLiveBackgroundIntensity,
  type LiveBackground,
} from "../model/liveBackground";
import {
  CLOSED_SIGNAL,
  createLiveSignalDriver,
  type LiveBackgroundPalette,
  type LiveSignal,
} from "./live-background";
import {
  createBackgroundRenderer,
  isAmbientBackground,
  type BackgroundRenderer,
} from "./live-background/renderer";

const FRAME_INTERVAL = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;
// Full-pane scenes must not allocate a native-resolution 4K/8K drawing buffer.
const MAX_BACKING_PIXELS = 2_500_000;
function pixelRatio(width: number, height: number): number {
  return Math.min(
    window.devicePixelRatio || 1,
    MAX_PIXEL_RATIO,
    Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, width * height)),
  );
}
/** A still frame for reduced motion still shows a populated scene. */
const STILL_TIME = 12;
/** The calm activity envelope reaches rest before the loop stops. */
const SETTLE_SECONDS = 2;
/** A provider may remain busy while waiting for a tool or approval. */
const ACTIVITY_GRACE_SECONDS = 1.5;
/** Ordinary still frames retain the resting composition of a quiet conversation. */
const STILL_SIGNAL: LiveSignal = CLOSED_SIGNAL;
/** Picker demos show their identifying artwork without animating or changing chat rest. */
const STILL_DEMO_SIGNAL: LiveSignal = { presence: 1 };

/** Reads a token through a probe so color-mix() and var() arrive resolved. */
function resolveColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}

/** Reuses the previous palette when the resolved tokens did not change. */
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
    monoFont,
  };
}

/** Settings preview: talk for a few seconds, then pause, like a reply arriving. */
function demoSpeechLength(time: number): number {
  const cycle = time % 6;
  return cycle < 3.5 ? Math.floor(time * 40) : -1;
}

/**
 * Animated layer for chat panes. It follows the decorative-motion setting:
 * when motion is off or the system asks for reduced motion it paints one
 * still frame instead of running a loop.
 *
 * `speech` is the length of the reply being streamed (-1 when idle). Its active
 * state drives presence; new text adds bounded, eased motion energy. `activity` is everything the
 * running turn has streamed, including reasoning and tools (-1 when idle). New
 * activity keeps the scene awake; an unchanged busy turn settles during waits.
 */
export function LiveBackgroundCanvas({
  effect,
  intensity,
  active = true,
  speech = -1,
  activity = speech,
  demoSpeech = false,
  still = false,
  className = "",
}: {
  effect: LiveBackground;
  intensity: number;
  active?: boolean;
  speech?: number;
  activity?: number;
  demoSpeech?: boolean;
  /** Paints one frame and never starts the loop; used for picker thumbnails. */
  still?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  // Streamed text changes every frame; the loop reads it without restarting.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const activeRef = useRef(active);
  activeRef.current = active;
  const updateLoopRef = useRef<(() => void) | null>(null);
  // Every new chunk can wake a settled scene without rebuilding its renderer.
  useEffect(() => {
    updateLoopRef.current?.();
  }, [active, speech, activity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (!still || effect === "none" || !canvas || !probe) return;
    let palette = readPalette(probe);
    let width = 0;
    let height = 0;

    // Each still frame builds, paints and releases its scene.
    const paintStill = () => {
      if (width === 0 || height === 0) return;
      const ratio = pixelRatio(width, height);
      const renderer = createBackgroundRenderer(effect, canvas, palette);
      renderer?.resize(width, height, ratio);
      renderer?.draw(STILL_TIME, 0, demoSpeech ? STILL_DEMO_SIGNAL : STILL_SIGNAL);
      renderer?.dispose();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      paintStill();
    };

    const refreshPalette = () => {
      const next = readPalette(probe, palette);
      if (next === palette) return;
      palette = next;
      paintStill();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // Theme and accent changes repaint the thumbnail in the new colors.
    const themeObserver = new MutationObserver(refreshPalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [still, effect, demoSpeech]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (still || effect === "none" || !canvas || !probe) return;
    let palette = readPalette(probe);
    let renderer: BackgroundRenderer | null = createBackgroundRenderer(effect, canvas, palette);
    const ambient = () =>
      isAmbientBackground(effect) && canvas.dataset.backgroundRenderer === "webgl";
    let contextLost = false;
    let width = 0;
    let height = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let nextDraw = 0;
    let time = STILL_TIME;
    let intersects = typeof IntersectionObserver === "undefined";
    let idleFor = 0;
    let quietFor = 0;
    let previousSpeech = speechRef.current;
    let previousActivity = activityRef.current;
    const busy = () =>
      demoSpeech ||
      (quietFor < ACTIVITY_GRACE_SECONDS && (speechRef.current >= 0 || activityRef.current >= 0));
    const refreshActivity = () => {
      if (previousSpeech === speechRef.current && previousActivity === activityRef.current) return;
      previousSpeech = speechRef.current;
      previousActivity = activityRef.current;
      quietFor = 0;
      idleFor = 0;
    };
    // Refresh on gate notifications, not every frame (the snapshot reads storage).
    let animate = decorativeMotionEnabled();
    // Repainting every cell each frame is the largest idle cost of a window behind another
    // app: keep the last painted frame until the window has focus again.
    let focused = windowHasFocus();
    const signal = createLiveSignalDriver();

    const paint = (delta: number) => {
      if (width === 0 || height === 0) return;
      const length = demoSpeech ? demoSpeechLength(time) : busy() ? speechRef.current : -1;
      const work = demoSpeech ? length : busy() ? activityRef.current : -1;
      renderer?.draw(
        time,
        delta,
        animate ? signal.update(time, delta, length, work) : CLOSED_SIGNAL,
      );
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = pixelRatio(rect.width, rect.height);
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      renderer?.resize(width, height, ratio);
      // Advance once so a still frame shows trails and ripples, not an empty grid.
      paint(animate ? 0 : STILL_TIME);
    };

    const settled = () => !ambient() && !busy() && idleFor >= SETTLE_SECONDS;
    const running = () =>
      animate &&
      !contextLost &&
      focused &&
      activeRef.current &&
      intersects &&
      width > 0 &&
      height > 0 &&
      !settled();

    const tick = (now: number) => {
      frame = 0;
      if (!running()) return;
      // Long pauses (hidden tabs, sleep) resume smoothly instead of jumping.
      const delta = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      time += delta;
      quietFor += delta;
      idleFor = busy() ? 0 : idleFor + delta;
      paint(delta);
      // The last frame stays on screen; no frame is requested until work resumes.
      if (settled()) {
        last = 0;
        nextDraw = 0;
        return;
      }
      const interval = ambient() && !busy() ? 1000 / 12 : FRAME_INTERVAL;
      // Keep a deadline instead of adding a whole interval after each vsync.
      // A timer sleeps between draws; only the due draw requests a browser frame.
      nextDraw = Math.max((nextDraw || now) + interval, now);
      timer = setTimeout(
        () => {
          timer = undefined;
          if (running()) frame = requestAnimationFrame(tick);
        },
        Math.max(0, nextDraw - performance.now()),
      );
    };

    const start = () => {
      if (busy()) idleFor = 0;
      if (frame !== 0 || timer !== undefined || !running()) return;
      last = 0;
      nextDraw = 0;
      frame = requestAnimationFrame(tick);
    };
    // Pausing cancels work without rebuilding the scene or replacing its last frame.
    const updateLoop = () => {
      refreshActivity();
      if (!running()) {
        if (frame !== 0) cancelAnimationFrame(frame);
        if (timer !== undefined) clearTimeout(timer);
        frame = 0;
        timer = undefined;
        last = 0;
        nextDraw = 0;
      } else start();
    };
    updateLoopRef.current = updateLoop;
    const syncMotion = () => {
      animate = decorativeMotionEnabled();
      focused = windowHasFocus();
      updateLoop();
    };
    const unsubscribe = subscribeDecorativeMotion(syncMotion);
    syncMotion();
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersects = entry.isIntersecting;
            updateLoop();
          });
    intersection?.observe(canvas);

    const refreshPalette = () => {
      const next = readPalette(probe, palette);
      if (next === palette) return;
      palette = next;
      renderer?.dispose();
      renderer = createBackgroundRenderer(effect, canvas, palette);
      width = 0;
      height = 0;
      resize();
    };

    resize();
    start();

    const observer = new ResizeObserver(() => {
      resize();
      updateLoop();
    });
    observer.observe(canvas);
    // Theme, accent and tint changes land as root class/style updates.
    const themeObserver = new MutationObserver(refreshPalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const loseContext = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      updateLoop();
    };
    const restoreContext = () => {
      renderer?.dispose();
      renderer = createBackgroundRenderer(effect, canvas, palette);
      contextLost = false;
      width = 0;
      height = 0;
      resize();
      updateLoop();
    };
    canvas.addEventListener("webglcontextlost", loseContext);
    canvas.addEventListener("webglcontextrestored", restoreContext);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      renderer?.dispose();
      canvas.removeEventListener("webglcontextlost", loseContext);
      canvas.removeEventListener("webglcontextrestored", restoreContext);
      observer.disconnect();
      themeObserver.disconnect();
      intersection?.disconnect();
      unsubscribe();
      updateLoopRef.current = null;
    };
  }, [effect, demoSpeech, still]);

  if (effect === "none") return null;
  return (
    <div
      aria-hidden
      data-live-background-scene={effect}
      className={`pointer-events-none overflow-hidden ${className}`}
      style={{ opacity: intensity }}
    >
      <canvas key={effect} ref={canvasRef} className="block size-full" />
      {isAmbientBackground(effect) ? (
        <svg
          viewBox="0 0 1000 700"
          preserveAspectRatio="none"
          className="live-background-fallback"
          aria-hidden
        >
          <g fill="none" stroke="var(--ui-text-secondary)" strokeWidth="1" opacity="0.18">
            {[0, 1, 2, 3, 4, 5].map((line) => (
              <path
                key={line}
                d={`M -100 ${200 + line * 28} C 250 ${-100 + line * 32}, 600 ${800 - line * 25}, 1100 ${250 + line * 26}`}
              />
            ))}
          </g>
        </svg>
      ) : null}
      <span ref={probeRef} className="hidden" />
    </div>
  );
}

/** The chat-pane layer driven by the saved appearance setting. */
export function LiveBackgroundLayer({
  active,
  visible = true,
  speech,
  activity,
}: {
  active: boolean;
  visible?: boolean;
  speech: number;
  activity: number;
}) {
  const effect = useLiveBackground();
  const intensity = useLiveBackgroundIntensity();
  // Only mounted split panes retain a still; hidden sessions release scene resources.
  if (!visible) return null;
  return (
    <div data-live-background-rail className="live-background-rail" aria-hidden>
      <LiveBackgroundCanvas
        effect={effect}
        intensity={intensity}
        active={active}
        speech={speech}
        activity={activity}
        className="live-background-figure"
      />
    </div>
  );
}
