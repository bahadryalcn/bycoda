// Owner accepted SVG drawImage versus worker Path2D edge coverage on 2026-11-12.
// Measured over 55 frames: WebGL 16,553 differing RGBA pixels, maximum 427/frame;
// Canvas 2D 17,568, maximum 456/frame; delta 209 (gray at alpha 28 vs transparent).
// Cap 480 adds 24 pixels (5.3%) above the larger measured per-frame maximum.
// Everything outside the swaying 236x58 sign and glyph-cell padding stays exact.
export const CLASSIC_SIGN_PIXEL_CAP = 480;
export const CLASSIC_SIGN_DELTA_CAP = 209;
export const CLASSIC_SIGN_REGION = { x: 780, y: 0, width: 720, height: 230 };
