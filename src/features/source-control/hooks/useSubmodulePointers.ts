import { useEffect, useMemo } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { GitChangedFile } from "../../../platform/tauri/fs";
import { splitSubmodulePointers, type SubmodulePointers } from "../model/submodulePointers";

/** Submodules shown as their own rows below a repository, and where its gitlinks go. */
export type SubmoduleListing = {
  paths: readonly string[];
  onPointers: (pointers: SubmodulePointers) => void;
};

/**
 * Splits a repository's changes into its listed rows and the gitlinks of listed
 * submodules, and publishes those gitlinks with the panel's own stage action so
 * each submodule row stages through the same queue and busy state.
 */
export function useSubmodulePointers(
  files: GitChangedFile[],
  submodules: SubmoduleListing | undefined,
  run: (file: GitChangedFile, action: "stage" | "unstage") => unknown,
) {
  const paths = submodules?.paths;
  const key = paths?.join("\n") ?? "";
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the path list.
  const split = useMemo(() => splitSubmodulePointers(files, paths), [files, key]);
  const act = useStableCallback(run);
  const publish = useStableCallback((value: SubmodulePointers) => submodules?.onPointers(value));
  const pointers = split[1];
  useEffect(() => {
    publish({ files: pointers, act });
  }, [pointers, publish, act]);
  useEffect(() => () => publish({ files: [], act }), [publish, act]);
  return split;
}
