import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const LANE = 12;
const MAX_STREAKS = 200;
/** Simulation step cap, so a long pause or a still frame never teleports streaks. */
const MAX_STEP = 0.1;

type Streak = {
  lane: number;
  y: number;
  speed: number;
  length: number;
  width: number;
  bright: number;
};

/**
 * Light streaks falling down fixed lanes, like light through a window. Each
 * streak has a soft glow under a thin core. Idle: a gentle, populated fall. While
 * the reply streams, more streaks come in, they fall faster and grow longer, and
 * their heads brighten in the accent colour.
 */
export function createLightfallScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let lanes = 0;
  let capacity = 0;
  let streaks: Streak[] = [];

  const respawn = (streak: Streak, anywhere: boolean) => {
    streak.lane = Math.floor(Math.random() * lanes);
    streak.speed = 40 + Math.random() * 110;
    streak.length = 40 + Math.random() * 110;
    streak.width = 0.7 + Math.random() * 0.9;
    streak.bright = 0.45 + Math.random() * 0.55;
    streak.y = anywhere ? Math.random() * height : -streak.length - Math.random() * height * 0.3;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      lanes = Math.max(1, Math.floor(width / LANE));
      capacity = Math.min(MAX_STREAKS, Math.max(40, Math.round((width * height) / 3000)));
      streaks = Array.from({ length: capacity }, () => {
        const streak: Streak = { lane: 0, y: 0, speed: 0, length: 0, width: 1, bright: 1 };
        respawn(streak, true);
        return streak;
      });
    },
    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (height <= 0 || capacity === 0) return;

      const presence = signal.presence;
      const energy = Math.min(1, signal.energy) * presence;
      // Streaks come in and out of service with the reply, instead of popping in.
      const active = Math.round(capacity * (0.6 + 0.4 * presence));
      const step = Math.min(delta, MAX_STEP);
      const rush = 1 + 2.2 * energy;
      const stretch = 1 + 0.9 * energy;

      ctx.lineCap = "round";
      for (let i = 0; i < active; i++) {
        const streak = streaks[i];
        streak.y += streak.speed * step * rush;
        const tailLength = streak.length * stretch;
        if (streak.y - tailLength > height) respawn(streak, false);

        const x = (streak.lane + 0.5) * LANE;
        const head = streak.y;
        const tail = head - tailLength;

        // Soft glow: a wide, faint stroke under the core.
        ctx.lineWidth = streak.width * 4;
        ctx.strokeStyle = palette.content;
        ctx.globalAlpha = 0.07 * streak.bright;
        ctx.beginPath();
        ctx.moveTo(x, tail);
        ctx.lineTo(x, head);
        ctx.stroke();

        ctx.lineWidth = streak.width;
        ctx.strokeStyle = palette.content;
        ctx.globalAlpha = 0.32 * streak.bright;
        ctx.beginPath();
        ctx.moveTo(x, tail);
        ctx.lineTo(x, head);
        ctx.stroke();

        // Bright accent head that carries the speech energy.
        ctx.strokeStyle = palette.accent;
        ctx.globalAlpha = (0.3 + 0.5 * energy + 0.15 * presence) * streak.bright;
        ctx.beginPath();
        ctx.moveTo(x, head - tailLength * 0.25);
        ctx.lineTo(x, head);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
