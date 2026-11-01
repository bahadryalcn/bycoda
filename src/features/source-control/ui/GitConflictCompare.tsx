import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useState } from "react";
import { gitConflictStages, type GitConflictStages } from "../../../platform/tauri/fs";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { comparisonsFor, missingSideNotes, type CompareId } from "../model/conflictCompare";
import { conflictKindInfo } from "../model/conflictSection";
import { buildUnifiedFile } from "../model/unifiedDiff";
import { GitGraphDialog } from "./GitGraphDialog";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  relative: string;
  onClose: () => void;
};

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stages: GitConflictStages };

/**
 * A read-only look at a conflicted file's three versions, current (stage 2),
 * incoming (stage 3) and the common base (stage 1), as diffs between pairs.
 * Resolving happens in the editor or from the row; nothing here writes.
 */
export function GitConflictCompare({ cwd, relative, onClose }: Props) {
  useLocale();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [pair, setPair] = useState<CompareId>("sides");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    gitConflictStages(cwd, relative).then(
      (stages) => {
        if (!cancelled) setLoad({ status: "ready", stages });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, relative, retry]);

  const comparisons = useMemo(
    () => (load.status === "ready" ? comparisonsFor(load.stages) : []),
    [load],
  );
  const selected = comparisons.find((entry) => entry.id === pair);
  const model = useMemo<UnifiedDiffFileModel[]>(() => {
    if (load.status !== "ready" || !selected) return [];
    const { stages } = load;
    const unified =
      stages.binary || stages.tooLarge || selected.unavailable
        ? null
        : buildUnifiedFile(selected.original, selected.current);
    return [
      {
        id: `${relative}:${selected.id}`,
        path: stages.path,
        label: `${relative} · ${selected.label}`,
        binary: stages.binary,
        tooLarge: stages.tooLarge,
        emptyMessage: selected.unavailable
          ? selected.unavailable
          : unified && unified.additions === 0 && unified.deletions === 0
            ? "These two versions are identical"
            : undefined,
        additions: unified?.additions ?? 0,
        deletions: unified?.deletions ?? 0,
        blocks: unified?.blocks ?? [],
      },
    ];
  }, [load, relative, selected]);

  const notes = load.status === "ready" ? missingSideNotes(load.stages) : [];
  const title = `Compare ${relative}${
    load.status === "ready" ? ` · ${conflictKindInfo(load.stages.kind).label}` : ""
  }`;

  return (
    <GitGraphDialog
      title={title}
      onClose={onClose}
      toolbar={
        <Tabs<CompareId> value={pair} onValueChange={setPair} panels="none">
          <TabList label={t("Versions to compare")}>
            {comparisons.map((entry) => (
              <Tab
                key={entry.id}
                value={entry.id}
                disabled={!!entry.unavailable}
                disabledReason={entry.unavailable}
              >
                {entry.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      }
    >
      {load.status === "loading" ? (
        <div className="min-h-0 flex-1">
          <SurfaceLoading label={t("Loading conflict versions")} />
        </div>
      ) : load.status === "error" ? (
        <div className="grid flex-1 place-items-center p-6">
          <EmptyState
            kind="unavailable"
            context="panel"
            title={t("Couldn’t load the versions")}
            description={load.message}
            onRetry={() => setRetry((value) => value + 1)}
          />
        </div>
      ) : (
        <>
          {notes.length > 0 ? (
            <p
              role="status"
              className="shrink-0 border-b border-stroke px-4 py-1.5 text-ui-caption text-(--ui-text-secondary)"
            >
              {notes.join(" ")}
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <UnifiedDiffView files={model} initialExpansion="all" />
          </div>
        </>
      )}
    </GitGraphDialog>
  );
}
