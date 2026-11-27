import { skillDisabled, type SkillPolicy } from "../../../integrations/harness/core/skillPolicy";
import { loadSkillRestrictions } from "./skillPreferences";
import { loadSkills, slugSkillName, type Skill, type SkillCatalogContext } from "./skills";
import type { SkillGroupPickerItem } from "./skillGroupPickerItem";
import { skillInvocationTokens } from "./skillTokens";
import { listSkillGroups, resolveSkillGroup, type SkillGroup } from "./skillGroups";
export { isSkillGroupPickerItem, type SkillGroupPickerItem } from "./skillGroupPickerItem";

/** Slash command of a group, without the slash. */
export function skillGroupInvocation(group: Pick<SkillGroup, "name" | "invocation">): string {
  return group.invocation || `group-${slugSkillName(group.name) || "skills"}`;
}
/** File skills and provider-reported invocations; exclude builtins and templates. */
export function skillGroupMembers(
  group: SkillGroup,
  skills: Skill[],
  policy: SkillPolicy,
): Skill[] {
  return resolveSkillGroup(
    group,
    skills.filter(
      (skill) =>
        ((skill.kind === "file" && skill.userInvocable !== false) ||
          (skill.kind === "native" && skill.origin !== "builtin")) &&
        !skillDisabled(policy, skill),
    ),
  ).skills;
}
export function skillGroupPickerItems(
  groups: SkillGroup[],
  skills: Skill[],
  policy: SkillPolicy,
): SkillGroupPickerItem[] {
  return groups.flatMap((group) => {
    const members = skillGroupMembers(group, skills, policy);
    return members.length
      ? [
          {
            kind: "template" as const,
            scope: "template" as const,
            source: "bycoda" as const,
            templateId: `skill-group:${group.id}`,
            groupId: group.id,
            name: group.name,
            invocation: skillGroupInvocation(group),
            description: members.map((skill) => skill.invocation).join(", "),
            memberCount: members.length,
            members: members.map((skill) => skill.invocation),
            body: "",
          },
        ]
      : [];
  });
}
/**
 * Selection-time discovery and authority refresh. The draft keeps one group token
 * (`/group-x`); it expands to member invocations at send. Failed policy reads insert nothing.
 */
export async function skillGroupInsertion(
  groupId: string,
  context: SkillCatalogContext,
  prefix: "/" | "$" = "/",
): Promise<string> {
  const skills = await loadSkills(context, { refresh: true });
  const policy = await loadSkillRestrictions(context.cwd, { refresh: true });
  const group = listSkillGroups().find((entry) => entry.id === groupId);
  if (!group) return "";
  const [item] = skillGroupPickerItems([group], skills, policy);
  return item ? `${prefix}${item.invocation}` : "";
}

/** Replaces each group token with its members' invocations, keeping the token's introducer. */
export function expandSkillGroupTokens(text: string, groups: readonly SkillGroupPickerItem[]) {
  const byInvocation = new Map(groups.map((group) => [group.invocation, group.members]));
  let out = "";
  let cursor = 0;
  for (const token of skillInvocationTokens(text)) {
    const members = byInvocation.get(token.name);
    if (!members) continue;
    const prefix = text[token.start];
    out += text.slice(cursor, token.start) + members.map((name) => `${prefix}${name}`).join(" ");
    cursor = token.end;
  }
  return out + text.slice(cursor);
}

export type SkillGroupRun = {
  text: string;
  group?: { name: string; members: readonly string[]; prefix: string };
};

/**
 * Inverse of `expandSkillGroupTokens` for display: a sent message's run of member
 * invocations, one space apart with one introducer, reads as its group again.
 */
export function skillGroupRuns(
  text: string,
  groups: readonly Pick<SkillGroupPickerItem, "name" | "members">[],
): SkillGroupRun[] {
  const tokens = skillInvocationTokens(text);
  // Longest first, so a group that contains another group's members wins.
  const ordered = groups
    .filter((group) => group.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length);
  const runs: SkillGroupRun[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const prefix = text[tokens[i].start];
    const group = ordered.find((entry) =>
      entry.members.every((member, offset) => {
        const token = tokens[i + offset];
        if (token?.name !== member || text[token.start] !== prefix) return false;
        return offset === 0 || text.slice(tokens[i + offset - 1].end, token.start) === " ";
      }),
    );
    if (!group) continue;
    const end = tokens[i + group.members.length - 1].end;
    if (tokens[i].start > cursor) runs.push({ text: text.slice(cursor, tokens[i].start) });
    runs.push({
      text: text.slice(tokens[i].start, end),
      group: { name: group.name, members: group.members, prefix },
    });
    cursor = end;
    i += group.members.length - 1;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}
