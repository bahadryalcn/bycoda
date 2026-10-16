import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// Ferrofluid: a magnetic liquid pooled on a surface. Jittered cones rise where a
// slow magnetic field is strong; their height follows the speech energy. Idle,
// the spikes sink and the liquid lies flat in a pool.
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uEnergy;
uniform float uPresence;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Where the magnetic field is strong, the liquid is drawn into spikes.
float field(vec2 p) {
  float n = valueNoise(p * 1.1 + vec2(uTime * 0.04, -uTime * 0.03)) * 0.7
    + valueNoise(p * 2.7 - vec2(uTime * 0.05, 0.0)) * 0.3;
  return smoothstep(0.4, 0.78, n);
}

// Nearest spike cone on a jittered grid, searched over the 3x3 neighbourhood.
float spikes(vec2 p, float amount) {
  const float CELL = 0.32;
  vec2 g = floor(p / CELL);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = g + vec2(float(i), float(j));
      vec2 site = c + 0.2 + 0.6 * vec2(hash21(c), hash21(c + 17.0));
      float d = length((site - p / CELL) * CELL);
      float rise = 0.45 + 0.55 * hash21(c + 31.0);
      float cone = max(0.0, 1.0 - d / (CELL * 0.75));
      h = max(h, cone * cone * rise * amount);
    }
  }
  return h;
}

float height(vec2 p, float amount) {
  float pool = 0.03 + 0.03 * valueNoise(p * 0.6 + uTime * 0.02);
  return pool + spikes(p, amount * field(p));
}

vec4 shade(vec2 pixel) {
  vec2 p = (pixel - 0.5 * uResolution) / uResolution.y * 3.2;
  float energy = clamp(uEnergy * uPresence, 0.0, 1.0);
  float amount = 0.12 + 0.88 * energy;
  float e = 0.012;
  float hx = height(p + vec2(e, 0.0), amount) - height(p - vec2(e, 0.0), amount);
  float hy = height(p + vec2(0.0, e), amount) - height(p - vec2(0.0, e), amount);
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));

  vec3 lightDir = normalize(vec3(-0.45, 0.6, 0.75));
  float diffuse = max(dot(n, lightDir), 0.0);
  vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float specular = pow(max(dot(n, halfVec), 0.0), 36.0);
  float rim = pow(1.0 - n.z, 2.0);

  float shadeAmount = 0.3 * diffuse + 0.22 * rim + 0.85 * specular;
  float alpha = clamp(shadeAmount * (0.55 + 0.45 * uPresence) * 0.85, 0.0, 1.0);
  vec3 color = mix(uContent, uAccent, clamp(specular * 1.4 + energy * rim, 0.0, 1.0));
  return vec4(color * alpha, alpha);
}
`;

export function createFerrofluidScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
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
        uEnergy: signal.energy,
        uPresence: signal.presence,
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
