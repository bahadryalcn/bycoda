import {
  jiraProjectIdsForFetch,
  listJiraProjects,
  requireHiddenJiraProjectIds,
} from "../../../features/inbox/model/jira";
export function readRoomInboxRevision(): string {
  return JSON.stringify({ hidden: [...new Set(requireHiddenJiraProjectIds())].sort() });
}

/** Scope comes only from this window's saved Inbox settings, never the model. */
export async function readRoomInboxScope(): Promise<{
  projectIds: string[] | null;
  revision: string;
}> {
  const read = () => [...new Set(requireHiddenJiraProjectIds())].sort();
  const before = read();
  const projectIds = before.length
    ? jiraProjectIdsForFetch(await listJiraProjects(), before)
    : null;
  const after = read();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Jira visibility changed during scope capture.");
  const visible = projectIds === null ? null : [...projectIds].sort();
  return { projectIds: visible, revision: JSON.stringify({ hidden: before }) };
}
