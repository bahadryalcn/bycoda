/** Theme-neutral cut-out rig: SVG `data-part` groups become cached canvas layers moved by joints. */

export type RigJoint =
  | "head"
  | "arm"
  | "forearm"
  | "weapon"
  | "arm-b"
  | "forearm-b"
  | "prop"
  | "cape";
export type RigPart = "body" | "blink" | "mouth" | "glow" | RigJoint;

/** Every joint angle is in degrees, clockwise on screen, relative to the artwork's drawn pose. */
export type RigPose = {
  bodyAngle: number;
  bodyX: number;
  bodyY: number;
  /** Vertical squash (+) or stretch (-) about the feet, for weight and impact. */
  squash: number;
  headAngle: number;
  headX: number;
  headScaleX: number;
  armAngle: number;
  armY: number;
  forearmAngle: number;
  weaponAngle: number;
  offArmAngle: number;
  offForearmAngle: number;
  propAngle: number;
  capeAngle: number;
  /** Overlay strengths, 0-1. */
  glow: number;
  blink: number;
  mouth: number;
};

export const restRigPose = (): RigPose => ({
  bodyAngle: 0,
  bodyX: 0,
  bodyY: 0,
  squash: 0,
  headAngle: 0,
  headX: 0,
  headScaleX: 1,
  armAngle: 0,
  armY: 0,
  forearmAngle: 0,
  weaponAngle: 0,
  offArmAngle: 0,
  offForearmAngle: 0,
  propAngle: 0,
  capeAngle: 0,
  glow: 0,
  blink: 0,
  mouth: 0,
});

type Pivot = { x: number; y: number };
type Layer = {
  part: RigPart;
  follow: RigJoint | null;
  overlay: boolean;
  trail: boolean;
  color: HTMLCanvasElement;
  neutral: HTMLCanvasElement;
  x: number;
  y: number;
};
export type CharacterRig = {
  id: string;
  layers: Layer[];
  joints: Map<RigJoint, { pivot: Pivot; follow: RigJoint | null }>;
  /** Whether any layer leaves a motion trail during fast actions. */
  trails: boolean;
};

const JOINTS = new Set<string>([
  "head",
  "arm",
  "forearm",
  "weapon",
  "arm-b",
  "forearm-b",
  "prop",
  "cape",
]);
const PARTS = new Set<string>([...JOINTS, "body", "blink", "mouth", "glow"]);
/** Feet rest on this artwork line; whole-body motion turns and squashes about it. */
export const RIG_FEET = { x: 80, y: 226 } as const;
const SIZE = 2;

function canvas(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  return result;
}

/** Crop once so transparent full-figure sheets do not multiply the shared cache size. */
function rasterize(image: HTMLImageElement, work: HTMLCanvasElement) {
  const c = work.getContext("2d")!;
  c.clearRect(0, 0, work.width, work.height);
  c.drawImage(image, 0, 0, work.width, work.height);
  const pixels = c.getImageData(0, 0, work.width, work.height);
  let left = work.width,
    top = work.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < work.height; y++) {
    for (let x = 0; x < work.width; x++) {
      const i = (y * work.width + x) * 4;
      if (!pixels.data[i + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      const gray = pixels.data[i] * 0.21 + pixels.data[i + 1] * 0.72 + pixels.data[i + 2] * 0.07;
      pixels.data[i] = 46 + gray * 0.43;
      pixels.data[i + 1] = 53 + gray * 0.44;
      pixels.data[i + 2] = 63 + gray * 0.46;
    }
  }
  if (left > right || top > bottom) return undefined;
  const width = right - left + 1,
    height = bottom - top + 1;
  const color = canvas(width, height);
  color.getContext("2d")!.drawImage(work, left, top, width, height, 0, 0, width, height);
  c.putImageData(pixels, 0, 0);
  const neutral = canvas(width, height);
  neutral.getContext("2d")!.drawImage(work, left, top, width, height, 0, 0, width, height);
  return { color, neutral, x: left / SIZE, y: top / SIZE };
}

/** Decode one 160x240 SVG into ordered layers; `data-front` layers are drawn last. */
export async function decodeCharacterRig(id: string, svg: string): Promise<CharacterRig> {
  const source = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (source.querySelector("parsererror")) throw new Error(`Invalid ${id} artwork`);
  const groups = [...source.querySelectorAll("[data-part]")];
  if (!groups.length) throw new Error(`Missing ${id} animation layers`);
  const layers: (Layer & { front: boolean })[] = [];
  const joints: CharacterRig["joints"] = new Map();
  const work = canvas(160 * SIZE, 240 * SIZE);
  for (const [index, group] of groups.entries()) {
    const part = group.getAttribute("data-part") ?? "";
    if (!PARTS.has(part)) throw new Error(`Unknown ${id} part ${part}`);
    const followName = group.getAttribute("data-follow");
    if (followName && !JOINTS.has(followName))
      throw new Error(`Unknown ${id} follow ${followName}`);
    const follow = followName as RigJoint | null;
    if (JOINTS.has(part) && !joints.has(part as RigJoint)) {
      joints.set(part as RigJoint, {
        pivot: {
          x: Number(group.getAttribute("data-pivot-x") ?? RIG_FEET.x),
          y: Number(group.getAttribute("data-pivot-y") ?? RIG_FEET.y),
        },
        follow,
      });
    }
    // Keep original ancestors and defs: gradient coordinates and inherited strokes stay intact.
    const isolated = source.documentElement.cloneNode(true) as Element;
    isolated.setAttribute("width", "160");
    isolated.setAttribute("height", "240");
    [...isolated.querySelectorAll("[data-part]")].forEach((element, i) => {
      if (i !== index) element.remove();
      else if (element.getAttribute("opacity") === "0") element.setAttribute("opacity", "1");
    });
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(isolated))}`;
    await image.decode();
    const sprite = rasterize(image, work);
    if (!sprite) continue;
    layers.push({
      part: part as RigPart,
      follow,
      overlay: group.getAttribute("opacity") === "0",
      trail: group.getAttribute("data-trail") === "true",
      front: group.getAttribute("data-front") === "true",
      ...sprite,
    });
  }
  return {
    id,
    layers: [...layers.filter((layer) => !layer.front), ...layers.filter((layer) => layer.front)],
    joints,
    trails: layers.some((layer) => layer.trail),
  };
}

function jointTransform(pose: RigPose, joint: RigJoint) {
  switch (joint) {
    case "head":
      return { angle: pose.headAngle, x: pose.headX, y: 0, scaleX: pose.headScaleX };
    case "arm":
      return { angle: pose.armAngle, x: 0, y: pose.armY, scaleX: 1 };
    case "forearm":
      return { angle: pose.forearmAngle, x: 0, y: 0, scaleX: 1 };
    case "weapon":
      return { angle: pose.weaponAngle, x: 0, y: 0, scaleX: 1 };
    case "arm-b":
      return { angle: pose.offArmAngle, x: 0, y: 0, scaleX: 1 };
    case "forearm-b":
      return { angle: pose.offForearmAngle, x: 0, y: 0, scaleX: 1 };
    case "prop":
      return { angle: pose.propAngle, x: 0, y: 0, scaleX: 1 };
    case "cape":
      return { angle: pose.capeAngle, x: 0, y: 0, scaleX: 1 };
  }
}

/** Outermost joint first: a forearm turns with its upper arm, a weapon with its forearm. */
function chainOf(rig: CharacterRig, layer: Layer): RigJoint[] {
  const chain: RigJoint[] = [];
  let joint: RigJoint | null = JOINTS.has(layer.part) ? (layer.part as RigJoint) : layer.follow;
  while (joint && chain.length < 8 && !chain.includes(joint)) {
    chain.unshift(joint);
    joint = rig.joints.get(joint)?.follow ?? null;
  }
  return chain;
}

export function paintRig(
  c: CanvasRenderingContext2D,
  rig: CharacterRig,
  pose: RigPose,
  palette: "color" | "neutral",
  trailsOnly = false,
) {
  c.save();
  const squash = Math.max(-0.3, Math.min(0.3, pose.squash));
  c.translate(RIG_FEET.x + pose.bodyX, RIG_FEET.y + pose.bodyY);
  c.rotate((pose.bodyAngle * Math.PI) / 180);
  c.scale(1 + squash * 0.5, 1 - squash);
  c.translate(-RIG_FEET.x, -RIG_FEET.y);
  for (const layer of rig.layers) {
    if (trailsOnly && !layer.trail) continue;
    const alpha =
      layer.part === "blink"
        ? pose.blink
        : layer.part === "mouth"
          ? pose.mouth
          : layer.part === "glow"
            ? pose.glow
            : 1;
    if (alpha <= 0) continue;
    c.save();
    c.globalAlpha *= Math.min(1, alpha);
    for (const joint of chainOf(rig, layer)) {
      const pivot = rig.joints.get(joint)?.pivot;
      if (!pivot) continue;
      const move = jointTransform(pose, joint);
      c.translate(pivot.x + move.x, pivot.y + move.y);
      c.rotate((move.angle * Math.PI) / 180);
      c.scale(move.scaleX, 1);
      c.translate(-pivot.x, -pivot.y);
    }
    const sprite = layer[palette];
    c.drawImage(sprite, layer.x, layer.y, sprite.width / SIZE, sprite.height / SIZE);
    c.restore();
  }
  c.restore();
}

/**
 * One figure in local artwork units, feet at RIG_FEET. Trails repeat only `data-trail` layers.
 * `charge` fills the color pass from the feet up to `headroom`; undefined stays neutral.
 */
export function paintCharacter(
  c: CanvasRenderingContext2D,
  rig: CharacterRig,
  poseAt: (offset: number) => RigPose & { action: number },
  charge: number | undefined,
  headroom: number,
) {
  const pose = poseAt(0);
  const trailing = rig.trails && pose.action > 0;
  const older = trailing ? poseAt(-110) : undefined;
  const previous = trailing ? poseAt(-55) : undefined;
  const paint = (palette: "neutral" | "color") => {
    if (older) {
      c.save();
      c.globalAlpha *= pose.action * 0.06;
      paintRig(c, rig, older, palette, true);
      c.restore();
    }
    if (previous) {
      c.save();
      c.globalAlpha *= pose.action * 0.13;
      paintRig(c, rig, previous, palette, true);
      c.restore();
    }
    paintRig(c, rig, pose, palette);
  };
  if (charge === undefined || charge < 1) paint("neutral");
  if (charge !== undefined && charge > 0) {
    c.save();
    if (charge < 1) {
      // Clip before joints move, so the fill line stays horizontal across the figure.
      const level = RIG_FEET.y - (headroom - 9) * charge;
      c.beginPath();
      c.rect(-320, level, 800, 480);
      c.clip();
    }
    paint("color");
    c.restore();
  }
}
