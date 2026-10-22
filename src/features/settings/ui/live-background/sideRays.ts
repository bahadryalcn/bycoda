import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// Light shafts falling from the top-right corner. Presence lengthens the shafts
// and brightens them; speech energy makes the shafts shimmer and sway harder.
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uPresence;
uniform float uEnergy;

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
  vec2 source = vec2(res.x / unit + 0.1, -0.15);
  vec2 v = p - source;
  float dist = length(v);

  // Shafts point down and left; the heading sways slightly, more with energy.
  float heading = 2.356 + 0.08 * sin(uTime * 0.21) + 0.05 * uEnergy * sin(uTime * 1.3);
  float ang = mod(atan(v.y, v.x) - heading + 3.14159265, 6.28318531) - 3.14159265;

  float spread = 0.5 + 0.1 * uPresence;
  float bend = ang / spread;
  float fan = exp(-bend * bend * 1.4);
  float reach = 0.55 + 0.9 * uPresence + 0.15 * uEnergy;
  float falloff = exp(-dist / reach);

  // Two noise octaves cut the fan into drifting shafts.
  float u = ang * 9.0;
  float n = 0.65 * valueNoise(vec2(u + uTime * 0.15, 0.0))
    + 0.35 * valueNoise(vec2(u * 2.3 - uTime * 0.1 + uEnergy * 2.0, 3.0));
  float shaft = smoothstep(0.35, 0.75, n);

  float intensity = 0.3 + 0.5 * uPresence + 0.35 * uEnergy;
  float light = fan * shaft * falloff * intensity;
  float sourceGlow = exp(-dist * 5.0) * 0.25 * (0.4 + uEnergy);
  float alpha = clamp(light * 0.5 + sourceGlow, 0.0, 1.0);

  vec3 ink = mix(uContent, uAccent, 0.5 + 0.5 * sin(ang * 3.0 + uTime * 0.2));
  return vec4(ink * alpha, alpha);
}
`;

export function createSideRaysScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
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
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
