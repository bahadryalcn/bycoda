import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupIdForPath,
} from "../../projects/model/projectGroups";
import type { UsageGroupLookup } from "./usageOverview";

/** Looks up the rail group a folder was filed into, as of this call. */
export function railGroupLookup(): UsageGroupLookup {
  const groups = loadProjectGroups();
  const assignments = loadProjectGroupAssignments(groups);
  const byId = new Map(groups.map((group) => [group.id, group]));
  return (project) => {
    const id = projectGroupIdForPath(project, assignments);
    const group = id ? byId.get(id) : undefined;
    return group ? { id: group.id, name: group.name } : null;
  };
}
