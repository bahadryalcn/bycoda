import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import {
  orderProjectGroupMembers,
  saveProjectGroupMemberOrder,
  type ProjectGroup,
} from "../model/projectGroups";

/**
 * One drag list for a group's projects and nested workspaces, so a workspace can sit above or
 * between projects. Projects keep their rail order through `onReorderProjects`; the workspace
 * slots are saved on the group.
 */
export function useProjectGroupMembers(
  group: ProjectGroup,
  projectPaths: string[],
  workspaceIds: string[],
  onReorderProjects: (paths: string[]) => void,
  projectLabel: (path: string) => string,
) {
  const members = orderProjectGroupMembers(projectPaths, workspaceIds, group.memberOrder);
  const byId = new Map(members.map((member) => [member.id, member]));
  const sortable = useAnimatedReorder(
    members.map((member) => member.id),
    (ids) => {
      const next = ids.flatMap((id) => byId.get(id) ?? []);
      onReorderProjects(next.filter((member) => member.kind === "project").map((m) => m.id));
      // A refused save (locked room) leaves the workspaces where they were.
      saveProjectGroupMemberOrder(group.id, next).catch(() => undefined);
    },
    "y",
    undefined,
    {
      // Workspaces fold to their header while anything moves, so every block is one row tall.
      foldOnDrag: workspaceIds.length > 0,
      // A nested workspace is spoken by its region name (aria-label), which is its group name.
      label: (id) => (byId.get(id)?.kind === "project" ? projectLabel(id) : ""),
    },
  );
  return { members, sortable };
}
