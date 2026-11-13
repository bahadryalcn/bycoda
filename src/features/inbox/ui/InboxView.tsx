import { InboxCollectionStatus } from "./InboxCollectionStatus";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { InboxLoadError } from "./InboxLoadError";
import { RemoteActivityNotices } from "../../sessions/public/RemoteActivityNotices";
import { githubRepositoryOptions } from "../model/inboxRepositoryFilters";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import "./InboxView.css";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { filterCodeHostScopes, useCodeHostScopes } from "../model/codeHostScopes";
import { subscribeInboxItemRequests, takeInboxItemRequest } from "../model/inboxItemRequest";
import { t, useLocale } from "../../../shared/i18n";
import { useInboxCollection } from "../hooks/useInboxCollection";
import { useProviderConnections } from "../hooks/useProviderConnections";
import { useInboxProviderScopes } from "../hooks/useInboxProviderScopes";
import { useInboxSourceSelection } from "../hooks/useInboxSourceSelection";
import { useLinkedTarget, useLinkedTargetItem } from "../hooks/useLinkedTarget";
import { visibleInboxItems } from "../model/inboxVisibleItems";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import {
  ChevronsUpDown,
  ChevronLeft,
  CheckCheck,
  CircleX,
  Inbox,
  ListBullet,
  ListFilter,
  SquareKanban,
  RefreshCw,
  Search,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useContext,
  useDeferredValue,
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
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  inboxItemKey,
  inboxProjectsForRail,
  type InboxItem,
  type InboxQuery,
} from "../model/githubTasks";
import {
  connectableInboxSources,
  hasActiveInboxFilters,
  jiraActiveFilterCount,
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
import { IS_MAC } from "../../../platform/tauri/platform";
import { type RecentProject } from "../../projects/model/recents";
import { type LinkedWorkItem } from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  linkedWorkItemInboxKey,
  relatedSessionsForInboxItem,
} from "../../sessions/model/sessionWorkItem";
import {
  inboxHasUnseenItems,
  inboxSeenStatus,
  markInboxItemSeen,
  markInboxItemsSeen,
  retryInboxSeenStorage,
  useInboxSeenTick,
} from "../model/inboxSeen";
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
import { InboxDetailBody } from "./InboxDetailBody";
import { InboxSourceRow } from "./InboxSourceRow";
import { MessagesPanel, openMessagingSettings, useMessagingAccounts } from "../../messaging";
import { inboxProjectOptions, CiRepairProps } from "./InboxPresentation";
import { InboxCard } from "./InboxCard";
export { LinkedWorkItemPanel } from "./LinkedWorkItemPanel";
export { InboxDetail, inboxShowsFullFileDiff } from "./InboxDetail";
export { GithubPrActions } from "./InboxPrActions";
export { inboxStatusMark } from "./InboxPresentation";

const MIN_WIDTH = 240;

const MAX_WIDTH = 420;

const DEFAULT_WIDTH = 320;

let rememberedWidth = DEFAULT_WIDTH;

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
  const seenSaveGeneration = useRef(0);
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
  const messaging = useMessagingAccounts(!pullRequestsOnly);
  const [messagesChosen, setMessagesChosen] = useRetainedState(`${viewStateKey}:messages`, false);
  const linked = useLinkedTarget({
    target,
    onReveal: () => {
      setMessagesChosen(false);
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
  const listScope = `${viewStateKey}:${JSON.stringify([source, activeFilters, jiraScope, linearScope])}`;
  const filtersActive =
    codeScopes.hidden.length > 0 ||
    hasActiveInboxFilters(activeFilters, source, linearHiddenTeamIds, jiraHiddenProjectIds);
  // One count per narrowed dimension (assignment, scope, kind, time, status); the same
  // dimensions the filter menu's own "Clear filters" resets.
  const statusFiltered = isTrackerSource(source)
    ? activeFilters.status.open || activeFilters.status.closed
    : Object.values(activeFilters.status).some(Boolean);
  const filterCount =
    (source === "jira" ? jiraActiveFilterCount(activeFilters) : 0) +
    (activeFilters.assignedToMe ? 1 : 0) +
    (source === "linear" && linearHiddenTeamIds.length > 0 ? 1 : 0) +
    (source === "jira" && jiraHiddenProjectIds.length > 0 ? 1 : 0) +
    ((source === "linear"
      ? activeFilters.hiddenLinearProjects.length
      : source === "jira"
        ? 0
        : activeFilters.hiddenProjects.filter(
            (path) => source === "github" || !path.startsWith("github:"),
          ).length) > 0
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
      jiraAssignees: source === "jira" ? activeFilters.jiraAssignees : undefined,
      jiraUnassigned: source === "jira" ? activeFilters.jiraUnassigned : undefined,
      jiraStatuses: source === "jira" ? activeFilters.jiraStatuses : undefined,
      state: fetchState,
      search: "",
      githubKinds: source !== "github" ? [] : pullRequestsOnly ? ["pr"] : undefined,
      linearHiddenTeamIds: linearScope ?? undefined,
      jiraHiddenProjectIds: jiraScope ?? undefined,
      jiraEnabled: source === "jira" && jiraView === "list",
    }),
    [
      activeFilters.assignedToMe,
      activeFilters.jiraAssignees,
      activeFilters.jiraUnassigned,
      activeFilters.jiraStatuses,
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
  const hasMessaging = messaging.accounts.length > 0;
  const messagesOpen = hasMessaging && (messagesChosen || noSourcesConnected);
  const connectMessages = !pullRequestsOnly && messaging.loaded && !hasMessaging;

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
  const openRequestedItem = useStableCallback(() => {
    if (pullRequestsOnly) return;
    const item = takeInboxItemRequest();
    if (!item) return;
    setMessagesChosen(false);
    selectSource(item.provider);
    setSearchInput(item.identifier || String(item.number));
    setSelectedKey(inboxItemKey(item));
    setDetailOpen(true);
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- store listener for chat work-item chips; a request sent before mount waits in the store.
  useEffect(() => {
    openRequestedItem();
    return subscribeInboxItemRequests(openRequestedItem);
  }, [openRequestedItem]);
  const selectItem = useStableCallback((item: InboxItem) => {
    const key = inboxItemKey(item);
    const generation = ++seenSaveGeneration.current;
    releaseTarget();
    setSelectedKey(key);
    setDetailOpen(true);
    const applyResult = (saved: boolean) => {
      if (seenSaveGeneration.current !== generation) return;
      setFailedReadItem(saved ? null : item);
      setReadStatusError(saved ? null : "Could not save read status. Please try again.");
    };
    const result = markInboxItemSeen({ key, updatedAt: item.updatedAt });
    if (typeof result === "boolean") applyResult(result);
    else void result.then(applyResult).catch(() => applyResult(false));
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
  const seenStorageStatus = inboxSeenStatus();
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
    () => inboxHasUnseenItems(sourceEntries),
    [inboxSeenTick, sourceEntries],
  );

  const sourceError = providerErrors[source] ?? null;
  // Full pages mean older items may not be loaded; the list reads have no total.
  const sourceLimited = collection.limited?.includes(source) ?? false;

  // Local filters cannot retarget an open public-comment composer. Resolve the
  // selected identity from allowed loaded data before considering a default.
  const allowedItems = sourceAvailable
    ? filterCodeHostScopes(
        items.filter((item) => item.provider === source),
        codeScopes.provider,
        codeScopes.scopes,
        codeScopes.hidden,
      )
    : [];
  const selectedByKey =
    allowedItems.find((item) => inboxItemKey(item) === selectedKey) ??
    visibleItems.find((item) => inboxItemKey(item) === selectedKey);
  const waitingForTarget = !!targetSelectionKey && selectedKey === targetSelectionKey;
  const selected =
    selectedByKey ?? (waitingForTarget || selectedKey ? null : visibleItems[0]) ?? null;
  const { updateItem } = collection;
  const updateInboxItem = useCallback(
    (next: InboxItem) => {
      updateItem(next);
      patchTargetItem(next);
    },
    [updateItem, patchTargetItem],
  );
  const setListScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      listLock(element);
      listScrollRef.current = element;
    },
    [listLock],
  );

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
    setMessagesChosen(false);
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
    <InboxSourceRow
      sources={visibleSources}
      source={source}
      messages={hasMessaging}
      messagesSelected={messagesOpen}
      onSelect={onSourceChange}
      onSelectMessages={() => setMessagesChosen(true)}
      connectable={connectableSources.length > 0 || connectMessages}
      connectOpen={connectMenuOpen}
      connectButtonRef={connectButtonRef}
      onToggleConnect={() => setConnectMenuOpen((open) => !open)}
    />
  );

  const viewRow =
    !pullRequestsOnly && source === "github" ? (
      <div className="flex shrink-0 items-center px-2 py-1">
        <SegmentedControl
          label={t("Type")}
          value={
            activeFilters.hiddenKinds.length >= 2
              ? ""
              : activeFilters.hiddenKinds.length === 0
                ? "all"
                : activeFilters.hiddenKinds.includes("issue")
                  ? "pr"
                  : "issue"
          }
          onValueChange={(next) =>
            onFiltersChange({
              ...activeFilters,
              hiddenKinds: next === "all" ? [] : next === "pr" ? ["issue"] : ["pr"],
            })
          }
          options={[
            { value: "all", label: t("All") },
            { value: "pr", label: t("Pull requests") },
            { value: "issue", label: t("Issues") },
          ]}
        />
      </div>
    ) : null;

  const toolbarActions = (
    <ButtonGroup
      aria-label={source === "jira" ? t("Jira view") : t("Inbox")}
      className="ml-auto shrink-0"
      onKeyDown={(event) => {
        if (source !== "jira" || !(event.target as HTMLElement).matches("button[data-value]"))
          return;
        const next =
          event.key === "Home"
            ? "list"
            : event.key === "End"
              ? "board"
              : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
                ? jiraView === "list"
                  ? "board"
                  : "list"
                : null;
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        setJiraView(next);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`button[data-value="${next}"]`)
          ?.focus();
      }}
    >
      {source === "jira" ? (
        <>
          <Button
            iconOnly
            label={t("List")}
            variant="ghost"
            pressed={jiraView === "list"}
            data-value="list"
            tabIndex={jiraView === "list" ? 0 : -1}
            onClick={() => setJiraView("list")}
          >
            <ListBullet className="icon-sm" strokeWidth={1.75} />
          </Button>
          <Button
            iconOnly
            label={t("Board")}
            variant="ghost"
            pressed={jiraView === "board"}
            data-value="board"
            tabIndex={jiraView === "board" ? 0 : -1}
            onClick={() => setJiraView("board")}
          >
            <SquareKanban className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </>
      ) : null}
      {showCollectionTools || source === "jira" ? (
        <Button
          iconOnly
          label={t("Mark loaded {p0} items as read", { p0: INBOX_SOURCE_LABELS[source] })}
          variant="ghost"
          type="button"
          aria-label={t("Mark loaded {p0} items as read", {
            p0: INBOX_SOURCE_LABELS[source],
          })}
          disabled={!sourceHasUnseen}
          onClick={() => {
            setFailedReadItem(null);
            const generation = ++seenSaveGeneration.current;
            const applyResult = (saved: boolean) => {
              if (seenSaveGeneration.current === generation)
                setReadStatusError(
                  saved ? null : "Some read status updates may have saved. Retry to complete.",
                );
            };
            const result = markInboxItemsSeen(sourceEntries);
            if (typeof result === "boolean") applyResult(result);
            else void result.then(applyResult).catch(() => applyResult(false));
          }}
          className="shrink-0"
        >
          <CheckCheck className="icon-sm" strokeWidth={1.75} />
        </Button>
      ) : null}
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
    </ButtonGroup>
  );

  const list = (
    <div
      ref={resize.setPaneRef}
      {...surfaceAttributes(
        { frame: "pane", edge: "responsive-end", variant: "transparent" },
        "inbox-list-panel relative flex h-full min-h-0 shrink-0 flex-col",
      )}
    >
      {sourceRow}
      {viewRow}
      {noSourcesConnected ? null : (
        <div className="inbox-collection-toolbar flex shrink-0 flex-wrap items-center gap-2 px-2 py-1.5">
          {showCollectionTools ? (
            <div className="inbox-collection-search flex min-w-0 flex-1 items-center gap-1">
              <SearchInputGroup appearance="field" className="min-w-0 flex-1">
                <Search tone="secondary" className="pointer-events-none icon-xs shrink-0" />
                <SearchInput
                  focusOwner="group"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t("Filter issues")}
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
              <div
                className="relative shrink-0"
                data-filter-trigger=""
                data-filter-active={filtersActive ? "" : undefined}
              >
                <Button
                  iconOnly
                  variant="ghost"
                  label={filtersActive ? t("Filter inbox (filters active)") : t("Filter inbox")}
                  selected={filtersActive}
                  aria-expanded={!!filterMenu}
                  aria-haspopup="menu"
                  onClick={onFilterButtonClick}
                >
                  <ListFilter className="icon-sm" strokeWidth={1.75} />
                </Button>
                {filterCount > 0 ? (
                  <Badge
                    variant="count"
                    size="xs"
                    className="pointer-events-none absolute -right-1 -top-1"
                  >
                    {filterCount}
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
          {toolbarActions}
        </div>
      )}
      {readStatusError ? (
        <Alert tone="danger">
          {t(readStatusError)}
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
      {seenStorageStatus.state === "loading" ? (
        <Alert tone="info">{t("Loading Inbox read status…")}</Alert>
      ) : seenStorageStatus.state === "error" ? (
        <Alert tone="danger">
          {t("Inbox read status is unavailable. Unread indicators may be incomplete.")}
          <Button variant="secondary" onClick={retryInboxSeenStorage}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      {sourceError ? (
        <InboxLoadError
          error={sourceError}
          retrying={refreshAction === "retry"}
          disabled={refreshAction === "toolbar"}
          onRetry={() => requestRefresh("retry", source === "github")}
        />
      ) : null}
      <div ref={setListScrollRef} className="min-h-0 flex-1 overflow-hidden flex flex-col">
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
            description={t("Could not load.")}
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
        ) : visibleItems.length === 0 &&
          !(source === "jira" && collection.jiraContinuation.hasMore) ? (
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
          <ContinuousList
            loadOnScroll={source === "jira"}
            hasMore={source === "jira" && collection.jiraContinuation.hasMore}
            loading={source === "jira" && collection.jiraContinuation.loading}
            error={source === "jira" ? collection.jiraContinuation.error : null}
            onLoadMore={collection.jiraContinuation.loadMore}
            onRetry={collection.jiraContinuation.loadMore}
            fill
            className="p-1.5 overscroll-none"
            label={t("Inbox")}
            items={visibleItems}
            stateKey={`inbox:${listScope}`}
            itemKey={inboxItemKey}
            requiredKey={selected ? inboxItemKey(selected) : null}
            estimateSize={96}
            renderItem={(item) => {
              const key = inboxItemKey(item);
              const projectId = projectKey(item.projectPath);
              const relatedSessionCount = sessionCounts.get(key) ?? 0;
              return (
                <div role="listitem">
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
                </div>
              );
            }}
          />
        )}
      </div>
      {noSourcesConnected || visibleItems.length === 0 ? null : (
        <InboxCollectionStatus
          count={visibleItems.length}
          total={source === "jira" && !narrowed ? collection.jiraContinuation.total : undefined}
          limited={sourceLimited}
          partial={!!sourceError}
        />
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
      items={items}
      codeHostProjects={codeScopes.scopes?.projects}
      hiddenCodeHostProjects={codeScopes.hidden}
      codeHostError={codeScopes.error}
      onCodeHostProjectsChange={codeScopes.save}
      x={filterMenu.x}
      y={filterMenu.y}
      projects={source === "github" ? githubRepositoryOptions(projects) : projectOptions}
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
    connectMenuOpen && (connectableSources.length > 0 || connectMessages) ? (
      <InboxConnectMenu
        anchor={connectButtonRef}
        sources={connectableSources}
        onConnect={onOpenIntegrations}
        onConnectMessages={connectMessages ? openMessagingSettings : undefined}
        onClose={() => setConnectMenuOpen(false)}
      />
    ) : null;

  return (
    <Text
      as="div"
      size="inherit"
      tone="neutral"
      role="region"
      aria-label={t("Inbox")}
      data-app-inbox
      className="bycoda-inbox flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <PaneHeader
        chromeInset={besideRail ? (compactRail ? "compact" : false) : true}
        dragRegion
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        icon={toolNavigation ? undefined : <Inbox strokeWidth={1.75} />}
        title={toolNavigation ? undefined : pullRequestsOnly ? t("Pull Requests") : t("Inbox")}
        titleAs="h1"
        trailing={IS_MAC ? null : <WindowControls />}
        className={toolNavigation ? "items-stretch" : undefined}
      >
        {toolNavigation ? <ToolNavigation /> : null}
      </PaneHeader>
      <RemoteActivityNotices inbox />
      {pullRequestsOnly && projects.length === 0 && onOpenProject ? (
        <header
          {...surfaceAttributes(
            { frame: "neutral", edge: "bottom" },
            "flex shrink-0 flex-wrap items-center gap-2 px-3 py-2",
          )}
        >
          {pullRequestsOnly && projects.length === 0 && onOpenProject ? (
            <Button variant="ghost" type="button" onClick={() => void onOpenProject()}>
              {t("Add project")}
            </Button>
          ) : null}
        </header>
      ) : null}
      {messagesOpen ? (
        <MessagesPanel accounts={messaging.accounts} sourceRow={sourceRow} />
      ) : source === "jira" && jiraView === "board" ? (
        <>
          <div
            {...surfaceAttributes(
              { variant: "transparent" },
              "inbox-board-band flex shrink-0 flex-wrap items-center",
            )}
          >
            <div className="min-w-0 max-w-sm flex-1 basis-72">{sourceRow}</div>
            {toolbarActions}
          </div>
          <div
            className="inbox-jira-layout flex min-h-0 min-w-0 flex-1"
            data-detail-open={!!boardIssue}
          >
            <JiraBoardView
              revision={refresh}
              selectedIssueId={boardIssue?.id}
              onSelect={(issue) => {
                boardIssueOrigin.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
              <aside
                {...surfaceAttributes(
                  { frame: "pane", edge: "responsive-start" },
                  "jira-board-detail",
                )}
                aria-label={boardIssue.identifier}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !hasActiveOverlay()) {
                    event.preventDefault();
                    closeBoardIssue();
                  }
                }}
              >
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
            <div
              {...surfaceAttributes(
                { frame: "neutral", edge: "bottom" },
                "inbox-detail-back shrink-0 px-2 py-1",
              )}
            >
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
    </Text>
  );
}
