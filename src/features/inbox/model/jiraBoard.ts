import { errorText } from "../../../shared/lib/errors";
import { invoke } from "@tauri-apps/api/core";
import {
  clearJiraCache,
  jiraProjectIdsForFetch,
  jiraReadGeneration,
  listJiraProjects,
  requireHiddenJiraProjectIds,
  rememberJiraFilterIssues,
  loadAllowedJiraBoardIds,
  type JiraIssue,
  type JiraProject,
} from "./jira";
import type { InboxFilters } from "./inboxFilters";

export type JiraBoard = {
  id: number;
  name: string;
  kind: "scrum" | "kanban";
  /** Owning project; absent for boards Jira does not attach to one. */
  projectId?: string;
};
export type JiraColumn = { name: string; statusIds: string[] };
export type JiraSprint = { id: number; name: string; state: "active" | "future"; goal: string };
export type JiraBoardConfiguration = {
  columns: JiraColumn[];
  rankFieldId: number | null;
  sprints: JiraSprint[];
};
export type JiraBoardIssue = JiraIssue & { statusId: string };
export type JiraIssuePage = { issues: JiraBoardIssue[]; nextPageToken: string | null };
export type JiraTransition = {
  id: string;
  name: string;
  statusId: string;
  statusName?: string;
  requiresFields: boolean;
};
export type JiraIssueScope = { scope: "board" | "backlog" | "sprint"; sprintId?: number };
type BoardIssueFilters = {
  assignedToMe: boolean;
  assigneeIds: string[];
  unassigned: boolean;
  statuses: string[];
  open: boolean;
  closed: boolean;
};

export function jiraBoardIssueFilters(filters: InboxFilters): BoardIssueFilters | undefined {
  const { assignedToMe, jiraAssignees = [], jiraUnassigned = false, jiraStatuses = [] } = filters;
  const { open, closed } = filters.status;
  if (
    !assignedToMe &&
    !jiraAssignees.length &&
    !jiraUnassigned &&
    !jiraStatuses.length &&
    open === closed
  )
    return;
  return {
    assignedToMe,
    assigneeIds: jiraAssignees,
    unassigned: jiraUnassigned,
    statuses: jiraStatuses,
    open,
    closed,
  };
}
export type JiraMove = {
  target: "board" | "backlog" | "sprint" | "rank";
  sprintId?: number;
  beforeKey?: string;
  afterKey?: string;
};

export const jiraErrorMessage = (reason: unknown) => errorText(reason);

async function visibleProjectIds() {
  const hidden = requireHiddenJiraProjectIds();
  return hidden.length ? jiraProjectIdsForFetch(await listJiraProjects(), hidden) : null;
}

export async function listJiraBoards() {
  const allowed = loadAllowedJiraBoardIds();
  if (allowed.length === 0) return [];
  const projectIds = await visibleProjectIds();
  if (projectIds?.length === 0) return [];
  const boards = await invoke<JiraBoard[]>("jira_list_boards", { projectIds });
  return boards.filter((board) => allowed.includes(board.id));
}

/** Every board of the account, independent of project visibility, so Settings fetches once. */
export const listJiraBoardCatalog = () =>
  invoke<JiraBoard[]>("jira_list_boards", { projectIds: null });

/**
 * Narrows a catalog to the visible projects exactly as the native per-project fetch does:
 * no effective hiding keeps every board, otherwise only boards owned by a visible project.
 */
export function jiraBoardsInVisibleProjects(
  boards: readonly JiraBoard[],
  projects: readonly JiraProject[],
  hiddenIds: readonly string[],
): JiraBoard[] {
  const visible = jiraProjectIdsForFetch(projects, hiddenIds);
  if (visible === null) return projects.length === 0 && hiddenIds.length > 0 ? [] : [...boards];
  const ids = new Set(visible);
  return boards.filter((board) => board.projectId !== undefined && ids.has(board.projectId));
}
export const jiraBoardConfiguration = (boardId: number) =>
  invoke<JiraBoardConfiguration>("jira_board_configuration", { boardId });
export async function jiraBoardIssues(
  boardId: number,
  scope: JiraIssueScope,
  nextPageToken?: string,
  filters?: BoardIssueFilters,
) {
  const generation = jiraReadGeneration();
  const projectIds = await visibleProjectIds();
  if (projectIds?.length === 0) return { issues: [], nextPageToken: null };
  const page = await invoke<JiraIssuePage>("jira_board_issues", {
    boardId,
    scope: scope.scope,
    sprintId: scope.sprintId ?? null,
    nextPageToken: nextPageToken ?? null,
    projectIds,
    ...(filters && { filters }),
  });
  const hidden = requireHiddenJiraProjectIds();
  const issues = page.issues.filter((issue) => !hidden.includes(issue.teamId));
  if (generation === jiraReadGeneration()) rememberJiraFilterIssues(issues);
  return {
    ...page,
    issues: issues.map((issue) => ({ ...issue, jiraBoardId: boardId })),
  };
}
export const jiraIssueTransitions = (key: string) =>
  invoke<JiraTransition[]>("jira_issue_transitions", { key });
export async function jiraTransitionIssue(key: string, transitionId: string) {
  await invoke("jira_issue_transition", { key, transitionId });
  clearJiraCache();
}
export async function jiraMoveIssue(boardId: number, key: string, move: JiraMove) {
  await invoke("jira_board_move", {
    boardId,
    key,
    target: move.target,
    sprintId: move.sprintId ?? null,
    beforeKey: move.beforeKey ?? null,
    afterKey: move.afterKey ?? null,
  });
  clearJiraCache();
}

export function columnTransitions(transitions: JiraTransition[], column: JiraColumn) {
  return transitions.filter((transition) => column.statusIds.includes(transition.statusId));
}

/** Rank within the visible destination; dropping on a card inserts before it. */
export function rankAnchor(
  issues: JiraBoardIssue[],
  key: string,
  beforeKey?: string,
): Pick<JiraMove, "beforeKey" | "afterKey"> {
  if (beforeKey && beforeKey !== key) return { beforeKey };
  const others = issues.filter((issue) => issue.identifier !== key);
  const last = others[others.length - 1];
  return last ? { afterKey: last.identifier } : {};
}
