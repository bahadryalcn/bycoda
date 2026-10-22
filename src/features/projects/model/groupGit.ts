export const OPEN_PROJECT_CHANGES_EVENT = "bycoda:open-project-changes";

/** One project of a group, as far as its working tree is known. */
export type GroupProjectGit = {
  remote: boolean;
  /** Changed files, or null while unknown. */
  files: number | null;
  ahead?: number | null;
  behind?: number | null;
};

export type GroupGitSummary = {
  /** Projects on this computer; remote ones are not counted. */
  local: number;
  remote: number;
  /** Local projects whose stats are known. */
  known: number;
  /** Local projects with uncommitted changes. */
  dirty: number;
  files: number;
  /** Totals over the projects whose sync state is known. */
  ahead: number;
  behind: number;
  syncKnown: number;
};

export function summarizeGroupGit(projects: readonly GroupProjectGit[]): GroupGitSummary {
  const summary: GroupGitSummary = {
    local: 0,
    remote: 0,
    known: 0,
    dirty: 0,
    files: 0,
    ahead: 0,
    behind: 0,
    syncKnown: 0,
  };
  for (const project of projects) {
    if (project.remote) {
      summary.remote += 1;
      continue;
    }
    summary.local += 1;
    if (project.files != null) {
      summary.known += 1;
      summary.files += project.files;
      if (project.files > 0) summary.dirty += 1;
    }
    if (project.ahead != null && project.behind != null) {
      summary.syncKnown += 1;
      summary.ahead += project.ahead;
      summary.behind += project.behind;
    }
  }
  return summary;
}

export type FetchAllResult = {
  path: string;
  status: "fetched" | "no-remote" | "failed";
  error?: string;
};

export type FetchAllDeps = {
  hasRemote: (path: string) => Promise<boolean>;
  fetch: (path: string) => Promise<void>;
};

/**
 * Fetches the projects one after another, so a slow remote or a stalled
 * process delays only itself. A failure is recorded and the run goes on.
 * `onProgress` receives each result as it lands and the index being worked on.
 */
export async function fetchAllProjects(
  paths: readonly string[],
  deps: FetchAllDeps,
  onProgress?: (results: readonly FetchAllResult[], next: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<FetchAllResult[]> {
  const results: FetchAllResult[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    if (isCancelled()) break;
    const path = paths[index];
    onProgress?.(results, index);
    try {
      if (!(await deps.hasRemote(path))) {
        results.push({ path, status: "no-remote" });
      } else {
        await deps.fetch(path);
        results.push({ path, status: "fetched" });
      }
    } catch (error) {
      results.push({
        path,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  onProgress?.(results, paths.length);
  return results;
}
