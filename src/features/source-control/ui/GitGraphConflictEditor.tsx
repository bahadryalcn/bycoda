import { Button } from "../../../shared/ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { MergeConflictEditor } from "./MergeConflictEditor";
import {
  detectLineEnding,
  normalizeLineBreaks,
  restoreLineEnding,
} from "../../files/editor/editorDoc";

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
  const [operation, setOperation] = useState<"ours" | "theirs" | "save" | null>(null);
  const pending = useRef(false);
  const expectedDisk = useRef<string | null>(null);
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
          expectedDisk.current = disk;
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
  const runConflict = async (
    name: "ours" | "theirs" | "save",
    label: string,
    action: () => Promise<unknown>,
  ) => {
    if (disabled || pending.current) return false;
    pending.current = true;
    setOperation(name);
    try {
      return await run(label, action);
    } finally {
      pending.current = false;
      setOperation(null);
    }
  };
  const take = (side: "ours" | "theirs") => {
    if (!loaded || disabled || pending.current) return;
    const value = loaded.stages[side];
    if (loaded.disk === null || value === null) {
      void runConflict(side, "Resolving conflict…", async () => {
        await gitResolveConflict(cwd, relative, side);
        onResolved();
      });
    } else setDraft(value);
  };
  const save = async () => {
    if (!loaded || loaded.disk === null || hasConflictMarkers(draft)) return;
    const success = await runConflict("save", "Saving conflict resolution…", async () => {
      if ((await readTextFile(path)) !== loaded.disk)
        throw new Error(t("The file changed on disk. Reopen it before saving your resolution."));
      const serialized = restoreLineEnding(
        normalizeLineBreaks(draft),
        detectLineEnding(loaded.disk),
      );
      await writeTextFile(path, serialized);
      // Keep the editor aligned with disk even if staging subsequently fails.
      setLoaded({ ...loaded, disk: serialized });
      setDraft(serialized);
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
  if (loaded.disk !== null && hasConflictMarkers(loaded.disk))
    return (
      <MergeConflictEditor
        key={`${cwd}:${path}:${retry}`}
        cwd={cwd}
        path={path}
        value={loaded.disk}
        base={loaded.stages.base}
        active
        disabled={disabled}
        onDirtyChange={onDirty}
        canSave={() => !disabled}
        onResolved={onResolved}
        onSave={async (text) => {
          if ((await readTextFile(path)) !== expectedDisk.current)
            throw new Error(
              t("The file changed on disk. Reopen it before saving your resolution."),
            );
          const serialized = restoreLineEnding(
            normalizeLineBreaks(text),
            detectLineEnding(loaded.disk!),
          );
          await writeTextFile(path, serialized);
          expectedDisk.current = serialized;
        }}
      />
    );
  const editable = loaded.disk !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-3 py-2">
        <span
          title={relative}
          className="min-w-0 flex-1 truncate text-ui-caption font-medium text-warning"
        >
          {relative}
        </span>
        <Button
          variant="ghost"
          motion="none"
          type="button"
          loading={operation === "ours"}
          disabled={operation !== "ours" && (disabled || operation !== null)}
          onClick={() => take("ours")}
        >
          {t("Use current")}
        </Button>
        <Button
          variant="ghost"
          motion="none"
          type="button"
          loading={operation === "theirs"}
          disabled={operation !== "theirs" && (disabled || operation !== null)}
          onClick={() => take("theirs")}
        >
          {t("Use incoming")}
        </Button>
        {editable && hasConflictMarkers(draft) ? (
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={disabled || operation !== null}
            onClick={() => setDraft(resolveConflictMarkers(draft, "both"))}
          >
            {t("Use both")}
          </Button>
        ) : null}
      </header>
      {editable ? (
        <ConflictLayout
          cwd={cwd}
          path={path}
          dirty={dirty}
          resultActions={
            <Button
              variant="primary"
              motion="none"
              type="button"
              loading={operation === "save"}
              disabled={
                (operation !== "save" && (disabled || operation !== null)) ||
                hasConflictMarkers(draft)
              }
              onClick={() => void save()}
              className="shrink-0"
            >
              {t("Save and stage")}
            </Button>
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
              disabled={disabled || operation !== null}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-0 flex-1 resize-none font-mono leading-5"
            />
          </div>
        </ConflictLayout>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <UnifiedDiffView files={models} />
          </div>
          <p className="px-3 py-2 text-[12px] text-[var(--ui-text-secondary)]">
            {t("Choose a whole-file version to resolve this conflict")}
          </p>
        </>
      )}
    </div>
  );
}
