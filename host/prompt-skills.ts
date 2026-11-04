import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { listHostSkillCandidatesAsync, skillMatchesProvider } from "./skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { SKILL_INVOCATION_GUIDANCE } from "../src/integrations/harness/core/skillGuidance";
import { readSkillPolicy } from "./skill-policy";
import {
  extractChatCitations,
  projectChatCitationsForProvider,
  withChatCitations,
} from "../src/features/sessions/model/chatCitation";
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
  provider?: string,
): Promise<string> {
  const { text: prose, citations } = extractChatCitations(text);
  const project = (prepared: string) =>
    projectChatCitationsForProvider(withChatCitations(prepared, citations));
  // Source snapshots and their comments are literal context, not skill
  // invocations. Strip their markers before policy/token discovery and append
  // their readable provider projection only after genuine owner skills expand.
  text = prose;
  let policy = readSkillPolicy(home);
  let native = reportedSkillRestrictions(getReportedCommands(sessionId));
  assertSkillInvocationsEnabled(text, policy);
  assertSkillInvocationsEnabled(text, native);
  const names = new Set(skillInvocationTokens(text).map((token) => token.name));
  if (!names.size) return project(text);
  const inventory = await listHostSkillCandidatesAsync(cwd, home);
  if (inventory.truncated) throw new Error("Skill discovery is incomplete; prompt preparation refused.");
  policy = readSkillPolicy(home);
  native = reportedSkillRestrictions(getReportedCommands(sessionId));
  assertSkillInvocationsEnabled(text, policy);
  assertSkillInvocationsEnabled(text, native);
  const installed = inventory.skills;
  const named = installed.filter((skill) => skillMatchesProvider(skill, provider) && names.has(skill.name));
  if (provider) {
    for (const name of names)
      if (
        !named.some((skill) => skill.name === name) &&
        installed.some(
          (skill) =>
            skill.name === name &&
            skill.installProvider &&
            skill.installProvider !== "all" &&
            skill.installProvider !== provider,
        )
      )
        throw new Error(`Skill "${name}" is not installed for provider "${provider}".`);
  }
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
  if (!picked.length) return project(text);
  const blocks = await Promise.all(
    picked.map(async (skill) => {
      try {
        const assertCurrent = () => {
          const current = readSkillPolicy(home);
          const reported = reportedSkillRestrictions(getReportedCommands(sessionId));
          if (skillDisabled(current, skill) || skillDisabled(reported, skill))
            throw new Error("Skill policy changed while preparing the prompt.");
        };
        assertCurrent();
        const file = await open(skill.path, "r");
        let body: string;
        try {
          const size = (await file.stat()).size;
          if (size > 2 * 1024 * 1024) throw new Error("Skill exceeds 2 MiB");
          assertCurrent();
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
  const finalPolicy = readSkillPolicy(home);
  const finalNative = reportedSkillRestrictions(getReportedCommands(sessionId));
  assertSkillInvocationsEnabled(text, finalPolicy);
  assertSkillInvocationsEnabled(text, finalNative);
  if (picked.some((skill) => skillDisabled(finalPolicy, skill) || skillDisabled(finalNative, skill)))
    throw new Error("Skill policy changed while preparing the prompt.");
  return project(
    [SKILL_INVOCATION_GUIDANCE, "", blocks.join("\n\n"), "", "---", "", text].join("\n"),
  );
}
