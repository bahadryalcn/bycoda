import { useEffect, useMemo, useState } from "react";
import {
  gitConflictStages,
  gitResolveConflict,
  gitStageFile,
  readTextFile,
  writeTextFile,
  type GitConflictStages,
} from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/git";
import { hasConflictMarkers, resolveConflictMarkers } from "../model/conflictMarkers";
import { buildUnifiedFile } from "../model/unifiedDiff";
import { UnifiedDiffView } from "./UnifiedDiffView";
import { GitFeedback, GitLoading } from "./GitFeedback";
import type { GraphRun } from "./GitGraphBranches";
import { ConflictLayout, conflictSourcesFromMarkers } from "./ConflictLayout";

export function GitGraphConflictEditor({
  cwd,
  path,
  relative,
  disabled,
  run,
  onDirty,
  onResolved,
}: {
  cwd: string;
  path: string;
  relative: string;
  disabled: boolean;
  run: GraphRun;
  onDirty: (dirty: boolean) => void;
  onResolved: () => void;
}) {
  useLocale();
  const [loaded, setLoaded] = useState<{
    stages: GitConflictStages;
    disk: string | null;
    oursLabel: string;
    theirsLabel: string;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    void gitConflictStages(cwd, relative)
      .then(async (stages) => {
        // Never read binary/oversized data into the editable output.
        const disk =
          stages.binary || stages.tooLarge
            ? null
            : await readTextFile(path).catch((error) => {
                if (stages.ours === null || stages.theirs === null) return null;
                throw error;
              });
        if (!cancelled) {
          const sources = conflictSourcesFromMarkers(disk ?? "");
          setLoaded({
            stages,
            disk,
            oursLabel: sources.ours.label,
            theirsLabel: sources.theirs.label,
          });
          setDraft(disk ?? "");
        }
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, path, relative, retry]);
  const dirty = loaded !== null && loaded.disk !== null && draft !== loaded.disk;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const models = useMemo(() => {
    if (!loaded || loaded.disk !== null) return [];
    const { stages } = loaded;
    const unified =
      stages.binary || stages.tooLarge
        ? null
        : buildUnifiedFile(stages.ours ?? "", stages.theirs ?? "");
    return [
      {
        id: relative,
        path,
        label: t("Current → incoming"),
        binary: stages.binary,
        tooLarge: stages.tooLarge,
        additions: unified?.additions ?? 0,
        deletions: unified?.deletions ?? 0,
        blocks: unified?.blocks ?? [],
      },
    ];
  }, [loaded, path, relative]);
  const take = (side: "ours" | "theirs") => {
    if (!loaded) return;
    const value = loaded.stages[side];
    if (loaded.disk === null || value === null) {
      void run("Resolving conflict…", async () => {
        await gitResolveConflict(cwd, relative, side);
        onResolved();
      });
    } else setDraft(value);
  };
  const save = async () => {
    if (!loaded || loaded.disk === null || hasConflictMarkers(draft)) return;
    const success = await run("Saving conflict resolution…", async () => {
      if ((await readTextFile(path)) !== loaded.disk)
        throw new Error(t("The file changed on disk. Reopen it before saving your resolution."));
      await writeTextFile(path, draft);
      // Keep the editor aligned with disk even if staging subsequently fails.
      setLoaded({ ...loaded, disk: draft });
      await gitStageFile(cwd, relative);
    });
    if (success) {
      onDirty(false);
      onResolved();
    }
  };
  if (error)
    return (
      <GitFeedback
        title={t("Conflict versions unavailable")}
        detail={error}
        onRetry={() => setRetry((value) => value + 1)}
      />
    );
  if (!loaded) return <GitLoading text="Loading conflict versions" />;
  const editable = loaded.disk !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-3 py-2">
        <span
          title={relative}
          className="min-w-0 flex-1 truncate text-[12px] font-medium text-warning"
        >
          {relative}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => take("ours")}
          className="rounded border border-stroke px-2 py-1 text-[11px] hover:bg-content/10 disabled:opacity-40"
        >
          {t("Use current")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => take("theirs")}
          className="rounded border border-stroke px-2 py-1 text-[11px] hover:bg-content/10 disabled:opacity-40"
        >
          {t("Use incoming")}
        </button>
        {editable && hasConflictMarkers(draft) ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft(resolveConflictMarkers(draft, "both"))}
            className="rounded border border-stroke px-2 py-1 text-[11px] hover:bg-content/10"
          >
            {t("Use both")}
          </button>
        ) : null}
      </header>
      {editable ? (
        <ConflictLayout
          path={path}
          dirty={dirty}
          resultActions={
            <button
              type="button"
              disabled={disabled || hasConflictMarkers(draft)}
              onClick={() => void save()}
              className="shrink-0 rounded bg-content px-3 py-1 text-[12px] text-background-base disabled:opacity-40"
            >
              {t("Save and stage")}
            </button>
          }
          ours={{
            text: loaded.stages.ours,
            label: loaded.oursLabel,
            origin: "Git index · stage 2",
          }}
          theirs={{
            text: loaded.stages.theirs,
            label: loaded.theirsLabel,
            origin: "Git index · stage 3",
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {hasConflictMarkers(draft) ? (
              <p className="px-3 pb-1 text-[11px] text-warning">
                {t("Resolve every conflict marker before staging")}
              </p>
            ) : null}
            <textarea
              id="graph-conflict-output"
              aria-label={t("Resolved output")}
              value={draft}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-0 flex-1 resize-none bg-background-base p-3 font-mono text-[12px] leading-5 text-content outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            />
          </div>
        </ConflictLayout>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <UnifiedDiffView files={models} />
          </div>
          <p className="px-3 py-2 text-[12px] text-content/65">
            {t("Choose a whole-file version to resolve this conflict")}
          </p>
        </>
      )}
    </div>
  );
}
