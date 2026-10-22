import { errorText } from "../../../shared/lib/errors";
import { gitPanelRuntime, setGitFeedback } from "../model/gitPanelState";
import { useCallback } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  gitResolveConflict,
  gitStageFile,
  readTextFile,
  writeTextFile,
} from "../../../platform/tauri/fs";
import { appName } from "../../../shared/lib/appName";
import { hasConflictMarkers, resolveConflictMarkers } from "../model/conflictMarkers";
import { conflictHasFile, type ConflictChoice, type ConflictRow } from "../model/conflictSection";

type Options = {
  cwd: string;
  busy: string | null;
  setBusy: (value: string | null) => void;
  /** Reload after git changed; `paths` are files whose contents changed on disk. */
  onMutated: (paths?: string[]) => void;
};

/**
 * What the Merge Conflicts section can do to its files. Each runs one git
 * change at a time (the panel's shared `busy`), shows a failure in a dialog,
 * and reloads either way.
 */
export function useConflictActions({ cwd, busy, setBusy, onMutated }: Options) {
  const run = useCallback(
    async (key: string, paths: string[], work: () => Promise<unknown>) => {
      if (busy || gitPanelRuntime(cwd).state.busy) return;
      setGitFeedback(cwd, null);
      setBusy(key);
      try {
        const result = await work();
        if (result !== false)
          setGitFeedback(cwd, {
            kind: "success",
            title: "Conflict operation complete",
          });
      } catch (error) {
        setGitFeedback(cwd, {
          kind: "error",
          title: "Couldn’t resolve conflict",
          detail: errorText(error),
        });
      } finally {
        setBusy(null);
        onMutated(paths);
      }
    },
    [busy, cwd, onMutated, setBusy],
  );

  /** Take a whole-file choice. "Both" joins the two sides of each block in the file. */
  const choose = useCallback(
    (row: ConflictRow, choice: ConflictChoice) =>
      run(row.relative, [row.path], async () => {
        if (choice.side === "both") {
          await writeTextFile(
            row.path,
            resolveConflictMarkers(await readTextFile(row.path), "both"),
          );
          await gitStageFile(cwd, row.relative);
          return;
        }
        await gitResolveConflict(cwd, row.relative, choice.side);
      }),
    [cwd, run],
  );

  /** Stage the file as it is, after a warning if conflict markers are still in it. */
  const markResolved = useCallback(
    (row: ConflictRow) =>
      run(row.relative, [row.path], async () => {
        if (conflictHasFile(row.kind)) {
          // A binary or unreadable file cannot hold markers we could warn about.
          const text = await readTextFile(row.path).catch(() => "");
          if (hasConflictMarkers(text)) {
            const confirmed = await ask(
              `${row.relative} still contains conflict markers. Mark it as resolved anyway?`,
              { title: appName(), kind: "warning", okLabel: "Mark Resolved" },
            );
            if (!confirmed) return false;
          }
        }
        await gitStageFile(cwd, row.relative);
      }),
    [cwd, run],
  );

  /** Every file takes the same side; a side that deleted a file deletes it. */
  const acceptAll = useCallback(
    async (rows: readonly ConflictRow[], side: "ours" | "theirs") => {
      if (busy || rows.length === 0) return;
      const which = side === "ours" ? "current" : "incoming";
      const confirmed = await ask(
        `Accept all ${which} changes in ${rows.length} conflicted file${rows.length === 1 ? "" : "s"}? ` +
          `Each file is replaced by the ${which} branch's version, and a file that branch deleted is deleted. ` +
          "Edits you made to these files are discarded.",
        {
          title: appName(),
          kind: "warning",
          okLabel: `Accept All ${side === "ours" ? "Current" : "Incoming"}`,
        },
      );
      if (!confirmed) return;
      await run(
        "conflicts",
        rows.map((row) => row.path),
        async () => {
          for (const row of rows) await gitResolveConflict(cwd, row.relative, side);
        },
      );
    },
    [busy, cwd, run],
  );

  return { choose, markResolved, acceptAll };
}
