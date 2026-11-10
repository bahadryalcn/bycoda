import { normalizeProjectMascotName } from "../../projects/model/projectMascots";
// Pure list on purpose: tabGroups pulls desktop runtime, and this model is shared with the phone.
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroupColors";
import {
  AVATAR_ACCESSORY,
  AVATAR_FACE,
  AVATAR_HEADWEAR,
  AVATAR_OUTFIT,
  AVATAR_PALETTE_COUNT,
  type MemberAvatarChoice,
} from "./memberAvatarTraits";

export type CrewAppearance = {
  /** A project mascot name; unset uses the one hashed from the crew id. */
  icon?: string;
  /** Index into `TAB_GROUP_COLORS`; unset or 0 keeps the mascot's own colors. */
  color?: number;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid crew object");
  return value as Record<string, unknown>;
};
export const CREW_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
export function parseHandle(value: unknown): string {
  const handle = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!CREW_HANDLE_PATTERN.test(handle)) throw new Error("Invalid member handle");
  return handle;
}
export function parseAvatar(value: unknown): MemberAvatarChoice | undefined {
  const a = record(value);
  const invalid = () => new Error("Invalid member avatar");
  const part = <T extends string>(key: string, options: readonly T[]): T | undefined => {
    if (a[key] === undefined) return undefined;
    const found = options.find((option) => option === a[key]);
    if (!found) throw invalid();
    return found;
  };
  const known = ["headwear", "face", "glasses", "outfit", "palette", "accessory"];
  if (Object.keys(a).some((key) => !known.includes(key))) throw invalid();
  if (a.glasses !== undefined && typeof a.glasses !== "boolean") throw invalid();
  if (
    a.palette !== undefined &&
    (typeof a.palette !== "number" ||
      !Number.isInteger(a.palette) ||
      a.palette < 0 ||
      a.palette >= AVATAR_PALETTE_COUNT)
  )
    throw invalid();
  const choice: MemberAvatarChoice = {
    headwear: part("headwear", AVATAR_HEADWEAR),
    face: part("face", AVATAR_FACE),
    glasses: a.glasses as boolean | undefined,
    outfit: part("outfit", AVATAR_OUTFIT),
    palette: a.palette as number | undefined,
    accessory: part("accessory", AVATAR_ACCESSORY),
  };
  const defined = Object.fromEntries(
    Object.entries(choice).filter(([, entry]) => entry !== undefined),
  ) as MemberAvatarChoice;
  return Object.keys(defined).length ? defined : undefined;
}
export function parseAppearance(value: unknown): CrewAppearance | undefined {
  const a = record(value);
  const icon = typeof a.icon === "string" ? normalizeProjectMascotName(a.icon) : null;
  const color =
    typeof a.color === "number" &&
    Number.isInteger(a.color) &&
    a.color > 0 &&
    a.color < TAB_GROUP_COLORS.length
      ? a.color
      : undefined;
  return icon || color ? { ...(icon ? { icon } : {}), ...(color ? { color } : {}) } : undefined;
}

export function crewPaletteColor(index: number | undefined): string | undefined {
  return index ? TAB_GROUP_COLORS[index] : undefined;
}
