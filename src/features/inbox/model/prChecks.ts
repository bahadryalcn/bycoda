import { invoke } from "@tauri-apps/api/core";
import {
  fetchGithubPrChecks,
  fetchGithubCheckDetails,
  githubActionsJobId,
  type CodeHostProvider,
  type GithubPrChecks,
  type GithubPrCheck,
  type GithubCheckDetails,
} from "./githubPrChecks";
export type { CodeHostProvider } from "./githubPrChecks";
export async function fetchPrChecks(
  provider: CodeHostProvider,
  cwd: string,
  repo: string,
  number: number,
): Promise<GithubPrChecks> {
  if (provider === "github")
    return {
      ...(await fetchGithubPrChecks(cwd, repo, number)),
      provider,
      instance: "https://github.com",
    };
  const command = provider === "gitlab" ? "gitlab_pr_checks" : "azure_devops_pr_checks";
  const result = await invoke<GithubPrChecks>(command, { repo, number });
  return {
    ...result,
    provider,
    checks: result.checks.map((check) => ({
      ...check,
      provider,
      instance: result.instance,
    })),
  };
}
export function hasCheckDetails(check: GithubPrCheck, repo: string): boolean {
  return check.provider && check.provider !== "github"
    ? Boolean(check.detailsRef)
    : Boolean(githubActionsJobId(check.url, repo));
}
export async function fetchCheckDetails(
  cwd: string,
  repo: string,
  check: GithubPrCheck,
): Promise<GithubCheckDetails> {
  if (!check.provider || check.provider === "github") {
    const jobId = githubActionsJobId(check.url, repo);
    if (!jobId)
      return {
        steps: [],
        annotations: [],
        notice: "This check does not expose job details. Inspect its check URL.",
      };
    return fetchGithubCheckDetails(cwd, repo, jobId);
  }
  const command =
    check.provider === "gitlab" ? "gitlab_check_details" : "azure_devops_check_details";
  if (!check.detailsRef)
    return {
      steps: [],
      annotations: [],
      notice: "This check does not expose job details. Inspect its check URL.",
    };
  if (!check.instance) throw new Error("Check instance is missing; reload checks.");
  return invoke<GithubCheckDetails>(command, {
    repo,
    ...check.detailsRef,
    expectedInstance: check.instance,
  });
}
