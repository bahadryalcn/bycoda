import { prefetchGithubWorkItem, type InboxItem } from "./githubTasks";
import { gitlabWorkItemDetails, peekGitlabWorkItemDetails } from "./gitlab";
import { azureDevOpsWorkItemDetails, peekAzureDevOpsWorkItemDetails } from "./azureDevOps";

const pending = new Set<string>();
/** Hover/focus warms the same detail cache used when any code-host item opens. */
export function prefetchInboxItem(item: InboxItem): void {
  if (item.kind !== "pr" && item.kind !== "issue") return;
  if (item.provider === "github") {
    prefetchGithubWorkItem(item.projectPath, {
      repo: item.repo,
      kind: item.kind,
      number: item.number,
    });
    return;
  }
  const details =
    item.provider === "gitlab"
      ? gitlabWorkItemDetails
      : item.provider === "azuredevops"
        ? azureDevOpsWorkItemDetails
        : null;
  const peek =
    item.provider === "gitlab"
      ? peekGitlabWorkItemDetails
      : item.provider === "azuredevops"
        ? peekAzureDevOpsWorkItemDetails
        : null;
  if (!details || !peek || peek(item.repo, item.kind, item.number)) return;
  const key = JSON.stringify([item.provider, item.repo, item.kind, item.number]);
  if (pending.has(key)) return;
  pending.add(key);
  void details(item.repo, item.kind, item.number)
    .catch((error) => console.warn("Inbox detail prefetch failed", error))
    .finally(() => pending.delete(key));
}
