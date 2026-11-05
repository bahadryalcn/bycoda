import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Sash } from "../../../shared/ui/Sash";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import graphLayout from "./GitGraphLayout.module.css";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitBranch, Maximize2, Search, RefreshCw } from "../../../shared/ui/icons";
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
import { ExplorerMenu } from "../../files/public/ExplorerMenu";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { GIT_ACTIONS, useRemoteSupports } from "../../connections/public/remoteCapabilities";
import { reportRemoteLoad, useRemoteLoadFailure } from "../../connections/public/remoteHealth";
import { RemoteLoadError } from "../../connections/public/RemoteLoadError";
import { commitMenuItems, filterHistory, githubCommitUrl } from "../model/commitActions";
import { layoutGitGraph } from "../model/gitGraph";
import { GitGraphDialog } from "./GitGraphDialog";
import { GitGraphList, type GraphListItem } from "./GitGraphList";
import { GraphSearchInput } from "./GitGraphParts";
import { RefNameDialog } from "./RefNameDialog";
import { useGitResource } from "../hooks/useGitResource";
import { GitFeedback, GitLoading } from "./GitFeedback";
import { confirmGitAction } from "../model/gitConfirmation";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { copyText } from "../../../platform/tauri/clipboard";
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

import { EMPTY_HISTORY_FILTERS, matchesHistoryFilters } from "../model/gitHistoryFilters";

const HISTORY_PAGE = 200;

export function GitHistoryGraph({
  cwd,
  enabled,
  expanded,
  selectedSha,
  onToggleExpanded,
  onOpenCommit,
}: Props) {
  useLocale();
  const { copyAsync } = useCopyFeedback({ resetKeys: [cwd], successMs: 1200 });
  // Commit actions and the wider scope need this computer or a host with `git.actions`.
  const actions = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const stateKey = `git-history:${pathKey(cwd)}`;
  const [showAll, setShowAll] = useRetainedState(`${stateKey}:all`, false);
  const [fullShowAll, setFullShowAll] = useRetainedState(`${stateKey}:full-all`, true);
  const [limit, setLimit] = useRetainedState(`${stateKey}:limit:${showAll}`, HISTORY_PAGE);
  const [searchOpen, setSearchOpen] = useRetainedState(`${stateKey}:search`, false);
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const deferredQuery = useDeferredValue(query);
  const [columnFilters, setColumnFilters] = useRetainedState(
    `${stateKey}:columns`,
    EMPTY_HISTORY_FILTERS,
  );
  const [fullOpen, setFullOpen] = useState(false);
  const columnsActive = fullOpen && Object.values(columnFilters).some((value) => value.trim());
  const [fullCommit, setFullCommit] = useState<GitHistoryCommit | null>(null);
  const [commitMode, setCommitMode] = useState<"changes" | "blame">("changes");
  const [resolutionDirty, setResolutionDirty] = useState(false);
  const [resolutionReset, setResolutionReset] = useState(0);
  const { commits, failure, loading, error, refresh } = useGitHistory(
    cwd,
    enabled && (expanded || fullOpen),
    actions && (fullOpen ? fullShowAll : showAll),
    limit,
  );
  const [busy] = useGitPanelState(cwd, "busy");
  const rows = useMemo(() => layoutGitGraph(commits), [commits]);
  const rowBySha = useMemo(
    () => new Map(commits.map((commit, index) => [commit.sha, rows[index]])),
    [commits, rows],
  );
  // The full-graph dialog has its own search field bound to the same query.
  const searching = (searchOpen || fullOpen) && deferredQuery.trim() !== "";
  const items = useMemo(() => {
    const visible = searching ? filterHistory(commits, deferredQuery) : commits;
    return visible
      .filter((commit) => !columnsActive || matchesHistoryFilters(commit, columnFilters))
      .flatMap((commit): GraphListItem[] => {
        const row = rowBySha.get(commit.sha);
        return row ? [{ commit, row }] : [];
      });
  }, [commits, deferredQuery, searching, rowBySha, columnsActive, columnFilters]);
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
        const confirmed = await confirmGitAction({
          title: t("Hard reset to {p0}?", { p0: commit.shortSha }),
          message: t(
            "The current branch moves to {p0} and all uncommitted changes are discarded. This can’t be undone.",
            { p0: commit.shortSha },
          ),
          confirmLabel: t("Hard reset"),
        });
        if (confirmed) await run(() => gitReset(cwd, sha, "hard"));
        return;
      }
      case "copy-sha":
        if (!(await copyAsync(() => copyText(sha), { parallel: true }))) {
          throw new Error(t("Clipboard write failed."));
        }
        return;
      case "copy-message":
        if (
          !(await copyAsync(async () => copyText((await gitCommitMessage(cwd, sha)).trimEnd()), {
            parallel: true,
          }))
        ) {
          throw new Error(t("Clipboard write failed."));
        }
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
    <Button
      size="sm"
      iconOnly
      label={t("Show all branches")}
      tooltip={showAll ? t("Showing all branches") : t("Show all branches")}
      variant="ghost"
      motion="none"
      type="button"
      aria-pressed={showAll}
      onClick={() => {
        setShowAll(!showAll);
      }}
    >
      <GitBranch className="icon-sm" strokeWidth={1.75} />
    </Button>
  ) : null;

  const discardResolution = async () => {
    if (
      resolutionDirty &&
      !(await confirmGitAction({
        title: t("Discard conflict resolution?"),
        message: t("Your unsaved edits to the conflict resolution will be discarded."),
        confirmLabel: t("Discard"),
      }))
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
        <EmptyState
          size="inline"
          kind="empty"
          className="px-3"
          description={t("No project folder")}
        />
      ) : commits.length === 0 ? (
        loading ? (
          <GitLoading text="Loading commit graph…" />
        ) : error || failure ? (
          <EmptyState
            size="inline"
            kind="unavailable"
            className="px-3"
            description={t("Commit history unavailable")}
            onRetry={refresh}
          />
        ) : (
          <EmptyState
            size="inline"
            kind="empty"
            className="px-3"
            description={t("No commits yet")}
          />
        )
      ) : items.length === 0 ? (
        <EmptyState
          size="inline"
          kind="filtered"
          className="px-3"
          description={
            <>
              {t("No matching commits in the ")}
              {commits.length}
              {t(" loaded")}
            </>
          }
        />
      ) : undefined;
    const graph = (
      <GitGraphList
        variant={variant}
        items={items}
        plain={searching || columnsActive}
        filters={variant === "workspace" ? columnFilters : undefined}
        onFilters={setColumnFilters}
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

  // Inside the Commit Graph dialog the menu must open in the dialog's popover layer,
  // otherwise the modal covers it.
  const commitMenu = menu ? (
    <ExplorerMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={t("Commit actions")}
      width={264}
      header={
        <div className="px-2 py-1.5 text-ui-caption text-(--ui-text-secondary)">
          <code className="mr-2">{menu.commit.shortSha}</code>
          <span className="block truncate text-content">{menu.commit.subject}</span>
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
  ) : null;
  return (
    <div aria-busy={loading} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <SectionLabel
        className={expanded ? "px-1.5" : "h-full px-1.5"}
        collapsible
        expanded={expanded}
        onExpandedChange={onToggleExpanded}
        actions={
          expanded ? (
            <>
              <Button
                size="sm"
                iconOnly
                label={t("Refresh commit graph")}
                variant="ghost"
                motion="none"
                type="button"
                loading={loading}
                loadingLabel={t("Refreshing…")}
                onClick={refresh}
              >
                <RefreshCw className="icon-sm" />
              </Button>
              {showAllButton}
              <Button
                size="sm"
                iconOnly
                label={t("Search commits")}
                variant="ghost"
                motion="none"
                type="button"
                aria-pressed={searchOpen}
                onClick={() => {
                  setSearchOpen((open) => !open);
                  setQuery("");
                }}
              >
                <Search className="icon-sm" strokeWidth={1.75} />
              </Button>
              {cwd && cwd !== "~" ? (
                <Button
                  size="sm"
                  iconOnly
                  label={t("Open full graph")}
                  variant="ghost"
                  motion="none"
                  type="button"
                  onClick={() => setFullOpen(true)}
                >
                  <Maximize2 className="icon-sm" strokeWidth={1.75} />
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {t("Graph")}
      </SectionLabel>
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
              <Button
                size="sm"
                iconOnly
                label={t("Refresh full commit graph")}
                tooltip={t("Refresh commit graph")}
                variant="ghost"
                motion="none"
                type="button"
                loading={loading}
                loadingLabel={t("Refreshing…")}
                onClick={() => {
                  refresh();
                  notifyGitChanged(cwd, "refs");
                }}
              >
                <RefreshCw className="icon-sm" />
              </Button>
              <div className={graphLayout.search}>
                <GraphSearchInput value={query} onChange={setQuery} />
              </div>
              {actions ? (
                <div className={graphLayout.scope}>
                  <SegmentedControl
                    label={t("History scope")}
                    value={fullShowAll ? "all" : "current"}
                    options={[
                      { value: "current", label: t("Current branch") },
                      { value: "all", label: t("All branches") },
                    ]}
                    onValueChange={(value) => setFullShowAll(value === "all")}
                  />
                </div>
              ) : null}
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
          {commitMenu}
        </GitGraphDialog>
      ) : null}
      {fullOpen ? null : commitMenu}
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
  const start = useRef(height);
  const clamp = (value: number) =>
    Math.min(maxHeight(), Math.max(GRAPH_PANEL_MIN, Math.round(value)));
  // Dragging up grows the graph panel: its sash sits above it.
  return (
    <Sash
      orientation="horizontal"
      label={t("Resize graph")}
      value={height}
      min={GRAPH_PANEL_MIN}
      appearance="hidden"
      onResizeStart={() => {
        start.current = height;
      }}
      onResize={(delta) => onHeightPaint(clamp(start.current - delta))}
      onResizeEnd={(delta, { cancelled }) => {
        const next = clamp(cancelled ? start.current : start.current - delta);
        onHeightPaint(next);
        onHeightCommit(next);
      }}
      onReset={() => {
        const next = clamp(GRAPH_PANEL_DEFAULT);
        onHeightPaint(next);
        onHeightCommit(next);
      }}
    />
  );
}
