import { terminalText } from "../../../shared/lib/terminalText";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Spinner } from "../../../shared/ui/Spinner";
import { Modal } from "../../../shared/ui/Modal";
import "./search.css";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { projectDisplayName } from "../../projects/model/projectNames";
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
import {
  conversationRowsFrom,
  flattenGrouped,
  groupHitsWithCounts,
  type GroupedHitCounts,
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
  rankProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../files/model/fileIndex";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
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
      return t("Conversations");
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
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const stateKey = `workspace-search:${pathKey(cwd)}`;
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [scope, setScope] = useRetainedState<SearchScope>(`${stateKey}:scope`, "all");
  const listId = useId();
  const scopeId = useId();
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
  const [resultCapacity, setResultCapacity] = useState({ context: "", rows: 0 });
  const files = fileIndex.cwd === cwd ? fileIndex.files : [];
  const [chatFilters, setChatFilters] = useRetainedState<ChatFilters>(
    `${stateKey}:filters`,
    DEFAULT_CHAT_FILTERS,
  );

  const trimmed = query.trim();

  const appliedRequest = useRef<SearchRequest | undefined>(undefined);
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

  useEffect(() => {
    if (!open) return;
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
              error: error instanceof Error ? error.message : String(error),
            });
        });
    };
    const unsubscribe = subscribeProjectFiles(() => refresh());
    refresh(true);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cwd, open, fileRetry]);

  const deferredTrimmed = useDeferredValue(trimmed);
  const deferredSessions = useDeferredValue(sessions);
  const [messageSearch] = useState(() => new SessionMessageSearch());
  const conversationRows = useMemo(
    () => conversationRowsFrom(history, deferredSessions),
    [history, deferredSessions],
  );
  const fileHits = useMemo(
    () =>
      deferredTrimmed && looksLikeProject(cwd)
        ? hitsFromFileRanks(rankProjectFiles(files, deferredTrimmed, recentOpenedFiles(cwd), 40))
        : [],
    [cwd, files, deferredTrimmed],
  );
  const titleHits = useMemo(
    () => (deferredTrimmed ? searchConversationTitles(conversationRows, deferredTrimmed) : []),
    [conversationRows, deferredTrimmed],
  );
  const liveMessageHits = useMemo(
    () =>
      messageSearch.search(
        deferredTrimmed
          ? deferredSessions.map((session) => ({
              id: session.id,
              cwd: session.cwd,
              harness: session.harness,
              title: session.title,
              updatedAt: Date.now(),
              blocks: session.blocks,
            }))
          : [],
        deferredTrimmed,
      ),
    [messageSearch, deferredSessions, deferredTrimmed],
  );
  const projectHits = useMemo(
    () => (trimmed ? searchRecentProjects(recents, trimmed) : []),
    [recents, trimmed],
  );
  const grouping = useMemo(
    () => {
      const groups = loadProjectGroups();
      return { groups, assignments: loadProjectGroupAssignments(groups) };
    },
    // Re-read when the search opens or the project list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      JSON.stringify([
        history.map((session) => session.id).sort(),
        sessions.map((session) => session.id).sort(),
      ]),
    [history, sessions],
  );
  const conversation = useConversationSearch(
    open && (scope === "all" || scope === "conversations"),
    conversationOptions,
    conversationRevision,
  );
  const chatSessions = conversation.result.sessions;
  const pendingIndex = conversation.result.pending;
  const projectSearch = useProjectFileSearch(
    open && (scope === "all" || scope === "files") && looksLikeProject(cwd),
    cwd,
    trimmed,
  );
  const contentHits = useMemo(
    () => hitsFromContentMatches(projectSearch.result.matches),
    [projectSearch.result.matches],
  );
  const error =
    scope === "all" || scope === "files"
      ? (projectSearch.error ?? (fileIndexError?.cwd === cwd ? fileIndexError.error : null))
      : null;
  const fileMode = scope === "all" || scope === "files";
  const conversationMode = scope === "all" || scope === "conversations";
  const conversationError = conversationMode ? conversation.error : null;
  const loading =
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
    () => groupChatSessions(visibleChatSessions, grouping),
    [visibleChatSessions, grouping],
  );
  const chatRows = useMemo(() => chatEntries(chatGroups), [chatGroups]);

  const grouped = useMemo(() => {
    const eligible = trimmed
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
    trimmed,
    lock,
    cwd,
  ]);
  const hits = useMemo(() => flattenGrouped(grouped.grouped), [grouped]);

  // The Conversations tab lists results by project, with its own rows to step
  // through; every other tab steps through `hits`.
  const chatMode = scope === "conversations";
  const rowCount = chatMode ? chatRows.length : hits.length;
  const resultsCurrent = deferredTrimmed === trimmed;
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

  const openHit = (hit: AppSearchHit | null) => {
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
  };

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
  const projectScope = looksLikeProject(cwd)
    ? `${projectDisplayName(cwd)} · ${prettyCwd(cwd)}`
    : t("No project folder");
  const scopeCopy =
    scope === "files"
      ? `${t("Files")}: ${projectScope}`
      : scope === "projects"
        ? t("Recent projects")
        : chatMode
          ? `${t(filters.scope === "everywhere" ? "Everywhere" : filters.scope === "group" ? "This group" : "This project")}${filters.scope === "everywhere" ? "" : ` · ${projectDisplayName(cwd)}`}`
          : `${t("Files")}: ${projectScope} · ${t("Conversations")}: ${t("Everywhere")} · ${t("Recent projects")}`;
  const limitNotice =
    !empty && (truncated || (!chatMode && grouped.omitted > 0)) ? (
      <InfoPopover label={t("Search result limits")}>
        <p>
          {truncated ? t("Results limited to the first matches") : t("Showing first matches")}
          {!chatMode && grouped.omitted > 0
            ? ` · ${grouped.omitted} ${t("more loaded matches")}`
            : ""}
        </p>
      </InfoPopover>
    ) : null;
  const indexNotice =
    pendingIndex > 0 && !conversationError && conversationMode ? (
      <p className="px-2.5 py-1 text-ui-micro text-(--ui-text-muted)">
        {t("Application-wide indexing")}: {t("Indexing ")}
        {pendingIndex}
        {t(" conversation")}
        {pendingIndex === 1 ? "" : "s"}
        {t(". Results may be incomplete.")}
      </p>
    ) : null;

  const content = (
    <div
      role="search"
      aria-label={t("Search")}
      data-app-search
      data-search-empty={empty || undefined}
      data-search-size={capacity <= 4 ? "small" : capacity <= 10 ? "medium" : "large"}
      className={`app-search @container/search flex min-h-0 min-w-0 flex-1 flex-col text-content ${presentation === "dialog" ? "app-search-dialog" : ""}`}
    >
      <div className="flex shrink-0 flex-col">
        <PaneHeader
          dragRegion={presentation === "page"}
          chromeInset={
            presentation === "page" ? (!besideRail ? true : compactRail ? "compact" : false) : false
          }
          className="select-none"
          leading={
            presentation === "page" && !besideRail ? (
              <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
            ) : null
          }
          actions={
            presentation === "dialog" ? (
              <Button variant="ghost" iconOnly label={t("Full screen")} onClick={onExpand}>
                <Maximize2 className="icon-sm" />
              </Button>
            ) : onCompact ? (
              <Button variant="ghost" iconOnly label={t("Restore")} onClick={onCompact}>
                <Minimize2 className="icon-sm" />
              </Button>
            ) : null
          }
          trailing={presentation === "page" && !IS_MAC ? <WindowControls /> : null}
        >
          <div className="min-w-0 flex-1 px-2">
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
                aria-describedby={scopeId}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                data-tauri-drag-region="false"
                className="min-w-0 flex-1 select-text"
              />
              {loading ? (
                <Spinner size="sm" className="shrink-0 text-(--ui-text-secondary)" />
              ) : null}
            </SearchInputGroup>
          </div>
        </PaneHeader>

        <div className="app-search-mode-band">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <SegmentedControl
              label={t("Search in")}
              value={scope}
              onValueChange={(value) => setScope(value as SearchScope)}
              options={SCOPES.map((item) => ({ value: item.id, label: item.label }))}
            />
          </div>
          {chatMode ? (
            <ChatFilterBar
              filters={chatFilters}
              inGroup={Boolean(chatGroupFor(cwd, grouping))}
              onChange={setChatFilters}
            />
          ) : null}
        </div>
      </div>

      <div className="app-search-scope-summary">
        <p id={scopeId}>{scopeCopy}</p>
        {limitNotice}
      </div>

      {!empty && (error || conversationError) ? (
        <Alert tone="danger" className="mx-2 mt-2 max-h-40 shrink-0 overflow-auto break-words">
          {error ? (
            <p>
              {t("File search failed: ")}
              {error}{" "}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  projectSearch.retry();
                  setFileRetry((value) => value + 1);
                }}
              >
                {t("Retry file search")}
              </Button>
            </p>
          ) : null}
          {conversationError ? (
            <p>
              {t("Conversation search failed: ")}
              {conversationError}{" "}
              <Button variant="ghost" size="sm" type="button" onClick={conversation.retry}>
                {t("Retry conversation search")}
              </Button>
            </p>
          ) : null}
          {rowCount > 0 ? <p>{t("Results below may be incomplete.")}</p> : null}
        </Alert>
      ) : null}

      <div
        ref={lockOverscroll}
        aria-busy={loading}
        className={
          empty
            ? "min-h-0 overflow-y-auto overscroll-none px-3 py-2"
            : "min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
        }
      >
        {!empty && loading && rowCount === 0 ? (
          <p role="status" className="px-2 py-1.5 text-ui-caption text-(--ui-text-secondary)">
            {t("Searching…")}
          </p>
        ) : null}
        {empty ? (
          <EmptyState
            context="panel"
            icon={<Search className="icon-md" />}
            description={t("Find files, conversations, messages, and projects.")}
          />
        ) : noResults ? (
          <>
            <p role="status" className="px-2 py-1.5 text-ui-caption text-(--ui-text-muted)">
              {t(indexing ? "No indexed matches yet" : "No results")}
            </p>
            {indexNotice}
          </>
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
              listId={listId}
              counts={grouped.counts}
              hits={hits}
              active={resultsCurrent ? active : -1}
              query={trimmed}
              onActive={(index) => {
                if (resultsCurrent) setActive(index);
              }}
              onOpen={openHit}
            />
          </>
        )}
      </div>
      <footer className="app-search-footer">
        <span>
          <ShortcutKbd size="xs">↑</ShortcutKbd> <ShortcutKbd size="xs">↓</ShortcutKbd>{" "}
          {t("Navigate")}
        </span>
        <span>
          <ShortcutKbd size="xs">Enter</ShortcutKbd> {t("Open")}
        </span>
        <span>
          <ShortcutKbd size="xs">Esc</ShortcutKbd> {t("Close")}
        </span>
      </footer>
    </div>
  );
  return presentation === "dialog" ? (
    <Modal
      padding="none"
      title={t("Search")}
      size="lg"
      onClose={onClose}
      className="app-search-modal"
    >
      {content}
    </Modal>
  ) : (
    content
  );
}

function ResultList({
  listId,
  counts,
  hits,
  active,
  query,
  onActive,
  onOpen,
}: {
  listId: string;
  counts: GroupedHitCounts;
  hits: AppSearchHit[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onOpen: (hit: AppSearchHit) => void;
}) {
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
    <div id={listId} role="listbox" aria-label={t("Search results")} onMouseMove={onListMouseMove}>
      {hits.map((hit, index) => {
        const highlighted = index === active;
        const row = rowCopy(hit, query);
        const heading =
          hit.kind === "conversation"
            ? t("Conversations")
            : hit.kind === "message"
              ? t("Messages")
              : hit.kind === "file"
                ? t("Files")
                : hit.kind === "content"
                  ? t("File content")
                  : t("Projects");
        const count =
          counts[
            hit.kind === "conversation"
              ? "conversations"
              : hit.kind === "message"
                ? "messages"
                : hit.kind === "file"
                  ? "files"
                  : hit.kind === "project"
                    ? "projects"
                    : "content"
          ];
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
              <div
                role="presentation"
                className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-ui-caption font-medium text-(--ui-text-secondary)"
              >
                <span>{heading}</span>
                <span className="tabular-nums">
                  {count.shown} {t("shown")}
                  {count.omitted > 0 ? ` · ${count.omitted} ${t("more loaded matches")}` : ""}
                </span>
              </div>
            ) : null}
            <Button
              variant="item"
              tone="accent"
              motion="none"
              fullWidth
              selected={highlighted}
              className="app-search-result"
              id={`${listId}-option-${index}`}
              ref={highlighted ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={highlighted}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onRowEnter(index)}
              onClick={() => onOpen(hit)}
            >
              <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                {row.icon}
              </span>
              <span className="app-search-result-copy">
                <span className="app-search-result-title">{row.title}</span>
                {row.preview ? (
                  <span className="app-search-result-preview">{row.preview}</span>
                ) : null}
                <span className="app-search-result-meta">{row.meta}</span>
                {highlighted ? (
                  <span className="app-search-result-identity">{fullIdentity}</span>
                ) : null}
              </span>
              <span className="app-search-result-kind sr-only">
                {t(
                  hit.kind === "conversation"
                    ? "Conversation"
                    : hit.kind === "message"
                      ? "Message"
                      : hit.kind === "project"
                        ? "Project"
                        : "File",
                )}
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
