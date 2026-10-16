import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// A dispersing prism: a triangular cross-section that sways while idle, spins
// a little further on each burst of speech, and glows with presence. Its light
// fans out to the right as thin bands. Colors are only the content and accent
// tokens, mixed by position, so the scene reads in light and dark themes alike.
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uPresence;
uniform float uEnergy;
uniform float uOpen;

// Signed distance to an equilateral triangle (apex up) with circumradius r.
float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec4 shade(vec2 pixel) {
  vec2 res = uResolution;
  float unit = min(res.x, res.y);
  vec2 p = vec2(pixel.x - 0.5 * res.x, 0.5 * res.y - pixel.y) / unit;
  vec2 center = vec2(0.2 * res.x / unit, 0.0);
  vec2 v = p - center;

  // Idle sway; each burst of energy kicks the prism further around.
  float spin = 0.35 * sin(uTime * 0.25) + 0.7 * uEnergy;
  float c = cos(spin);
  float s = sin(spin);
  vec2 q = mat2(c, -s, s, c) * v;

  float r = 0.3 + 0.03 * uPresence + 0.02 * uOpen;
  float dist = sdTriangle(q, r);
  float intensity = 0.35 + 0.5 * uPresence + 0.6 * uEnergy + 0.2 * uOpen;

  // Spectral-style bands inside the body and along the edges.
  float band = 0.5 + 0.5 * sin(q.x * 14.0 + q.y * 9.0 - uTime * 0.8);
  vec3 inkBody = mix(uContent, uAccent, band);
  float body = (1.0 - smoothstep(-0.01, 0.01, dist)) * 0.1 * intensity;
  float edge = exp(-abs(dist) * 60.0) * 0.55 * intensity;
  float halo = exp(-max(dist, 0.0) * 5.0) * 0.07 * intensity;
  float shapeAlpha = body + edge + halo;

  // Light fanned out to the right of the prism; rays pulse with presence.
  float len = length(v);
  float ang = atan(v.y, v.x);
  float rays = pow(0.5 + 0.5 * sin(ang * 34.0 + uTime * 0.4), 10.0);
  float fan = smoothstep(-0.1, 0.5, v.x) * exp(-len * 1.8);
  float beam = rays * fan * (0.12 + 0.5 * uPresence + 0.4 * uEnergy);
  vec3 inkBeam = mix(uContent, uAccent, 0.5 + 0.5 * sin(ang * 4.0 + uTime * 0.3));

  float alpha = clamp(shapeAlpha + beam, 0.0, 1.0);
  vec3 premultiplied = inkBody * shapeAlpha + inkBeam * beam;
  return vec4(min(premultiplied, vec3(alpha)), alpha);
}
`;

export function createPrismScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
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
