import { themePalette } from "../../../shared/theme/palette";
import { STAR_WARS_ARTWORK } from "./starWarsCrew";
import type { StarWarsIdentity, StarWarsMotion } from "./starWarsMotion";

type PartName =
  | "body"
  | "head"
  | "arm"
  | "forearm"
  | "weapon"
  | "force-arm"
  | "jedi-arm"
  | "saber"
  | "blink"
  | "mouth"
  | "panel";
type Pivot = { x: number; y: number };
type Layer = {
  part: PartName;
  follow: string | null;
  mode: string | null;
  pivot: Pivot;
  overlay: boolean;
  color: HTMLCanvasElement;
  neutral: HTMLCanvasElement;
  x: number;
  y: number;
};
export type StarWarsRig = {
  id: StarWarsIdentity;
  layers: Layer[];
  head: Pivot;
  arm: Pivot;
  /** Elbow of a two-segment arm; absent when the artwork's arm is a single piece. */
  forearm?: Pivot;
  jediArm: Pivot;
};
const rigs = new Map<StarWarsIdentity, StarWarsRig>();
let loading: Promise<void> | undefined;
const SIZE = 2;
// Bundled imports work with the desktop's restricted connect-src policy as well as Vite.
const sources = import.meta.glob<string>("/public/crew/star-wars/*.svg", {
  query: "?raw",
  import: "default",
});

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
  if (left > right || top > bottom) throw new Error("Empty Star Wars artwork layer");
  const width = right - left + 1,
    height = bottom - top + 1;
  const color = canvas(width, height);
  color.getContext("2d")!.drawImage(work, left, top, width, height, 0, 0, width, height);
  c.putImageData(pixels, 0, 0);
  const neutral = canvas(width, height);
  neutral.getContext("2d")!.drawImage(work, left, top, width, height, 0, 0, width, height);
  return { color, neutral, x: left / SIZE, y: top / SIZE };
}

/** Decode the local SVG layers once; all subsequent acting uses cached canvas transforms. */
export function loadStarWarsRigs(): Promise<void> {
  loading ??= Promise.all(
    STAR_WARS_ARTWORK.map(async ({ id }) => {
      if (rigs.has(id)) return;
      const loadSource = sources[`/public/crew/star-wars/${id}.svg`];
      if (!loadSource) throw new Error(`Cannot load ${id} artwork`);
      const source = new DOMParser().parseFromString(await loadSource(), "image/svg+xml");
      if (source.querySelector("parsererror")) throw new Error(`Invalid ${id} artwork`);
      const groups = [...source.querySelectorAll("[data-part]")];
      if (!groups.length) throw new Error(`Missing ${id} animation layers`);
      const layers: Layer[] = [];
      const work = canvas(160 * SIZE, 240 * SIZE);
      for (const [index, group] of groups.entries()) {
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
        layers.push({
          part: group.getAttribute("data-part") as PartName,
          follow: group.getAttribute("data-follow"),
          mode: group.getAttribute("data-mode"),
          pivot: {
            x: Number(group.getAttribute("data-pivot-x") ?? 80),
            y: Number(group.getAttribute("data-pivot-y") ?? 226),
          },
          overlay: group.getAttribute("opacity") === "0",
          ...rasterize(image, work),
        });
      }
      // Blades sweep in front of faces; partition once while preserving all other layer order.
      const hasSaber = id === "yoda" || id === "obi-wan" || id === "luke" || id === "darth-vader";
      const saberPart = id === "yoda" ? "saber" : "weapon";
      const orderedLayers = hasSaber
        ? [
            ...layers.filter((layer) => layer.part !== saberPart),
            ...layers.filter((layer) => layer.part === saberPart),
          ]
        : layers;
      rigs.set(id, {
        id,
        layers: orderedLayers,
        head: layers.find((layer) => layer.part === "head")!.pivot,
        arm: layers.find((layer) => layer.part === "arm")?.pivot ?? { x: 80, y: 150 },
        forearm: layers.find((layer) => layer.part === "forearm")?.pivot,
        jediArm: layers.find((layer) => layer.part === "jedi-arm")?.pivot ?? { x: 100, y: 151 },
      });
    }),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

export const starWarsRig = (id: StarWarsIdentity) => rigs.get(id);

function rotate(
  c: CanvasRenderingContext2D,
  pivot: Pivot,
  angle: number,
  x = 0,
  y = 0,
  scaleX = 1,
) {
  c.translate(pivot.x + x, pivot.y + y);
  c.rotate((angle * Math.PI) / 180);
  c.scale(scaleX, 1);
  c.translate(-pivot.x, -pivot.y);
}

/** A local flash shares the weapon transform; its short ray never crosses the stage. */
function paintMuzzleFlash(
  c: CanvasRenderingContext2D,
  id: StarWarsIdentity,
  recoil: number,
  palette: "color" | "neutral",
) {
  if (recoil <= 0 || (id !== "leia" && id !== "chewbacca")) return;
  c.save();
  c.globalAlpha *= Math.min(1, recoil);
  c.translate(id === "leia" ? 123 : 13, id === "leia" ? 131 : 68);
  c.rotate(id === "leia" ? -Math.PI / 2 : Math.PI);
  c.fillStyle = palette === "color" ? themePalette.hexffad86 : themePalette.hexb3c5d8;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(5, -2);
  c.lineTo(3, -5);
  c.lineTo(10, -1.5);
  c.lineTo(16, 0);
  c.lineTo(10, 1.5);
  c.lineTo(3, 5);
  c.lineTo(5, 2);
  c.closePath();
  c.fill();
  c.strokeStyle = palette === "color" ? themePalette.hexfff5c3 : themePalette.hexe1ebf3;
  c.lineWidth = 1.5;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(1, 0);
  c.lineTo(18, 0);
  c.stroke();
  c.restore();
}

function paintLayers(
  c: CanvasRenderingContext2D,
  rig: StarWarsRig,
  motion: StarWarsMotion,
  palette: "color" | "neutral",
  weaponsOnly: boolean,
) {
  c.save();
  rotate(c, { x: 80, y: 226 }, motion.bodyAngle, motion.bodyX, motion.bodyY);
  for (const layer of rig.layers) {
    if (weaponsOnly && layer.part !== "weapon" && layer.part !== "saber") continue;
    const expressionAlpha =
      layer.part === "blink"
        ? motion.blink
        : layer.part === "mouth"
          ? motion.mouth
          : layer.overlay && layer.part === "panel"
            ? motion.panel
            : 1;
    const modeAlpha =
      layer.mode === "rest" ? 1 - motion.jedi : layer.mode === "jedi" ? motion.jedi : 1;
    const alpha = expressionAlpha * modeAlpha;
    if (alpha <= 0) continue;
    c.save();
    c.globalAlpha *= alpha;
    if (layer.part === "head" || layer.follow === "head")
      rotate(c, rig.head, motion.headAngle, motion.headX, 0, motion.headScaleX);
    const forearm = layer.part === "forearm" || layer.follow === "forearm";
    if (
      (layer.part === "arm" || layer.follow === "arm" || forearm) &&
      !(rig.id === "yoda" && layer.mode === "rest")
    )
      rotate(c, rig.arm, motion.armAngle, 0, motion.armY);
    // The elbow pivot is carried by the upper arm, so the forearm bends after the shoulder turns.
    if (forearm && rig.forearm) rotate(c, rig.forearm, motion.forearmAngle);
    if (layer.part === "force-arm") rotate(c, layer.pivot, motion.forceAngle);
    if (layer.part === "jedi-arm" || layer.follow === "jedi-arm")
      rotate(c, rig.jediArm, motion.armAngle, 0, motion.armY);
    if (layer.part === "weapon" || layer.part === "saber")
      rotate(c, layer.pivot, motion.weaponAngle);
    const sprite = layer[palette];
    c.drawImage(sprite, layer.x, layer.y, sprite.width / SIZE, sprite.height / SIZE);
    if (layer.part === "panel" && !layer.overlay && motion.panel > 0) {
      c.globalCompositeOperation = "screen";
      c.globalAlpha *= motion.panel * 0.6;
      c.drawImage(sprite, layer.x, layer.y, sprite.width / SIZE, sprite.height / SIZE);
    }
    if (!weaponsOnly && layer.part === "weapon")
      paintMuzzleFlash(c, rig.id, motion.recoil, palette);
    c.restore();
  }
  c.restore();
}

/** One pose is used for both passes, so expressions never detach at the color boundary. */
export function paintStarWarsRig(
  c: CanvasRenderingContext2D,
  rig: StarWarsRig,
  motion: StarWarsMotion,
  palette: "color" | "neutral",
) {
  paintLayers(c, rig, motion, palette, false);
}

/** Cached blade silhouettes only: a fast swing must never leave ghost heads or bodies. */
export function paintStarWarsWeaponTrail(
  c: CanvasRenderingContext2D,
  rig: StarWarsRig,
  motion: StarWarsMotion,
  palette: "color" | "neutral",
  opacity: number,
) {
  if (opacity <= 0) return;
  c.save();
  c.globalAlpha *= opacity;
  paintLayers(c, rig, motion, palette, true);
  c.restore();
}
