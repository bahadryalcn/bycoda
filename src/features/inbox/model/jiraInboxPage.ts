import { invoke } from "@tauri-apps/api/core";
import type { InboxQuery } from "./githubTasks";
import {
  jiraProjectIdsForFetch,
  listJiraProjects,
  requireHiddenJiraProjectIds,
  rememberJiraFilterIssues,
  jiraReadGeneration,
  type JiraIssue,
} from "./jira";
import { jiraIssueToInboxItem } from "./inboxItemMappers";

export type JiraListContinuation = { token: string | null; total?: number; cursors?: string[] };
type JiraIssuePage = { issues: JiraIssue[]; nextPageToken: string | null; total?: number | null };

/** Every page revalidates the explicit project scope; scrolling never widens it. */
export async function fetchJiraInboxPage(query: InboxQuery, token?: string) {
  const generation = jiraReadGeneration();
  const hiddenIds = query.jiraHiddenProjectIds ?? requireHiddenJiraProjectIds();
  const projectIds = hiddenIds.length
    ? jiraProjectIdsForFetch(await listJiraProjects(), hiddenIds)
    : null;
  if (projectIds?.length === 0)
    return { items: [], jiraPage: { token: null } as JiraListContinuation };
  const page = await invoke<JiraIssuePage>("jira_list_issue_page", {
    assignedToMe: query.assignedToMe,
    state: query.state,
    projectIds: projectIds ?? [],
    limit: query.state === "all" ? 100 : 40,
    filters: {
      assigneeIds: query.jiraAssignees ?? [],
      unassigned: query.jiraUnassigned ?? false,
      statuses: query.jiraStatuses ?? [],
    },
    nextPageToken: token ?? null,
  });
  if (!page || !Array.isArray(page.issues)) throw new Error("Jira did not return an issue page");
  if (page.nextPageToken != null && typeof page.nextPageToken !== "string")
    throw new Error("Jira returned an invalid issue page token");
  if (token && page.nextPageToken === token)
    throw new Error("Jira returned a repeated issue page token");
  const hidden = new Set(hiddenIds);
  if (generation !== jiraReadGeneration())
    throw new Error("Jira account or scope changed during the read");
  rememberJiraFilterIssues(page.issues.filter((issue) => !hidden.has(issue.teamId)));
  const total =
    typeof page.total === "number" && Number.isSafeInteger(page.total) && page.total >= 0
      ? page.total
      : undefined;
  return {
    items: page.issues.filter((issue) => !hidden.has(issue.teamId)).map(jiraIssueToInboxItem),
    jiraPage: { token: page.nextPageToken || null, total } satisfies JiraListContinuation,
    ...(page.nextPageToken ? { limited: true } : {}),
  };
}
