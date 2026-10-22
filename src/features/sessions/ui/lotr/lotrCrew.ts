import { themePalette } from "../../../../shared/theme/palette";
import type { CrewRole } from "../crewMotion";

/**
 * Seat 2 leads (Gandalf) and seat 3 advises (Sauron), as in every crew theme.
 * `headroom` is the artwork height above the feet line that labels and the charge fill clear.
 */
export const LOTR_CREW = [
  { id: "nazgul", name: "Nazgûl", accent: themePalette.hexcbb6ed, headroom: 196 },
  { id: "orc", name: "Orc", accent: themePalette.hexb5d984, headroom: 198 },
  { id: "gandalf", name: "Gandalf", accent: themePalette.hexe1ebf3, headroom: 214 },
  { id: "sauron", name: "Sauron", accent: themePalette.hexffad86, headroom: 214 },
  { id: "dwarf", name: "Dwarf", accent: themePalette.hexd6a064, headroom: 145 },
  { id: "hobbit", name: "Hobbit", accent: themePalette.hex84dfae, headroom: 137 },
] as const;

export type LotrIdentity = (typeof LOTR_CREW)[number]["id"];
export const LOTR_IDS = LOTR_CREW.map(({ id }) => id);

/** Overflow seats repeat only the subagent kinds; the lead and advisor stay unique. */
const HELPERS = [LOTR_CREW[1], LOTR_CREW[0], LOTR_CREW[4], LOTR_CREW[5]] as const;

export function lotrCharacter(id: number, role?: CrewRole) {
  if (role === "lead") return LOTR_CREW[2];
  if (role === "advisor") return LOTR_CREW[3];
  return id < LOTR_CREW.length ? LOTR_CREW[id] : HELPERS[(id - LOTR_CREW.length) % HELPERS.length];
}
