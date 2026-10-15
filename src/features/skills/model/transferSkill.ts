import { exportSkill, importSkill, type DiscoveredSkill } from "../../../platform/tauri/fs";
import { runMachineCommand } from "../../connections/model/remoteCommands";
import { invalidateSkills, SKILLS_CHANGE_EVENT } from "./skills";

/** Marks an import that found a skill of that name already on the target. */
const SKILL_EXISTS = "SKILL_EXISTS:";

export class SkillExistsError extends Error {
  constructor(readonly skillName: string) {
    super(`A skill named ${skillName} already exists.`);
    this.name = "SkillExistsError";
  }
}

/** Built-in skills have no folder and plugin skills (`plugin:name`) belong to
 * their plugin, so neither can be copied to another machine. */
export function canTransferSkill(skill: Pick<DiscoveredSkill, "name" | "scope">): boolean {
  return skill.scope !== "builtin" && !skill.name.includes(":");
}

/**
 * Copies a skill's folder from one machine to the other's personal skills
 * (`~/.agents/skills/<name>`). `sourceCwd` / `targetCwd` are project paths used
 * to pick the machine: `remote://…` is another machine, empty or local is this
 * computer. `targetMachine` (an environment id) addresses a machine directly
 * instead, for one that has no open project. Rejects with `SkillExistsError`
 * unless `overwrite`.
 */
export async function transferSkill(input: {
  skill: Pick<DiscoveredSkill, "name" | "path">;
  sourceCwd: string;
  targetCwd: string;
  targetMachine?: string;
  overwrite: boolean;
}): Promise<string> {
  const bundle = await exportSkill(input.skill.path, input.sourceCwd);
  let written: string;
  try {
    written = input.targetMachine
      ? ((await runMachineCommand(input.targetMachine, "skill_import", {
          name: bundle.name,
          files: bundle.files,
          overwrite: input.overwrite,
        })) as string)
      : await importSkill(input.targetCwd, bundle, input.overwrite);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes(SKILL_EXISTS)) throw new SkillExistsError(bundle.name);
    throw reason;
  }
  invalidateSkills();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
  return written;
}
