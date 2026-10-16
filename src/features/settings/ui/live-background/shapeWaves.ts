import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/**
 * Shape waves: a grid of squares, circles and diamonds whose size follows a
 * travelling wave. Speaking raises the amplitude and speed, and a ring of accent
 * ripples out from the centre on each burst. Idle, the waves drift gently.
 * Output is premultiplied alpha; colors come in as uniforms.
 */
const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uEnergy;
uniform float uPresence;
uniform float uRows;

vec4 shade(vec2 pixel) {
  float cell = uResolution.y / uRows;
  vec2 grid = pixel / cell;
  vec2 id = floor(grid);
  vec2 local = fract(grid) - 0.5;
  // Work in height units so the wave shape does not depend on pane width.
  vec2 at = (id + 0.5) * cell / uResolution.y;
  float aspect = uResolution.x / uResolution.y;
  float speaking = uEnergy * uPresence;

  float amplitude = 0.6 + 0.9 * speaking;
  float speed = 0.7 + 0.7 * speaking;
  float wave =
      0.5 * sin(at.x * 9.0 + uTime * 0.9 * speed)
    + 0.35 * sin(at.y * 11.0 - uTime * 0.7 * speed + at.x * 2.0)
    + 0.4 * sin((at.x + at.y) * 5.0 + uTime * 0.45 * speed);
  float height = 0.5 + 0.5 * clamp(wave * 0.5 * amplitude, -1.0, 1.0);

  // Accent ripple: a ring travelling outward from the centre of the pane.
  vec2 centre = vec2(0.5 * aspect, 0.5);
  float maxRadius = length(vec2(0.5 * aspect, 0.5)) * 1.15;
  float front = fract(uTime * 0.16 * speed) * maxRadius;
  float radius = length(at - centre);
  float ring = exp(-pow((radius - front) / 0.06, 2.0)) * (0.2 + 0.8 * uEnergy) * uPresence;

  float size = mix(0.14, 0.44, height) * (1.0 + 0.45 * ring);
  // Height chooses the shape: circles low, squares middle, diamonds high.
  float band = floor(height * 2.999);
  float dCircle = length(local) - size;
  float dSquare = max(abs(local.x), abs(local.y)) - size * 0.85;
  float dDiamond = abs(local.x) + abs(local.y) - size * 1.1;
  float d = mix(mix(dCircle, dSquare, step(1.0, band)), dDiamond, step(2.0, band));
  float edge = 0.07;
  float shape = 1.0 - smoothstep(-edge, edge, d);

  float accent = clamp(ring * 1.2 + speaking * height * 0.35, 0.0, 1.0);
  vec3 color = mix(uContent, uAccent, accent);
  float alpha = shape * clamp(0.5 + 0.3 * uPresence + 0.2 * height, 0.0, 1.0);
  return vec4(color * alpha, alpha);
}
`;

export function createShapeWavesScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
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
        uRows: Math.max(10, Math.round(height / 16)),
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
