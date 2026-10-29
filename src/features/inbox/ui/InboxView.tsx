import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import "./InboxView.css";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { filterCodeHostScopes, useCodeHostScopes } from "../model/codeHostScopes";
import { prefetchInboxItem } from "../model/inboxPrefetch";
import { t, useLocale } from "../../../shared/i18n";
import { INBOX_VISIBLE_POLL_MS } from "../model/inboxPolling";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronsUpDown,
  ChevronLeft,
  CheckCheck,
  CircleX,
  ExternalLink,
  Inbox,
  LoaderCircle,
  MessageMultiple,
  Plus,
  RefreshCw,
  Search,
  X,
} from "../../../shared/ui/icons";
import {
  useCallback,
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
  githubStatus,
  githubWorkItem,
  GITHUB_WORK_ITEM_FRESH_MS,
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  inboxListFetchedAt,
  inboxProjectsForRail,
  listInboxItems,
  peekGithubWorkItem,
  peekInboxList,
  formatRelativeTime,
  type InboxItem,
  type InboxProviderErrors,
  type InboxQuery,
} from "../model/githubTasks";
import {
  applyInboxFilters,
  connectableInboxSources,
  hasActiveInboxFilters,
  loadInboxConnections,
  linearProjectOptions,
  inboxFetchState,
  loadInboxFilters,
  loadInboxSource,
  pruneInboxFilters,
  saveInboxFilters,
  resolveInboxSource,
  saveInboxConnections,
  saveInboxSource,
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
  inboxItemMatchesLinkedWorkItem,
  linkedWorkItemInboxKey,
  relatedSessionsForInboxItem,
} from "../../sessions/model/sessionWorkItem";
import {
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  rememberInboxItems,
  useInboxSeenTick,
} from "../model/inboxSeen";
import { LIST_PAGE_SIZE, listWindowSize } from "../../../shared/lib/listWindow";
import {
  LINEAR_CHANGE_EVENT,
  linearConnected,
  listLinearTeams,
  readHiddenLinearTeamIds,
  subscribeLinearScope,
  saveHiddenLinearTeamIds,
  type LinearTeam,
} from "../model/linear";
import {
  JIRA_CHANGE_EVENT,
  jiraConnected,
  jiraBackgroundSyncEnabled,
  listJiraProjects,
  readHiddenJiraProjectIds,
  subscribeJiraScope,
  saveHiddenJiraProjectIds,
  type JiraProject,
} from "../model/jira";
import { GITLAB_CHANGE_EVENT, gitlabConnected } from "../model/gitlab";
import { AZUREDEVOPS_CHANGE_EVENT, azureDevOpsConnected } from "../model/azureDevOps";
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

function peekInboxForRail(recents: RecentProject[], cwd: string) {
  const projects = inboxProjectsForRail(recents, cwd);
  const filters = pruneInboxFilters(
    loadInboxFilters(),
    projects.map((project) => project.path),
  );
  const linearHidden = readHiddenLinearTeamIds();
  const jiraHidden = readHiddenJiraProjectIds();
  // An unreadable saved scope must not surface a cached unscoped list.
  if (!linearHidden || !jiraHidden) return null;
  return peekInboxList(projects, {
    assignedToMe: filters.assignedToMe,
    state: inboxFetchState(filters),
    search: "",
    linearHiddenTeamIds: linearHidden,
    jiraHiddenProjectIds: jiraHidden,
  });
}

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
    <Button
      variant="tab"
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(source)}
    >
      <span className="flex items-center gap-1.5">
        <InboxProviderMark provider={source} className="block icon-sm shrink-0" />
        <span className="leading-none">{label}</span>
      </span>
    </Button>
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

  const [searchInput, setSearchInput] = useRetainedState(`${viewStateKey}:search`, "");
  const deferredSearch = useDeferredValue(searchInput);
  const queryClient = useQueryClient();
  const queryVisible = useQueryVisible();
  const forceRead = useRef(false);
  const retryFailedRead = useRef(false);
  const [items, setItems] = useState<InboxItem[]>(
    () => peekInboxForRail(recents, cwd)?.items ?? [],
  );
  const [loading, setLoading] = useState(() => peekInboxForRail(recents, cwd) == null);
  const [refreshAction, setRefreshAction] = useState<"toolbar" | "retry" | null>(null);
  const refreshActionRef = useRef<"toolbar" | "retry" | null>(null);
  const [readStatusError, setReadStatusError] = useState<string | null>(null);
  const [failedReadItem, setFailedReadItem] = useState<InboxItem | null>(null);
  const [providerErrors, setProviderErrors] = useState<InboxProviderErrors>(
    () => peekInboxForRail(recents, cwd)?.errors ?? {},
  );
  const [refresh, setRefresh] = useState(0);
  const requestRefresh = (action: "toolbar" | "retry", retryFailedOnly = false) => {
    if (refreshActionRef.current) return;
    refreshActionRef.current = action;
    retryFailedRead.current = retryFailedOnly;
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
  const [jiraAutomaticSync, setJiraAutomaticSync] = useState(jiraBackgroundSyncEnabled);
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
  }, []);
  const targetSelectionKey = target ? linkedWorkItemInboxKey(target) : null;
  const [connections, setConnections] = useState(loadInboxConnections);
  const [source, setSource] = useState(() =>
    pullRequestsOnly
      ? ("github" as InboxSource)
      : resolveInboxSource(loadInboxSource(), connections),
  );
  const [selectedKey, setSelectedKey] = useRetainedState<string | null>(
    `${viewStateKey}:${source}:selected`,
    targetSelectionKey,
  );
  const [targetItem, setTargetItem] = useState<InboxItem | null>(null);
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
  // `null` means the saved scope cannot be read; fetches then fail closed.
  const [linearScope, setLinearScope] = useState(readHiddenLinearTeamIds);
  const linearHiddenTeamIds = useMemo(() => linearScope ?? [], [linearScope]);
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [jiraScope, setJiraScope] = useState(readHiddenJiraProjectIds);
  const jiraHiddenProjectIds = useMemo(() => jiraScope ?? [], [jiraScope]);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const prevRefresh = useRef(refresh);

  const projects = useMemo(() => inboxProjectsForRail(recents, cwd), [cwd, recents]);
  const projectOptions = useMemo(() => inboxProjectOptions(projects, logos), [logos, projects]);
  const linearProjects = useMemo(() => linearProjectOptions(items), [items]);
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
    if (!target) return;
    setSource("github");
    setSearchInput("");
    setSelectedKey(targetSelectionKey);
    setDetailOpen(true);
  }, [target, targetSelectionKey, setSelectedKey, setSearchInput]);

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

  useEffect(() => {
    return subscribeLinearScope(() => {
      setLinearScope(readHiddenLinearTeamIds());
      setRefresh((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeJiraScope(() => {
      setJiraScope(readHiddenJiraProjectIds());
      setJiraAutomaticSync(jiraBackgroundSyncEnabled());
      setRefresh((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    const onChange = () => setRefresh((value) => value + 1);
    window.addEventListener(GITLAB_CHANGE_EVENT, onChange);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(GITLAB_CHANGE_EVENT, onChange);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, onChange);
    };
  }, []);

  // The mount read does the real work: opening Settings unmounts this view, so
  // a token set there lands on the way back in. Reads can also overlap, and
  // only the newest may write, or a slow earlier answer restores a stale one.
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    const read = () => {
      const generation = ++latest;
      void Promise.allSettled([
        githubStatus(),
        linearConnected(),
        jiraConnected(),
        gitlabConnected(),
        azureDevOpsConnected(),
      ]).then(([github, linear, jira, gitlab, azuredevops]) => {
        if (cancelled || generation !== latest) return;
        setConnections((prev) => ({
          github: github.status === "fulfilled" ? github.value.connected : prev.github,
          linear: linear.status === "fulfilled" ? linear.value.connected : prev.linear,
          jira: jira.status === "fulfilled" ? jira.value.connected : prev.jira,
          gitlab: gitlab.status === "fulfilled" ? gitlab.value.connected : prev.gitlab,
          azuredevops:
            azuredevops.status === "fulfilled" ? azuredevops.value.connected : prev.azuredevops,
        }));
      });
    };
    read();
    window.addEventListener(LINEAR_CHANGE_EVENT, read);
    window.addEventListener(JIRA_CHANGE_EVENT, read);
    window.addEventListener(GITLAB_CHANGE_EVENT, read);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(LINEAR_CHANGE_EVENT, read);
      window.removeEventListener(JIRA_CHANGE_EVENT, read);
      window.removeEventListener(GITLAB_CHANGE_EVENT, read);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    };
  }, []);

  useEffect(() => {
    saveInboxConnections(connections);
  }, [connections]);

  // The initial source is resolved against cached status, so storage can still
  // name a provider this view has already fallen back from.
  useEffect(() => {
    if (!pullRequestsOnly) saveInboxSource(source);
    // Mount only: the temporary switch to GitHub for a linked target must not
    // be persisted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disconnecting can pull the tab out from under the current selection.
  useEffect(() => {
    const available = visibleInboxSources(connections).filter(
      (candidate) => !pullRequestsOnly || !isTrackerSource(candidate),
    );
    const next = pullRequestsOnly
      ? available.includes(source)
        ? source
        : (available[0] ?? "github")
      : resolveInboxSource(source, connections);
    if (next === source) return;
    setSource(next);
    if (!pullRequestsOnly) saveInboxSource(next);
  }, [connections, source, pullRequestsOnly]);

  const visibleSources = visibleInboxSources(connections).filter(
    (source) => !pullRequestsOnly || !isTrackerSource(source),
  );
  const connectableSources = connectableInboxSources(connections);
  const sourceAvailable = visibleSources.includes(source);
  const noSourcesConnected = visibleSources.length === 0;

  // The roster has to come from Linear, not from the fetched issues: hiding a
  // team drops its issues, so a derived list could never offer it back.
  useEffect(() => {
    if (source !== "linear") return;
    let cancelled = false;
    void listLinearTeams()
      .then((teams) => {
        if (!cancelled) setLinearTeams(teams);
      })
      .catch(() => {
        if (!cancelled) setLinearTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, linearHiddenTeamIds]);

  // Same for Jira: hidden projects are excluded from the fetch itself.
  useEffect(() => {
    if (source !== "jira") return;
    let cancelled = false;
    void listJiraProjects()
      .then((next) => {
        if (!cancelled) setJiraProjects(next);
      })
      .catch(() => {
        if (!cancelled) setJiraProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, jiraHiddenProjectIds]);

  const inboxQueryKey = useMemo(
    () => ["inbox", "list", projects, fetchQuery] as const,
    [projects, fetchQuery],
  );
  const inboxQuery = useQuery({
    queryKey: inboxQueryKey,
    queryFn: async ({ signal }) => {
      const force = forceRead.current;
      forceRead.current = false;
      const retryFailedOnly = retryFailedRead.current;
      retryFailedRead.current = false;
      const cached = peekInboxList(projects, fetchQuery);
      try {
        return await listInboxItems(projects, fetchQuery, {
          force,
          retryFailedOnly,
          onProgress: (result) => {
            if (!signal.aborted) queryClient.setQueryData(inboxQueryKey, result);
          },
        });
      } catch (reason) {
        if (cached) return cached;
        const message = reason instanceof Error ? reason.message : String(reason);
        return {
          items: [] as InboxItem[],
          errors: {
            github: message,
            linear: message,
            jira: message,
            gitlab: message,
            azuredevops: message,
          },
        };
      }
    },
    initialData: () => peekInboxList(projects, fetchQuery) ?? undefined,
    initialDataUpdatedAt: () => inboxListFetchedAt(projects, fetchQuery),
    // Reopening checks the shared cache's real age, including background reads.
    // listInboxItems skips provider calls while that cache is still fresh.
    refetchOnMount: "always",
    enabled: queryVisible,
    staleTime: INBOX_VISIBLE_POLL_MS,
    refetchInterval: (query) => {
      if (source === "jira" && !jiraAutomaticSync) return false;
      // A cached read on entry must not start another full five-minute wait.
      // Failed reads use the regular interval rather than a tight retry loop.
      if (Object.keys(query.state.data?.errors ?? {}).length > 0) return INBOX_VISIBLE_POLL_MS;
      const fetchedAt = inboxListFetchedAt(projects, fetchQuery);
      return fetchedAt
        ? Math.max(1000, fetchedAt + INBOX_VISIBLE_POLL_MS - Date.now())
        : INBOX_VISIBLE_POLL_MS;
    },
    retry: false,
  });
  useEffect(() => {
    setItems(inboxQuery.data?.items ?? []);
    setProviderErrors(inboxQuery.data?.errors ?? {});
    setLoading(inboxQuery.isPending);
  }, [inboxQuery.data, inboxQuery.isPending, inboxQuery.isFetching]);
  useEffect(() => {
    if (refresh === prevRefresh.current) return;
    prevRefresh.current = refresh;
    forceRead.current = true;
    void queryClient.invalidateQueries({ queryKey: inboxQueryKey }).finally(() => {
      if (prevRefresh.current === refresh) {
        refreshActionRef.current = null;
        setRefreshAction(null);
      }
    });
  }, [refresh, inboxQueryKey, queryClient]);

  useEffect(() => {
    if (!target || items.some((item) => inboxItemMatchesLinkedWorkItem(item, target))) {
      return;
    }
    let cancelled = false;
    void githubWorkItem(cwd, target.repo, target.kind, target.number, {
      maxAgeMs: GITHUB_WORK_ITEM_FRESH_MS,
    })
      .then((item) => {
        if (cancelled) return;
        setTargetItem({
          ...item,
          projectPath: cwd,
          provider: "github",
        });
      })
      .catch(() => {
        // The normal Inbox remains usable when an exact lookup is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, items, target, targetSelectionKey]);

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
    setSelectedKey(key);
    setDetailOpen(true);
  });
  const visibleItems = useMemo(() => {
    if (!sourceAvailable) return [];
    const visible = filterCodeHostScopes(
      applyInboxFilters(
        pullRequestsOnly ? items.filter((item) => item.kind === "pr") : items,
        activeFilters,
        deferredSearch,
        Date.now(),
        source,
      ),
      codeScopes.provider,
      codeScopes.scopes,
      codeScopes.hidden,
    );
    if (pullRequestsOnly)
      return [...visible].sort((a, b) =>
        prSort === "title"
          ? a.title.localeCompare(b.title)
          : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
    if (!target || source !== "github") return visible;
    const targeted =
      items.find((item) => inboxItemMatchesLinkedWorkItem(item, target)) ??
      (targetItem && inboxItemMatchesLinkedWorkItem(targetItem, target) ? targetItem : null);
    if (!targeted || visible.includes(targeted)) return visible;
    return [targeted, ...visible];
  }, [
    pullRequestsOnly,
    prSort,
    activeFilters,
    items,
    deferredSearch,
    source,
    sourceAvailable,
    target,
    targetItem,
    codeScopes.provider,
    codeScopes.scopes,
    codeScopes.hidden,
  ]);

  const inboxSeenTick = useInboxSeenTick();
  useEffect(() => {
    rememberInboxItems(
      items.map((item) => ({
        key: inboxItemKey(item),
        updatedAt: item.updatedAt,
        projectPath: item.projectPath,
      })),
    );
  }, [items]);
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
  const sourceLimited = inboxQuery.data?.limited?.includes(source) ?? false;

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
  const updateInboxItem = useCallback((next: InboxItem) => {
    const key = inboxItemKey(next);
    setItems((current) => current.map((entry) => (inboxItemKey(entry) === key ? next : entry)));
    queryClient.setQueryData<Awaited<ReturnType<typeof listInboxItems>>>(
      inboxQueryKey,
      (current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) => (inboxItemKey(entry) === key ? next : entry)),
            }
          : current,
    );
    setTargetItem((current) => (current && inboxItemKey(current) === key ? next : current));
  }, []);
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

  useEffect(() => {
    if (loading) return;
    if (!selected) {
      // An unavailable identity must not silently become the first remaining
      // result. A deliberate row selection is required after removal.
      return;
    }
    const key = inboxItemKey(selected);
    // Keep waiting while the exact cache-miss lookup loads. Otherwise the
    // current list's first row replaces the requested key.
    if (targetSelectionKey && selectedKey === targetSelectionKey && key !== targetSelectionKey) {
      return;
    }
    if (key !== selectedKey) setSelectedKey(key);
  }, [loading, selected, selectedKey, targetSelectionKey, setSelectedKey]);

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
    setSelectedKey(null);
    setBoardIssue(null);
    setSource(next);
    if (!pullRequestsOnly) saveInboxSource(next);
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
        <div
          role="tablist"
          aria-label={t("Inbox source")}
          className="flex min-w-0 basis-0 items-center gap-px"
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
        </div>
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
          title={t("Connect an inbox source")}
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
                title={t("Sort pull requests")}
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
            title={t("Mark loaded {p0} items as read", { p0: INBOX_SOURCE_LABELS[source] })}
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
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-ui-secondary text-(--ui-text-secondary)">
            <WorkingIndicator size="md" />{t("Loading...")}
          </div>
        ) : pullRequestsOnly && visibleItems.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            description={
              projects.length === 0
                ? t("Add a project to see its repository's pull requests.")
                : t("No loaded items match these filters.")
            }
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            description={
              !isTrackerSource(source) && projects.length === 0
                ? t("Open a project to fill the inbox")
                : t("No loaded items match these filters.")
            }
          />
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
      <div
        {...resize.separatorProps}
        aria-label={t("Resize inbox list")}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-(--ui-surface-selected)" : "hover:bg-(--ui-surface-hover)"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
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
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-(--ui-tone-neutral-border)"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
            <Inbox className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
            <h1 className="min-w-0 truncate text-(--ui-tone-neutral-fg)">
              {pullRequestsOnly ? t("Pull Requests") : t("Inbox")}
            </h1>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>

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
  const cachedItem = peekGithubWorkItem(target.repo, target.kind, target.number, cwd);
  const [item, setItem] = useState<InboxItem | null>(() =>
    cachedItem ? { ...cachedItem, projectPath: cwd, provider: "github" } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedItem == null);
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
    let cancelled = false;
    const cached = peekGithubWorkItem(target.repo, target.kind, target.number, cwd);
    setItem(cached ? { ...cached, projectPath: cwd, provider: "github" } : null);
    setError(null);
    setLoading(cached == null);
    void githubWorkItem(cwd, target.repo, target.kind, target.number, {
      maxAgeMs: GITHUB_WORK_ITEM_FRESH_MS,
    })
      .then((next) => {
        if (cancelled) return;
        setItem({ ...next, projectPath: cwd, provider: "github" });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, target.kind, target.number, target.repo]);

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
      className={`@container/linked relative min-h-0 max-w-full shrink-0 flex-col border-l border-(--ui-pane-border) text-(--ui-tone-neutral-fg) max-[950px]:absolute max-[950px]:inset-y-0 max-[950px]:right-0 max-[950px]:z-30 max-[950px]:shadow-(--ui-elevation-floating) ${
        visible ? "flex linked-work-item-enter" : "hidden"
      }`}
    >
      <div
        {...resize.separatorProps}
        aria-label={t("Resize linked {p0} panel", { p0: kindLabel.toLowerCase() })}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        className={`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none ${
          resize.dragging ? "bg-(--ui-surface-selected)" : "hover:bg-(--ui-surface-hover)"
        }`}
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
            <LoaderCircle className="icon-md animate-spin" strokeWidth={1.75} />
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
      title={item.title}
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
