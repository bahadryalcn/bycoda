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

function persistSkillPolicy(policy: SkillPolicy): void {
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

const restrictions = new Map<string, { policy: SkillPolicy; expires: number; storage: string }>();
let policyRevision = 0;
function invalidateRestrictions(): void {
  policyRevision++;
  restrictions.clear();
}

export function cacheSkillPolicy(policy: SkillPolicy): void {
  invalidateRestrictions();
  persistSkillPolicy(policy);
}

// Keep this event name in sync with SKILLS_CHANGE_EVENT in skills.ts; importing
// that module here would introduce a cycle through its policy loader.
if (typeof window !== "undefined") {
  window.addEventListener("bycoda:skills-change", invalidateRestrictions);
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === DISABLED_SKILL_PATHS_KEY || event.key === DISABLED_SKILL_NAMES_KEY)
      invalidateRestrictions();
  });
}

/** Short-lived per-checkout policy; settings writes invalidate it immediately. */
export async function loadSkillRestrictions(
  cwd = "",
  options?: { refresh?: boolean },
): Promise<SkillPolicy> {
  if (!cwd.startsWith("remote://") && !(typeof isTauri === "function" && isTauri()))
    return cachedSkillPolicy();
  if (options?.refresh) {
    // Explicit catalog refresh must also read current machine authority. Fence
    // older in-flight policy reads so they cannot restore the superseded cache.
    policyRevision++;
    restrictions.delete(cwd);
  }
  const storage = JSON.stringify(cachedSkillPolicy());
  const cached = restrictions.get(cwd);
  if (cached && cached.expires > Date.now() && cached.storage === storage) return cached.policy;
  restrictions.delete(cwd);
  const revision = policyRevision;
  let policy: SkillPolicy;
  try {
    policy = parseSkillPolicy(await getSkillPolicy(cwd, cachedSkillPolicy().disabledPaths));
  } catch (error) {
    throw new Error(`Could not load skill restrictions: ${String(error)}`);
  }
  // An in-flight read must not restore a policy superseded by Settings.
  if (revision !== policyRevision) return loadSkillRestrictions(cwd);
  if (!cwd.startsWith("remote://")) persistSkillPolicy(policy);
  for (const [key, entry] of restrictions) if (entry.expires <= Date.now()) restrictions.delete(key);
  if (restrictions.size >= 128) restrictions.delete(restrictions.keys().next().value!);
  restrictions.set(cwd, { policy, expires: Date.now() + 30_000, storage: JSON.stringify(cachedSkillPolicy()) });
  return policy;
}
