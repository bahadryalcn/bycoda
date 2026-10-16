import type { GitChangedFile, GitDiffIndex } from "../../../platform/tauri/fs";

export type IndexAction = "stage" | "unstage" | "discard";

/**
 * The index as it reads once a commit has taken what was staged, or every
 * change when the commit staged `all` of them first. A file that also has
 * unstaged edits stays under Changes; its line counts wait for the reload.
 */
export function applyCommit(index: GitDiffIndex, all: boolean): GitDiffIndex {
  let additions = index.additions;
  let deletions = index.deletions;
  const files: GitChangedFile[] = [];
  for (const file of index.files) {
    if (!all && !file.staged) {
      files.push(file);
    } else if (!all && file.unstaged) {
      files.push({ ...file, staged: false });
    } else {
      additions -= file.additions;
      deletions -= file.deletions;
    }
  }
  return { ...index, files, additions, deletions };
}

/**
 * The index as it will read once `action` has run on one file (`relative`) or
 * on every file it applies to. The Changes panel shows this at once and lets
 * the reload that follows the git command confirm or correct it.
 */
export function applyIndexAction(
  index: GitDiffIndex,
  action: IndexAction,
  relative?: string,
): GitDiffIndex {
  let additions = index.additions;
  let deletions = index.deletions;
  const files: GitChangedFile[] = [];
  for (const file of index.files) {
    const targeted =
      (relative === undefined || file.relative === relative) &&
      (action === "unstage" ? file.staged : file.unstaged);
    if (!targeted) {
      files.push(file);
    } else if (action === "stage") {
      files.push({
        ...file,
        staged: true,
        unstaged: false,
        status: file.status === "untracked" ? "added" : file.status,
      });
    } else if (action === "unstage") {
      files.push({
        ...file,
        staged: false,
        unstaged: true,
        status: file.status === "added" ? "untracked" : file.status,
      });
    } else if (file.staged) {
      // Discarding leaves what is staged; its line counts wait for the reload.
      files.push({ ...file, unstaged: false });
    } else {
      additions -= file.additions;
      deletions -= file.deletions;
    }
  }
  return { ...index, files, additions, deletions };
}
