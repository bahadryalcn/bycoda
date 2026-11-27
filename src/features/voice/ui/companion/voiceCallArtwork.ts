import { themePalette } from "../../../../shared/theme/palette";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import type { VoiceCompanionStatus } from "./voiceCompanionTypes";

export type VoiceCallPhase = "listening" | "speaking" | "transcribing" | "replying";
export type VoiceCallArtworkState = VoiceVisualState | "reconnecting" | "transcribing";

export function callArtworkState(
  status: VoiceCompanionStatus,
  visualState: VoiceVisualState,
  phase?: VoiceCallPhase,
): VoiceCallArtworkState {
  if (visualState === "error") return visualState;
  if (status === "reconnecting") return "reconnecting";
  if (visualState === "thinking" && phase === "transcribing") return "transcribing";
  return visualState;
}

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
  state: VoiceCallArtworkState,
  time: number,
  input: number,
  ink: string,
  expanded: boolean,
) {
  const reconnecting = state === "reconnecting";
  const orbiting = state === "thinking" || state === "connecting" || reconnecting;
  const transcribing = state === "transcribing";
  const replying = state === "assistant";
  const still = state === "off" || state === "muted" || state === "error";
  const spin = reconnecting
    ? -0.47
    : orbiting
      ? 0.25
      : state === "connected" || state === "off"
        ? 0.14
        : state === "listening"
          ? 0.35
          : 0.54;
  const rotation = time * spin;
  const oscillation = replying ? 0.02 * Math.sin(time * 4.8) : 0;
  const radius = size * (0.425 + input * 0.045 + oscillation);
  const center = size / 2;
  const tilt = expanded ? 0.34 + Math.sin(time * 0.86) * 0.19 : 0.31;
  const tiltSin = Math.sin(tilt);
  const tiltCos = Math.cos(tilt);
  const sweepY = Math.sin(time * (transcribing ? 3.3 : 1.75));
  const sweepRate = reconnecting ? -0.28 : state === "connecting" ? 0.3 : 0.52;
  const stretch = expanded && replying ? 1.12 : 1;
  context.fillStyle = ink;

  for (const [index, point] of POINTS.entries()) {
    let angle = point.angle + rotation;
    let height = point.y;
    let ring = point.radius;
    let depthScale = 1;
    let yaw = 0;
    let highlight = Math.max(0, 1 - Math.abs(point.y - sweepY) * 3);
    if (orbiting) {
      const orbit = ORBITS[Math.floor(index / DOTS_PER_ORBIT)];
      const progress = (index % DOTS_PER_ORBIT) / DOTS_PER_ORBIT;
      const sweep = fraction(progress - time * sweepRate - orbit.yaw * 0.12);
      angle = progress * TURN;
      ring = reconnecting ? 0.75 + orbit.radius * 0.15 : orbit.radius;
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
    } else if (transcribing) {
      height = point.y * 0.62 + Math.sin(angle * 1.6 + time * 3.5) * 0.12;
      highlight = Math.max(0, 1 - Math.abs(height - sweepY * 0.55) * 8);
    } else if (expanded && state === "error") {
      height = point.y * 0.84;
      angle += point.y > 0 ? 0.24 : -0.24;
    }

    const flatX = ring * Math.cos(angle);
    const flatZ = ring * Math.sin(angle) * depthScale;
    const x = flatX * Math.cos(yaw) + flatZ * Math.sin(yaw);
    const z = flatZ * Math.cos(yaw) - flatX * Math.sin(yaw);
    const y = height * tiltCos - z * tiltSin;
    const depth = (1 + height * tiltSin + z * tiltCos) / 2;
    const bright =
      orbiting || transcribing ? highlight ** 3 : highlight * (point.seed > 0.88 ? 1 : 0.28);
    const alpha =
      (0.14 + depth * 0.48 + bright * 0.54) * (state === "off" ? 0.85 : still ? 0.65 : 1);
    const dot = size * (0.0036 + depth * 0.0033 + bright * (expanded ? 0.006 : 0.009));
    context.globalAlpha = Math.min(1, alpha);
    context.beginPath();
    context.arc(center + x * radius * stretch, center - y * radius, Math.max(0.52, dot), 0, TURN);
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
  state: VoiceCallArtworkState,
  time: number,
  input: number,
  expanded: boolean,
) {
  const connecting = state === "connecting" || state === "reconnecting";
  const waiting = state === "thinking" || connecting || state === "transcribing";
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
    const sweep = expanded ? 0.14 : 0.095;
    const x = width * (pool.x + Math.sin(phase) * sweep);
    const y = height * (pool.y + Math.cos(phase * 0.77) * sweep * 0.78);
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
