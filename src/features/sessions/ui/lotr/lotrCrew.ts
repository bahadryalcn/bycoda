import { themePalette } from "../../../../shared/theme/palette";
import type { CrewRole } from "../crewMotion";

/**
 * Seat 2 leads (Gandalf) and seat 3 advises (Sauron), as in every crew theme.
 * `headroom` is the artwork height above the feet line that labels and the charge fill clear.
 */
export const LOTR_CREW = [
  { id: "nazgul", name: "Nazgûl", accent: themePalette.hexcbb6ed, headroom: 196 },
  { id: "elf", name: "Elf", accent: themePalette.hexfde68a, headroom: 203 },
  { id: "gandalf", name: "Gandalf", accent: themePalette.hexe1ebf3, headroom: 214 },
  { id: "sauron", name: "Sauron", accent: themePalette.hexffad86, headroom: 214 },
  { id: "dwarf", name: "Dwarf", accent: themePalette.hexd6a064, headroom: 145 },
  { id: "hobbit", name: "Hobbit", accent: themePalette.hex84dfae, headroom: 137 },
] as const;

/** Orcs only march in once a session runs more than six subagents at a time. */
export const LOTR_ORC = {
  id: "orc",
  name: "Orc",
  accent: themePalette.hexb5d984,
  headroom: 198,
} as const;

export type LotrIdentity = (typeof LOTR_CREW)[number]["id"] | typeof LOTR_ORC.id;
export const LOTR_IDS: LotrIdentity[] = [...LOTR_CREW, LOTR_ORC].map(({ id }) => id);

/** Subagents #5 and #6 take seats 6 and 7; every seat after that belongs to subagent #7 or later. */
const ORC_SEAT = 8;
const HELPERS = [LOTR_CREW[1], LOTR_CREW[0]] as const;

export function lotrCharacter(id: number, role?: CrewRole) {
  if (role === "lead") return LOTR_CREW[2];
  if (role === "advisor") return LOTR_CREW[3];
  if (id < LOTR_CREW.length) return LOTR_CREW[id];
  return id < ORC_SEAT ? HELPERS[id - LOTR_CREW.length] : LOTR_ORC;
}
