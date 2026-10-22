import type { CrewTheme } from "../../settings/model/settings";
import type { CodeArtPainter } from "./crewCodeArt";
import type { CrewRole } from "./crewMotion";
import { createLotrPainter, loadLotrCrew } from "./lotr/lotrPainter";
import { lotrCharacter } from "./lotr/lotrCrew";
import { starWarsCharacter } from "./starWarsCrew";
import { createStarWarsPainter, loadStarWarsCrew } from "./starWarsPainter";

export type RiggedCrewCharacter = {
  id: string;
  name: string;
  accent: string;
  /** Artwork height above the feet that labels and the context fill clear. */
  headroom: number;
};

/** A character theme drawn from cached SVG joints, colored by context instead of aged by it. */
export type RiggedCrewTheme = {
  /** Upper-case stage title shown above the crew; a proper name, not translated. */
  title: string;
  load: () => Promise<void>;
  createPainter: (surface: HTMLCanvasElement) => CodeArtPainter;
  character: (id: number, role?: CrewRole) => RiggedCrewCharacter;
};

const RIGGED: Partial<Record<CrewTheme, RiggedCrewTheme>> = {
  "star-wars": {
    title: "STAR WARS",
    load: loadStarWarsCrew,
    createPainter: createStarWarsPainter,
    character: starWarsCharacter,
  },
  lotr: {
    title: "THE LORD OF THE RINGS",
    load: loadLotrCrew,
    createPainter: createLotrPainter,
    character: lotrCharacter,
  },
};

/** Undefined for the classic code-art crew. */
export const riggedCrewTheme = (theme: CrewTheme) => RIGGED[theme];
