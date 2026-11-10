import type { CrewDefinition } from "./crew";
import { forgetCrewAppearance } from "./crewAppearance";
import type { CrewAppearance } from "./crewIdentity";

type LocalLooks = Record<string, CrewAppearance>;

export function hasLook(look: CrewAppearance | undefined): look is CrewAppearance {
  return !!look && !!(look.icon || look.color);
}

/**
 * The look to show: an unsaved draft's own look first, then the one the Host stores for
 * the crew (identical on every device), then a look still kept on this device from before
 * the Host stored it. No result means the default hashed from the crew id.
 */
export function resolveCrewLook(
  crew: { id: string; appearance?: CrewAppearance },
  local: LocalLooks,
  look?: CrewAppearance,
): CrewAppearance | undefined {
  if (look) return look;
  if (hasLook(crew.appearance)) return crew.appearance;
  return local[crew.id];
}

/** Applies an edit; clearing both fields leaves `{}`, which the Host stores as no look. */
export function mergeLook(current: CrewAppearance, patch: CrewAppearance): CrewAppearance {
  const next = { ...current, ...patch };
  if (!next.icon) delete next.icon;
  if (!next.color) delete next.color;
  return next;
}

/**
 * Migration of a look kept only on this device. A crew that has a local entry but no
 * Host look gets that entry with the next save the owner makes anyway; opening or
 * listing crews never writes. An explicitly cleared look (`{}`) is not migrated.
 */
export function migrationLook(
  crew: Pick<CrewDefinition, "id" | "appearance">,
  local: LocalLooks,
  supported: boolean,
): CrewAppearance | undefined {
  return supported && crew.appearance === undefined && hasLook(local[crew.id])
    ? local[crew.id]
    : undefined;
}

/** What a save sends: the definition plus its migrating local look, if any. */
export function outgoingWithLook(
  definition: CrewDefinition,
  local: LocalLooks,
  supported: boolean,
): CrewDefinition {
  const appearance = migrationLook(definition, local, supported);
  return appearance ? { ...definition, appearance } : definition;
}

/**
 * Runs only after the Host accepted a save. The local entry is then redundant, either
 * because it migrated or because the owner set the look on the draft itself, and is
 * removed. A failed save never reaches this, so the entry stays for the next attempt.
 */
export function settleLocalLook(sent: CrewDefinition, returned: CrewDefinition) {
  if (sent.appearance !== undefined || returned.appearance !== undefined)
    forgetCrewAppearance(returned.id);
}

/** After a save, an untouched draft gains the migrated look so later saves keep it. */
export function keepMigratedLook(
  adopted: CrewDefinition,
  sent: CrewDefinition,
  returned: CrewDefinition,
): CrewDefinition {
  return adopted.appearance === undefined &&
    sent.appearance === undefined &&
    returned.appearance !== undefined
    ? { ...adopted, appearance: returned.appearance }
    : adopted;
}
