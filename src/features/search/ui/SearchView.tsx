import { errorText } from "../../../shared/lib/errors";
import { Tooltip } from "../../../shared/ui/Tooltip";
import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../shared/ui/ActionHost";
import { PickerListRoot } from "../../../shared/ui/picker/PickerList";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { terminalText } from "../../../shared/lib/terminalText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Alert } from "../../../shared/ui/Alert";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { ListRow } from "../../../shared/ui/ListRow";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Spinner } from "../../../shared/ui/Spinner";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Modal } from "../../../shared/ui/Modal";
import "./search.css";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/model/projectNames";
import { t, useLocale } from "../../../shared/i18n";
import { Search, Maximize2, Minimize2 } from "../../../shared/ui/icons";
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { rowCopy } from "./searchRowCopy";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import {
  conversationRowsFrom,
  flattenGrouped,
  groupHitsWithCounts,
  hitsFromContentMatches,
  hitsFromFileRanks,
  mergeHits,
  searchConversationTitles,
  searchRecentProjects,
  SessionMessageSearch,
  type AppSearchHit,
  type SearchScope,
  type SearchRequest,
} from "../model/appSearch";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
  useFileRanking,
} from "../../files/public/fileIndex";
import { pathKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { type OpenFileFn } from "../model/search";
import { type Session } from "../../sessions/model/session";
import { type SessionSummary } from "../../sessions/data/sessionStore";
import { loadProjectGroupAssignments, loadProjectGroups } from "../../projects/model/projectGroups";
import {
  chatEntries,
  chatGroupFor,
  DEFAULT_CHAT_FILTERS,
  groupChatSessions,
  hitsFromContentSessions,
  scopeCwds,
  sinceFor,
  type ChatFilters,
} from "../model/chatSearch";
import { ChatFilterBar, ChatSearchResults } from "./ChatSearchResults";
import { useConversationSearch } from "../model/useConversationSearch";
import { useProjectFileSearch } from "../model/useProjectFileSearch";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { isImeComposition } from "../../../shared/lib/keyboard";

const SCOPES: { id: SearchScope; label: string }[] = [
  {
    id: "all",
    get label() {
      return t("All");
    },
  },
  {
    id: "conversations",
    get label() {
      return t("Sessions");
    },
  },
  {
    id: "files",
    get label() {
      return t("Files");
    },
  },
  {
    id: "projects",
    get label() {
      return t("Projects");
    },
  },
];

type Props = {
  open: boolean;
  presentation?: "dialog" | "page";
  onExpand?: () => void;
  onCompact?: () => void;
  cwd: string;
  recents: RecentProject[];
  history: SessionSummary[];
  sessions: Session[];
  focusToken?: number;
  request?: SearchRequest;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  onOpenFile: OpenFileFn;
  onOpenSession: (sessionId: string, blockId?: string, query?: string) => void;
  onOpenProject: (path: string) => void;
};

const NO_RECENT_PATHS: string[] = [];

export function SearchView({
  open,
  presentation = "page",
  onExpand,
  onCompact,
  cwd,
  recents,
  history,
  sessions,
  focusToken = 0,
  request,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onOpenFile,
  onOpenSession,
  onOpenProject,
}: Props) {
  useLocale();
  const projectLabels = useProjectLabels();
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const stateKey = `workspace-search:${pathKey(cwd)}`;
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [scope, setScope] = useRetainedState<SearchScope>(`${stateKey}:scope`, "all");
  const listId = useId();
  const [selection, setSelection] = useRetainedState<{
    context: string;
    id: string | null;
  }>(`${stateKey}:active`, { context: "", id: null });
  const [fileIndex, setFileIndex] = useState(() => ({
    cwd,
    files: peekProjectFiles(cwd) ?? [],
  }));
  const [fileIndexError, setFileIndexError] = useState<{
    cwd: string;
    error: string;
  } | null>(null);
  const [fileRetry, setFileRetry] = useState(0);
  const [resultCapacity, setResultCapacity] = useState({
    context: "",
    rows: 0,
  });
  const files = fileIndex.cwd === cwd ? fileIndex.files : [];
  const [chatFilters, setChatFilters] = useRetainedState<ChatFilters>(
    `${stateKey}:filters`,
    DEFAULT_CHAT_FILTERS,
  );

  const appliedRequest = useRef<SearchRequest | undefined>(undefined);
  const sourceScope = open && request && appliedRequest.current !== request ? request.scope : scope;
  const trimmed = query.trim();
  const fileMode = sourceScope === "all" || sourceScope === "files";
  const conversationMode = sourceScope === "all" || sourceScope === "conversations";
  const filesEnabled = open && fileMode;
  const localConversationsEnabled = open && sourceScope === "all";
  const projectsEnabled = open && (sourceScope === "all" || sourceScope === "projects");

  useEffect(() => {
    if (!open || !request || appliedRequest.current === request) return;
    appliedRequest.current = request;
    setScope(request.scope);
    if (request.query !== undefined) setQuery(request.query);
    const conversationScope = request.conversationScope;
    if (conversationScope) {
      setChatFilters((filters) => ({ ...filters, scope: conversationScope }));
    }
  }, [open, request, setScope, setQuery, setChatFilters]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        isImeComposition(event) ||
        event.defaultPrevented ||
        hasActiveOverlay()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the visible file index in sync with file-index notifications and release its subscription when hidden.
  useEffect(() => {
    if (!filesEnabled) return;
    if (!looksLikeProject(cwd)) {
      setFileIndex({ cwd, files: [] });
      return;
    }
    let cancelled = false;
    let revision = 0;
    const refresh = (activate = false) => {
      const requestedRevision = ++revision;
      setFileIndexError(null);
      const cached = peekProjectFiles(cwd);
      setFileIndex({ cwd, files: cached ?? [] });
      if (cached && !activate) return;
      void loadProjectFiles(cwd)
        .then((next) => {
          if (!cancelled && revision === requestedRevision) setFileIndex({ cwd, files: next });
        })
        .catch((error: unknown) => {
          if (!cancelled && revision === requestedRevision)
            setFileIndexError({
              cwd,
              error: errorText(error),
            });
        });
    };
    const unsubscribe = subscribeProjectFiles(() => refresh());
    refresh(true);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cwd, filesEnabled, fileRetry]);

  const deferredTrimmed = useDeferredValue(trimmed);
  const deferredSessions = useDeferredValue(sessions);
  const [messageSearch] = useState(() => new SessionMessageSearch());
  const conversationRows = useMemo(
    () => (localConversationsEnabled ? conversationRowsFrom(history, deferredSessions) : []),
    [localConversationsEnabled, history, deferredSessions],
  );
  const recentPaths = recentOpenedFiles(cwd);
  const { results: rankedFiles, pending: rankingPending } = useFileRanking(
    filesEnabled && !!trimmed && looksLikeProject(cwd),
    cwd,
    files,
    deferredTrimmed,
    recentPaths.length ? recentPaths : NO_RECENT_PATHS,
    { limit: 40, backgroundQuery: trimmed },
  );
  const fileHits = useMemo(() => hitsFromFileRanks(rankedFiles), [rankedFiles]);
  const titleHits = useMemo(
    () =>
      localConversationsEnabled && deferredTrimmed
        ? searchConversationTitles(conversationRows, deferredTrimmed)
        : [],
    [localConversationsEnabled, conversationRows, deferredTrimmed],
  );
  const liveMessageHits = useMemo(() => {
    if (!localConversationsEnabled) return [];
    // The row's recency is the session's own timestamp (`Session` carries none).
    const eligibleUpdatedAt = new Map(
      conversationRows.map((session) => [session.id, session.updatedAt]),
    );
    return messageSearch.search(
      deferredTrimmed
        ? deferredSessions
            .filter((session) => eligibleUpdatedAt.has(session.id))
            .map((session) => ({
              id: session.id,
              cwd: session.cwd,
              harness: session.harness,
              title: session.title,
              updatedAt: eligibleUpdatedAt.get(session.id) ?? 0,
              blocks: session.blocks,
            }))
        : [],
      deferredTrimmed,
    );
  }, [
    localConversationsEnabled,
    conversationRows,
    messageSearch,
    deferredSessions,
    deferredTrimmed,
  ]);
  const projectHits = useMemo(
    () => (projectsEnabled && trimmed ? searchRecentProjects(recents, trimmed, projectLabels) : []),
    [projectsEnabled, recents, trimmed, projectLabels],
  );
  const grouping = useMemo(
    () => {
      const groups = loadProjectGroups();
      return { groups, assignments: loadProjectGroupAssignments(groups) };
    },
    // Re-read when the search opens or the project list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadProjectGroups reads stored state, so it must re-run on open and on recents change only
    [open, recents],
  );
  // The filters belong to the Conversations tab; the All tab searches everywhere.
  const filters = scope === "conversations" ? chatFilters : DEFAULT_CHAT_FILTERS;
  const conversationOptions = useMemo(
    () => ({
      query: trimmed,
      cwds: scopeCwds(filters.scope, cwd, recents, grouping),
      harness: filters.harness === "any" ? undefined : filters.harness,
      includeArchived: filters.archived,
      since: sinceFor(filters.range),
    }),
    [trimmed, filters, cwd, recents, grouping],
  );
  const conversationRevision = useMemo(
    () =>
      open && conversationMode
        ? JSON.stringify([
            history.map((session) => session.id).sort(),
            sessions.map((session) => session.id).sort(),
          ])
        : "",
    [open, conversationMode, history, sessions],
  );
  const conversation = useConversationSearch(
    open && conversationMode,
    conversationOptions,
    conversationRevision,
  );
  const chatSessions = conversation.result.sessions;
  const pendingIndex = conversation.result.pending;
  const projectSearch = useProjectFileSearch(filesEnabled && looksLikeProject(cwd), cwd, trimmed);
  const contentHits = useMemo(
    () => hitsFromContentMatches(projectSearch.result.matches),
    [projectSearch.result.matches],
  );
  const error =
    scope === "all" || scope === "files"
      ? (projectSearch.error ?? (fileIndexError?.cwd === cwd ? fileIndexError.error : null))
      : null;
  const conversationError = conversationMode ? conversation.error : null;
  // A machine connection failure is explained once by the central notice, not by this strip.
  const fileShownCentrally = useConnectionErrorShownCentrally(error);
  const conversationShownCentrally = useConnectionErrorShownCentrally(conversationError);
  const showFileError = !!error && !fileShownCentrally;
  const showConversationError = !!conversationError && !conversationShownCentrally;
  const loading =
    rankingPending ||
    (fileMode && projectSearch.loading) ||
    (conversationMode && conversation.loading) ||
    deferredTrimmed !== trimmed;
  const truncated =
    (fileMode && projectSearch.result.truncated) ||
    (conversationMode && conversation.result.truncated);
  // "Everywhere" searches every stored conversation, so results from locked
  // groups are dropped here, and again if a group locks while they are shown.
  const lock = useLockSnapshot();
  const visibleChatSessions = useMemo(
    () => chatSessions.filter((session) => !isProjectLockedIn(lock, session.cwd)),
    [chatSessions, lock],
  );
  const remoteHits = useMemo(
    () => hitsFromContentSessions(visibleChatSessions),
    [visibleChatSessions],
  );
  const chatGroups = useMemo(
    () => groupChatSessions(visibleChatSessions, grouping, projectLabels),
    [visibleChatSessions, grouping, projectLabels],
  );
  const chatRows = useMemo(() => chatEntries(chatGroups), [chatGroups]);

  const hasQuery = !!trimmed;
  const grouped = useMemo(() => {
    const eligible = hasQuery
      ? mergeHits(
          titleHits,
          liveMessageHits,
          remoteHits,
          fileHits,
          contentHits,
          projectHits,
        ).filter(
          (hit) =>
            !isProjectLockedIn(
              lock,
              hit.kind === "conversation" || hit.kind === "message"
                ? hit.cwd
                : hit.kind === "project"
                  ? hit.path
                  : cwd,
            ),
        )
      : [];
    return groupHitsWithCounts(eligible, scope);
  }, [
    contentHits,
    fileHits,
    liveMessageHits,
    projectHits,
    remoteHits,
    scope,
    titleHits,
    hasQuery,
    lock,
    cwd,
  ]);
  const hits = useMemo(() => flattenGrouped(grouped.grouped), [grouped]);

  // The Conversations tab lists results by project, with its own rows to step
  // through; every other tab steps through `hits`.
  const chatMode = scope === "conversations";
  const rowCount = chatMode ? chatRows.length : hits.length;
  const resultsCurrent = deferredTrimmed === trimmed && !rankingPending;
  const rowIds = useMemo(
    () => (chatMode ? chatRows : hits).map((row) => row.id),
    [chatMode, chatRows, hits],
  );
  const selectionContext = JSON.stringify([cwd, trimmed, scope, filters]);
  const selectedIndex =
    selection.context === selectionContext && selection.id !== null
      ? rowIds.indexOf(selection.id)
      : -1;
  const active = selectedIndex >= 0 ? selectedIndex : 0;
  const setActive = (index: number) =>
    setSelection({ context: selectionContext, id: rowIds[index] ?? null });
  const optionId = (index: number) => `${listId}-option-${index}`;
  const capacity =
    resultCapacity.context === selectionContext
      ? Math.max(resultCapacity.rows, rowCount)
      : rowCount;

  // The list never shrinks within one search context, so the panel keeps its height.
  if (
    deferredTrimmed === trimmed &&
    !(resultCapacity.context === selectionContext && resultCapacity.rows >= rowCount)
  ) {
    setResultCapacity({
      context: selectionContext,
      rows:
        resultCapacity.context === selectionContext
          ? Math.max(resultCapacity.rows, rowCount)
          : rowCount,
    });
  }

  useEffect(() => {
    if (!resultsCurrent) return;
    if (
      selection.context !== selectionContext ||
      (selection.id !== null && !rowIds.includes(selection.id)) ||
      (selection.id === null && rowIds.length > 0)
    ) {
      setSelection({ context: selectionContext, id: rowIds[0] ?? null });
    }
  }, [selection.context, selection.id, selectionContext, rowIds, setSelection, resultsCurrent]);

  const openChat = (entry: { sessionId: string; blockId?: string } | undefined) => {
    if (!resultsCurrent || !entry) return;
    onOpenSession(entry.sessionId, entry.blockId, trimmed);
    onClose();
  };

  const openHit = useStableCallback((hit: AppSearchHit | null) => {
    if (!resultsCurrent || !hit) return;
    if (hit.kind === "file") {
      onOpenFile(hit.path, undefined, { exact: true });
    } else if (hit.kind === "content") {
      onOpenFile(hit.path, { line: hit.line, column: hit.column }, { exact: true });
    } else if (hit.kind === "conversation") {
      onOpenSession(hit.sessionId);
    } else if (hit.kind === "message") {
      onOpenSession(hit.sessionId, hit.blockId, trimmed);
    } else onOpenProject(hit.path);
    onClose();
  });

  const onActiveResult = useStableCallback((index: number) => {
    if (resultsCurrent) setActive(index);
  });

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!resultsCurrent || rowCount === 0) return;
      setActive((active + 1) % rowCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!resultsCurrent || rowCount === 0) return;
      setActive((active - 1 + rowCount) % rowCount);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (deferredTrimmed !== trimmed) return;
      if (chatMode) openChat(chatRows[active]);
      else openHit(hits[active] ?? null);
    }
  };

  if (!open) return null;

  const empty = !trimmed;
  const indexing = pendingIndex > 0 && (scope === "all" || chatMode);
  const noResults = !empty && rowCount === 0 && !loading && !error && !conversationError;
  const limitNotice =
    !empty && resultsCurrent && (truncated || (!chatMode && grouped.omitted > 0)) ? (
      <Text as="p" size="micro" tone="muted" className="px-2.5 py-1">
        {truncated ? t("Results limited to the first matches") : t("Showing first matches")}
        {!chatMode && grouped.omitted > 0
          ? ` · ${grouped.omitted} ${t("more loaded matches")}`
          : ""}
      </Text>
    ) : null;
  const indexNotice =
    pendingIndex > 0 && !conversationError && conversationMode ? (
      <div className="flex items-center gap-1 px-2 py-1">
        <LoadingText delay={false}>
          {pendingIndex === 1
            ? t("Indexing {p0} conversation", { p0: pendingIndex })
            : t("Indexing {p0} conversations", { p0: pendingIndex })}
        </LoadingText>
        <InfoTooltip label={t("Indexing status")}>
          {t("Results may be incomplete until indexing finishes.")}
        </InfoTooltip>
      </div>
    ) : null;

  const searchField = (
    <SearchInputGroup appearance="field" className="w-full">
      <Search className="icon-sm shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <SearchInput
        type="search"
        focusOwner="group"
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onQueryKeyDown}
        placeholder={t("Search files, conversations, and projects")}
        aria-label={t("Search")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={!empty && rowCount > 0}
        aria-controls={!empty && rowCount > 0 ? listId : undefined}
        aria-activedescendant={
          resultsCurrent && !empty && rowCount > 0 ? optionId(active) : undefined
        }
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        data-tauri-drag-region="false"
        className="min-w-0 flex-1 select-text"
      />
      {loading ? <Spinner size="sm" className="shrink-0" tone="secondary" /> : null}
    </SearchInputGroup>
  );

  const content = (
    <Text
      as="div"
      size="inherit"
      tone="primary"
      role="search"
      aria-label={t("Search")}
      data-app-search
      data-search-empty={empty || undefined}
      data-search-size={capacity <= 4 ? "small" : capacity <= 10 ? "medium" : "large"}
      className={`app-search @container/search flex min-h-0 min-w-0 flex-1 flex-col ${presentation === "dialog" ? "app-search-dialog" : ""}`}
    >
      <div className="flex shrink-0 flex-col">
        {presentation === "page" ? (
          <PaneHeader
            dragRegion
            chromeInset={!besideRail ? true : compactRail ? "compact" : false}
            className="select-none"
            leading={
              !besideRail ? <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} /> : null
            }
            actions={
              onCompact ? (
                <Button variant="ghost" iconOnly label={t("Restore")} onClick={onCompact}>
                  <Minimize2 className="icon-sm" />
                </Button>
              ) : null
            }
            trailing={!IS_MAC ? <WindowControls /> : null}
          >
            <div className="min-w-0 flex-1 px-2">{searchField}</div>
          </PaneHeader>
        ) : null}

        <div className="app-search-mode-band">
          <SegmentedControl
            label={t("Search in")}
            value={scope}
            onValueChange={(value) => setScope(value as SearchScope)}
            options={SCOPES.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
          />
          {scope === "files" ? (
            <Text size="caption" tone="secondary" truncate className="min-w-0 flex-1">
              {projectDisplayNameFrom(cwd, projectLabels)}
            </Text>
          ) : null}
          {chatMode ? (
            <ChatFilterBar
              filters={chatFilters}
              inGroup={Boolean(chatGroupFor(cwd, grouping))}
              onChange={setChatFilters}
            />
          ) : null}
        </div>
        {limitNotice}
      </div>

      {!empty && (showFileError || showConversationError) ? (
        <Alert
          tone="danger"
          title={t("Search failed")}
          className="mx-2 mt-2 shrink-0 break-words"
          extra={
            <>
              <ErrorDetails
                detail={[
                  showFileError ? error : null,
                  showConversationError ? conversationError : null,
                ]
                  .filter(Boolean)
                  .join("\n")}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (showFileError) {
                    projectSearch.retry();
                    setFileRetry((value) => value + 1);
                  }
                  if (showConversationError) conversation.retry();
                }}
              >
                {t("Retry")}
              </Button>
            </>
          }
        />
      ) : null}

      <div
        ref={lockOverscroll}
        aria-busy={loading}
        className={
          empty
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none px-3 py-2"
            : "min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
        }
      >
        {!empty && loading && rowCount === 0 ? (
          <LoadingText delay={false} inset="row">
            {t("Searching…")}
          </LoadingText>
        ) : null}
        {empty ? (
          <EmptyState
            context="panel"
            illustration="search-empty"
            description={t("Type to search across the project")}
          />
        ) : noResults ? (
          <EmptyState
            size="inline"
            kind="filtered"
            inset="row"
            description={indexing ? t("No indexed matches yet") : t("No results")}
          />
        ) : chatMode ? (
          <>
            {indexNotice}
            <ChatSearchResults
              listId={listId}
              groups={chatGroups}
              entries={chatRows}
              active={resultsCurrent ? active : -1}
              onActive={(index) => {
                if (resultsCurrent) setActive(index);
              }}
              onOpen={openChat}
            />
          </>
        ) : (
          <>
            {indexNotice}
            <ResultList
              projectLabels={projectLabels}
              listId={listId}
              hits={hits}
              active={resultsCurrent ? active : -1}
              query={deferredTrimmed}
              onActive={onActiveResult}
              onOpen={openHit}
            />
          </>
        )}
      </div>
    </Text>
  );
  return presentation === "dialog" ? (
    <Modal
      scroll="none"
      padding="none"
      title={t("Search")}
      size="lg"
      onClose={onClose}
      toolbar={
        <>
          <div className="min-w-0 flex-1">{searchField}</div>
          <Button variant="ghost" iconOnly label={t("Full screen")} onClick={onExpand}>
            <Maximize2 className="icon-sm" />
          </Button>
        </>
      }
    >
      {content}
    </Modal>
  ) : (
    content
  );
}

function ResultList({
  projectLabels,
  listId,
  hits,
  active,
  query,
  onActive,
  onOpen,
}: {
  projectLabels: Record<string, string>;
  listId: string;
  hits: AppSearchHit[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onOpen: (hit: AppSearchHit) => void;
}) {
  "use memo";
  useLocale();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [hits]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.clientX === pointer.current.x && event.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  return (
    <PickerListRoot id={listId} label={t("Search results")} onMouseMove={onListMouseMove}>
      {hits.map((hit, index) => {
        const highlighted = index === active;
        const row = rowCopy(hit, query, projectLabels);
        const heading =
          hit.kind === "conversation"
            ? t("Sessions")
            : hit.kind === "message"
              ? t("Messages")
              : hit.kind === "file"
                ? t("Files")
                : hit.kind === "content"
                  ? t("File content")
                  : t("Projects");
        const fullIdentity =
          hit.kind === "file"
            ? hit.path
            : hit.kind === "content"
              ? `${hit.path}:${hit.line}:${hit.column}`
              : hit.kind === "project"
                ? hit.path
                : `${terminalText(hit.title).text}\n${hit.cwd}`;
        return (
          <div key={hit.id} role="presentation">
            {index === 0 || hits[index - 1].kind !== hit.kind ? (
              <Text
                as="div"
                size="caption"
                tone="secondary"
                weight="medium"
                role="presentation"
                className="flex items-center gap-2 px-2 pb-1 pt-2"
              >
                <span>{heading}</span>
              </Text>
            ) : null}
            <Tooltip label={fullIdentity} when="overflow">
              <ListRow
                active={highlighted}
                aria-selected={highlighted}
                {...actionContentScopeAttributes()}
                className="app-search-result"
                id={`${listId}-option-${index}`}
                ref={highlighted ? activeRef : undefined}
                role="option"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onRowEnter(index)}
                onClick={() => onOpen(hit)}
              >
                <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                  {row.icon}
                </span>
                <span className="app-search-result-copy">
                  <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="medium"
                    leading="inherit"
                    truncate
                    {...actionContentAttributes(
                      { phase: "always", reveal: "wrap" },
                      "app-search-result-title",
                    )}
                  >
                    {row.title}
                  </Text>
                  {row.preview ? (
                    <Text
                      size="inherit"
                      tone="secondary"
                      leading="inherit"
                      {...actionContentAttributes({
                        phase: "always",
                        reveal: "preview",
                      })}
                      {...motionAttributes(
                        { transition: "size", duration: "standard" },
                        actionContentAttributes(
                          { phase: "always", reveal: "preview" },
                          "app-search-result-preview",
                        ).className,
                      )}
                    >
                      {row.preview}
                    </Text>
                  ) : null}
                  <Text
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    truncate
                    {...actionContentAttributes(
                      { phase: "always", reveal: "wrap" },
                      "app-search-result-meta",
                    )}
                  >
                    {row.meta}
                  </Text>
                </span>
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className="app-search-result-kind sr-only"
                >
                  {hit.kind === "conversation"
                    ? t("Session")
                    : hit.kind === "message"
                      ? t("Message")
                      : hit.kind === "project"
                        ? t("Project")
                        : t("File")}
                </Text>
              </ListRow>
            </Tooltip>
          </div>
        );
      })}
    </PickerListRoot>
  );
}
