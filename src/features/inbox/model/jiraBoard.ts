import { invoke } from "@tauri-apps/api/core";
import {
  clearJiraCache,
  jiraProjectIdsForFetch,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  loadAllowedJiraBoardIds,
  type JiraIssue,
} from "./jira";

export type JiraBoard = { id: number; name: string; kind: "scrum" | "kanban" };
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
  requiresFields: boolean;
};
export type JiraIssueScope = { scope: "board" | "backlog" | "sprint"; sprintId?: number };
export type JiraMove = {
  target: "board" | "backlog" | "sprint" | "rank";
  sprintId?: number;
  beforeKey?: string;
  afterKey?: string;
};

async function visibleProjectIds() {
  const hidden = loadHiddenJiraProjectIds();
  return hidden.length ? jiraProjectIdsForFetch(await listJiraProjects(), hidden) : null;
}

export async function listJiraBoards(options?: { includeUnselected?: boolean }) {
  const allowed = loadAllowedJiraBoardIds();
  if (!options?.includeUnselected && allowed.length === 0) return [];
  const projectIds = await visibleProjectIds();
  if (projectIds?.length === 0) return [];
  const boards = await invoke<JiraBoard[]>("jira_list_boards", { projectIds });
  return options?.includeUnselected ? boards : boards.filter((board) => allowed.includes(board.id));
}
export const jiraBoardConfiguration = (boardId: number) =>
  invoke<JiraBoardConfiguration>("jira_board_configuration", { boardId });
export async function jiraBoardIssues(
  boardId: number,
  scope: JiraIssueScope,
  nextPageToken?: string,
) {
  const projectIds = await visibleProjectIds();
  if (projectIds?.length === 0) return { issues: [], nextPageToken: null };
  const page = await invoke<JiraIssuePage>("jira_board_issues", {
    boardId,
    scope: scope.scope,
    sprintId: scope.sprintId ?? null,
    nextPageToken: nextPageToken ?? null,
    projectIds,
  });
  const hidden = loadHiddenJiraProjectIds();
  return { ...page, issues: page.issues.filter((issue) => !hidden.includes(issue.teamId)) };
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
