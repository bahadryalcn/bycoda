import type { InboxItem } from "./githubTasks";
import type { LinearIssue } from "./linear";
import type { JiraIssue } from "./jira";
import type { GitlabWorkItem } from "./gitlab";
import type { AzureDevOpsWorkItem } from "./azureDevOps";

/** Maps one provider's tracker item into the shared inbox row shape. */
export function linearIssueToInboxItem(issue: LinearIssue): InboxItem {
  return {
    provider: "linear",
    kind: "linear",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectId: issue.projectId || "",
    projectName: issue.projectName || "",
    projectPath: issue.projectPath || "",
  };
}

export function jiraIssueToInboxItem(issue: JiraIssue): InboxItem {
  return {
    provider: "jira",
    kind: "jira",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectPath: issue.projectPath || "",
  };
}

export function gitlabWorkItemToInboxItem(
  item: GitlabWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "gitlab",
    repo: item.repo || repo,
    projectPath,
  };
}

export function azureDevOpsWorkItemToInboxItem(
  item: AzureDevOpsWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "azuredevops",
    repo: item.repo || repo,
    projectPath,
  };
}
