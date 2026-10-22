import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { listHostSkillCandidates } from "./skills";
import { readSkillPolicy } from "./skill-policy";
import { skillDisabled } from "../src/integrations/harness/core/skillPolicy";
import {
  getReportedCommands,
  reportedSkillRestrictions,
} from "../src/integrations/harness/core/reportedCommands";

function effectivePolicy(home: string, sessionId?: string) {
  const policy = readSkillPolicy(home);
  const native = reportedSkillRestrictions(getReportedCommands(sessionId));
  return {
    ...policy,
    disabledNames: [...new Set([...policy.disabledNames, ...native.disabledNames])],
    disabledPaths: [...new Set([...policy.disabledPaths, ...native.disabledPaths])],
  };
}

const STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

/**
 * Installation inventory, not proof that a provider has enabled a skill.
 * Ranks by how much of the task each candidate covers, and keeps shadowed
 * same-name copies so callers compare alternatives instead of the first hit.
 */
export function searchHarnessSkills(
  cwd: string,
  input: { query?: string; offset?: number; limit?: number },
  home = homedir(),
  sessionId?: string,
  explicitNames: readonly string[] = [],
) {
  const query = (input.query ?? "").trim().toLowerCase();
  const terms = [...new Set(words(query))];
  const { skills: candidates, truncated } = listHostSkillCandidates(cwd, home);
  const policy = effectivePolicy(home, sessionId);
  const matches = candidates
    .filter(
      (skill) =>
        !skillDisabled(policy, skill) &&
        (skill.modelInvocable !== false ||
          (skill.userInvocable !== false && explicitNames.includes(skill.name))),
    )
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const nameWords = new Set(words(name));
      const description = skill.description.toLowerCase();
      const descriptionWords = new Set(words(description));
      let matched = 0;
      let score = name === query ? 20 : 0;
      for (const term of terms) {
        const termScore = nameWords.has(term)
          ? 4
          : name.includes(term)
            ? 3
            : descriptionWords.has(term)
              ? 2
              : description.includes(term)
                ? 1
                : 0;
        if (termScore) matched++;
        score += termScore;
      }
      // Covering more of the task beats repeating one broad keyword.
      if (terms.length) score += Math.round((10 * matched) / terms.length);
      return { skill, score, matched };
    })
    .filter(({ matched }) => !terms.length || matched > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.skill.active) - Number(a.skill.active) ||
        Number(b.skill.scope === "project") - Number(a.skill.scope === "project") ||
        a.skill.name.localeCompare(b.skill.name),
    );
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 20)));
  const skills = matches.slice(offset, offset + limit).map(({ skill, matched }) => ({
    ...skill,
    enabled: true,
    providerEnabled: getReportedCommands(sessionId).some(
      (entry) => entry.kind === "skill" && entry.name === skill.name && entry.enabled === true,
    )
      ? "enabled"
      : "unknown",
    description: skill.description.slice(0, 1000),
    ...(terms.length ? { matchedTerms: matched, queryTerms: terms.length } : {}),
  }));
  return {
    skills,
    total: matches.length,
    nextOffset: offset + skills.length < matches.length ? offset + skills.length : null,
    truncated,
    availability:
      "bycoda-disabled skills are excluded; active=false means a same-name alternative, not disabled; provider enablement is not established by this inventory",
  };
}

/** Accept a discovered name, never an agent-supplied filesystem path. */
export async function readHarnessSkill(
  cwd: string,
  input: { name: string; source?: string; scope?: string; offset?: number; maxChars?: number },
  home = homedir(),
  sessionId?: string,
  explicitNames: readonly string[] = [],
) {
  // Without a selector, read the copy that /name resolves to.
  const named = listHostSkillCandidates(cwd, home).skills.filter(
    (entry) => entry.name === input.name,
  );
  const matches = named.filter(
    (entry) =>
      (!input.source || entry.source === input.source) &&
      (!input.scope || entry.scope === input.scope),
  );
  const policy = effectivePolicy(home, sessionId);
  const allowed = matches.filter(
    (entry) =>
      !skillDisabled(policy, entry) &&
      (entry.modelInvocable !== false ||
        (entry.userInvocable !== false && explicitNames.includes(entry.name))),
  );
  const skill = allowed.find((entry) => entry.active) ?? allowed[0];
  if (!skill)
    throw new Error(
      matches.length
        ? `Skill "${input.name}" is disabled for this conversation.`
        : `Skill "${input.name}" is not installed for this project.`,
    );
  const file = await open(skill.path, "r");
  let body: string;
  try {
    const size = (await file.stat()).size;
    if (size > 2 * 1024 * 1024) throw new Error("Skill exceeds 2 MiB.");
    const buffer = Buffer.alloc(size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > size) throw new Error("Skill changed while reading; retry discovery.");
    body = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const maxChars = Math.min(16000, Math.max(200, Math.trunc(input.maxChars ?? 6000)));
  const text = body.slice(offset, offset + maxChars);
  return {
    name: skill.name,
    path: skill.path,
    scope: skill.scope,
    source: skill.source,
    active: skill.active,
    text,
    totalChars: body.length,
    nextOffset: offset + text.length < body.length ? offset + text.length : null,
  };
}
