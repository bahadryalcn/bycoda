import { Button } from "../../../shared/ui/Button";
import { runDiffWorker } from "../model/diffWorker";
import { t, useLocale } from "../../../shared/i18n/git";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader } from "../../../shared/ui/icons";
import {
  gitDiscardFile,
  gitFileDiff,
  gitStageContents,
  gitStageFile,
  subscribeGitChanged,
  type GitChangedFile,
  type GitFileDiffKind,
} from "../../../platform/tauri/fs";
import { buildUnifiedFileAsync, type UnifiedFileDiff } from "../model/unifiedDiff";
import {
  prioritizeWorkingTreeDiffEntries,
  workingTreeDiffEntries,
  workingTreeDiffEntryLabel,
  workingTreeDiffFocusId,
  type WorkingTreeDiffEntry,
} from "../model/workingTreeDiff";
import { stageChunkText } from "../../files/editor/editorGit";
import {
  currentGitChangeHint,
  fetchGitIndex,
  invalidateGitIndex,
  notifyGitChangedWith,
} from "../model/gitIndexStore";
import {
  dirtyEntryIds,
  entriesToLoad,
  reuseLoadedDiff,
  sameChangedFiles,
  sameChangedRow,
} from "../model/workingTreeReload";
import { LINE_DIFF_CONFIG } from "../model/lineDiff";
import { confirmDiscardFile } from "../model/gitConfirmation";
import { withGitOperation } from "../model/gitPanelState";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  focusPath?: string;
  focusKind?: GitFileDiffKind;
  focusRequest?: number;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  original: string;
  current: string;
  unified: UnifiedFileDiff | null;
  error?: string;
};

type CachedModel = {
  file: GitChangedFile;
  kind: GitFileDiffKind;
  loaded: LoadedDiff | undefined;
  model: UnifiedDiffFileModel;
};

const DIFF_LOAD_CONCURRENCY = 4;
// Bodies loaded without waiting for their section to be seen: the first
// screenful is there at once.
const EAGER_DIFF_LOADS = 10;
const REFRESH_DEBOUNCE_MS = 500;
// A shared index fetched just before the event that woke us still counts.
const GIT_INDEX_EVENT_SLACK_MS = 300;

function buildModel(
  entry: WorkingTreeDiffEntry,
  loaded: LoadedDiff | undefined,
): UnifiedDiffFileModel {
  const { file, kind } = entry;
  const unified = loaded?.unified ?? null;
  const unchanged =
    unified != null && unified.additions === 0 && unified.deletions === 0 && !loaded?.binary;
  // Also before the body is loaded: the placeholder shows the index's counts.
  const canUseIndexCounts = !loaded?.error && !(file.staged && file.unstaged);
  return {
    id: entry.id,
    path: file.path,
    label: workingTreeDiffEntryLabel(entry),
    binary: loaded?.binary,
    tooLarge: loaded?.tooLarge,
    emptyMessage:
      loaded == null
        ? "Loading…"
        : loaded.error
          ? `Couldn’t load diff: ${loaded.error}`
          : unchanged
            ? kind === "staged"
              ? "No staged changes"
              : "No unstaged changes"
            : undefined,
    additions: unified?.additions ?? (canUseIndexCounts ? file.additions : 0),
    deletions: unified?.deletions ?? (canUseIndexCounts ? file.deletions : 0),
    blocks: unchanged ? [] : (unified?.blocks ?? []),
    canStage: kind === "unstaged",
    canDiscard: kind === "unstaged",
    canStageHunk: kind === "unstaged" && !loaded?.binary && !loaded?.tooLarge,
  };
}

export function WorkingTreeDiff({ cwd, focusPath, focusKind, focusRequest }: Props) {
  useLocale();
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  const [diffs] = useState(() => new Map<string, LoadedDiff>());
  const [diffVersion, setDiffVersion] = useState(0);
  const setDiffs = useCallback(
    (update: Map<string, LoadedDiff> | ((map: Map<string, LoadedDiff>) => boolean)) => {
      if (typeof update === "function") {
        if (!update(diffs)) return;
      } else {
        if (!diffs.size) return;
        diffs.clear();
      }
      setDiffVersion((value) => value + 1);
    },
    [diffs],
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const refreshNow = useRef<((paths: readonly string[]) => void) | null>(null);
  const mutationQueue = useRef(Promise.resolve());
  const pendingIds = useRef(new Set<string>());
  const mutationContext = useRef({ cwd, active: true });
  useEffect(() => {
    const context = { cwd, active: true };
    mutationContext.current = context;
    setBusyId(null);
    setMutationError(null);
    return () => {
      context.active = false;
    };
  }, [cwd]);

  const enqueueMutation = useCallback(
    (id: string, path: string, action: () => Promise<boolean | void>) => {
      const context = mutationContext.current;
      const key = `${cwd}\0${id}`;
      if (pendingIds.current.has(key)) return;
      pendingIds.current.add(key);
      const task = mutationQueue.current
        .then(async () => {
          if (!context.active) return;
          setBusyId(id);
          setMutationError(null);
          try {
            if ((await withGitOperation(cwd, "Updating diff…", action)) !== false) {
              invalidateGitIndex();
              notifyGitChangedWith(cwd, "index", { paths: [path] });
              // Our own action: show its result without the debounce.
              refreshNow.current?.([path]);
            }
          } catch (caught) {
            if (context.active)
              setMutationError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            if (context.active) setBusyId(null);
          }
        })
        .finally(() => {
          pendingIds.current.delete(key);
        });
      mutationQueue.current = task;
      return task;
    },
    [cwd],
  );
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;
  // Sections that are expanded and near the viewport: their bodies are the
  // ones worth loading (or reloading after a change).
  const neededRef = useRef(new Set<string>());
  const pumpRef = useRef<(() => void) | null>(null);
  const onSectionNeeded = useCallback((id: string, needed: boolean) => {
    if (needed) neededRef.current.add(id);
    else neededRef.current.delete(id);
    if (needed) pumpRef.current?.();
  }, []);

  useEffect(() => {
    setError(null);
    if (!cwd || cwd === "~") {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    setFiles(null);
    setDiffs(new Map());

    // What each loaded diff was loaded for. A refresh fetches again only the
    // entries whose index row moved, plus the ones a change names as touched.
    const loadedRows = new Map<string, GitChangedFile>();
    // Entries that must be fetched again whatever their row says; kept across
    // runs so a superseded run does not lose them.
    const dirtyIds = new Set<string>();
    let lastHead: string | null | undefined;
    let pendingAll = true;
    const pendingPaths = new Set<string>();
    let lastEventAt = 0;
    // Entries of the last index read, focused file first, and the loads that
    // are running or failed since the last refresh (neither is started again).
    let latestEntries: WorkingTreeDiffEntry[] = [];
    const inFlight = new Set<string>();
    const failedIds = new Set<string>();

    const loadEntry = async (entry: WorkingTreeDiffEntry) => {
      let loaded: LoadedDiff;
      let failed = false;
      try {
        const diff = await gitFileDiff(cwd, entry.file.relative, entry.kind);
        const candidate: LoadedDiff = {
          binary: diff.binary,
          tooLarge: diff.tooLarge,
          original: diff.original,
          current: diff.current,
          unified: null,
        };
        // Same texts as on screen: keep that object, skip the parse.
        const previous = diffsRef.current.get(entry.id);
        const reused = reuseLoadedDiff(previous, candidate);
        loaded =
          reused !== candidate
            ? reused
            : {
                ...candidate,
                unified:
                  !diff.binary && !diff.tooLarge
                    ? await runDiffWorker(
                        (remote) => remote.build(diff.original, diff.current),
                        () => buildUnifiedFileAsync(diff.original, diff.current),
                      )
                    : null,
              };
      } catch (caught: unknown) {
        failed = true;
        loaded = {
          binary: false,
          tooLarge: false,
          original: "",
          current: "",
          unified: null,
          error: caught instanceof Error ? caught.message : String(caught),
        };
      }
      inFlight.delete(entry.id);
      if (disposed) return;
      // An entry that left the list meanwhile has nothing to show.
      if (latestEntries.some((candidate) => candidate.id === entry.id)) {
        // A failed load stays unrecorded; the next refresh retries it.
        if (failed) {
          loadedRows.delete(entry.id);
          failedIds.add(entry.id);
        } else loadedRows.set(entry.id, entry.file);
        setDiffs((existing) => {
          if (existing.get(entry.id) === loaded) return false;
          existing.set(entry.id, loaded);
          return true;
        });
      }
      pump();
    };

    // Starts loads for what is needed and not yet (or no longer) current, up
    // to the concurrency limit; each finished load pumps again.
    const pump = () => {
      if (disposed) return;
      const skip = new Set([...inFlight, ...failedIds]);
      const todo = entriesToLoad(
        latestEntries,
        loadedRows,
        dirtyIds,
        neededRef.current,
        EAGER_DIFF_LOADS,
        skip,
      );
      for (const entry of todo) {
        if (inFlight.size >= DIFF_LOAD_CONCURRENCY) break;
        inFlight.add(entry.id);
        // A change that lands while this load runs marks it dirty again.
        dirtyIds.delete(entry.id);
        void loadEntry(entry);
      }
    };
    pumpRef.current = pump;

    const run = () => {
      const current = ++generation;
      const since = lastEventAt ? lastEventAt - GIT_INDEX_EVENT_SLACK_MS : undefined;
      setError(null);
      void fetchGitIndex(cwd, { since })
        .then(async (index) => {
          if (disposed || current !== generation) return;
          setFiles((previous) =>
            previous && sameChangedFiles(previous, index.files) ? previous : index.files,
          );
          setError(null);
          const entries = workingTreeDiffEntries(index.files, focusKind);
          // A moved HEAD changes the left side of rows that look the same.
          if (index.head !== lastHead) pendingAll = true;
          lastHead = index.head;
          for (const id of dirtyEntryIds(entries, pendingAll ? null : pendingPaths)) {
            dirtyIds.add(id);
          }
          pendingAll = false;
          pendingPaths.clear();
          // A refresh keeps each loaded diff on screen until its replacement
          // arrives; only files that left the list are dropped.
          const kept = new Set(entries.map((entry) => entry.id));
          for (const id of [...loadedRows.keys(), ...dirtyIds]) {
            if (!kept.has(id)) {
              loadedRows.delete(id);
              dirtyIds.delete(id);
            }
          }
          setDiffs((existing) => {
            if ([...existing.keys()].every((id) => kept.has(id))) {
              return false;
            }
            for (const id of existing.keys()) if (!kept.has(id)) existing.delete(id);
            return true;
          });
          latestEntries = prioritizeWorkingTreeDiffEntries(entries, focusPath, focusKind);
          // A refresh retries what failed before.
          failedIds.clear();
          pump();
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setFiles([]);
        });
    };

    run();
    let refreshTimer = 0;
    // Trailing, not restarted by later events, so a steady stream of changes
    // still refreshes every REFRESH_DEBOUNCE_MS.
    const scheduleRun = (paths: readonly string[] | null, now = false) => {
      lastEventAt = Date.now();
      if (paths === null) pendingAll = true;
      else for (const path of paths) pendingPaths.add(path);
      if (now) {
        window.clearTimeout(refreshTimer);
        refreshTimer = 0;
        run();
        return;
      }
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0;
        run();
      }, REFRESH_DEBOUNCE_MS);
    };
    const unsub = subscribeGitChanged(
      // Read while the event is delivered; without a hint anything may have
      // changed.
      () => scheduleRun(currentGitChangeHint()?.paths ?? null),
      { cwd },
    );
    refreshNow.current = (paths) => scheduleRun(paths, true);
    const onFocus = () => {
      if (!document.hidden) scheduleRun(null);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      refreshNow.current = null;
      pumpRef.current = null;
      window.clearTimeout(refreshTimer);
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cwd, focusKind, retry]);

  // A review opened from the Changes or Staged Changes section shows only that side.
  const entries = useMemo(() => workingTreeDiffEntries(files ?? [], focusKind), [files, focusKind]);

  // One model per entry, rebuilt only when its row or its loaded diff changed,
  // so a refresh costs a lookup per file instead of a rebuild per file.
  const modelCache = useRef(new Map<string, CachedModel>());
  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    const previous = modelCache.current;
    const next = new Map<string, CachedModel>();
    const built = entries.map((entry) => {
      const { file, kind } = entry;
      const loaded = diffs.get(entry.id);
      const cached = previous.get(entry.id);
      if (
        cached &&
        cached.loaded === loaded &&
        cached.kind === kind &&
        sameChangedRow(cached.file, file)
      ) {
        next.set(entry.id, cached);
        return cached.model;
      }
      const model = buildModel(entry, loaded);
      next.set(entry.id, { file, kind, loaded, model });
      return model;
    });
    modelCache.current = next;
    return built;
  }, [diffs, diffVersion, entries, files]);

  const totals = useMemo(
    () =>
      models.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [models],
  );

  const focusId = useMemo(
    () => workingTreeDiffFocusId(entries, focusPath, focusKind),
    [entries, focusKind, focusPath],
  );

  const onStageFile = useCallback(
    async (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.kind !== "unstaged") return;
      await enqueueMutation(id, entry.file.path, () => gitStageFile(cwd, entry.file.relative));
    },
    [cwd, entries, enqueueMutation],
  );

  const onDiscardFile = useCallback(
    async (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.kind !== "unstaged") return;
      await enqueueMutation(id, entry.file.path, async () => {
        if (!(await confirmDiscardFile(entry.file))) return false;
        await gitDiscardFile(cwd, entry.file.relative);
      });
    },
    [cwd, entries, enqueueMutation],
  );

  const onStageHunk = useCallback(
    async (id: string, pos: number) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.kind !== "unstaged") return;
      const loaded = diffsRef.current.get(id);
      if (!loaded || loaded.error || loaded.binary || loaded.tooLarge) return;
      // Same diff the view used to produce `pos`, so the same hunk is staged.
      const next = stageChunkText(loaded.original, loaded.current, pos, null, LINE_DIFF_CONFIG);
      if (next == null) return;
      await enqueueMutation(id, entry.file.path, () =>
        gitStageContents(cwd, entry.file.relative, next),
      );
    },
    [cwd, entries, enqueueMutation],
  );

  if (!cwd || cwd === "~") {
    return (
      <p className="grid h-full place-items-center text-[13px] text-[var(--ui-text-muted)]">
        {t("No project folder")}
      </p>
    );
  }
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-5 text-danger" />
        <p className="text-[13px] text-content">{t("Couldn’t load changes")}</p>
        <p className="mt-1 text-[12px] text-[var(--ui-text-secondary)]">{error}</p>
        <Button
          variant="ghost"
          motion="none"
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="mt-3"
        >
          {t("Retry")}
        </Button>
      </div>
    );
  }
  if (files == null) {
    return (
      <div className="grid h-full place-items-center text-[var(--ui-text-muted)]">
        <Loader className="size-4 animate-spin" strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mutationError && (
        <p role="alert" className="shrink-0 px-3 py-2 text-[12px] text-danger">
          {mutationError}
        </p>
      )}
      <UnifiedDiffView
        files={models}
        fileCount={focusKind ? entries.length : files.length}
        focusId={focusId}
        focusRequest={focusRequest}
        busyId={busyId}
        totals={totals}
        onStageFile={onStageFile}
        onDiscardFile={onDiscardFile}
        onStageHunk={onStageHunk}
        onSectionNeeded={onSectionNeeded}
      />
    </div>
  );
}
