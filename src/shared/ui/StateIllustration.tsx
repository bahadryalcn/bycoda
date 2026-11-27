import { useEffect, useState } from "react";
import styles from "./StateIllustration.module.css";

/** Every scene, with the frames of its loop (frame 0 is the rest pose) and the width / height of one frame. */
const frameUrls = import.meta.glob<string>(
  "../../assets/states/*/frame-*.png",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const SCENES = {
  "connect-computer": 812 / 623,
  "no-projects": 488 / 637,
  "no-sessions": 369 / 658,
  "chat-empty": 776 / 666,
  "inbox-empty": 680 / 645,
  "search-empty": 545 / 637,
  unreachable: 554 / 654,
  error: 504 / 639,
  success: 594 / 652,
  locked: 559 / 668,
  permission: 520 / 657,
  offline: 424 / 788,
} as const;

export type IllustrationName = keyof typeof SCENES;

const FPS = 6;
/** Four seconds: breathing, bead sway, two blinks, brows, mustache twitch and the scene's prop. */
const LOOP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 12, 13, 4, 14, 15, 16, 8, 17, 18,
  11,
];
/** The chat scene's typing dots fill in, so it has its own order (17 frames). */
const CHAT_LOOP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 1, 2, 2, 11, 12, 13, 14, 15, 15, 16,
  0,
];

const frameCache = new Map<IllustrationName, string[]>();
function framesOf(name: IllustrationName): string[] {
  const cached = frameCache.get(name);
  if (cached) return cached;
  const prefix = `../../assets/states/${name}/frame-`;
  const frames: string[] = [];
  for (let index = 0; frameUrls[`${prefix}${index}.png`]; index += 1)
    frames.push(frameUrls[`${prefix}${index}.png`]);
  frameCache.set(name, frames);
  return frames;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** The app's decorative-motion setting and native window visibility, published on <html>. */
function motionGateClosed() {
  const { decorativeMotion, windowVisible } = document.documentElement.dataset;
  return decorativeMotion === "off" || windowVisible === "off";
}

/** The loop step to draw: runs while the window is visible and motion is allowed, rests on step 0 otherwise. */
function useLoopStep(steps: number) {
  const [step, setStep] = useState(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the sprite timer in step with reduced motion, the decorative-motion setting and window visibility
  useEffect(() => {
    const motion = window.matchMedia?.(REDUCED_MOTION);
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      timer = undefined;
      if (
        motion?.matches ||
        motionGateClosed() ||
        document.hidden ||
        steps < 2
      ) {
        setStep(0);
        return;
      }
      timer = setInterval(
        () => setStep((current) => (current + 1) % steps),
        1000 / FPS,
      );
    };
    sync();
    motion?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    const gate = new MutationObserver(sync);
    gate.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-decorative-motion", "data-window-visible"],
    });
    return () => {
      gate.disconnect();
      clearInterval(timer);
      motion?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [steps]);
  return step;
}

/** Decodes every frame once so a swap never flashes an empty image. */
function usePreloaded(frames: string[]) {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- warms the browser image cache with the scene frames
  useEffect(() => {
    for (const url of frames) new Image().src = url;
  }, [frames]);
}

const HEIGHTS = { page: 144, panel: 96 } as const;

/**
 * The pixel guide acting out one state, a decorative looping sprite at 6 fps that rests on its first
 * frame under reduced motion or with decorative motion off. `size` is the state region it heads: `page`
 * (144 px tall) or `panel` (96 px); width follows the scene's aspect, so nothing shifts.
 * @group feedback
 * @use The mascot of a block FailureState or EmptyState; use their `illustration` prop rather than placing it by hand.
 * @avoid A small status mark: StatusGlyph or StatusDot. An inline row failure: InlineError. It is a hero for a whole state, not an icon.
 */
export function StateIllustration({
  name,
  size = "page",
}: {
  name: IllustrationName;
  size?: keyof typeof HEIGHTS;
}) {
  const height = HEIGHTS[size];
  const frames = framesOf(name);
  const loop = name === "chat-empty" ? CHAT_LOOP : LOOP;
  const step = useLoopStep(frames.length > 1 ? loop.length : 0);
  usePreloaded(frames);
  const frame = frames[loop[step] ?? 0] ?? frames[0];
  return (
    <img
      className={styles.art}
      src={frame}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-scene={name}
      data-step={step}
      style={{ blockSize: height, inlineSize: height * SCENES[name] }}
    />
  );
}
