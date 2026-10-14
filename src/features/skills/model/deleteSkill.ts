import type { DiscoveredSkill } from "../../../platform/tauri/fs";

export function canDeleteSkill(skill: DiscoveredSkill): boolean {
  return (
    skill.scope !== "builtin" &&
    !skill.name.includes(":") &&
    !/\/(?:\.system|plugins)\//i.test(skill.path.replace(/\\/g, "/"))
  );
}
