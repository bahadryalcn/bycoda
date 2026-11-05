import type { JiraBoardIssue, JiraIssueScope, JiraMove, JiraTransition } from "../model/jiraBoard";

/** A board column or backlog group with its paging state. */
export type Group = {
  id: string;
  name: string;
  scope: JiraIssueScope;
  issues: JiraBoardIssue[];
  token: string | null;
  goal?: string;
  state?: string;
  loaded: boolean;
  pages: number;
  error?: string;
  stale?: boolean;
  autoPaused?: boolean;
  cursors?: string[];
};
export type TransitionPick = {
  issue: JiraBoardIssue;
  choices: JiraTransition[];
  anchor: Pick<JiraMove, "beforeKey" | "afterKey">;
};
