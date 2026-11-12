import { t } from "../../../shared/i18n";
import { skillDisabled, type SkillPolicy } from "../../../integrations/harness/core/skillPolicy";
import { loadSkillRestrictions } from "./skillPreferences";
import {
  loadSkills,
  slugSkillName,
  type Skill,
  type SkillCatalogContext,
  type TemplateSkill,
} from "./skills";
import { listSkillGroups, resolveSkillGroup, type SkillGroup } from "./skillGroups";
export type SkillGroupPickerItem = TemplateSkill & { groupId: string };
export function isSkillGroupPickerItem(skill: Skill): skill is SkillGroupPickerItem {
  return skill.kind === "template" && "groupId" in skill && typeof skill.groupId === "string";
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
  translate: typeof t = t,
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
            invocation: `group-${slugSkillName(group.name) || "skills"}`,
            description: translate("{p0} skills", { p0: members.length }),
            body: "",
          },
        ]
      : [];
  });
}
/** Selection-time discovery and authority refresh. Failed policy reads insert nothing. */
export async function skillGroupInsertion(
  groupId: string,
  context: SkillCatalogContext,
  prefix: "/" | "$" = "/",
): Promise<string> {
  const skills = await loadSkills(context, { refresh: true });
  const policy = await loadSkillRestrictions(context.cwd, { refresh: true });
  const group = listSkillGroups().find((entry) => entry.id === groupId);
  if (!group) return "";
  return skillGroupMembers(group, skills, policy)
    .map((skill) => `${prefix}${skill.invocation}`)
    .join(" ");
}
