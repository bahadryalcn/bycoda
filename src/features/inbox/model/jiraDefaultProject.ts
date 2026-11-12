export type JiraDefaultProjects = {
  global?: string;
  projects: Record<string, string>;
  boards: Record<string, string>;
  issues: Record<string, string>;
};

export type JiraWorkingIssue = {
  url: string;
  teamId?: string;
  jiraBoardId?: number;
  projectPath?: string;
};

/** Board defaults apply only when opening an issue from that board. */
export function resolveJiraDefaultProject(
  issue: JiraWorkingIssue,
  defaults: JiraDefaultProjects,
  fallback: string,
): string {
  return (
    defaults.issues[issue.url] ||
    issue.projectPath ||
    (issue.jiraBoardId === undefined ? undefined : defaults.boards[String(issue.jiraBoardId)]) ||
    (issue.teamId ? defaults.projects[issue.teamId] : undefined) ||
    defaults.global ||
    fallback
  );
}
