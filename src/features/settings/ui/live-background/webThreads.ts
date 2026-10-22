import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/**
 * Web threads: fine lines strung across the pane that bow and cross like a web.
 * Speaking tightens the web, makes the threads hum and glow in travelling pulses,
 * and lifts their accent. Idle, they sway slowly. Lines are Lorentzian, so their
 * width is set in CSS-independent pixels. Output is premultiplied alpha.
 */
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uEnergy;
uniform float uPresence;
uniform float uCount;

const int MAX_THREADS = 14;

vec4 shade(vec2 pixel) {
  vec2 uv = pixel / uResolution;
  float x = uv.x;
  float y = uv.y;
  float speaking = uEnergy * uPresence;
  // Speech pulls the web tighter; the threads hum in place.
  float spread = mix(0.36, 0.2, clamp(speaking * 1.2, 0.0, 1.0));
  float envelope = 0.3 + 0.7 * sin(x * 3.14159);
  // A line's core is about 1.4 px wide, whatever the pane size.
  float core = pow(1.4 / uResolution.y, 2.0);
  float sum = 0.0;
  vec3 tint = vec3(0.0);
  for (int i = 0; i < MAX_THREADS; i++) {
    float index = float(i);
    if (index >= uCount) break;
    float k = index / max(uCount - 1.0, 1.0);
    float lane = 0.5 + (k - 0.5) * 2.0 * spread;
    float phase = index * 0.6;
    float sway =
        0.5 * sin(x * 9.0 + uTime * (0.35 + 0.2 * uEnergy) + phase)
      + 0.5 * sin(x * 4.0 - uTime * 0.21 + phase * 1.7);
    float hum = sin(x * 70.0 + uTime * 26.0 + index * 2.1) * 0.006 * speaking;
    float ty = lane + sway * 0.09 * envelope * (1.0 + 0.9 * speaking) + hum;
    float d = abs(y - ty);
    float g = core / (d * d + core);
    // Light travels along each thread while speaking.
    float pulse = pow(0.5 + 0.5 * sin(x * 12.0 - uTime * 6.0 + index), 8.0);
    g *= 1.0 + speaking * pulse * 1.5;
    sum += g;
    tint += g * mix(uContent, uAccent, k * (0.3 + 0.7 * speaking));
  }
  float edge = smoothstep(0.0, 0.14, x) * smoothstep(1.0, 0.86, x);
  float alpha = clamp(sum * 0.45 * edge, 0.0, 1.0) * (0.7 + 0.3 * uPresence);
  vec3 color = tint / max(sum, 0.0001) * alpha;
  return vec4(color, alpha);
}
`;

/** Threads per pane: about one every 11 CSS px, so small panes keep distinct lines. */
const PX_PER_THREAD = 11;
const MIN_THREADS = 5;
const MAX_THREADS = 14;

export function createWebThreadsScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const content = rgbToVec3(palette.contentRgb);
  const accent = rgbToVec3(palette.accentRgb);
  // One layer per scene: disposing a pane releases only its own reference.
  const layer = createShaderLayer({ fragment });
  let width = 0;
  let height = 0;
  let count = MAX_THREADS;
  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      count = Math.min(MAX_THREADS, Math.max(MIN_THREADS, Math.round(height / PX_PER_THREAD)));
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      layer.render(ctx, time, width, height, {
        uContent: content,
        uAccent: accent,
        uEnergy: signal.energy,
        uPresence: signal.presence,
        uCount: count,
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
