import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { listHostSkillCandidates } from "./skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { SKILL_INVOCATION_GUIDANCE } from "../src/integrations/harness/core/skillGuidance";
import { readSkillPolicy } from "./skill-policy";
import {
  assertSkillInvocationsEnabled,
  skillDisabled,
} from "../src/integrations/harness/core/skillPolicy";
import {
  getReportedCommands,
  reportedSkillRestrictions,
} from "../src/integrations/harness/core/reportedCommands";

/** Resolve on the host at send time; never send client paths or cache skill bodies. */
export async function prepareHostSkillPrompt(
  text: string,
  cwd: string,
  home = homedir(),
  sessionId?: string,
): Promise<string> {
  const policy = readSkillPolicy(home);
  const native = reportedSkillRestrictions(getReportedCommands(sessionId));
  assertSkillInvocationsEnabled(text, policy);
  assertSkillInvocationsEnabled(text, native);
  const names = new Set(skillInvocationTokens(text).map((token) => token.name));
  if (!names.size) return text;
  const named = listHostSkillCandidates(cwd, home).skills.filter((skill) => names.has(skill.name));
  const picked = [
    ...new Map(
      named
        .filter((skill) => !skillDisabled(policy, skill) && !skillDisabled(native, skill))
        .reverse()
        .map((skill) => [skill.name, skill]),
    ).values(),
  ];
  for (const name of names)
    if (named.some((skill) => skill.name === name) && !picked.some((skill) => skill.name === name))
      throw new Error(`Skill "${name}" is disabled for this conversation.`);
  for (const skill of picked)
    if (skill.userInvocable === false)
      throw new Error(`Skill "${skill.name}" does not allow user invocation.`);
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
