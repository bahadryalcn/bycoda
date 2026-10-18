import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { listHostSkills } from "./skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { SKILL_INVOCATION_GUIDANCE } from "../src/integrations/harness/core/skillGuidance";

/** Resolve on the host at send time; never send client paths or cache skill bodies. */
export async function prepareHostSkillPrompt(
  text: string,
  cwd: string,
  home = homedir(),
): Promise<string> {
  const names = new Set(skillInvocationTokens(text).map((token) => token.name));
  if (!names.size) return text;
  const picked = listHostSkills(cwd, home).filter((skill) => names.has(skill.name));
  if (!picked.length) return text;
  const blocks = await Promise.all(
    picked.map(async (skill) => {
      try {
        const file = await open(skill.path, "r");
        let body: string;
        try {
          const size = (await file.stat()).size;
          if (size > 2 * 1024 * 1024) throw new Error("Skill exceeds 2 MiB");
          const buffer = Buffer.alloc(size + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > size) throw new Error("Skill changed while reading");
          body = buffer.subarray(0, bytesRead).toString("utf8").trim();
        } finally {
          await file.close();
        }
        return `## /${skill.name}\n\nSkill file: ${skill.path}\n\n${body}`;
      } catch {
        throw new Error(`Skill "${skill.name}" could not be read from ${skill.path}.`);
      }
    }),
  );
  return [SKILL_INVOCATION_GUIDANCE, "", blocks.join("\n\n"), "", "---", "", text].join("\n");
}
