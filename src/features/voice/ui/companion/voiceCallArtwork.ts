import { themePalette } from "../../../../shared/theme/palette";
import type { VoiceVisualState } from "../../model/voiceVisualState";

const TURN = Math.PI * 2;
const DOTS = 234;
const DOTS_PER_ORBIT = 26;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function fraction(value: number) {
  return value - Math.floor(value);
}

/** The same particles persist in every state. Each dot carries its own phase and brightness. */
const POINTS = Array.from({ length: DOTS }, (_, index) => {
  const y = 1 - (2 * (index + 0.5)) / DOTS;
  return {
    y,
    radius: Math.sqrt(1 - y * y),
    angle: GOLDEN_ANGLE * index,
    seed: fraction(Math.sin(index * 46.13) * 45781.47),
  };
});

const ORBITS = Array.from({ length: DOTS / DOTS_PER_ORBIT }, (_, index) => {
  const tilt = Math.acos(1 - (2 * (index + 0.5)) / (DOTS / DOTS_PER_ORBIT));
  return {
    yaw: index * GOLDEN_ANGLE,
    lift: Math.sin(tilt),
    depth: Math.cos(tilt),
    radius: 0.58 + 0.42 * fraction(index * 0.618),
  };
});

export function paintCallOrb(
  context: CanvasRenderingContext2D,
  size: number,
  state: VoiceVisualState,
  time: number,
  input: number,
  ink: string,
) {
  const orbiting = state === "thinking" || state === "connecting";
  const replying = state === "assistant";
  const still = state === "off" || state === "muted" || state === "error";
  const rotation = time * (orbiting ? 0.25 : 0.54);
  const radius = size * (0.425 + input * 0.045 + (replying ? 0.02 * Math.sin(time * 4.8) : 0));
  const center = size / 2;
  const tiltSin = Math.sin(0.31);
  const tiltCos = Math.cos(0.31);
  context.fillStyle = ink;

  for (const [index, point] of POINTS.entries()) {
    let angle = point.angle + rotation;
    let height = point.y;
    let ring = point.radius;
    let depthScale = 1;
    let yaw = 0;
    let highlight = Math.max(0, 1 - Math.abs(point.y - Math.sin(time * 1.75)) * 3);
    if (orbiting) {
      const orbit = ORBITS[Math.floor(index / DOTS_PER_ORBIT)];
      const progress = (index % DOTS_PER_ORBIT) / DOTS_PER_ORBIT;
      const sweep = fraction(
        progress - time * (state === "connecting" ? 0.3 : 0.52) - orbit.yaw * 0.12,
      );
      angle = progress * TURN;
      ring = orbit.radius;
      height = Math.sin(angle) * orbit.lift * ring;
      depthScale = orbit.depth;
      yaw = orbit.yaw + rotation;
      highlight = Math.max(0, 1 - Math.min(sweep, 1 - sweep) * 13);
    } else if (replying) {
      const band = index % 5;
      angle = (index / DOTS) * 5 * TURN + rotation;
      height = (band - 2) * 0.29 + 0.2 * Math.sin(angle * 2 + time * 5 + band * 0.55);
      ring = Math.sqrt(1 - height * height);
      highlight = (1 + Math.sin(angle * 2 - time * 5 + band)) / 2;
    }

    const flatX = ring * Math.cos(angle);
    const flatZ = ring * Math.sin(angle) * depthScale;
    const x = flatX * Math.cos(yaw) + flatZ * Math.sin(yaw);
    const z = flatZ * Math.cos(yaw) - flatX * Math.sin(yaw);
    const y = height * tiltCos - z * tiltSin;
    const depth = (1 + height * tiltSin + z * tiltCos) / 2;
    const bright = orbiting ? highlight ** 3 : highlight * (point.seed > 0.88 ? 1 : 0.28);
    const alpha =
      (0.14 + depth * 0.48 + bright * 0.54) * (state === "off" ? 0.85 : still ? 0.65 : 1);
    const dot = size * (0.0036 + depth * 0.0033 + bright * 0.009);
    context.globalAlpha = Math.min(1, alpha);
    context.beginPath();
    context.arc(center + x * radius, center - y * radius, Math.max(0.52, dot), 0, TURN);
    context.fill();
  }
  context.globalAlpha = 1;
}

const POOLS = [
  { x: 0.16, y: 0.31, size: 0.66, strength: 1, speed: 0.62 },
  { x: 0.86, y: 0.67, size: 0.63, strength: 0.85, speed: 0.43 },
  { x: 0.26, y: 1, size: 0.58, strength: 0.62, speed: 0.54 },
];

export function paintCallBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: VoiceVisualState,
  time: number,
  input: number,
) {
  const waiting = state === "thinking" || state === "connecting";
  const replying = state === "assistant";
  const idle = state === "off" || state === "muted" || state === "error";
  const primary =
    state === "error"
      ? themePalette.dangerDark
      : waiting
        ? themePalette.voiceThink
        : replying
          ? themePalette.voiceReply
          : themePalette.voiceListen;
  const secondary =
    waiting || idle
      ? themePalette.voiceThinkGlow
      : replying
        ? themePalette.voiceReplyGlow
        : themePalette.voiceListenGlow;
  const strength = idle ? 0.24 : waiting ? 0.68 : 0.58;
  const breath =
    input * 0.32 +
    (waiting || replying ? (1 + Math.sin(time * (replying ? 4.8 : 1.6))) * 0.055 : 0);

  for (const [index, pool] of POOLS.entries()) {
    const phase = time * pool.speed + index * 1.7;
    const x = width * (pool.x + Math.sin(phase) * 0.095);
    const y = height * (pool.y + Math.cos(phase * 0.77) * 0.075);
    const radius = Math.max(width, height) * pool.size * (1 + breath);
    const light = context.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, index === 1 ? secondary : primary);
    light.addColorStop(1, "transparent");
    context.globalAlpha = (strength + breath * 0.28) * pool.strength;
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);
  }
  context.globalAlpha = 1;
}
