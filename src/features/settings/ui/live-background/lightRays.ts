import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// Soft light rays spreading down from a source at the top centre. Presence
// lengthens the rays; the lips' open/close rhythm breathes their brightness,
// and speech energy lights the source itself.
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uPresence;
uniform float uEnergy;
uniform float uOpen;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x),
    w.y
  );
}

vec4 shade(vec2 pixel) {
  vec2 res = uResolution;
  float unit = min(res.x, res.y);
  vec2 p = pixel / unit;
  vec2 source = vec2(0.5 * res.x / unit, -0.15);
  vec2 v = p - source;
  float dist = length(v);
  float ang = atan(v.x, v.y);

  // Rays fan out around the downward axis; angular noise splits them into beams.
  float fan = 1.0 - smoothstep(0.0, 1.35, abs(ang));
  float beams = valueNoise(vec2(ang * 14.0, uTime * 0.05));
  float fine = valueNoise(vec2(ang * 37.0 - uTime * 0.12, 5.0));
  float rays = smoothstep(0.4, 0.8, 0.6 * beams + 0.4 * fine);

  float reach = 0.5 + 1.1 * uPresence;
  float falloff = exp(-dist / reach);
  float haze = 0.7 + 0.3 * valueNoise(vec2(ang * 3.0, dist * 2.0 - uTime * 0.1));

  // The breath follows the syllable rhythm of the lips when they are open.
  float breath = 0.75 + 0.25 * sin(uTime * 0.9) + 0.4 * uOpen;
  float light = fan * rays * falloff * haze * breath * (0.25 + 0.35 * uPresence);
  float sourceGlow = exp(-dist * 6.0) * (0.2 + 0.35 * uPresence + 0.4 * uEnergy);
  float alpha = clamp(light + sourceGlow, 0.0, 1.0);

  vec3 ink = mix(uAccent, uContent, smoothstep(0.0, 1.2, dist));
  return vec4(ink * alpha, alpha);
}
`;

export function createLightRaysScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const content = rgbToVec3(palette.contentRgb);
  const accent = rgbToVec3(palette.accentRgb);
  // One layer per scene: disposing a pane releases only its own reference.
  const layer = createShaderLayer({ fragment });
  let width = 0;
  let height = 0;
  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      layer.render(ctx, time, width, height, {
        uContent: content,
        uAccent: accent,
        uPresence: signal.presence,
        uEnergy: signal.energy,
        uOpen: signal.open,
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
