/**
 * Layout and shading data for the ASCII figure: an AI core (a glowing lens in orbit rings) that
 * `asciiMask.ts` shades once into cached layers. This file fixes the grid, the character ramp and
 * the pulse states the reply cycles through (kept under their original "mouth" names).
 */
export const ASCII_MASK_ART = {
  /** Figure grid in cells; with 0.62em x 1.3em cells it is close to square. */
  mask: { cols: 96, rows: 46 },
  /** Luminance ramp, dark to light: fine punctuation carries the dark glass and the room, dense
   * marks only the hottest light, so the core reads as an image rather than as text. */
  ramp: " .`:,;-~=+*xX#%@",
  /** Pulse states: `open` is the light's power, `width` the size of its hot center, `press` a
   * brief dip. */
  mouths: {
    closed: { open: 0, width: 1, press: 0 },
    slight: { open: 0.3, width: 1, press: 0 },
    half: { open: 0.55, width: 0.96, press: 0 },
    open: { open: 1, width: 0.92, press: 0 },
    round: { open: 0.8, width: 0.7, press: 0 },
    wide: { open: 0.45, width: 1.14, press: 0 },
    press: { open: 0, width: 1.04, press: 1 },
  },
} as const;
