import type { GitChangedFile } from "../../../platform/tauri/fs";

/** A repository's gitlink changes and the action that stages or unstages one. */
export type SubmodulePointers = {
  files: readonly GitChangedFile[];
  act: (file: GitChangedFile, action: "stage" | "unstage") => unknown;
};

const slashes = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * Splits gitlink rows of submodules that are listed as their own repositories
 * from ordinary changes. Git reports a gitlink at the submodule's exact path.
 */
export function splitSubmodulePointers(
  files: GitChangedFile[],
  submodules: readonly string[] = [],
): [listed: GitChangedFile[], pointers: GitChangedFile[]] {
  if (submodules.length === 0) return [files, []];
  const paths = new Set(submodules.map(slashes));
  const listed: GitChangedFile[] = [];
  const pointers: GitChangedFile[] = [];
  for (const file of files) (paths.has(slashes(file.relative)) ? pointers : listed).push(file);
  return [listed, pointers];
}
