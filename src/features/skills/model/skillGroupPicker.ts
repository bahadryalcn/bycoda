import { skillDisabled, type SkillPolicy } from "../../../integrations/harness/core/skillPolicy";
import { loadSkillRestrictions } from "./skillPreferences";
import {
  loadSkills,
  slugSkillName,
  type Skill,
  type SkillCatalogContext,
  type TemplateSkill,
} from "./skills";
import { skillInvocationTokens } from "./skillTokens";
import { listSkillGroups, resolveSkillGroup, type SkillGroup } from "./skillGroups";
export type SkillGroupPickerItem = TemplateSkill & {
  groupId: string;
  memberCount: number;
  /** Member invocations, in group order. */
  members: string[];
};
export function isSkillGroupPickerItem(skill: Skill): skill is SkillGroupPickerItem {
  return skill.kind === "template" && "groupId" in skill && typeof skill.groupId === "string";
}
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
