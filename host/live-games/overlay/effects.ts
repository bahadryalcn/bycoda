import type { HalayCue } from "../../../src/features/live-games/model/halayGame";
import { elapsedSince } from "../../../src/shared/lib/time/timestamps";

type Context = CanvasRenderingContext2D;
type Effect = Exclude<HalayCue["effect"], "gift" | "joined">;

interface Particle {
  x: number;
  y: number;
  xSpeed: number;
  ySpeed: number;
  rotation: number;
  size: number;
  color: string;
}

interface Burst {
  effect: Effect;
  at: number;
  particles: Particle[];
}

const colors = ["#ffc468", "#ff885f", "#83dfc4", "#f599b3", "#f8e8a6"];
const duration: Record<Effect, number> = {
  confetti: 2000,
  fireworks: 1600,
  drum: 850,
  "money-rain": 2600,
  handkerchief: 1700,
  leader: 1500,
};

function particles(effect: Effect, width: number, height: number): Particle[] {
  if (effect === "drum" || effect === "handkerchief") return [];
  const money = effect === "money-rain";
  const fireworks = effect === "fireworks";
  const centerX = width * (0.27 + Math.random() * 0.46);
  const centerY = height * (fireworks ? 0.28 : 0.49);
  return Array.from({ length: fireworks ? 64 : 38 }, (_, index) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 65 + Math.random() * (fireworks ? 300 : 165);
    return {
      x: money ? Math.random() * width : centerX,
      y: money ? -Math.random() * height * 0.28 : centerY,
      xSpeed: money ? Math.sin(angle) * 120 : Math.cos(angle) * speed,
      ySpeed: money ? 185 + Math.random() * 100 : Math.sin(angle) * speed - (fireworks ? 0 : 150),
      rotation: angle,
      size: 3 + Math.random() * 9,
      color: money ? (index % 2 ? "#a9d28a" : "#d3e3a3") : colors[index % colors.length],
    };
  });
}

function drawParticles(context: Context, burst: Burst, seconds: number): void {
  for (const particle of burst.particles) {
    const x = particle.x + particle.xSpeed * seconds;
    const y = particle.y + particle.ySpeed * seconds + 135 * seconds * seconds;
    context.lineWidth = 2;
    context.fillStyle = particle.color;
    context.strokeStyle = particle.color;
    if (burst.effect === "fireworks") {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - particle.xSpeed * 0.06, y - (particle.ySpeed + 270 * seconds) * 0.06);
      context.stroke();
    } else {
      context.save();
      context.translate(x, y);
      context.rotate(particle.rotation + seconds * 3);
      const money = burst.effect === "money-rain";
      const width = particle.size * (money ? 2.9 : 1);
      context.fillRect(-width / 2, -particle.size / 2, width, particle.size);
      if (money) {
        context.strokeStyle = "#48794a";
        context.strokeRect(
          -width / 2 + 2,
          -particle.size / 2 + 2,
          Math.max(0, width - 4),
          Math.max(0, particle.size - 4),
        );
      }
      context.restore();
    }
  }
}

export class Effects {
  private bursts: Burst[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  add(cue: HalayCue, at: number): void {
    const { effect } = cue;
    if (effect === "gift" || effect === "joined") return;
    if (this.bursts.length >= 10) this.bursts.shift();
    this.bursts.push({ effect, at, particles: particles(effect, this.width, this.height) });
  }

  draw(context: Context, now: number): void {
    this.bursts = this.bursts.filter(
      (burst) => elapsedSince(burst.at, now) < duration[burst.effect],
    );
    for (const burst of this.bursts) {
      const age = elapsedSince(burst.at, now);
      const progress = age / duration[burst.effect];
      context.save();
      context.globalAlpha = Math.min(1, (1 - progress) * 2.35);
      if (burst.effect === "drum") this.drawDrum(context, progress);
      else if (burst.effect === "handkerchief") this.drawHandkerchief(context, progress);
      else drawParticles(context, burst, age / 1000);
      context.restore();
    }
  }

  private drawDrum(context: Context, progress: number): void {
    const radius = this.width * (0.035 + progress * 0.32);
    context.strokeStyle = "#ffd081";
    context.lineWidth = 9 * (1 - progress) + 1;
    for (const factor of [0.75, 1, 1.25]) {
      context.beginPath();
      context.ellipse(
        this.width * (this.width > this.height ? 0.56 : 0.5),
        this.height * 0.53,
        radius * factor,
        radius * factor * 0.51,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }

  private drawHandkerchief(context: Context, progress: number): void {
    const x = this.width * (0.24 + progress * 0.52);
    const y = this.height * 0.57 + Math.sin(progress * Math.PI * 3) * this.height * 0.055;
    const wave = Math.sin(progress * Math.PI * 9) * 26;
    context.translate(x, y);
    context.rotate(0.2 + progress);
    context.fillStyle = "#e76650";
    context.strokeStyle = "#ffe3a2";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(0, 0);
    context.bezierCurveTo(-24, -72 + wave, -115, 12 + wave, -138, -50);
    context.quadraticCurveTo(-159, -8, -145, 20);
    context.bezierCurveTo(-93, 57 - wave, -36, -21, 0, 0);
    context.fill();
    context.stroke();
  }
}
