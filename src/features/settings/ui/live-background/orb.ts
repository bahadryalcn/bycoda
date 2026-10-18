import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// Orb ring/noise adapted from David Haz's React Bits Orb.
// https://reactbits.dev/backgrounds/orb. License: vendor/react-bits/LICENSE.md.
// Uses the shared GPU context, theme colors and streamed-text signal instead of pointer listeners.
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform vec3 uSpectrum;
uniform float uPresence;
uniform float uEnergy;
uniform float uOpen;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}
float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0,d0), dot(d1,d1), dot(d2,d2), dot(d3,d3)), 0.0);
  vec4 n = h*h*h*h * vec4(dot(d0,hash33(i)), dot(d1,hash33(i+i1)), dot(d2,hash33(i+i2)), dot(d3,hash33(i+1.0)));
  return dot(vec4(31.316), n);
}
vec4 shade(vec2 pixel) {
  vec2 uv = (pixel - uResolution * 0.5) / min(uResolution.x, uResolution.y) * 2.65;
  float len = length(uv);
  float ang = atan(uv.y, uv.x);
  float pulse = uEnergy * 0.045 + uOpen * 0.025;
  float n = snoise3(vec3(uv * 0.9, uTime * 0.35)) * 0.5 + 0.5;
  float radius = 0.8 + pulse + (n - 0.5) * (0.08 + 0.12 * uPresence);
  float dist = abs(len - radius);
  float rim = 1.0 / (1.0 + dist * (48.0 - 18.0 * uEnergy));
  float inner = smoothstep(radius - 0.28, radius - 0.018, len);
  float outer = 1.0 - smoothstep(radius, radius + 0.09, len);
  float swirl = 0.5 + 0.5 * cos(ang * 2.0 + n * 3.0 - uTime * 0.65);
  float body = inner * outer * (0.3 + 0.7 * swirl);
  vec2 head = vec2(cos(-uTime * 0.7), sin(-uTime * 0.7)) * radius;
  float highlight = 1.0 / (1.0 + dot(uv-head, uv-head) * 32.0);
  float halo = exp(-dist * 12.0) * 0.16;
  float wake = 0.58 + 0.25 * uPresence + 0.4 * uEnergy;
  float alpha = clamp((rim * inner * outer * 0.7 + body * 0.4 + highlight * rim * 0.6 + halo) * wake, 0.0, 1.0);
  vec3 ink = mix(uSpectrum, uAccent, swirl);
  ink = mix(ink, uContent, clamp(highlight * 0.4, 0.0, 1.0));
  return vec4(ink * alpha, alpha);
}
`;

export function createOrbScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const layer = createShaderLayer({ fragment, scale: 0.65 });
  const content = rgbToVec3(palette.contentRgb);
  const accent = rgbToVec3(palette.accentRgb);
  const spectrum = rgbToVec3(palette.spectrumRgb ?? palette.accentRgb);
  let width = 0;
  let height = 0;
  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      layer.render(ctx, time, width, height, {
        uContent: content,
        uAccent: accent,
        uSpectrum: spectrum,
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
