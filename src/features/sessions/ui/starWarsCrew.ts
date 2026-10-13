import type { CrewRole } from "./crewMotion";

/** Seat 2 leads and seat 3 advises in both themes. Helpers repeat only helper identities. */
export const STAR_WARS_CREW = [
  { id: "darth-vader", name: "Darth Vader", accent: "#fa7384", headroom: 209 },
  { id: "leia", name: "Leia Organa", accent: "#cbb6ed", headroom: 209 },
  { id: "obi-wan", name: "Obi-Wan Kenobi", accent: "#75cfff", headroom: 209 },
  { id: "yoda", name: "Yoda", accent: "#b5d984", headroom: 160 },
  { id: "luke", name: "Luke Skywalker", accent: "#84dfae", headroom: 209 },
  { id: "chewbacca", name: "Chewbacca", accent: "#d6a064", headroom: 209 },
] as const;

const R2_D2 = { id: "r2-d2", name: "R2-D2", accent: "#8eafff", headroom: 151 } as const;
/** Load overflow artwork too, so the seventh arrival can appear immediately. */
export const STAR_WARS_ARTWORK = [...STAR_WARS_CREW, R2_D2] as const;

const HELPERS = [
  R2_D2,
  STAR_WARS_CREW[0],
  STAR_WARS_CREW[1],
  STAR_WARS_CREW[4],
  STAR_WARS_CREW[5],
] as const;
export function starWarsCharacter(id: number, role?: CrewRole) {
  if (role === "lead") return STAR_WARS_CREW[2];
  if (role === "advisor") return STAR_WARS_CREW[3];
  return id < STAR_WARS_CREW.length
    ? STAR_WARS_CREW[id]
    : HELPERS[(id - STAR_WARS_CREW.length) % HELPERS.length];
}

/** A context meter, not task progress: unknown readings never become a fictional 100%. */
export function crewCharge(context: number | undefined, enabled = true): number | undefined {
  if (!enabled) return 1;
  return context === undefined || !Number.isFinite(context)
    ? undefined
    : Math.max(0, Math.min(1, context));
}
