import { useEffect, useState } from "react";
import {
  gitBranches,
  gitCommitMessage,
  gitHistory,
  gitOperationState,
  type GitHistoryCommit,
  type GitOperation,
} from "../../../platform/tauri/fs";

export type ConflictProvenance = { label: string; subject?: string; detail: string };

/** Resolve marker identities through existing read APIs; never guess the incoming branch. */
export function useConflictProvenance(cwd: string | undefined, ours: string, theirs: string) {
  const [value, setValue] = useState<{
    cwd: string;
    oursMarker: string;
    theirsMarker: string;
    ours: ConflictProvenance;
    theirs: ConflictProvenance;
    operation: GitOperation | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!cwd) return;
    void (async () => {
      const [history, operation, branches] = await Promise.all([
        gitHistory(cwd, 200, true).catch(() => null),
        gitOperationState(cwd).catch(() => null),
        gitBranches(cwd).catch(() => null),
      ]);
      const resolve = async (
        marker: string,
        side: "ours" | "theirs",
      ): Promise<ConflictProvenance> => {
        const hash = marker.match(/^([a-f0-9]{7,40})(?:\s|$)/i)?.[1];
        const ref = marker === "HEAD" || (!marker && side === "ours") ? history?.head : hash;
        const commit: GitHistoryCommit | undefined = history?.commits?.find((item) =>
          ref ? item.sha.startsWith(ref) : item.refs.some((item) => item.name === marker),
        );
        const branch =
          side === "ours" &&
          (marker === "HEAD" || !marker) &&
          !branches?.detached &&
          branches?.current
            ? branches.current
            : (commit?.refs.find((item) => item.name === marker)?.name ??
              commit?.refs
                .filter((item) => item.kind === "local" || item.kind === "remote")
                .map((item) => item.name)
                .join(", "));
        const identity = hash ?? (marker === "HEAD" ? "HEAD" : null);
        const message =
          commit?.subject ??
          (identity ? await gitCommitMessage(cwd, identity).catch(() => "") : "");
        return {
          label: branch || (hash ? hash.slice(0, 7) : marker),
          subject: message.split(/\r?\n/)[0] || undefined,
          detail: [marker, commit?.sha, message].filter(Boolean).join(" · "),
        };
      };
      const [current, incoming] = await Promise.all([
        resolve(ours, "ours"),
        resolve(theirs, "theirs"),
      ]);
      if (!cancelled)
        setValue({
          cwd,
          oursMarker: ours,
          theirsMarker: theirs,
          ours: current,
          theirs: incoming,
          operation,
        });
    })().catch(() => {
      /* Keep marker identities when provenance is unavailable. */
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, ours, theirs]);
  return value && value.cwd === cwd && value.oursMarker === ours && value.theirsMarker === theirs
    ? value
    : null;
}
