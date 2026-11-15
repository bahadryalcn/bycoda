/**
 * One source with src/styles/index.css: `--motion-duration-fast` 120ms, `--motion-duration-standard`
 * 160ms and `--motion-ease-standard`. Keep these numbers in sync with that file (a test asserts it).
 */
const FAST_SECONDS = 0.12;
const STANDARD_SECONDS = 0.16;
const STANDARD_EASE = [0.22, 1, 0.36, 1] as const;

export const motionTokens = {
  /** Two durations. `instant`, `exit` alias fast and standard; `considered` is for scene-level reveals. */
  duration: {
    fast: FAST_SECONDS,
    standard: STANDARD_SECONDS,
    instant: FAST_SECONDS,
    exit: STANDARD_SECONDS,
    considered: 0.48,
  },
  /** One easing; enter and exit alias it. `inOut` is for elements that move while on screen. */
  ease: {
    standard: STANDARD_EASE,
    enter: STANDARD_EASE,
    exit: STANDARD_EASE,
    inOut: [0.65, 0, 0.35, 1],
  },
  spring: {
    responsive: { type: "spring", stiffness: 520, damping: 38 },
    gentle: { type: "spring", stiffness: 340, damping: 34 },
    /** Presses, toggles, thumbs, and small indicators. Settles fast with a hint of life. */
    snappy: { type: "spring", visualDuration: 0.26, bounce: 0.12 },
    /** Panels, height changes, and layout shifts. Critically damped, never overshoots. */
    smooth: { type: "spring", visualDuration: 0.4, bounce: 0 },
    /** Shape morphs, shared layout highlights, and width changes that follow new content. */
    morph: { type: "spring", visualDuration: 0.42, bounce: 0.16 },
  },
  /** Stagger steps in seconds. Keep total stagger under roughly 0.4s. */
  stagger: { char: 0.016, word: 0.04, line: 0.08, item: 0.035 },
  /** Blur radii in px for text and content crossfades. Keep blur small and brief. */
  blur: { subtle: 2, soft: 4, text: 8 },
} as const;
