import {
  jiraProjectIdsForFetch,
  listJiraProjects,
  loadAllowedJiraBoardIds,
  requireHiddenJiraProjectIds,
} from "../../../features/inbox/model/jira";

const preferences = () => ({
  hidden: [...new Set(requireHiddenJiraProjectIds())].sort(),
  boards: [...new Set(loadAllowedJiraBoardIds())].sort((a, b) => a - b),
});
export function readRoomInboxRevision(): string {
  return JSON.stringify(preferences());
}

/** Scope comes only from this window's saved Inbox settings, never the model. */
export async function readRoomInboxScope(): Promise<{
  projectIds: string[] | null;
  allowedBoardIds: number[];
  revision: string;
}> {
  const before = preferences();
  const projectIds = before.hidden.length
    ? jiraProjectIdsForFetch(await listJiraProjects(), before.hidden)
    : null;
  if (JSON.stringify(before) !== JSON.stringify(preferences()))
    throw new Error("Jira visibility changed during scope capture.");
  const visible = projectIds === null ? null : [...projectIds].sort();
  return { projectIds: visible, allowedBoardIds: before.boards, revision: JSON.stringify(before) };
}
