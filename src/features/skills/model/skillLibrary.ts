import type { DiscoveredSkill } from "../../../platform/tauri/fs";

/** A connected machine whose skills are listed: `cwd` is its open project
 * (a `remote://` path), or empty for its personal skills only. */
export type SkillMachine = { environmentId: string; name: string; cwd: string };

/** One machine's discovered skills; `skills` is null while loading or after a failed first read. */
export type MachineSkillList = {
  machine: SkillMachine | null;
  skills: DiscoveredSkill[] | null;
};

export type SkillCopy = {
  skill: DiscoveredSkill;
  machine: SkillMachine | null;
};

/** One library row: the same skill (scope, source, name) merged across machines. */
export type SkillEntry = {
  key: string;
  name: string;
  scope: DiscoveredSkill["scope"];
  /** The copy the row opens: this computer's when present, else the first machine's. */
  primary: SkillCopy;
  copies: SkillCopy[];
};

export type SkillPresence = "present" | "missing" | "unknown";
export type SkillListFilter = "all" | "enabled" | "off" | "missing";

const nameKey = (name: string) => name.toLocaleLowerCase();

/** Merges per-machine lists into rows, keeping this computer's order first. */
export function mergeSkillLibrary(lists: MachineSkillList[]): SkillEntry[] {
  const entries = new Map<string, SkillEntry>();
  for (const { machine, skills } of lists) {
    for (const skill of skills ?? []) {
      const key = `${skill.scope}\n${skill.source}\n${nameKey(skill.name)}`;
      const copy = { skill, machine };
      const entry = entries.get(key);
      if (entry) entry.copies.push(copy);
      else
        entries.set(key, {
          key,
          name: skill.name,
          scope: skill.scope,
          primary: copy,
          copies: [copy],
        });
    }
  }
  return [...entries.values()];
}

/** Whether a skill with this name exists on each machine, in list order. */
export function skillPresence(name: string, lists: MachineSkillList[]): SkillPresence[] {
  const wanted = nameKey(name);
  return lists.map(({ skills }) =>
    skills === null
      ? "unknown"
      : skills.some((skill) => nameKey(skill.name) === wanted)
        ? "present"
        : "missing",
  );
}

/** The copy of a named skill on one machine, preferring the same scope and source. */
export function copyOn(
  list: MachineSkillList,
  like: Pick<DiscoveredSkill, "name" | "scope" | "source">,
): DiscoveredSkill | null {
  const same = (list.skills ?? []).filter((skill) => nameKey(skill.name) === nameKey(like.name));
  return (
    same.find((skill) => skill.scope === like.scope && skill.source === like.source) ??
    same[0] ??
    null
  );
}

/** Lower-cased skill names per machine key (`local` or environment id), for "already installed" checks. */
export function installedNames(lists: MachineSkillList[]): Map<string, Set<string>> {
  return new Map(
    lists
      .filter((list) => list.skills !== null)
      .map((list) => [
        list.machine?.environmentId ?? "local",
        new Set((list.skills ?? []).map((skill) => nameKey(skill.name))),
      ]),
  );
}

export function filterSkillEntries(
  entries: SkillEntry[],
  query: string,
  filter: SkillListFilter,
  isOff: (copy: SkillCopy) => boolean,
  lists: MachineSkillList[],
): SkillEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (
      needle &&
      !entry.copies.some(({ skill }) =>
        [skill.name, skill.description, skill.source, skill.path].some((text) =>
          text.toLocaleLowerCase().includes(needle),
        ),
      )
    )
      return false;
    if (filter === "enabled") return !isOff(entry.primary);
    if (filter === "off") return isOff(entry.primary);
    if (filter === "missing") return skillPresence(entry.name, lists).includes("missing");
    return true;
  });
}
