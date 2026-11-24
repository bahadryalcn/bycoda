import type { Skill, TemplateSkill } from "./skills";

export type SkillGroupPickerItem = TemplateSkill & {
  groupId: string;
  memberCount: number;
  /** Member invocations, in group order. */
  members: string[];
};
export function isSkillGroupPickerItem(skill: Skill): skill is SkillGroupPickerItem {
  return skill.kind === "template" && "groupId" in skill && typeof skill.groupId === "string";
}
