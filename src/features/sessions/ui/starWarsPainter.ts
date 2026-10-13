import { CODE_HEIGHT, CODE_WIDTH, CREW_TOP, type CodeArtPainter } from "./crewCodeArt";
import { starWarsCharacter } from "./starWarsCrew";
import { starWarsLayout } from "./starWarsLayout";
import { starWarsMotionAt } from "./starWarsMotion";
import { paintStarWarsRig, paintStarWarsWeaponTrail, starWarsRig } from "./starWarsRig";

export { loadStarWarsRigs as loadStarWarsCrew } from "./starWarsRig";

const SABER_CHARACTERS = new Set(["darth-vader", "obi-wan", "luke", "yoda"]);

/** The shared scene owns lifecycle, visibility, reduced motion and the paint clock. */
export function createStarWarsPainter(surface: HTMLCanvasElement): CodeArtPainter {
  const scale = 2;
  surface.width = CODE_WIDTH * scale;
  surface.height = CODE_HEIGHT * scale;
  const c = surface.getContext("2d")!;
  return (_poses, activity = [], viewportWidth = 1280, time = 0) => {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, CODE_WIDTH, CODE_HEIGHT);
    const places = starWarsLayout(Math.max(6, activity.length), viewportWidth).sort(
      (a, b) => a.y - b.y,
    );
    for (const place of places) {
      const state = activity[place.id];
      const arrival = state?.arrival ?? 1;
      if (arrival <= 0) continue;
      const character = starWarsCharacter(place.id, state?.role);
      const rig = starWarsRig(character.id);
      if (!rig) continue;
      const charge = state?.charge;
      const working = state?.working === true;
      const motion = starWarsMotionAt(character.id, place.id, time, state);
      const trailing = motion.action > 0 && SABER_CHARACTERS.has(character.id);
      const previous = trailing
        ? starWarsMotionAt(character.id, place.id, time - 55, state)
        : undefined;
      const older = trailing
        ? starWarsMotionAt(character.id, place.id, time - 110, state)
        : undefined;
      const paint = (palette: "neutral" | "color") => {
        if (older) paintStarWarsWeaponTrail(c, rig, older, palette, motion.action * 0.06);
        if (previous) paintStarWarsWeaponTrail(c, rig, previous, palette, motion.action * 0.13);
        paintStarWarsRig(c, rig, motion, palette);
      };
      const x = place.x + (place.id >= 6 ? (1 - arrival) * (place.id % 2 ? 45 : -45) : 0);
      c.save();
      c.translate(x, place.y + CREW_TOP);
      c.scale(place.scale, place.scale);
      c.globalAlpha = arrival;
      // A small docking light makes active work visible independently of context fill.
      c.fillStyle = "rgba(12,19,32,0.5)";
      c.beginPath();
      c.ellipse(0, 0, 43, 6, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = character.accent;
      c.globalAlpha = arrival * (working ? 0.8 : 0.23);
      c.lineWidth = working ? 1.5 : 0.8;
      c.beginPath();
      c.ellipse(0, 0, 44, 7, 0, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = arrival;
      c.translate(-75, -224);
      c.scale(150 / 160, 225 / 240);
      if (charge === undefined || charge < 1) paint("neutral");
      if (charge !== undefined && charge > 0) {
        c.save();
        // Character-specific crown height means R2 and Yoda fill at the same rate as humans.
        const bottom = -2;
        const top = -(character.headroom - 9);
        const level = bottom - (bottom - top) * charge;
        c.beginPath();
        if (charge < 1) {
          // Clip in stage coordinates, before the joints move: the fill stays horizontal.
          c.rect(-240, (level + 220) / (150 / 160), 640, 480);
          c.clip();
        }
        paint("color");
        c.restore();
      }
      c.restore();
    }
  };
}
