import { useRef, useState } from "react";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import {
  memberKey,
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
  // The slot save waits on the privacy Host round-trip while the project order commits at once,
  // so the dropped order shows until the save settles instead of snapping back for that wait.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const latestSave = useRef(0);
  const members = orderProjectGroupMembers(
    projectPaths,
    workspaceIds,
    pendingOrder ?? group.memberOrder,
  );
  const byId = new Map(members.map((member) => [member.id, member]));
  const handleReorder = (ids: string[]) => {
    const next = ids.flatMap((id) => byId.get(id) ?? []);
    const save = ++latestSave.current;
    const settle = () => {
      if (save === latestSave.current) setPendingOrder(null);
    };
    setPendingOrder(next.map(memberKey));
    onReorderProjects(next.filter((member) => member.kind === "project").map((m) => m.id));
    // A refused save (locked room) returns the workspaces to their saved slots.
    saveProjectGroupMemberOrder(group.id, next).then(settle, settle);
  };
  const sortable = useAnimatedReorder(
    members.map((member) => member.id),
    handleReorder,
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
