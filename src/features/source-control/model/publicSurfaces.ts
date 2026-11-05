/** Keep diff surfaces in separate chunks until their owning pane opens. */
export function loadCommitDiff() {
  return import("../ui/CommitDiff");
}

export function loadSessionChangesDiff() {
  return import("../ui/SessionChangesDiff");
}

export function loadWorkingTreeDiff() {
  return import("../ui/WorkingTreeDiff");
}
