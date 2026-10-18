import { EmptyState } from "../../../shared/ui/EmptyState";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import "./search.css";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale } from "../../../shared/i18n";
import {
  Folder,
  LoaderCircle,
  MessageSquare,
  Search,
  Maximize2,
  Minimize2,
} from "../../../shared/ui/icons";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  conversationRowsFrom,
  flattenGrouped,
  groupHits,
  hitsFromContentMatches,
  hitsFromFileRanks,
  mergeHits,
  searchConversationTitles,
  searchRecentProjects,
  SessionMessageSearch,
  type AppSearchHit,
  type SearchScope,
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
import { isLocalProject, type RecentProject } from "../../projects/model/recents";
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
  const [active, setActive] = useState(0);
  const [fileIndex, setFileIndex] = useState(() => ({ cwd, files: peekProjectFiles(cwd) ?? [] }));
  const files = fileIndex.cwd === cwd ? fileIndex.files : [];
  const [chatFilters, setChatFilters] = useRetainedState<ChatFilters>(
    `${stateKey}:filters`,
    DEFAULT_CHAT_FILTERS,
  );

  const trimmed = query.trim();

  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open, cwd]);

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
    if (!isLocalProject(cwd)) {
      setFileIndex({ cwd, files: [] });
      return;
    }
    let cancelled = false;
    let revision = 0;
    const refresh = (activate = false) => {
      const requestedRevision = ++revision;
      const cached = peekProjectFiles(cwd);
      setFileIndex({ cwd, files: cached ?? [] });
      if (cached && !activate) return;
      void loadProjectFiles(cwd)
        .then((next) => {
          if (!cancelled && revision === requestedRevision) setFileIndex({ cwd, files: next });
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeProjectFiles(() => refresh());
    refresh(true);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cwd, open]);

  const deferredTrimmed = useDeferredValue(trimmed);
  const deferredSessions = useDeferredValue(sessions);
  const [messageSearch] = useState(() => new SessionMessageSearch());
  const conversationRows = useMemo(
    () => conversationRowsFrom(history, deferredSessions),
    [history, deferredSessions],
  );
  const fileHits = useMemo(
    () =>
      deferredTrimmed && isLocalProject(cwd)
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
  const conversation = useConversationSearch(
    open && (scope === "all" || scope === "conversations"),
    conversationOptions,
  );
  const chatSessions = conversation.result.sessions;
  const pendingIndex = conversation.result.pending;
  const projectSearch = useProjectFileSearch(
    open && (scope === "all" || scope === "files") && isLocalProject(cwd),
    cwd,
    trimmed,
  );
  const contentHits = useMemo(
    () => hitsFromContentMatches(projectSearch.result.matches),
    [projectSearch.result.matches],
  );
  const error = projectSearch.error;
  const contentTruncated = projectSearch.result.truncated;
  const loading = projectSearch.loading || conversation.loading || deferredTrimmed !== trimmed;
  const truncated = contentTruncated || conversation.result.truncated;
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

  const hits = useMemo(() => {
    if (!trimmed) return [];
    return flattenGrouped(
      groupHits(
        mergeHits(titleHits, liveMessageHits, remoteHits, fileHits, contentHits, projectHits),
        scope,
      ),
    );
  }, [contentHits, fileHits, liveMessageHits, projectHits, remoteHits, scope, titleHits, trimmed]);

  // The Conversations tab lists results by project, with its own rows to step
  // through; every other tab steps through `hits`.
  const chatMode = scope === "conversations";
  const rowCount = chatMode ? chatRows.length : hits.length;

  useEffect(() => {
    setActive(0);
  }, [trimmed, scope, filters]);

  useEffect(() => {
    if (active >= rowCount) setActive(0);
  }, [active, rowCount]);

  const openChat = (entry: { sessionId: string; blockId?: string } | undefined) => {
    if (!entry) return;
    onOpenSession(entry.sessionId, entry.blockId, trimmed);
    onClose();
  };

  const openHit = (hit: AppSearchHit | null) => {
    if (!hit) return;
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
      if (rowCount === 0) return;
      setActive((index) => (index + 1) % rowCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rowCount === 0) return;
      setActive((index) => (index - 1 + rowCount) % rowCount);
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
  const noResults = !empty && rowCount === 0 && !loading && !error && !conversation.error;
  const limitNotice = truncated ? (
    <p className="px-2.5 py-1 text-[11px] text-content/45">
      {t("Results limited to the first matches")}
    </p>
  ) : null;
  const indexNotice =
    pendingIndex > 0 && scope !== "files" && scope !== "projects" ? (
      <p className="px-2.5 py-1 text-[11px] text-content/45">
        {t("Indexing ")}
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
      className={`app-search flex min-h-0 min-w-0 flex-1 flex-col text-content ${presentation === "dialog" ? "app-search-dialog" : ""}`}
    >
      <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto]">
        <div
          className="col-span-3 grid h-10 grid-cols-subgrid select-none items-center border-b border-stroke"
          data-tauri-drag-region={presentation === "page" ? "deep" : undefined}
        >
          <div className="flex items-center">
            {presentation === "page" ? (
              <>
                {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
                {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
                {besideRail ? null : (
                  <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
                )}
              </>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 px-3">
            <SearchInputGroup appearance="field" className="w-full">
              <Search className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <SearchInput
                type="search"
                focusOwner="group"
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onQueryKeyDown}
                placeholder={t("Search everything...")}
                aria-label={t("Search")}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                data-tauri-drag-region="false"
                className="min-w-0 flex-1 select-text"
              />
              {loading ? (
                <LoaderCircle
                  className="size-3.5 shrink-0 animate-spin text-(--ui-text-secondary)"
                  strokeWidth={1.75}
                />
              ) : null}
            </SearchInputGroup>
          </div>
          <div className="flex items-center pe-3">
            {presentation === "dialog" ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Full screen")}
                tooltip={t("Full screen")}
                onClick={onExpand}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            ) : (
              <>
                {onCompact ? (
                  <Button
                    variant="ghost"
                    iconOnly
                    label={t("Restore")}
                    tooltip={t("Restore")}
                    onClick={onCompact}
                  >
                    <Minimize2 className="size-3.5" />
                  </Button>
                ) : null}
                {!IS_MAC ? <WindowControls /> : null}
              </>
            )}
          </div>
        </div>

        <div className="col-span-3 grid min-h-9 grid-cols-subgrid items-center border-b border-stroke">
          <div className="col-start-2 min-w-0 overflow-x-auto px-3 py-1">
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

      {!empty && (error || conversation.error) ? (
        <Alert tone="danger" role="alert">
          {error ? (
            <p>
              {t("File search failed: ")}
              {error}{" "}
              <Button variant="ghost" size="sm" type="button" onClick={projectSearch.retry}>
                {t("Retry file search")}
              </Button>
            </p>
          ) : null}
          {conversation.error ? (
            <p>
              {t("Conversation search failed: ")}
              {conversation.error}{" "}
              <Button variant="ghost" size="sm" type="button" onClick={conversation.retry}>
                {t("Retry conversation search")}
              </Button>
            </p>
          ) : null}
          {rowCount > 0 ? (
            <p className="text-content/75">{t("Results below may be incomplete.")}</p>
          ) : null}
        </Alert>
      ) : null}

      <div
        ref={lockOverscroll}
        aria-busy={loading}
        className={
          empty
            ? "flex min-h-0 flex-1 items-center justify-center overflow-y-auto overscroll-none"
            : "min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
        }
      >
        {empty ? (
          <EmptyState
            icon={<Search className="size-6" />}
            description={t("Find files, conversations, messages, and projects.")}
          />
        ) : noResults ? (
          <>
            <p className="px-2 py-1.5 text-[12px] text-content/50">{t("No results")}</p>
            {indexNotice}
            {limitNotice}
          </>
        ) : chatMode ? (
          <>
            {indexNotice}
            {limitNotice}
            <ChatSearchResults
              groups={chatGroups}
              entries={chatRows}
              active={active}
              onActive={setActive}
              onOpen={openChat}
            />
          </>
        ) : (
          <>
            {indexNotice}
            {limitNotice}
            <ResultList
              hits={hits}
              active={active}
              query={trimmed}
              onActive={setActive}
              onOpen={openHit}
            />
          </>
        )}
      </div>
      <footer className="app-search-footer">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> {t("Search results")}
        </span>
        <span>
          <kbd>Enter</kbd> {t("Open")}
        </span>
        <span>
          <kbd>Esc</kbd> {t("Close")}
        </span>
      </footer>
    </div>
  );
  return presentation === "dialog" ? (
    <Modal title={t("Search")} size="lg" onClose={onClose} className="app-search-modal">
      {content}
    </Modal>
  ) : (
    content
  );
}

function ResultList({
  hits,
  active,
  query,
  onActive,
  onOpen,
}: {
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
    <div role="listbox" aria-label={t("Search results")} onMouseMove={onListMouseMove}>
      {hits.map((hit, index) => {
        const highlighted = index === active;
        const row = rowCopy(hit, query);
        return (
          <Button
            variant="item"
            motion="none"
            fullWidth
            selected={highlighted}
            className="app-search-result"
            key={hit.id}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onOpen(hit)}
          >
            <span className="grid size-4 shrink-0 place-items-center">{row.icon}</span>
            <span className="app-search-result-copy">
              <span className="app-search-result-title">{row.title}</span>
              {row.preview ? (
                <span className="app-search-result-preview">{row.preview}</span>
              ) : null}
              <span className="app-search-result-meta">{row.meta}</span>
            </span>
            <span className="app-search-result-kind">
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
        );
      })}
    </div>
  );
}

function rowCopy(
  hit: AppSearchHit,
  query: string,
): { icon: ReactNode; title: ReactNode; meta: string; preview?: ReactNode } {
  if (hit.kind === "conversation") {
    return {
      icon: <HarnessIcon harness={hit.harness} className="size-3.5" />,
      title: <MatchText text={hit.title} positions={hit.positions} active />,
      meta: projectDisplayName(hit.cwd),
    };
  }
  if (hit.kind === "message") {
    return {
      icon: <MessageSquare className="size-3.5 text-content/55" strokeWidth={1.75} />,
      title: hit.title,
      preview: <Highlight text={hit.preview || hit.title} query={query} />,
      meta: projectDisplayName(hit.cwd),
    };
  }
  if (hit.kind === "file") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size={16} />,
      title: <MatchText text={hit.name} positions={namePositions(hit)} active />,
      meta: hit.relative,
    };
  }
  if (hit.kind === "content") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size={16} />,
      title: hit.name,
      preview: <Highlight text={hit.preview} query={query} />,
      meta: `${hit.relative}:${hit.line}`,
    };
  }
  return {
    icon: <ProjectLogoIcon path={hit.path} className="size-3.5 rounded-sm" fallback={Folder} />,
    title: <MatchText text={hit.name} positions={hit.positions} active />,
    meta: prettyCwd(hit.path),
  };
}

function Highlight({ text, query }: { text: string; query: string }) {
  useLocale();
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return <>{text}</>;
  const end = index + needle.length;
  return (
    <>
      {text.slice(0, index)}
      <span className="text-accent">{text.slice(index, end)}</span>
      {text.slice(end)}
    </>
  );
}

function namePositions(hit: { name: string; relative: string; positions: number[] }) {
  const offset = Math.max(0, hit.relative.length - hit.name.length);
  return hit.positions
    .map((index) => index - offset)
    .filter((index) => index >= 0 && index < hit.name.length);
}
