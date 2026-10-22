import { themePalette } from "../../../../shared/theme/palette";
import { paintCharacter } from "../characterRig";
import { CODE_HEIGHT, CODE_WIDTH, CREW_TOP, type CodeArtPainter } from "../crewCodeArt";
import { starWarsLayout } from "../starWarsLayout";
import { lotrCharacter } from "./lotrCrew";
import { lotrMotionAt } from "./lotrMotion";
import { lotrRig } from "./lotrRig";

export { loadLotrCrew } from "./lotrRig";

/** The shared scene owns lifecycle, visibility, reduced motion and the paint clock. */
export function createLotrPainter(surface: HTMLCanvasElement): CodeArtPainter {
  const scale = 2;
  surface.width = CODE_WIDTH * scale;
  surface.height = CODE_HEIGHT * scale;
  const c = surface.getContext("2d")!;
  return (_poses, activity = [], viewportWidth = 1280, time = 0) => {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, CODE_WIDTH, CODE_HEIGHT);
    // The crescent is theme-neutral: six familiar seats with the lead and advisor at the rear.
    const places = starWarsLayout(Math.max(6, activity.length), viewportWidth).sort(
      (a, b) => a.y - b.y,
    );
    for (const place of places) {
      const state = activity[place.id];
      const arrival = state?.arrival ?? 1;
      if (arrival <= 0) continue;
      const character = lotrCharacter(place.id, state?.role);
      const rig = lotrRig(character.id);
      if (!rig) continue;
      const working = state?.working === true;
      const x = place.x + (place.id >= 6 ? (1 - arrival) * (place.id % 2 ? 45 : -45) : 0);
      c.save();
      c.translate(x, place.y + CREW_TOP);
      c.scale(place.scale, place.scale);
      c.globalAlpha = arrival;
      // A small docking light makes active work visible independently of context fill.
      c.fillStyle = themePalette.rgba_12_19_32_0_5;
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
      paintCharacter(
        c,
        rig,
        (offset) => lotrMotionAt(character.id, place.id, time + offset, state),
        state?.charge,
        character.headroom,
      );
      c.restore();
    }
  };
}
