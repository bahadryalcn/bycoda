import { isTauri } from "@tauri-apps/api/core";
import { getSkillPolicy } from "../../../platform/tauri/fs";
import { parseSkillPolicy, type SkillPolicy } from "../../../integrations/harness/core/skillPolicy";

export const DISABLED_SKILL_PATHS_KEY = "bycoda.disabledSkillPaths";
const DISABLED_SKILL_NAMES_KEY = "bycoda.disabledSkillNames";

export function cachedSkillPolicy(): SkillPolicy {
  const read = (key: string): string[] => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const disabledPaths = read(DISABLED_SKILL_PATHS_KEY);
  let migrated = false;
  try {
    migrated = localStorage.getItem(DISABLED_SKILL_NAMES_KEY) !== null;
  } catch {
    /* no browser storage */
  }
  return {
    disabledPaths,
    disabledNames: migrated
      ? read(DISABLED_SKILL_NAMES_KEY)
      : [
          ...new Set(
            disabledPaths
              .filter((path) => !path.startsWith("remote://"))
              .map((path) => path.replace(/\\/g, "/").split("/").slice(-2)[0])
              .filter(Boolean),
          ),
        ],
  };
}

export function cacheSkillPolicy(policy: SkillPolicy): void {
  try {
    const remoteLegacy = cachedSkillPolicy().disabledPaths.filter((path) =>
      path.startsWith("remote://"),
    );
    localStorage.setItem(
      DISABLED_SKILL_PATHS_KEY,
      JSON.stringify([...new Set([...remoteLegacy, ...policy.disabledPaths])]),
    );
    localStorage.setItem(DISABLED_SKILL_NAMES_KEY, JSON.stringify(policy.disabledNames));
  } catch {
    // This browser cache is optional. The caller still uses the authoritative
    // host policy, including its restrictions, when storage is unavailable/full.
  }
}

/** Load afresh at every send; the host, other windows and Settings share one machine file. */
export async function loadSkillRestrictions(cwd = ""): Promise<SkillPolicy> {
  if (!cwd.startsWith("remote://") && !(typeof isTauri === "function" && isTauri()))
    return cachedSkillPolicy();
  let policy: SkillPolicy;
  try {
    policy = parseSkillPolicy(await getSkillPolicy(cwd, cachedSkillPolicy().disabledPaths));
  } catch (error) {
    throw new Error(`Could not load skill restrictions: ${String(error)}`);
  }
  if (!cwd.startsWith("remote://")) cacheSkillPolicy(policy);
  return policy;
}
