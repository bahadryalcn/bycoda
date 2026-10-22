import { useCallback, type MutableRefObject } from "react";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import type { RepositoryReviewRequest } from "../../../features/source-control/model/workspaceRepositories";
import type { EditorFileOpen } from "./useEditorFileOpen";
import type { SourceControlSurfaces } from "./useSourceControlSurfaces";

export interface RepositoryReviewOpenDeps {
  sidebarCwdRef: MutableRefObject<string>;
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  onOpenFile: EditorFileOpen["onOpenFile"];
  onOpenCommit: SourceControlSurfaces["onOpenCommit"];
  onOpenDiff: SourceControlSurfaces["onOpenDiff"];
  onOpenAllChanges: SourceControlSurfaces["onOpenAllChanges"];
}

/** Routes a repository review request to the matching file, commit, diff or all-changes view. */
export function useRepositoryReviewOpen(deps: RepositoryReviewOpenDeps): {
  onOpenRepository: (request: RepositoryReviewRequest) => void;
} {
  const {
    sidebarCwdRef,
    lockSnapshot,
    onOpenFile,
    onOpenCommit,
    onOpenDiff,
    onOpenAllChanges,
  } = deps;

  const onOpenRepository = useCallback(
    (request: RepositoryReviewRequest) => {
      const projectCwd = sidebarCwdRef.current;
      if (
        isProjectLockedIn(lockSnapshot, request.cwd) ||
        isProjectLockedIn(lockSnapshot, projectCwd)
      )
        return;
      if (request.type === "file") {
        onOpenFile(
          request.path,
          undefined,
          { exact: true, pin: request.pin },
          { cwd: request.cwd, projectCwd },
        );
      } else if (request.type === "commit") {
        onOpenCommit(request.commit, request.pin, request.cwd);
      } else if (request.path) {
        onOpenDiff(request.path, undefined, request.kind, request.pin, true, {
          cwd: request.cwd,
          projectCwd,
        });
      } else onOpenAllChanges(request.kind, request.cwd);
    },
    [lockSnapshot, onOpenFile, onOpenCommit, onOpenDiff, onOpenAllChanges],
  );

  return { onOpenRepository };
}
