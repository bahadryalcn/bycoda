import { listSkills, type DiscoveredSkill } from "../../../platform/tauri/fs";

const CANDIDATE_TTL_MS = 30_000;
const candidates = new Map<string, { expires: number; skills: Promise<DiscoveredSkill[]> }>();

/**
 * Every skill a provider might see in this folder: the whole inventory plus the
 * provider's own view of it, which can surface a skill a same-named install for
 * another provider shadows. Each send asks for it, and each read rescans every
 * skill folder on disk, so one read serves the sends of the next half minute.
 * A skill installed or removed in the app drops it at once; a failure is not kept.
 */
export function loadProviderSkillCandidates(
  cwd: string,
  provider: string,
): Promise<DiscoveredSkill[]> {
  const key = `${provider}\n${cwd}`;
  const cached = candidates.get(key);
  if (cached && cached.expires > Date.now()) return cached.skills;
  const skills = Promise.all([listSkills(cwd), listSkills(cwd, null, provider)]).then(
    ([inventory, eligible]) => [...inventory, ...eligible],
  );
  for (const [other, entry] of candidates)
    if (entry.expires <= Date.now()) candidates.delete(other);
  if (candidates.size >= 128) candidates.delete(candidates.keys().next().value!);
  candidates.set(key, { expires: Date.now() + CANDIDATE_TTL_MS, skills });
  skills.catch(() => {
    if (candidates.get(key)?.skills === skills) candidates.delete(key);
  });
  return skills;
}

export function clearProviderSkillCandidates() {
  candidates.clear();
}

// Keep this event name in sync with SKILLS_CHANGE_EVENT in skills.ts; importing
// a feature module here would cross the integration boundary.
if (typeof window !== "undefined") {
  window.addEventListener("bycoda:skills-change", () => candidates.clear());
}
