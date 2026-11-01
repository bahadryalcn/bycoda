import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import "./InboxView.css";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { filterCodeHostScopes, useCodeHostScopes } from "../model/codeHostScopes";
import { prefetchInboxItem } from "../model/inboxPrefetch";
import { t, useLocale } from "../../../shared/i18n";
import { useInboxCollection } from "../hooks/useInboxCollection";
import { useProviderConnections } from "../hooks/useProviderConnections";
import { useInboxProviderScopes } from "../hooks/useInboxProviderScopes";
import { useInboxSourceSelection } from "../hooks/useInboxSourceSelection";
import { useGithubWorkItem } from "../hooks/useGithubWorkItem";
import { useLinkedTarget, useLinkedTargetItem } from "../hooks/useLinkedTarget";
import { visibleInboxItems } from "../model/inboxVisibleItems";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronsUpDown,
  ChevronLeft,
  CheckCheck,
  CircleX,
  ExternalLink,
  Inbox,
  MessageMultiple,
  Plus,
  RefreshCw,
  Search,
  X,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useContext,
  useDeferredValue,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { InboxFiltersMenu, INBOX_FILTER_MENU_WIDTH } from "./InboxFiltersMenu";
import { InboxConnectMenu } from "./InboxConnectMenu";
import { JiraBoardView } from "./JiraBoardView";
import type { JiraBoardIssue } from "../model/jiraBoard";
import { WORKSPACE_REFRESH_EVENT } from "../../../app/shell/WorkspaceControls";
import { InboxProviderMark } from "./InboxProviderMark";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  inboxProjectsForRail,
  formatRelativeTime,
  type InboxItem,
  type InboxQuery,
} from "../model/githubTasks";
import {
  connectableInboxSources,
  hasActiveInboxFilters,
  loadInboxConnections,
  linearProjectOptions,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
  saveInboxFilters,
  saveInboxConnections,
  DEFAULT_INBOX_FILTERS,
  visibleInboxSources,
  INBOX_SOURCE_LABELS,
  isTrackerSource,
  type ConnectableInboxSource,
  type InboxFilters,
  type InboxSource,
} from "../model/inboxFilters";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
import { IS_MAC } from "../../../platform/tauri/platform";
import { type RecentProject } from "../../projects/model/recents";
import { type LinkedWorkItem } from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  linkedWorkItemInboxKey,
  relatedSessionsForInboxItem,
} from "../../sessions/model/sessionWorkItem";
import {
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  useInboxSeenTick,
} from "../model/inboxSeen";
import { LIST_PAGE_SIZE, listWindowSize } from "../../../shared/lib/listWindow";
import { saveHiddenLinearTeamIds } from "../model/linear";
import { saveHiddenJiraProjectIds } from "../model/jira";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { InboxDiscussionPanel, type InboxSessionPortal } from "./InboxDiscussionPanel";
import { inboxAskKey } from "../model/inboxAsk";
import { InboxDetail } from "./InboxDetail";
import {
  InboxProjectOption,
  inboxProjectOptions,
  inboxStatusMark,
  InboxLabel,
  CiRepairProps,
} from "./InboxPresentation";
export { InboxDetail, inboxShowsFullFileDiff } from "./InboxDetail";
export { GithubPrActions } from "./InboxPrActions";
export { inboxStatusMark } from "./InboxPresentation";

const MIN_WIDTH = 240;

const MAX_WIDTH = 420;

const DEFAULT_WIDTH = 320;

const LINKED_PANEL_MIN_WIDTH = 360;

const LINKED_PANEL_DEFAULT_WIDTH = 520;

let rememberedWidth = DEFAULT_WIDTH;

let rememberedLinkedPanelWidth = LINKED_PANEL_DEFAULT_WIDTH;

function InboxSourceTab({
  source,
  selected,
  onSelect,
}: {
  source: InboxSource;
  selected: boolean;
  onSelect: (source: InboxSource) => void;
}) {
  useLocale();
  const label = INBOX_SOURCE_LABELS[source];
  return (
    <Tab
      value={source}
      // Choosing the current source again still returns to its list (clears the open item).
      onClick={() => {
        if (selected) onSelect(source);
      }}
    >
      <span className="flex items-center gap-1.5">
        <InboxProviderMark provider={source} className="block icon-sm shrink-0" />
        <span className="leading-none">{label}</span>
      </span>
    </Tab>
  );
}

type Props = {
  pullRequestsOnly?: boolean;
  onOpenProject?: () => void | Promise<void>;
  onAsk: (item: InboxItem) => Promise<string>;
  onAskRestart: (item: InboxItem) => Promise<string>;
  onAskMount: (portal: InboxSessionPortal | null) => void;
  cwd: string;
  recents: RecentProject[];
  besideRail?: boolean;
  compactRail?: boolean;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  sessions?: readonly SessionSummary[];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  /** Session-card destination to reveal after the Inbox list loads. */
  target?: LinkedWorkItem | null;
  /** Opens Settings on the card where the given source is connected. */
  onOpenIntegrations: (source: ConnectableInboxSource) => void;
};

export function InboxView({
  pullRequestsOnly = false,
  onOpenProject,
  onAsk,
  onAskRestart,
  onAskMount,
  cwd,
  recents,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onStart,
  repairSessions,
  onRepairChecks,
  sessions = [],
  onOpenSession,
  target = null,
  onOpenIntegrations,
}: Props) {
  useLocale();
  // Inside the workspace the tool switcher takes the title place.
  const toolNavigation = useContext(ToolNavigationContext)?.active != null;
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const viewStateKey = `inbox:${pullRequestsOnly ? "pull-requests" : "all"}:${projectKey(cwd)}`;
  const listLock = useLockOverscroll<HTMLDivElement>();
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const [retainedSearch, setRetainedSearch] = useRetainedState(`${viewStateKey}:search`, "");
  const queryVisible = useQueryVisible();
  const [refreshAction, setRefreshAction] = useState<"toolbar" | "retry" | null>(null);
  const refreshActionRef = useRef<"toolbar" | "retry" | null>(null);
  const [readStatusError, setReadStatusError] = useState<string | null>(null);
  const [failedReadItem, setFailedReadItem] = useState<InboxItem | null>(null);
  const [refresh, setRefresh] = useState(0);
  const requestRefresh = (action: "toolbar" | "retry", retryFailedOnly = false) => {
    if (refreshActionRef.current) return;
    refreshActionRef.current = action;
    collection.setRetryFailedOnly(retryFailedOnly);
    setRefreshAction(action);
    setRefresh((value) => value + 1);
  };
  const [detailOpen, setDetailOpen] = useState(false);
  const [jiraView, setJiraView] = useRetainedState<"list" | "board">(
    `${viewStateKey}:jira-view`,
    "list",
  );
  const [boardIssue, setBoardIssue] = useState<JiraBoardIssue | null>(null);
  const boardIssueOrigin = useRef<HTMLElement | null>(null);
  const closeBoardIssue = () => {
    setBoardIssue(null);
    requestAnimationFrame(() => {
      if (boardIssueOrigin.current?.isConnected) boardIssueOrigin.current.focus();
    });
  };
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
  }, []);
  // Provider status reads (mount and provider-change events) are generation
  // guarded in useProviderConnections: opening Settings unmounts this view, so a
  // token set there lands on the way back in, and only the newest read writes
  // the last-known copy used to seed the next mount.
  const { connections } = useProviderConnections(loadInboxConnections, saveInboxConnections);
  const { source, selectSource, revealSource } = useInboxSourceSelection({
    pullRequestsOnly,
    connections,
  });
  const {
    linearScope,
    linearHiddenTeamIds,
    linearTeams,
    jiraScope,
    jiraHiddenProjectIds,
    jiraProjects,
    jiraAutomaticSync,
  } = useInboxProviderScopes({
    source,
    onScopeChange: () => setRefresh((value) => value + 1),
  });
  const linked = useLinkedTarget({
    target,
    onReveal: () => {
      revealSource("github");
      setDetailOpen(true);
    },
  });
  const { targetSelectionKey } = linked;
  const searchInput = linked.searchPinned ? "" : retainedSearch;
  const deferredSearch = useDeferredValue(searchInput);
  const [retainedKey, setSelectedKey] = useRetainedState<string | null>(
    `${viewStateKey}:${source}:selected`,
    targetSelectionKey,
  );
  // The selection stays the user's own choice; a linked target only pins it.
  const selectedKey = linked.pinnedKey ?? retainedKey;
  /** Hands the pinned target over to the user's retained selection and search. */
  const releaseTarget = () => {
    if (!linked.pinnedKey) return;
    setSelectedKey(linked.pinnedKey);
    setRetainedSearch("");
    linked.releaseTarget();
  };
  const setSearchInput = (value: string) => {
    releaseTarget();
    setRetainedSearch(value);
  };
  const [filters, setFilters] = useState(() => {
    const saved = loadInboxFilters();
    return pullRequestsOnly
      ? { ...saved, hiddenKinds: saved.hiddenKinds.filter((kind) => kind !== "pr") }
      : saved;
  });
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [prSort, setPrSort] = useRetainedState(`${viewStateKey}:pr-sort`, "updated");
  const codeScopes = useCodeHostScopes(source, refresh);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);

  const projects = useMemo(() => inboxProjectsForRail(recents, cwd), [cwd, recents]);
  const projectOptions = useMemo(() => inboxProjectOptions(projects, logos), [logos, projects]);
  const activeFilters = useMemo(
    () =>
      pruneInboxFilters(
        filters,
        projects.map((project) => project.path),
      ),
    [filters, projects],
  );
  const listScope = `${viewStateKey}:${JSON.stringify([source, activeFilters, jiraScope, linearScope, searchInput])}`;
  const [listLimit, setListLimit] = useRetainedState(`${listScope}:list-limit`, LIST_PAGE_SIZE);
  const filtersActive =
    codeScopes.hidden.length > 0 ||
    hasActiveInboxFilters(activeFilters, source, linearHiddenTeamIds, jiraHiddenProjectIds);
  // One count per narrowed dimension (assignment, scope, kind, time, status); the same
  // dimensions the filter menu's own "Clear filters" resets.
  const statusFiltered = isTrackerSource(source)
    ? activeFilters.status.open || activeFilters.status.closed
    : Object.values(activeFilters.status).some(Boolean);
  const filterCount =
    (activeFilters.assignedToMe ? 1 : 0) +
    (source === "linear" && linearHiddenTeamIds.length > 0 ? 1 : 0) +
    (source === "jira" && jiraHiddenProjectIds.length > 0 ? 1 : 0) +
    ((source === "linear"
      ? activeFilters.hiddenLinearProjects.length
      : source === "jira"
        ? 0
        : activeFilters.hiddenProjects.length) > 0
      ? 1
      : 0) +
    (codeScopes.hidden.length > 0 ? 1 : 0) +
    (!isTrackerSource(source) && activeFilters.hiddenKinds.length > 0 ? 1 : 0) +
    (activeFilters.time !== "all" ? 1 : 0) +
    (statusFiltered ? 1 : 0);
  const resetFilters = () => {
    onFiltersChange(DEFAULT_INBOX_FILTERS);
    if (source === "linear" && linearHiddenTeamIds.length > 0) saveHiddenLinearTeamIds([]);
    if (source === "jira" && jiraHiddenProjectIds.length > 0) saveHiddenJiraProjectIds([]);
    if (codeScopes.hidden.length > 0) codeScopes.save([]);
  };
  // Search, filters and mark-as-read only mean something once there is something to narrow or mark.
  const narrowed = filtersActive || searchInput.trim().length > 0;
  const resetNarrowing = () => {
    resetFilters();
    setSearchInput("");
  };
  const fetchState = inboxFetchState(activeFilters);
  const fetchQuery = useMemo<InboxQuery>(
    () => ({
      assignedToMe: activeFilters.assignedToMe,
      state: fetchState,
      search: "",
      githubKinds: source !== "github" ? [] : pullRequestsOnly ? ["pr"] : undefined,
      linearHiddenTeamIds: linearScope ?? undefined,
      jiraHiddenProjectIds: jiraScope ?? undefined,
      jiraEnabled: source === "jira" && jiraView === "list",
    }),
    [
      activeFilters.assignedToMe,
      pullRequestsOnly,
      source,
      jiraView,
      fetchState,
      linearScope,
      jiraScope,
    ],
  );

  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasActiveOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      if (filterMenu) {
        setFilterMenu(null);
        return;
      }
      if (connectMenuOpen) {
        setConnectMenuOpen(false);
        return;
      }
      onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [connectMenuOpen, filterMenu]);

  const visibleSources = visibleInboxSources(connections).filter(
    (source) => !pullRequestsOnly || !isTrackerSource(source),
  );
  const connectableSources = connectableInboxSources(connections);
  const sourceAvailable = visibleSources.includes(source);
  const noSourcesConnected = visibleSources.length === 0;

  const collection = useInboxCollection({
    projects,
    fetchQuery,
    enabled: queryVisible,
    automaticRefresh: !(source === "jira" && !jiraAutomaticSync),
    refresh,
    onRefreshSettled: () => {
      refreshActionRef.current = null;
      setRefreshAction(null);
    },
  });
  const { items, providerErrors, loading } = collection;
  const showCollectionTools = loading || items.length > 0 || narrowed;
  const linearProjects = useMemo(() => linearProjectOptions(items), [items]);

  const { targetItem, patchTargetItem } = useLinkedTargetItem({ target, cwd, items });

  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions)
      if (session.linkedWorkItem) {
        const key = linkedWorkItemInboxKey(session.linkedWorkItem);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    return counts;
  }, [sessions]);
  const selectItem = useStableCallback((item: InboxItem) => {
    const key = inboxItemKey(item);
    const saved = markInboxItemSeen({ key, updatedAt: item.updatedAt });
    setFailedReadItem(saved ? null : item);
    setReadStatusError(saved ? null : "Could not save read status. Please try again.");
    releaseTarget();
    setSelectedKey(key);
    setDetailOpen(true);
  });
  const {
    provider: codeScopesProvider,
    scopes: codeScopesLoaded,
    hidden: codeScopesHidden,
  } = codeScopes;
  const visibleItems = useMemo(
    () =>
      visibleInboxItems({
        items,
        pullRequestsOnly,
        prSort,
        filters: activeFilters,
        search: deferredSearch,
        source,
        sourceAvailable,
        codeScopes: {
          provider: codeScopesProvider,
          scopes: codeScopesLoaded,
          hidden: codeScopesHidden,
        },
        target,
        targetItem,
        now: Date.now(),
      }),
    [
      pullRequestsOnly,
      prSort,
      activeFilters,
      items,
      deferredSearch,
      source,
      sourceAvailable,
      target,
      targetItem,
      codeScopesProvider,
      codeScopesLoaded,
      codeScopesHidden,
    ],
  );

  const inboxSeenTick = useInboxSeenTick();
  const sourceEntries = useMemo(
    () =>
      sourceAvailable
        ? items
            .filter((item) => item.provider === source)
            .map((item) => ({
              key: inboxItemKey(item),
              updatedAt: item.updatedAt,
            }))
        : [],
    [items, source, sourceAvailable],
  );
  const sourceHasUnseen = useMemo(
    () => sourceEntries.some(isInboxEntryUnseen),
    [inboxSeenTick, sourceEntries],
  );

  const sourceError = providerErrors[source] ?? null;
  // Full pages mean older items may not be loaded; the list reads have no total.
  const sourceLimited = collection.limited?.includes(source) ?? false;

  // Local filters cannot retarget an open public-comment composer. Resolve the
  // selected identity from allowed loaded data before considering a default.
  const allowedItems = sourceAvailable ? filterCodeHostScopes(
    items.filter((item) => item.provider === source),
    codeScopes.provider, codeScopes.scopes, codeScopes.hidden,
  ) : [];
  const selectedByKey = allowedItems.find((item) => inboxItemKey(item) === selectedKey)
    ?? visibleItems.find((item) => inboxItemKey(item) === selectedKey);
  const waitingForTarget = !!targetSelectionKey && selectedKey === targetSelectionKey;
  const selected = selectedByKey ?? (waitingForTarget || selectedKey ? null : visibleItems[0]) ?? null;
  const selectedOutsideFilters = !!selected && !visibleItems.some((entry) => inboxItemKey(entry) === inboxItemKey(selected));
  const { updateItem } = collection;
  const updateInboxItem = useCallback(
    (next: InboxItem) => {
      updateItem(next);
      patchTargetItem(next);
    },
    [updateItem, patchTargetItem],
  );
  const shownItemCount = listWindowSize(visibleItems.length, listLimit);
  const shownItems = visibleItems.slice(0, shownItemCount);
  const hasMoreItems = shownItemCount < visibleItems.length;
  const retainedListScroll = useRetainedScroll<HTMLDivElement>(listScope, { ready: !loading });
  const setListScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      listLock(element);
      retainedListScroll(element);
      listScrollRef.current = element;
    },
    [listLock, retainedListScroll],
  );
  useEffect(() => {
    if (!hasMoreItems) return;
    const sentinel = loadMoreRef.current;
    const root = listScrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setListLimit((current) => current + LIST_PAGE_SIZE);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreItems, shownItemCount]);

  const onFiltersChange = (next: InboxFilters) => {
    const pruned = pruneInboxFilters(
      next,
      projects.map((project) => project.path),
    );
    setFilters(pruned);
    if (!pullRequestsOnly) saveInboxFilters(pruned);
  };

  const onSourceChange = (next: InboxSource) => {
    setDetailOpen(false);
    releaseTarget();
    setSelectedKey(null);
    setBoardIssue(null);
    selectSource(next);
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterMenu({
      x: rect.right - INBOX_FILTER_MENU_WIDTH,
      y: rect.bottom + 2,
    });
  };

  const sourceRow = (
    <div className="flex h-9 shrink-0 items-center gap-px px-2">
      {visibleSources.length > 0 ? (
        <Tabs value={source} onValueChange={onSourceChange} panels="none">
          <TabList
            label={t("Inbox source")}
            className="min-w-0 basis-0"
            style={{ flexGrow: visibleSources.length }}
          >
            {visibleSources.map((option) => (
              <InboxSourceTab
                key={option}
                source={option}
                selected={source === option}
                onSelect={onSourceChange}
              />
            ))}
          </TabList>
        </Tabs>
      ) : null}
      {connectableSources.length > 0 ? (
        <Button
          iconOnly
          label={t("Connect an inbox source")}
          variant="ghost"
          ref={connectButtonRef}
          type="button"
          aria-label={t("Connect an inbox source")}
          aria-haspopup="menu"
          aria-expanded={connectMenuOpen}
          onClick={() => setConnectMenuOpen((open) => !open)}
        >
          <Plus className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );

  const viewRow =
    source === "jira" ? (
      <div className="flex shrink-0 items-center gap-2 px-2 py-1">
        <SegmentedControl label={t("Jira view")} selectionRole="pressed" value={jiraView}
          onValueChange={(next) => setJiraView(next === "board" ? "board" : "list")}
          options={[{ value: "list", label: t("List") }, { value: "board", label: t("Board") }]} />
      </div>
    ) : !pullRequestsOnly && source === "github" ? (
      <div className="flex shrink-0 items-center px-2 py-1">
        <SegmentedControl label={t("Type")} value={activeFilters.hiddenKinds.length >= 2 ? "" : activeFilters.hiddenKinds.length === 0 ? "all" : activeFilters.hiddenKinds.includes("issue") ? "pr" : "issue"}
          onValueChange={(next) => onFiltersChange({ ...activeFilters, hiddenKinds: next === "all" ? [] : next === "pr" ? ["issue"] : ["pr"] })}
          options={[{ value: "all", label: t("All") }, { value: "pr", label: t("Pull requests") }, { value: "issue", label: t("Issues") }]} />
      </div>
    ) : null;

  const list = (
    <div
      ref={resize.setPaneRef}
      className="inbox-list-panel relative flex h-full min-h-0 shrink-0 flex-col border-r border-(--ui-pane-border) bg-(--ui-surface-panel)"
    >
      {sourceRow}
      {viewRow}
      {noSourcesConnected ? null : (
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          {showCollectionTools ? (
          <>
          <SearchInputGroup appearance="field" className="min-w-0 flex-1">
            <Search className="pointer-events-none icon-xs shrink-0 text-(--ui-text-secondary)" />
            <SearchInput
              focusOwner="group"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("Filter loaded items")}
              aria-label={t("Filter loaded items")}
              spellCheck={false}
              autoComplete="off"
            />
          </SearchInputGroup>
          {pullRequestsOnly ? (
            <>
              <Button
                iconOnly
                ref={sortButtonRef}
                label={t("Sort pull requests")}
                variant="ghost"
                type="button"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                onClick={() => setSortMenuOpen((open) => !open)}
              >
                <ChevronsUpDown className="icon-xs" strokeWidth={1.75} />
              </Button>
              {sortMenuOpen ? (
                <DropdownMenu
                  anchor={sortButtonRef}
                  label={t("Sort pull requests")}
                  returnFocusRef={sortButtonRef}
                  onClose={() => setSortMenuOpen(false)}
                  items={[
                    {
                      kind: "item",
                      id: "updated",
                      label: t("Recently updated"),
                      checked: prSort !== "title",
                      selectionRole: "radio",
                    },
                    {
                      kind: "item",
                      id: "title",
                      label: t("Title"),
                      checked: prSort === "title",
                      selectionRole: "radio",
                    },
                  ]}
                  onPick={(id) => {
                    setPrSort(id);
                    setSortMenuOpen(false);
                  }}
                />
              ) : null}
            </>
          ) : null}
          <FilterTrigger
            label={filtersActive ? t("Filter inbox (filters active)") : t("Filter inbox")}
            activeCount={filterCount}
            onReset={resetFilters}
            resetLabel={t("Clear filters")}
            aria-expanded={!!filterMenu}
            aria-haspopup="menu"
            onClick={onFilterButtonClick}
          />
          <Button
            iconOnly
            label={t("Mark loaded {p0} items as read", { p0: INBOX_SOURCE_LABELS[source] })}
            variant="ghost"
            type="button"
            aria-label={t("Mark loaded {p0} items as read", { p0: INBOX_SOURCE_LABELS[source] })}
            disabled={!sourceHasUnseen}
            onClick={() => {
              setFailedReadItem(null);
              setReadStatusError(
                markInboxItemsSeen(sourceEntries)
                  ? null
                  : "Could not save read status. Please try again.",
              );
            }}
            className="shrink-0"
          >
            <CheckCheck className="icon-sm" strokeWidth={1.75} />
          </Button>
          </>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <Button
            iconOnly
            label={t("Refresh")}
            variant="ghost"
            type="button"
            aria-label={t("Refresh")}
            loading={refreshAction === "toolbar"}
            disabled={refreshAction === "retry"}
            onClick={() => requestRefresh("toolbar")}
            className="shrink-0"
          >
            <RefreshCw className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
      )}
      {readStatusError ? (
        <Alert tone="danger" role="alert">
          {readStatusError}
          {failedReadItem ? (
            <Button
              data-inbox-read-retry
              variant="secondary"
              onClick={() => selectItem(failedReadItem)}
            >
              {t("Retry")}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {sourceError && visibleItems.length > 0 ? (
        <Alert tone="warning" role="alert" action={
          <Button loading={refreshAction === "retry"} disabled={refreshAction === "toolbar"} onClick={() => requestRefresh("retry", source === "github")}>{t("Retry")}</Button>
        }>
          <span className="whitespace-pre-wrap wrap-anywhere">{sourceError}</span>
        </Alert>
      ) : null}
      <div ref={setListScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {noSourcesConnected ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            description={
              pullRequestsOnly
                ? t("Connect GitHub, GitLab or Azure DevOps to view pull requests.")
                : t("Add a connection to start using the Inbox.")
            }
            action={
              connectableSources.length > 0 ? (
                <Button variant="secondary" type="button" onClick={() => setConnectMenuOpen(true)}>
                  {t("Connect an inbox source")}
                </Button>
              ) : undefined
            }
          />
        ) : sourceError && visibleItems.length === 0 ? (
          <EmptyState
            icon={<CircleX aria-hidden="true" />}
            description={sourceError}
            action={
              <Button
                variant="secondary"
                type="button"
                loading={refreshAction === "retry"}
                disabled={refreshAction === "toolbar"}
                onClick={() => requestRefresh("retry", source === "github")}
              >
                {t("Refresh")}
              </Button>
            }
          />
        ) : loading && items.length === 0 ? (
          <LoadingText className="justify-center py-10" />
        ) : visibleItems.length === 0 ? (
          !pullRequestsOnly && !isTrackerSource(source) && projects.length === 0 ? (
            <EmptyState
              kind="empty"
              icon={<Inbox aria-hidden="true" />}
              description={t("Open a project to fill the inbox")}
              action={
                onOpenProject ? (
                  <Button variant="secondary" type="button" onClick={() => void onOpenProject()}>
                    {t("Add project")}
                  </Button>
                ) : undefined
              }
            />
          ) : pullRequestsOnly && projects.length === 0 ? (
            <EmptyState
              kind="empty"
              icon={<Inbox aria-hidden="true" />}
              description={t("Add a project to see its repository's pull requests.")}
            />
          ) : narrowed ? (
            <EmptyState
              kind="filtered"
              icon={<Inbox aria-hidden="true" />}
              description={t("No loaded items match these filters.")}
              onReset={resetNarrowing}
              resetLabel={t("Clear filters")}
            />
          ) : (
            <EmptyState
              kind="empty"
              icon={<Inbox aria-hidden="true" />}
              description={t("No items to show.")}
            />
          )
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {shownItems.map((item) => {
              const key = inboxItemKey(item);
              const projectId = projectKey(item.projectPath);
              const relatedSessionCount = sessionCounts.get(key) ?? 0;
              return (
                <li key={key}>
                  <InboxCard
                    item={item}
                    active={selected != null && key === inboxItemKey(selected)}
                    logoPath={resolveTabGroupLogo(projectId, logos)}
                    mascotName={resolveTabGroupMascot(projectId, groupMascots)}
                    mascotColor={resolveTabGroupColor(
                      projectId,
                      groupColors,
                      groupCustomColors,
                      projectName(item.projectPath),
                    )}
                    relatedSessionCount={relatedSessionCount}
                    onSelect={selectItem}
                  />
                </li>
              );
            })}
            {hasMoreItems ? (
              <li ref={loadMoreRef} className="list-none">
                <Button fullWidth onClick={() => setListLimit((current) => current + LIST_PAGE_SIZE)}>{t("Load more items")}</Button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
      {noSourcesConnected || visibleItems.length === 0 ? null : (
        <div
          role="status"
          data-inbox-list-status
          className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-ui-micro tabular-nums text-(--ui-text-secondary)"
        >
          <span title={t("{p0} loaded", { p0: visibleItems.length })}>
            {t("{p0} loaded", { p0: visibleItems.length })}
            {hasMoreItems ? ` · ${t("{p0} shown", { p0: shownItems.length })}` : ""}
            {sourceLimited ? (
              <span
                data-inbox-list-limit
                title={t("The provider returned a full page. Older items may not be loaded, and no total is available.")}
              >
                {` · ${t("Limit reached")}`}
              </span>
            ) : null}
          </span>
          {sourceError ? <span className="text-(--ui-tone-warning-fg)">{t("Partial")}</span> : null}
        </div>
      )}
      <Sash
        {...resize.sashProps}
        appearance="hidden"
        label={t("Resize inbox list")}
        className="absolute inset-y-0 -right-px"
      />
    </div>
  );

  const filtersPortal = filterMenu ? (
    <InboxFiltersMenu
      codeHostProjects={codeScopes.scopes?.projects}
      hiddenCodeHostProjects={codeScopes.hidden}
      codeHostError={codeScopes.error}
      onCodeHostProjectsChange={codeScopes.save}
      x={filterMenu.x}
      y={filterMenu.y}
      projects={projectOptions}
      linearProjects={linearProjects}
      linearTeams={linearTeams}
      hiddenLinearTeamIds={linearHiddenTeamIds}
      jiraProjects={jiraProjects}
      hiddenJiraProjectIds={jiraHiddenProjectIds}
      source={source}
      filters={activeFilters}
      onChange={onFiltersChange}
      onLinearTeamsChange={saveHiddenLinearTeamIds}
      onJiraProjectsChange={saveHiddenJiraProjectIds}
      onClose={() => setFilterMenu(null)}
    />
  ) : null;

  const connectPortal =
    connectMenuOpen && connectableSources.length > 0 ? (
      <InboxConnectMenu
        anchor={connectButtonRef}
        sources={connectableSources}
        onConnect={onOpenIntegrations}
        onClose={() => setConnectMenuOpen(false)}
      />
    ) : null;

  return (
    <div
      role="region"
      aria-label={t("Inbox")}
      data-app-inbox
      className="bycoda-inbox flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
    >
      <PaneHeader
        chromeInset={besideRail ? (compactRail ? "compact" : false) : true}
        dragRegion
        leading={besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        icon={toolNavigation ? undefined : <Inbox strokeWidth={1.75} />}
        title={toolNavigation ? undefined : pullRequestsOnly ? t("Pull Requests") : t("Inbox")}
        titleAs="h1"
        trailing={IS_MAC ? null : <WindowControls />}
        className={toolNavigation ? "items-stretch" : undefined}
      >
        {toolNavigation ? <ToolNavigation /> : null}
      </PaneHeader>

      {pullRequestsOnly && projects.length === 0 && onOpenProject ? (
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2">
          {pullRequestsOnly && projects.length === 0 && onOpenProject ? (
            <Button variant="ghost" type="button" onClick={() => void onOpenProject()}>
              {t("Add project")}
            </Button>
          ) : null}
        </header>
      ) : null}

      {source === "jira" && jiraView === "board" ? (
        <>
          <div className="inbox-board-band flex shrink-0 flex-wrap items-center bg-(--ui-surface-panel)">
            <div className="min-w-0 max-w-sm flex-1 basis-72">{sourceRow}</div>
            {viewRow}
          </div>
          <div className="inbox-jira-layout flex min-h-0 min-w-0 flex-1" data-detail-open={!!boardIssue}>
            <JiraBoardView
              revision={refresh}
              selectedIssueId={boardIssue?.id}
              onSelect={(issue) => {
                boardIssueOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setBoardIssue(issue);
              }}
              onScopeChanged={() => setBoardIssue(null)}
              onChanged={() => setRefresh((value) => value + 1)}
              onIssuesLoaded={(issues) =>
                setBoardIssue((old) =>
                  old ? (issues.find((issue) => issue.id === old.id) ?? old) : null,
                )
              }
            />
            {boardIssue ? (
              <aside className="jira-board-detail" aria-label={boardIssue.identifier}
                onKeyDown={(event) => { if (event.key === "Escape" && !hasActiveOverlay()) { event.preventDefault(); closeBoardIssue(); } }}>
                <Button
                  variant="ghost"
                  type="button"
                  className="jira-board-detail-close"
                  autoFocus
                  onClick={closeBoardIssue}
                >
                  <ChevronLeft className="icon-sm" aria-hidden="true" />
                  {t("Close issue details")}
                </Button>
                <InboxDetailBody
                  item={boardIssue}
                  cwd={cwd}
                  projects={projectOptions}
                  revision={refresh}
                  relatedSessions={relatedSessionsForInboxItem(boardIssue, sessions)}
                  onStart={onStart}
                  repairSessions={repairSessions}
                  onRepairChecks={onRepairChecks}
                  onOpenSession={onOpenSession}
                />
              </aside>
            ) : null}
          </div>
        </>
      ) : (
        <div
          className="inbox-list-detail flex min-h-0 min-w-0 flex-1"
          data-detail-open={detailOpen}
        >
          {list}
          <div className="inbox-detail-pane flex min-h-0 min-w-0 flex-1 flex-col">
            {selectedOutsideFilters ? (
              <Alert tone="info" role="status" action={<Button onClick={() => { setSearchInput(""); onFiltersChange(DEFAULT_INBOX_FILTERS); }}>{t("Clear filters")}</Button>}>
                {t("Outside current filters")}
              </Alert>
            ) : null}
            <div className="inbox-detail-back shrink-0 border-b border-(--ui-tone-neutral-border) px-2 py-1">
              <Button variant="ghost" onClick={() => setDetailOpen(false)}>
                <ChevronLeft className="icon-sm" aria-hidden="true" />
                {t("Back")}
              </Button>
            </div>
            <div className="relative flex min-h-0 min-w-0 flex-1">
              <div className="min-h-0 min-w-0 flex-1">
                <InboxDetailBody
                  item={selected}
                  cwd={cwd}
                  projects={projectOptions}
                  revision={refresh}
                  relatedSessions={selected ? relatedSessionsForInboxItem(selected, sessions) : []}
                  onDiscuss={() => setDiscussionOpen(true)}
                  onStart={onStart}
                  repairSessions={repairSessions}
                  onRepairChecks={onRepairChecks}
                  onOpenSession={onOpenSession}
                  onItemChange={updateInboxItem}
                />
              </div>
              {discussionOpen && selected ? (
                <InboxDiscussionPanel
                  onOpen={onAsk}
                  onRestart={onAskRestart}
                  onMount={onAskMount}
                  key={inboxAskKey(selected)}
                  item={selected}
                  onClose={() => setDiscussionOpen(false)}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
      {filtersPortal}
      {connectPortal}
    </div>
  );
}

export function LinkedWorkItemPanel({
  repairSessions,
  onRepairChecks,
  onOpenSession,
  target,
  cwd,
  recents,
  visible = true,
  onClose,
}: {
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  target: LinkedWorkItem;
  cwd: string;
  recents: RecentProject[];
  visible?: boolean;
  onClose: () => void;
}) {
  useLocale();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const projects = useMemo(() => inboxProjectsForRail(recents, cwd), [cwd, recents]);
  const projectOptions = useMemo(() => inboxProjectOptions(projects, logos), [logos, projects]);
  const { item, error, loading, setItem } = useGithubWorkItem(target, cwd);
  const resize = useDragResize({
    min: LINKED_PANEL_MIN_WIDTH,
    max: () =>
      Math.max(
        LINKED_PANEL_MIN_WIDTH,
        Math.round(
          (typeof window === "undefined" ? LINKED_PANEL_DEFAULT_WIDTH / 0.65 : window.innerWidth) *
            0.65,
        ),
      ),
    defaultWidth: LINKED_PANEL_DEFAULT_WIDTH,
    initial: rememberedLinkedPanelWidth,
    direction: "left",
    onCommit: (width) => {
      rememberedLinkedPanelWidth = width;
    },
  });

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasActiveOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible]);

  const kindLabel = target.kind === "pr" ? "Pull request" : "Issue";
  return (
    <aside
      ref={resize.setPaneRef}
      aria-label={t("Linked {p0} #{p1}", { p0: kindLabel.toLowerCase(), p1: target.number })}
      aria-busy={loading}
      aria-hidden={!visible}
      inert={!visible || undefined}
      data-linked-work-item-panel
      className={`@container/linked relative min-h-0 max-w-full shrink-0 flex-col border-l border-(--ui-pane-border) text-(--ui-tone-neutral-fg) @max-[950px]/main-row:absolute @max-[950px]/main-row:inset-y-0 @max-[950px]/main-row:right-0 @max-[950px]/main-row:z-30 @max-[950px]/main-row:shadow-(--ui-elevation-floating) ${
        visible ? "flex linked-work-item-enter" : "hidden"
      }`}
    >
      <Sash
        {...resize.sashProps}
        appearance="hidden"
        label={t("Resize linked {p0} panel", { p0: kindLabel.toLowerCase() })}
        className="absolute inset-y-0 -left-px"
      />
      <header className="flex shrink-0 items-center gap-2 px-3 py-1">
        <span className="min-w-0 flex-1 truncate text-ui-caption font-medium text-(--ui-text-secondary)">
          {t("Linked {p0} #{p1}", { p0: kindLabel.toLowerCase(), p1: target.number })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Close {p0} panel", { p0: kindLabel.toLowerCase() })}
          onClick={onClose}
          className="shrink-0"
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </Button>
      </header>
      <div className="min-h-0 min-w-0 flex-1">
        {item ? (
          <InboxDetail
            key={inboxItemKey(item)}
            item={item}
            cwd={cwd}
            projects={projectOptions}
            revision={0}
            relatedSessions={[]}
            mode="panel"
            visible={visible}
            repairSessions={repairSessions}
            onRepairChecks={onRepairChecks}
            onOpenSession={onOpenSession}
            onItemChange={setItem}
          />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <CircleX className="icon-lg text-(--ui-tone-danger-fg)" strokeWidth={1.75} />
            <Alert tone="info" role="alert" className="max-w-sm">
              {error}
            </Alert>
            <Button variant="secondary" type="button" onClick={() => void openUrl(target.url)}>
              <ExternalLink className="icon-sm" strokeWidth={1.75} />
              {t("Open on GitHub")}
            </Button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-(--ui-text-secondary)">
            <Spinner size="md" />
          </div>
        )}
      </div>
    </aside>
  );
}

function InboxDetailBody({
  item,
  cwd,
  projects,
  revision = 0,
  relatedSessions,
  onDiscuss,
  onStart,
  repairSessions,
  onRepairChecks,
  onOpenSession,
  onItemChange,
}: {
  item: InboxItem | null;
  cwd: string;
  projects: InboxProjectOption[];
  revision?: number;
  relatedSessions: readonly SessionSummary[];
  onDiscuss?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  onItemChange?: (item: InboxItem) => void;
}) {
  useLocale();
  if (!item) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState icon={<Inbox aria-hidden="true" />} description={t("Select an inbox item")} />
      </div>
    );
  }
  return (
    <InboxDetail
      key={inboxItemKey(item)}
      item={item}
      cwd={cwd}
      projects={projects}
      revision={revision}
      relatedSessions={relatedSessions}
      onDiscuss={onDiscuss}
      onStart={onStart}
      repairSessions={repairSessions}
      onRepairChecks={onRepairChecks}
      onOpenSession={onOpenSession}
      onItemChange={onItemChange}
    />
  );
}

const InboxCard = memo(function InboxCard({
  item,
  active,
  logoPath,
  mascotName,
  mascotColor,
  relatedSessionCount,
  onSelect,
}: {
  item: InboxItem;
  active: boolean;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
  relatedSessionCount: number;
  onSelect: (item: InboxItem) => void;
}) {
  useLocale();
  useInboxSeenTick();
  const status = inboxStatusMark(item);
  const kindLabel =
    item.kind === "pr" ? (item.provider === "gitlab" ? "Merge request" : "Pull request") : "Issue";
  const time = formatRelativeTime(item.updatedAt);
  const name = projectName(item.projectPath);
  const tracker = item.provider === "linear" || item.provider === "jira";
  const source = tracker ? item.teamName || item.repo : item.repo || name;
  const attentionLabel =
    item.provider === "gitlab" || item.provider === "azuredevops"
      ? gitlabAttentionLabel(item.attentionReason ?? "")
      : "";
  const unseen = isInboxEntryUnseen({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
  });

  return (
    <Button
      variant="item"
      layout="stacked"
      className="w-full min-w-0"
      type="button"
      tooltip={item.title}
      aria-current={active ? "true" : undefined}
      selected={active}
      aria-label={`${status.label} ${kindLabel.toLowerCase()} ${inboxItemRef(
        item,
      )}: ${item.title}, ${source}${attentionLabel ? `, ${attentionLabel}` : ""}${unseen ? ", new" : ""}${item.labels.length ? `, ${item.labels.map((label) => label.name).join(", ")}` : ""}${relatedSessionCount > 0 ? `, ${relatedSessionCount} related ${relatedSessionCount === 1 ? "thread" : "threads"}` : ""}`}
      onClick={() => onSelect(item)}
      onMouseEnter={() => prefetchInboxItem(item)}
      onFocus={() => prefetchInboxItem(item)}
    >
      <span className={`min-w-0 line-clamp-2 wrap-anywhere text-ui-secondary leading-snug text-(--ui-tone-neutral-fg) ${unseen ? "font-medium" : "font-normal"}`}>
        {item.title}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <status.Icon className={`icon-xs shrink-0 ${status.className}`} strokeWidth={1.75} />
          <span className="min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
            {t(kindLabel)} {inboxItemRef(item)} · {tracker ? item.state : t(status.label)}
            {attentionLabel ? ` · ${attentionLabel}` : ""}
          </span>
        </span>
        {relatedSessionCount > 0 || time || unseen ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {relatedSessionCount > 0 ? (
              <span
                title={t(
                  relatedSessionCount === 1 ? "{p0} related thread" : "{p0} related threads",
                  { p0: relatedSessionCount },
                )}
                className="inline-flex items-center gap-0.5 text-ui-micro tabular-nums text-(--ui-tone-accent-fg)"
              >
                <MessageMultiple className="icon-xs" strokeWidth={1.75} />
                {relatedSessionCount}
              </span>
            ) : null}
            {time ? (
              <span className="text-ui-micro tabular-nums text-(--ui-text-secondary)">{time}</span>
            ) : null}
            {unseen ? (
              <span
                data-inbox-unread
                aria-hidden
                className="size-1.5 rounded-full bg-(--ui-tone-accent-fg)"
              />
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui-micro text-(--ui-text-secondary)">
          {tracker || !item.projectPath ? null : logoPath ? (
            <ProjectLogoIcon
              path={logoPath}
              className="icon-sm shrink-0 rounded-sm"
              imageClassName="icon-sm"
            />
          ) : (
            <ProjectMascot
              project={name}
              color={mascotColor}
              name={mascotName}
              className="icon-xs shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{source}</span>
        </span>
        {item.labels.length > 0 ? (
          <span className="flex min-w-0 max-w-[45%] items-center gap-1 overflow-hidden">
            {item.labels.slice(0, 1).map((label) => (
              <InboxLabel key={label.name} label={label} compact />
            ))}
            {item.labels.length > 1 ? <span className="shrink-0 text-ui-micro text-(--ui-text-secondary)">+{item.labels.length - 1}</span> : null}
          </span>
        ) : null}
      </span>
    </Button>
  );
});
