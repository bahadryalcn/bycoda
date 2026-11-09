import { useCallback } from "react";
import { gitPrStatus } from "../../../platform/tauri/fs";
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
    reload: resource.refresh,
  };
}
