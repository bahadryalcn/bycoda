import { useCallback } from "react";
import { githubReadScope, gitPrStatus } from "../../../platform/tauri/fs";
import { releaseGithubReadBlock } from "../../../shared/lib/githubReadGate";
import { useGitResource } from "./useGitResource";
import { GITHUB_PR_FRESH_MS } from "../model/gitRefreshPolicy";

/** The open pull request for `branch`, read only while `enabled`. */
export function usePrStatus(cwd: string, branch: string | null | undefined, enabled: boolean) {
  const read = useCallback(() => gitPrStatus(cwd), [cwd, branch]);
  const resource = useGitResource(
    cwd,
    `pr:${cwd}:${branch ?? ""}`,
    enabled && !!cwd && cwd !== "~" && !!branch,
    read,
    true,
    GITHUB_PR_FRESH_MS,
    true,
  );
  return {
    pr: resource.data,
    loading: resource.loading,
    error: resource.error,
    // An explicit reload may probe a pause GitHub did not time; a stated reset time still holds.
    reload: () => {
      releaseGithubReadBlock(githubReadScope(cwd));
      return resource.refresh();
    },
  };
}
