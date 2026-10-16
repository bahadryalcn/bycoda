import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Maximize2,
  Search,
  RefreshCw,
} from "../../../shared/ui/icons";
import { suppressTextSelection } from "../../../shared/lib/drag";
import {
  gitCheckoutCommit,
  gitCherryPick,
  gitCreateBranchAt,
  gitCreateTag,
  gitHistory,
  gitCommitMessage,
  gitRemotes,
  gitReset,
  gitRevert,
  notifyGitChanged,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { GIT_ACTIONS, useRemoteSupports } from "../../connections/model/remoteCapabilities";
import { reportRemoteLoad, useRemoteLoadFailure } from "../../connections/model/remoteHealth";
import { RemoteLoadError } from "../../connections/ui/RemoteLoadError";
import { commitMenuItems, filterHistory, githubCommitUrl } from "../model/commitActions";
import { layoutGitGraph } from "../model/gitGraph";
import { GitGraphDialog } from "./GitGraphDialog";
import { GitGraphList, type GraphListItem } from "./GitGraphList";
import { GraphSearchInput } from "./GitGraphParts";
import { RefNameDialog } from "./RefNameDialog";
import { appName } from "../../../shared/lib/appName";
import { useGitResource } from "../hooks/useGitResource";
import { GitFeedback, GitLoading } from "./GitFeedback";
import { confirmNative } from "../model/gitConfirmation";
const GitGraphWorkspace = lazy(() =>
  import("./GitGraphWorkspace").then((module) => ({
    default: module.GitGraphWorkspace,
  })),
);
import { useGitPanelState, withGitOperation, setGitFeedback } from "../model/gitPanelState";

type Props = {
  cwd: string;
  enabled: boolean;
  expanded: boolean;
  selectedSha?: string;
  onToggleExpanded: () => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

const HISTORY_PAGE = 200;

const HEADER_BUTTON =
  "mr-1 grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content aria-pressed:bg-content/10 aria-pressed:text-content";

export function GitHistoryGraph({
  cwd,
  enabled,
  expanded,
  selectedSha,
  onToggleExpanded,
  onOpenCommit,
}: Props) {
  useLocale();
  // Commit actions and the wider scope need this computer or a host with `git.actions`.
  const actions = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const stateKey = `git-history:${pathKey(cwd)}`;
  const [showAll, setShowAll] = useRetainedState(`${stateKey}:all`, false);
  const [limit, setLimit] = useRetainedState(`${stateKey}:limit:${showAll}`, HISTORY_PAGE);
  const [searchOpen, setSearchOpen] = useRetainedState(`${stateKey}:search`, false);
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [fullOpen, setFullOpen] = useState(false);
  const [fullCommit, setFullCommit] = useState<GitHistoryCommit | null>(null);
  const [commitMode, setCommitMode] = useState<"changes" | "blame">("changes");
  const [resolutionDirty, setResolutionDirty] = useState(false);
  const [resolutionReset, setResolutionReset] = useState(0);
  const { commits, failure, loading, error, refresh } = useGitHistory(
    cwd,
    enabled && (expanded || fullOpen),
    actions && (showAll || fullOpen),
    limit,
  );
  const [busy] = useGitPanelState(cwd, "busy");
  const rows = useMemo(() => layoutGitGraph(commits), [commits]);
  const rowBySha = useMemo(
    () => new Map(commits.map((commit, index) => [commit.sha, rows[index]])),
    [commits, rows],
  );
  // The full-graph dialog has its own search field bound to the same query.
  const searching = (searchOpen || fullOpen) && query.trim() !== "";
  const items = useMemo(() => {
    const visible = searching ? filterHistory(commits, query) : commits;
    return visible.flatMap((commit): GraphListItem[] => {
      const row = rowBySha.get(commit.sha);
      return row ? [{ commit, row }] : [];
    });
  }, [commits, query, searching, rowBySha]);
  const hasMore = commits.length >= limit;

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    commit: GitHistoryCommit;
  } | null>(null);
  const [naming, setNaming] = useState<{
    kind: "branch" | "tag";
    commit: GitHistoryCommit;
  } | null>(null);
  const [namingBusy, setNamingBusy] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    if (!actions || busy || !(await discardResolution())) return;
    try {
      await withGitOperation(cwd, "Updating repository…", action);
      setGitFeedback(cwd, {
        kind: "success",
        get title() {
          return t("Git operation complete");
        },
      });
    } catch (error) {
      if (fullOpen) setFullCommit(null);
      setGitFeedback(cwd, {
        kind: "error",
        get title() {
          return t("Git operation failed");
        },
        detail: errorText(error),
      });
    } finally {
      // Also after a failure: a conflict leaves the tree and index changed.
      notifyGitChanged(cwd, "refs");
    }
  };

  const onPick = async (id: string, commit: GitHistoryCommit) => {
    const { sha } = commit;
    switch (id) {
      case "open-changes":
      case "blame":
        if (!(await discardResolution())) return;
        setFullCommit(commit);
        setCommitMode(id === "blame" ? "blame" : "changes");
        setFullOpen(true);
        return;
      case "github": {
        const url = githubCommitUrl(await gitRemotes(cwd), sha);
        if (!url) throw new Error(t("No GitHub remote found for this repository"));
        await openUrl(url);
        return;
      }
      case "checkout":
        return run(() => gitCheckoutCommit(cwd, sha));
      case "branch":
      case "tag":
        setNamingError(null);
        setNaming({ kind: id, commit });
        return;
      case "cherry-pick":
        return run(() => gitCherryPick(cwd, sha));
      case "revert":
        return run(() => gitRevert(cwd, sha));
      case "reset-soft":
        return run(() => gitReset(cwd, sha, "soft"));
      case "reset-mixed":
        return run(() => gitReset(cwd, sha, "mixed"));
      case "reset-hard": {
        const confirmed = await ask(
          t(
            "Reset the current branch to {p0} and discard all uncommitted changes? This cannot be undone.",
            { p0: commit.shortSha },
          ),
          { title: appName(), kind: "warning", okLabel: t("Reset") },
        );
        if (confirmed) await run(() => gitReset(cwd, sha, "hard"));
        return;
      }
      case "copy-sha":
        await navigator.clipboard.writeText(sha);
        return;
      case "copy-message":
        await navigator.clipboard.writeText((await gitCommitMessage(cwd, sha)).trimEnd());
        return;
    }
  };

  const submitName = async (name: string) => {
    if (!naming || !actions || busy || !(await discardResolution())) return;
    setNamingBusy(true);
    setNamingError(null);
    try {
      await withGitOperation(cwd, "Creating reference…", async () => {
        if (naming.kind === "branch") await gitCreateBranchAt(cwd, name, naming.commit.sha);
        else await gitCreateTag(cwd, name, naming.commit.sha);
      });
      setNaming(null);
      notifyGitChanged(cwd, "refs");
    } catch (error) {
      setNamingError(errorText(error));
    } finally {
      setNamingBusy(false);
    }
  };

  const showAllButton = actions ? (
    <button
      type="button"
      title={showAll ? t("Showing all branches") : t("Show all branches")}
      aria-label={t("Show all branches")}
      aria-pressed={showAll}
      onClick={() => {
        setShowAll(!showAll);
      }}
      className={HEADER_BUTTON}
    >
      <GitBranch className="size-3.5" strokeWidth={1.75} />
    </button>
  ) : null;

  const discardResolution = async () => {
    if (
      resolutionDirty &&
      !(await confirmNative(t("Discard the unsaved conflict resolution?"), t("Discard")))
    )
      return false;
    if (resolutionDirty) setResolutionReset((value) => value + 1);
    setResolutionDirty(false);
    return true;
  };

  const closeFull = async () => {
    if (!(await discardResolution())) return;
    setFullOpen(false);
    if (!searchOpen) setQuery("");
  };

  const selectFullCommit = async (commit: GitHistoryCommit | null) => {
    if (commit?.sha === fullCommit?.sha) return;
    if (!(await discardResolution())) return;
    setCommitMode("changes");
    setFullCommit(commit);
  };

  const list = (variant: "compact" | "workspace") => {
    const empty =
      !cwd || cwd === "~" ? (
        <p className="px-3 py-2 text-[12px] text-content/45">{t("No project folder")}</p>
      ) : commits.length === 0 ? (
        loading ? (
          <GitLoading text="Loading commit graph…" />
        ) : error || failure ? (
          <p className="px-3 py-2 text-[12px] text-content/45">{t("Commit history unavailable")}</p>
        ) : (
          <p className="px-3 py-2 text-[12px] text-content/45">{t("No commits yet")}</p>
        )
      ) : items.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-content/45">
          {t("No matching commits in the ")}
          {commits.length}
          {t(" loaded")}
        </p>
      ) : undefined;
    const graph = (
      <GitGraphList
        variant={variant}
        items={items}
        plain={searching}
        selectedSha={variant === "workspace" ? fullCommit?.sha : selectedSha}
        hasMore={hasMore && !loading && !error && !failure}
        empty={empty}
        suspendHover={menu !== null}
        onLoadMore={() => setLimit((value) => value + HISTORY_PAGE)}
        onOpen={(commit, pin) => {
          if (variant === "workspace") void selectFullCommit(commit);
          else onOpenCommit(commit, pin);
        }}
        onMenu={(x, y, commit) => setMenu({ x, y, commit })}
      />
    );
    return failure ? (
      <>
        <RemoteLoadError cwd={cwd} failure={failure} stale={commits.length > 0} onRetry={refresh} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col opacity-60">{graph}</div>
      </>
    ) : (
      <>
        {error ? (
          <GitFeedback
            title={t("Couldn’t load commit graph")}
            detail={error}
            stale={commits.length > 0}
            onRetry={refresh}
          />
        ) : null}
        {graph}
      </>
    );
  };

  return (
    <div aria-busy={loading} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className={`flex w-full shrink-0 items-center ${expanded ? "h-7" : "h-full"}`}>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? t("Collapse graph") : t("Expand graph")}
          className="flex h-full min-w-0 flex-1 items-center gap-1 px-3 text-left leading-none hover:bg-content/5"
        >
          <span className="text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
            {t("Graph")}
          </span>
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
          ) : (
            <ChevronRight
              className="ml-auto size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          )}
        </button>
        {expanded ? (
          <button
            type="button"
            title={t("Refresh commit graph")}
            aria-label={t("Refresh commit graph")}
            disabled={loading}
            onClick={refresh}
            className={HEADER_BUTTON}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        ) : null}
        {expanded ? showAllButton : null}
        {expanded ? (
          <button
            type="button"
            title={t("Search commits")}
            aria-label={t("Search commits")}
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen((open) => !open);
              setQuery("");
            }}
            className={HEADER_BUTTON}
          >
            <Search className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {expanded && cwd && cwd !== "~" ? (
          <button
            type="button"
            title={t("Open full graph")}
            aria-label={t("Open full graph")}
            onClick={() => setFullOpen(true)}
            className={HEADER_BUTTON}
          >
            <Maximize2 className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {expanded && searchOpen ? (
        <div className="shrink-0 px-2 pb-1.5">
          <GraphSearchInput
            value={query}
            autoFocus
            onChange={setQuery}
            onEscape={() => {
              setSearchOpen(false);
              setQuery("");
            }}
          />
        </div>
      ) : null}
      {expanded ? list("compact") : null}
      {fullOpen ? (
        <GitGraphDialog
          title={t("Commit Graph")}
          expandable
          onClose={() => void closeFull()}
          toolbar={
            <>
              <button
                type="button"
                title={t("Refresh commit graph")}
                aria-label={t("Refresh full commit graph")}
                disabled={loading}
                onClick={() => {
                  refresh();
                  notifyGitChanged(cwd, "refs");
                }}
                className={HEADER_BUTTON}
              >
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
              <div className="max-w-sm min-w-0 flex-1">
                <GraphSearchInput value={query} onChange={setQuery} />
              </div>
            </>
          }
        >
          <Suspense fallback={<GitLoading text="Loading commit graph…" />}>
            <GitGraphWorkspace
              key={`${cwd}:${resolutionReset}`}
              cwd={cwd}
              commit={fullCommit}
              commitMode={commitMode}
              onCommitMode={setCommitMode}
              onCommit={(commit) => void selectFullCommit(commit)}
              onDirty={setResolutionDirty}
              onBranch={(commit) => {
                setNamingError(null);
                setNaming({ kind: "branch", commit });
              }}
              graph={list("workspace")}
            />
          </Suspense>
        </GitGraphDialog>
      ) : null}
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t("Commit actions")}
          width={264}
          header={
            <div className="px-2 py-1.5 text-[11px] text-content/55">
              <code className="mr-2">{menu.commit.shortSha}</code>
              <span className="block truncate text-content/80">{menu.commit.subject}</span>
            </div>
          }
          items={commitMenuItems(menu.commit, !actions || !!busy)}
          onPick={(id) => {
            const { commit } = menu;
            setMenu(null);
            void onPick(id, commit).catch((error) =>
              setGitFeedback(cwd, {
                kind: "error",
                title: t("Git operation failed"),
                detail: errorText(error),
              }),
            );
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {naming ? (
        <RefNameDialog
          title={naming.kind === "branch" ? t("New branch") : t("New tag")}
          description={
            naming.kind === "branch"
              ? t("Create and check out a branch at {p0}.", {
                  p0: naming.commit.shortSha,
                })
              : t("Create a tag at {p0}.", { p0: naming.commit.shortSha })
          }
          label={naming.kind === "branch" ? t("Branch name") : t("Tag name")}
          placeholder={naming.kind === "branch" ? t("feature/my-branch") : "v1.0.0"}
          submitLabel="Create"
          busy={namingBusy || !!busy}
          error={namingError}
          onSubmit={(name) => void submitName(name)}
          onCancel={() => setNaming(null)}
        />
      ) : null}
    </div>
  );
}

function useGitHistory(cwd: string, enabled: boolean, all: boolean, limit: number) {
  const failure = useRemoteLoadFailure(cwd, "graph");
  const remote = isRemoteProjectPath(cwd);
  const read = useCallback(
    async () => (await gitHistory(cwd, limit, all)).commits,
    [cwd, limit, all],
  );
  const resource = useGitResource(
    cwd,
    `history:${cwd}:${all}:${limit}`,
    enabled && !!cwd && cwd !== "~",
    read,
  );
  // Paging changes the cache key, but keeps the previous page visible while
  // the longer history is loading. Never carry it across a checkout or scope.
  const retained = useRef<{
    cwd: string;
    all: boolean;
    commits: GitHistoryCommit[];
  } | null>(null);
  if (resource.data) retained.current = { cwd, all, commits: resource.data };
  const commits =
    resource.data ??
    (retained.current?.cwd === cwd && retained.current.all === all ? retained.current.commits : []);
  useEffect(() => {
    if (enabled && remote && !resource.loading)
      reportRemoteLoad(cwd, "graph", resource.error ?? undefined);
  }, [cwd, enabled, remote, resource.loading, resource.error]);
  return {
    commits,
    loading: resource.loading,
    error: resource.error,
    failure,
    refresh: resource.refresh,
  };
}

export const GRAPH_PANEL_MIN = 120;
export const GRAPH_PANEL_DEFAULT = 240;

let graphPanelHeight = GRAPH_PANEL_DEFAULT;

export function loadGraphPanelHeight(): number {
  return graphPanelHeight;
}

export function saveGraphPanelHeight(height: number) {
  graphPanelHeight = height;
}

export function GraphResizeSash({
  height,
  onHeightPaint,
  onHeightCommit,
  maxHeight,
}: {
  height: number;
  onHeightPaint: (height: number) => void;
  onHeightCommit: (height: number) => void;
  maxHeight: () => number;
}) {
  useLocale();
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const paintedRef = useRef(height);
  paintedRef.current = height;
  const paintRef = useRef(onHeightPaint);
  paintRef.current = onHeightPaint;
  const commitRef = useRef(onHeightCommit);
  commitRef.current = onHeightCommit;
  const maxRef = useRef(maxHeight);
  maxRef.current = maxHeight;

  const clamp = (value: number) =>
    Math.min(maxRef.current(), Math.max(GRAPH_PANEL_MIN, Math.round(value)));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    drag.current = { start: event.clientY, size: paintedRef.current };
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    document.documentElement.classList.add("is-resizing");

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || !drag.current) return;
      const next = clamp(drag.current.size - (ev.clientY - drag.current.start));
      paintedRef.current = next;
      paintRef.current(next);
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      drag.current = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commitRef.current(clamp(paintedRef.current));
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("Resize graph")}
      aria-valuenow={height}
      className={`z-10 h-1.5 shrink-0 cursor-row-resize touch-none ${
        dragging ? "bg-content/15" : "hover:bg-content/10"
      }`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commitRef.current(clamp(GRAPH_PANEL_DEFAULT))}
    />
  );
}
