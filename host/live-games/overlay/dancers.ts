import type { HalaySnapshotDancer } from "../../../src/features/live-games/model/halayGame";
import { graphemes, truncateGraphemes } from "../../../src/shared/lib/text/truncate";
import { formation } from "./formation";

const costumes = ["#dd664d", "#2aa389", "#e1a648", "#bd5679", "#6a8e5f", "#567e9c"];
const skinTones = ["#b66d56", "#daa384", "#eeae81", "#a56347", "#f4c5a1"];

type Context = CanvasRenderingContext2D;
type Point = readonly [number, number];

interface Dancer {
  x: number;
  y: number;
  scale: number;
  phaseOffset: number;
  crowdOffset: number;
  ring: number;
  index: number;
  name: string;
  initial: string;
  role: HalaySnapshotDancer["role"];
  costume: string;
  skin: string;
  avatar?: HTMLImageElement;
}

interface Pose {
  dancer: Dancer;
  lift: number;
  step: number;
  left: Point;
  right: Point;
}

function line(context: Context, width: number, color: string, points: Point[]): void {
  context.beginPath();
  context.moveTo(...points[0]);
  for (let index = 1; index < points.length; index++) context.lineTo(...points[index]);
  context.lineWidth = width;
  context.strokeStyle = color;
  context.stroke();
}

function pose(dancer: Dancer, phase: number): Pose {
  const { x, y, scale, phaseOffset } = dancer;
  const step = Math.sin(phase + phaseOffset);
  const lift = Math.abs(step) * (9 * scale);
  const center = y - 37 * scale - lift;
  return {
    dancer,
    lift,
    step,
    left: [x - 22 * scale, center + step * 4 * scale],
    right: [x + 22 * scale, center - step * 4 * scale],
  };
}

function handBetween(first: Pose, second: Pose): Point {
  return [(first.dancer.x + second.dancer.x) / 2, (first.right[1] + second.left[1]) / 2];
}

function drawDancer(context: Context, frame: Pose, left: Point, right: Point): void {
  const { dancer, lift, step } = frame;
  const { x, y, scale, costume, skin, avatar, role } = dancer;
  const leader = role === "leader";
  const headY = -56;
  const radius = leader ? 17 : 14;

  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = "#06181583";
  context.beginPath();
  context.ellipse(0, 2, 24, 8, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const shoulderY = y - 41 * scale - lift;
  line(context, 8 * scale, costume, [[x - 10 * scale, shoulderY], left]);
  line(context, 8 * scale, costume, [[x + 10 * scale, shoulderY], right]);
  for (const [handX, handY] of [left, right]) {
    context.fillStyle = skin;
    context.beginPath();
    context.arc(handX, handY, 3.5 * scale, 0, Math.PI * 2);
    context.fill();
  }

  context.save();
  context.translate(x, y - lift);
  context.scale(scale, scale);
  line(context, 8, "#162323", [
    [-7, -21],
    [-13 - 6 * step, -9],
    [-14 - 8 * step, 0],
  ]);
  line(context, 8, "#162323", [
    [7, -21],
    [11 + 7 * step, -10],
    [13 + 8 * step, 0],
  ]);
  context.fillStyle = costume;
  context.beginPath();
  context.moveTo(-12, -44);
  context.quadraticCurveTo(0, -49, 12, -44);
  context.lineTo(17, -16);
  context.quadraticCurveTo(0, -9, -17, -16);
  context.closePath();
  context.fill();
  line(context, 4, "#ebca89", [
    [-14, -22],
    [0, -20],
    [14, -22],
  ]);
  line(context, 3, "#f8dcaa", [
    [-7, -43],
    [2, -36],
    [8, -42],
  ]);
  context.beginPath();
  context.arc(0, headY, radius, 0, Math.PI * 2);
  context.fillStyle = skin;
  context.fill();
  if (avatar?.complete && avatar.naturalWidth) {
    const diameter = radius * 2;
    const side = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    context.save();
    context.clip();
    context.drawImage(
      avatar,
      (avatar.naturalWidth - side) / 2,
      (avatar.naturalHeight - side) / 2,
      side,
      side,
      -radius,
      headY - radius,
      diameter,
      diameter,
    );
    context.restore();
  } else {
    context.fillStyle = "#1a2523";
    context.font = "bold 15px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(dancer.initial, 0, headY + 0.5);
  }
  context.strokeStyle = leader ? "#ffd26d" : role === "front" ? "#f6be88" : "#ead0a7";
  context.lineWidth = leader ? 4 : 2;
  context.stroke();
  if (leader) {
    const top = headY - radius - 4;
    line(context, 3, "#ffd26d", [
      [-10, top - 9],
      [-7, top],
      [7, top],
      [10, top - 9],
      [4, top - 6],
      [0, top - 14],
      [-4, top - 6],
      [-10, top - 9],
    ]);
    context.fillStyle = "#fbe2a1";
    context.beginPath();
    context.moveTo(18, -40);
    context.quadraticCurveTo(29, -44 - 9 * step, 38, -47);
    context.lineTo(34, -31);
    context.lineTo(18, -40);
    context.fill();
  }
  context.restore();
}

export class Dancers {
  private dancers: Dancer[] = [];
  private avatars = new Map<string, HTMLImageElement>();

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  update(viewers: HalaySnapshotDancer[]): void {
    const positions = formation(viewers.length, this.width, this.height);
    const labels = viewers.length > 32 ? 11 : 18;
    const usedAvatars = new Set<string>();
    this.dancers = positions.map((position, index) => {
      const { id, name, role, avatarUrl } = viewers[index];
      let avatar: HTMLImageElement | undefined;
      if (avatarUrl) {
        const url = new URL(avatarUrl, location.href);
        const avatarPrefix = new URL("avatar/", location.href);
        if (url.origin === avatarPrefix.origin && url.pathname.startsWith(avatarPrefix.pathname)) {
          usedAvatars.add(url.href);
          avatar = this.avatars.get(url.href);
          if (!avatar) {
            avatar = new Image();
            avatar.decoding = "async";
            avatar.src = url.href;
            this.avatars.set(url.href, avatar);
          }
        }
      }
      const colorIndex =
        Array.from(id).reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) | 0, 0) >>>
        0;
      return {
        ...position,
        phaseOffset: position.index * 0.31 + position.ring * 0.5,
        crowdOffset: viewers.length > 48 ? 10 * (position.index % 2) : 0,
        name: truncateGraphemes(name, role === "leader" ? 20 : labels),
        initial: graphemes(name)[0]?.toUpperCase() || "?",
        role,
        costume: costumes[colorIndex % costumes.length],
        skin: skinTones[colorIndex % skinTones.length],
        avatar,
      };
    });
    for (const url of this.avatars.keys()) {
      if (!usedAvatars.has(url)) this.avatars.delete(url);
    }
  }

  draw(context: Context, phase: number): void {
    context.lineCap = "round";
    context.lineJoin = "round";
    const frames = this.dancers.map((dancer) => pose(dancer, phase));
    const rings = [
      frames.filter(({ dancer }) => dancer.ring === 0),
      frames.filter(({ dancer }) => dancer.ring === 1),
    ];
    frames.sort((a, b) => a.dancer.y - b.dancer.y);
    for (const frame of frames) {
      const { ring, index } = frame.dancer;
      const row = rings[ring];
      const left = row.length > 1 ? handBetween(row[(index + 1) % row.length], frame) : frame.left;
      const right =
        row.length > 1
          ? handBetween(frame, row[(index + row.length - 1) % row.length])
          : frame.right;
      drawDancer(context, frame, left, right);
    }
    for (const { dancer, lift } of frames) {
      const { name, x, y, role, scale, crowdOffset } = dancer;
      const leader = role === "leader";
      const fontSize = leader ? Math.max(16, 20 * scale) : Math.max(9, 14 * scale);
      const height = y - lift - scale * (leader ? 96 : 77) - crowdOffset;
      context.font = `bold ${fontSize}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.lineWidth = leader ? 5 : 3;
      context.strokeStyle = "#12241e";
      context.strokeText(name, x, height);
      context.fillStyle = leader ? "#ffdd83" : "#fff1d1";
      context.fillText(name, x, height);
    }
  }
}
