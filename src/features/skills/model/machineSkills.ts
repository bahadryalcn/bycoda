import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import { runMachineCommand } from "../../connections/model/remoteCommands";

type MachineInventory = {
  skills: DiscoveredSkill[] | null;
  expires: number;
  retryAt: number;
  error: unknown;
  pending: Promise<DiscoveredSkill[]> | null;
};

const inventories = new Map<string, MachineInventory>();
const inventoryKey = (environmentId: string, cwd: string) => JSON.stringify([environmentId, cwd]);

/** Forgets every remembered machine inventory. */
export function clearMachineSkillsCache(): void {
  inventories.clear();
}

/** Last successful inventory for immediate display while this machine refreshes. */
export function cachedMachineSkills(
  environmentId: string,
  projectCwd = "",
): DiscoveredSkill[] | null {
  return inventories.get(inventoryKey(environmentId, projectCwd))?.skills ?? null;
}

/** A connected machine's skills: its personal ones, plus those of `projectCwd`
 * (a `remote://` project path on that machine) when given. The paths come
 * back as `remote://` paths. Pass `refresh: false` for cached page opens; the default
 * re-reads after mutations for existing callers. Explicit refresh also supersedes pending reads. */
export function listMachineSkills(
  environmentId: string,
  projectCwd = "",
  options?: { refresh?: boolean },
): Promise<DiscoveredSkill[]> {
  const key = inventoryKey(environmentId, projectCwd);
  let entry = inventories.get(key);
  if (!options?.refresh && entry) {
    if (entry.pending) return entry.pending;
    if (options?.refresh === false) {
      if (Date.now() < entry.retryAt) return Promise.reject(entry.error);
      if (entry.skills && Date.now() < entry.expires) return Promise.resolve(entry.skills);
    }
  }
  entry = { skills: entry?.skills ?? null, expires: 0, retryAt: 0, error: null, pending: null };
  // Bound retained project inventories; an evicted request cannot restore itself.
  if (!inventories.has(key) && inventories.size >= 128)
    inventories.delete(inventories.keys().next().value!);
  inventories.set(key, entry);
  const current = entry;
  const request = runMachineCommand(environmentId, "list_skills", {
    cwd: projectCwd,
  })
    .then((value) => {
      if (!Array.isArray(value))
        throw new Error("Could not load machine skills: invalid inventory.");
      const skills = value as DiscoveredSkill[];
      if (inventories.get(key) === current) {
        current.skills = skills;
        current.expires = Date.now() + 30_000;
      }
      return inventories.get(key)?.skills ?? skills;
    })
    .catch((error: unknown) => {
      if (inventories.get(key) === current) {
        current.error = error;
        current.retryAt = Date.now() + 5_000;
      }
      throw error;
    })
    .finally(() => {
      if (inventories.get(key) === current) current.pending = null;
    });
  current.pending = request;
  return request;
}
