import { errorText } from "../../../shared/lib/errors";
import { gitPanelRuntime, setGitFeedback } from "../model/gitPanelState";
import { useCallback } from "react";
import {
  gitResolveConflict,
  gitStageFile,
  readTextFile,
  writeTextFile,
} from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n/git";
import { confirmGitAction } from "../model/gitConfirmation";
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
            const confirmed = await confirmGitAction({
              title: t("Mark as resolved?"),
              message: t(
                "“{p0}” still contains conflict markers. Marking it resolved stages it as it is.",
                { p0: row.relative },
              ),
              confirmLabel: t("Mark resolved"),
              tone: "normal",
            });
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
      const count = rows.length;
      const ours = side === "ours";
      const effect =
        count === 1
          ? ours
            ? t("1 conflicted file will take the current branch’s version.")
            : t("1 conflicted file will take the incoming branch’s version.")
          : ours
            ? t("{p0} conflicted files will take the current branch’s version.", { p0: count })
            : t("{p0} conflicted files will take the incoming branch’s version.", { p0: count });
      const confirmed = await confirmGitAction({
        title: ours ? t("Accept all current changes?") : t("Accept all incoming changes?"),
        message: `${effect} ${t("A file that branch deleted is deleted, and your edits to these files are discarded.")}`,
        confirmLabel: ours ? t("Accept all current") : t("Accept all incoming"),
      });
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
