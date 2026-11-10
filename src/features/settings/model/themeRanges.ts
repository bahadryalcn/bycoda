/**
 * Tone limits shared by the Theme model and the Host suggestion check. Kept free of UI and
 * storage imports so the Host can validate suggestions without loading the appearance model.
 */
export const THEME_HUE_MIN = 0;
export const THEME_HUE_MAX = 360;
export const THEME_SATURATION_MIN = 0;

/**
 * Numeric limits of the appearance settings a generated theme may set. The settings models read
 * their bounds from here, so the Host check, the client check and the sliders cannot drift.
 */
export const APPEARANCE_RANGES = {
  darkLightness: { min: 0, max: 30 },
  sidebarOpacity: { min: 0.15, max: 1 },
  mainOpacity: { min: 0.15, max: 1 },
  sidebarBlur: { min: 1, max: 64 },
  chatBackgroundOpacity: { min: 0.05, max: 0.65 },
  chatBackgroundBlur: { min: 0, max: 40 },
  uiScale: { min: 0.5, max: 2 },
  liveIntensity: { min: 0.05, max: 0.8 },
  codeSize: { min: 11, max: 18 },
  terminalSize: { min: 8, max: 40 },
  contrast: { min: 75, max: 150 },
} as const;

/** Enumerated choices a generated theme may set; drift tests check each against its normalizer. */
export const APPEARANCE_CHOICES = {
  diffPalette: ["default", "colorblind", "high-contrast"],
  chatBackgroundScope: ["empty", "all"],
  newThreadEffect: ["none", "dither", "ascii", "halftone", "scanlines", "gradient-blur"],
  liveScene: [
    "none",
    "threads",
    "silk",
    "dark-veil",
    "soft-aurora",
    "floating-lines",
    "neural-tree",
    "latent-face",
    "code-visage",
    "serene-face",
    "thought-weaver",
    "ascii-mask",
    "dot-grid",
    "code-rain",
  ],
  crewTheme: ["classic", "star-wars", "lotr", "matrix"],
  rowDensity: ["compact", "standard", "detailed"],
  terminalWeight: [300, 400, 500, 600, 700],
  terminalLineHeight: [1, 1.15, 1.35, 1.5],
  scrollbarColor: ["auto", "neutral", "theme"],
  scrollbarSize: ["extra-thin", "thin", "medium", "large", "xlarge"],
  scrollbarVisibility: ["hover", "always"],
  tintSource: ["neutral", "theme", "accent"],
  workingColor: ["auto", "theme"],
  workingStyle: ["pulse", "steady", "off"],
} as const;
