import { themePalette } from "../../../../shared/theme/palette";
import type { CrewRole } from "../crewMotion";

/**
 * Neo leads and Morpheus advises; every subagent is another Agent Smith.
 * `headroom` is the artwork height above the feet line that labels clear.
 */
export const MATRIX_CREW = [
  {
    id: "agent-smith",
    name: "Agent Smith",
    accent: themePalette.hex94a3b8,
    headroom: 195,
  },
  { id: "neo", name: "Neo", accent: themePalette.hex50fa7b, headroom: 197 },
  {
    id: "morpheus",
    name: "Morpheus",
    accent: themePalette.hex67e8f9,
    headroom: 182,
  },
] as const;

export type MatrixIdentity = (typeof MATRIX_CREW)[number]["id"];
export const MATRIX_IDS: MatrixIdentity[] = MATRIX_CREW.map(({ id }) => id);

const [SMITH, NEO, MORPHEUS] = MATRIX_CREW;

export function matrixCharacter(_id: number, role?: CrewRole) {
  if (role === "lead") return NEO;
  if (role === "advisor") return MORPHEUS;
  return SMITH;
}
