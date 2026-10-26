import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { Modal } from "../../../shared/ui/Modal";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Search } from "../../../shared/ui/icons";
import { appName } from "../../../shared/lib/appName";
import {
  useEffect,
  useId,
  useMemo,
  useDeferredValue,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  recentOpenedFiles,
  rememberOpenedFile,
  type RankedFile,
} from "../model/fileIndex";
import { fuzzyMatch, type FuzzyHit } from "../../../shared/lib/fuzzy";
import { isRemoteProjectPath, looksLikeProject } from "../../projects/model/recents";
import type { OpenFileFn } from "../../search/model/search";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { FileTypeIcon } from "./FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { ALT, MOD, SHIFT } from "../../../platform/tauri/platform";
import { keybindingShortcutLabel, loadNotesEnabled } from "../../settings/model/settings";
import { NOTES_PANEL_COMMAND } from "../../notes/notesPanel";
import { LAYOUT_PRESETS } from "../../workspace/model/layoutPresets";
type Action = {
  id: string;
  label: string;
  hint?: string;
};

type RankedAction = Action & FuzzyHit;
export function reloadActionHint(mod = MOD, shift = SHIFT) {
  return `${mod}${shift}R`;
}

export const LAYOUT_ACTION_PREFIX = "layout-";

export function layoutPaletteActions(): Action[] {
  return LAYOUT_PRESETS.map((preset) => ({
    id: `${LAYOUT_ACTION_PREFIX}${preset.id}`,
    get label() {
      return t("Layout: {p0}", { p0: preset.label });
    },
  }));
}

function paletteActions(
  cwd: string,
  stopBackgroundWork: boolean,
  arrangeLayout: boolean,
): Action[] {
  const notes = loadNotesEnabled()
    ? [
        {
          id: "toggle-notes",
          get label() {
            return t("Toggle Notes Panel");
          },
          hint: keybindingShortcutLabel(NOTES_PANEL_COMMAND, `${MOD}${ALT}N`) ?? undefined,
        },
      ]
    : [];
  return [
    {
      id: "reload",
      get label() {
        return t("Reload {p0}", { p0: appName() });
      },
      hint: reloadActionHint(),
    },
    ...(stopBackgroundWork
      ? [
          {
            id: "stop-background",
            get label() {
              return t("Stop Background Work in This Session");
            },
          },
        ]
      : []),
    ...(isRemoteProjectPath(cwd)
      ? [
          {
            id: "reconnect-remote",
            get label() {
              return t("Reconnect Remote Machine");
            },
          },
        ]
      : []),
    ...notes,
    ...(arrangeLayout ? layoutPaletteActions() : []),
  ];
}

type Props = {
  open: boolean;
  cwd: string;
  openPaths?: string[];
  initialQuery?: string;
  /** The open session has subagents or commands that can be stopped one by one. */
  stopBackgroundWork?: boolean;
  /** The active tab has several panes, so "Layout: …" commands apply. */
  arrangeLayout?: boolean;
  onOpenFile: OpenFileFn;
  onRunAction: (id: string) => void;
  onClose: () => void;
};

export function FilePicker({
  open,
  cwd,
  openPaths = [],
  initialQuery = "",
  stopBackgroundWork = false,
  arrangeLayout = false,
  onOpenFile,
  onRunAction,
  onClose,
}: Props) {
  useLocale();
  const peekFiles = () => peekProjectFiles(cwd);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState(() => peekFiles() ?? []);
  const [loading, setLoading] = useState(() => peekFiles() == null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const recents = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const path of [...recentOpenedFiles(cwd), ...openPaths]) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  }, [cwd, openPaths, open]);
  const paletteMode = query.trim().startsWith(">");
  const actionQuery = paletteMode ? query.trim().slice(1).trim() : "";

  // Ranking the whole index is the costly part of a keystroke; let typing win.
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => (paletteMode ? [] : rankProjectFiles(files, deferredQuery, recents)),
    [files, paletteMode, deferredQuery, recents],
  );
  const actionResults = useMemo((): RankedAction[] => {
    if (!paletteMode) return [];
    const actions = paletteActions(cwd, stopBackgroundWork, arrangeLayout);
    if (!actionQuery) {
      return actions.map((action) => ({
        ...action,
        score: 0,
        positions: [],
      }));
    }
    return actions
      .flatMap((action) => {
        const hit = fuzzyMatch(actionQuery, action.label);
        return hit ? [{ ...action, ...hit }] : [];
      })
      .sort((a, b) => b.score - a.score);
  }, [actionQuery, paletteMode, cwd, stopBackgroundWork, arrangeLayout]);
  const optionCount = paletteMode ? actionResults.length : results.length;
  const activeIndex = Math.min(active, Math.max(0, optionCount - 1));
  const rankingPending = !paletteMode && deferredQuery !== query;

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActive(0);
    setRetrying(false);
    setError(null);
  }, [open, cwd, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const searchable = looksLikeProject(cwd);
    const cached = peekFiles();
    if (cached) {
      setFiles(cached);
      setLoading(false);
    } else {
      setFiles([]);
      setLoading(searchable);
    }
    if (!searchable) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadProjectFiles(cwd, true)
      .then((next) => {
        if (cancelled) return;
        setFiles(next);
        setError(null);
        setLoading(false);
        setRetrying(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        setRetrying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cwd, initialQuery, retry]);

  useEffect(() => {
    setActive((index) => (optionCount === 0 ? 0 : Math.min(index, optionCount - 1)));
  }, [optionCount]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
  }, [open]);

  if (!open) return null;

  const pick = (file: RankedFile) => {
    rememberOpenedFile(cwd, file.path);
    onOpenFile(file.path, undefined, { exact: true });
    onClose();
  };
  const runAction = (action: RankedAction) => {
    onRunAction(action.id);
    onClose();
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposition(e.nativeEvent)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (optionCount === 0) return;
      setActive((index) => (index + 1) % optionCount);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount === 0) return;
      setActive((index) => (index - 1 + optionCount) % optionCount);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (paletteMode) {
        const action = actionResults[activeIndex];
        if (action) runAction(action);
      } else {
        // A pending deferred render may still show the previous query's list.
        const file =
          deferredQuery === query
            ? results[activeIndex]
            : rankProjectFiles(files, query, recents)[0];
        if (file) pick(file);
      }
      return;
    }
    if (e.key === "Tab") e.preventDefault();
  };

  const empty = emptyLabel({
    cwd,
    query,
    loading,
    error,
    fileCount: files.length,
    matchCount: results.length,
    paletteMode,
    actionCount: actionResults.length,
  });

  const pickerLabel = paletteMode ? t("Command Palette") : t("Go to File");
  const detailedError = !!error && (error.length > 200 || /[\r\n]/.test(error));
  const errorSummary = error?.split(/[\r\n]/, 1)[0].slice(0, 120);
  return (
    <Modal
      title={pickerLabel}
      size="md"
      minimalHeader
      fitViewport={false}
      className="max-h-[80dvh]"
      motion="none"
      onClose={onClose}
    >
      <div
        data-file-picker
        aria-label={pickerLabel}
        aria-busy={!paletteMode && loading}
        className="flex flex-col"
      >
        <div className="pb-1.5">
          <label className="flex items-center gap-2 border-b border-stroke py-2.5 ps-2 pe-12 text-[var(--ui-text-secondary)]">
            <Search className="icon-sm shrink-0" strokeWidth={1.75} />
            <SearchInput
              ref={search}
              type="text"
              value={query}
              placeholder={t("Go to File (type > for commands)")}
              aria-label={pickerLabel}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={optionCount > 0}
              aria-controls={optionCount > 0 ? listId : undefined}
              aria-activedescendant={
                optionCount > 0 && !rankingPending ? `${listId}-option-${activeIndex}` : undefined
              }
              aria-busy={(!paletteMode && (loading || rankingPending)) || undefined}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
        </div>
        {!paletteMode && (error || retrying) ? (
          <div className="flex min-w-0 items-start gap-2 px-3 py-2 text-ui-caption">
            {error && detailedError ? (
              <details className="min-w-0 flex-1 break-words text-danger">
                <summary className="cursor-pointer" title={t("Error details")}>
                  <span role="alert" className="line-clamp-2">
                    {errorSummary}…
                  </span>
                </summary>
                <p tabIndex={0} className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {error}
                </p>
              </details>
            ) : error ? (
              <p role="alert" className="min-w-0 flex-1 break-words text-danger">
                {error}
              </p>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              loading={retrying}
              onClick={() => {
                setRetrying(true);
                setRetry((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : null}
        {empty && !(error && !files.length) ? (
          <p
            role="status"
            className="px-3 pb-3 pt-1 text-ui-caption text-[var(--ui-text-secondary)]"
          >
            {empty}
          </p>
        ) : paletteMode ? (
          <ActionList
            id={listId}
            actions={actionResults}
            active={activeIndex}
            query={actionQuery}
            onActive={setActive}
            onRun={runAction}
          />
        ) : (
          <FileList
            id={listId}
            files={results}
            active={activeIndex}
            query={query}
            onActive={setActive}
            onPick={pick}
          />
        )}
      </div>
    </Modal>
  );
}

function emptyLabel({
  cwd,
  query,
  loading,
  error,
  fileCount,
  matchCount,
  paletteMode,
  actionCount,
}: {
  cwd: string;
  query: string;
  loading: boolean;
  error: string | null;
  fileCount: number;
  matchCount: number;
  paletteMode: boolean;
  actionCount: number;
}): string | null {
  if (paletteMode) return actionCount === 0 ? "No matching commands" : null;
  if (error && fileCount === 0) return error;
  if (!looksLikeProject(cwd)) return "Open a project to search files";
  if (loading && fileCount === 0) return "Indexing files…";
  if (fileCount === 0) return "No files found";
  if (matchCount === 0) {
    return query.trim() ? "No matching files" : "Type a file name to search";
  }
  return null;
}

function ActionList({
  id,
  actions,
  active,
  query,
  onActive,
  onRun,
}: {
  id: string;
  actions: RankedAction[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onRun: (action: RankedAction) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={lockOverscroll}
      id={id}
      role="listbox"
      aria-label={t("Commands")}
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {actions.map((action, index) => {
        const highlighted = index === active;
        return (
          <Button
            variant="item"
            motion="none"
            key={action.id}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            tabIndex={-1}
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onRun(action)}
            className={`  flex h-8 w-full items-center gap-2 text-left leading-none  ${
              highlighted ? "" : ""
            }   `}
          >
            <span className="min-w-0 flex-1 truncate">
              <MatchText text={action.label} positions={action.positions} active={Boolean(query)} />
            </span>
            {action.hint ? (
              <ShortcutKbd size="xs" className="ml-auto shrink-0">
                {action.hint}
              </ShortcutKbd>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
function FileList({
  id,
  files,
  active,
  query,
  onActive,
  onPick,
}: {
  id: string;
  files: RankedFile[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [files]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  return (
    <div
      ref={lockOverscroll}
      id={id}
      role="listbox"
      aria-label={t("Files")}
      onMouseMove={onListMouseMove}
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {files.map((file, index) => {
        const highlighted = index === active;
        const slash = file.relative.lastIndexOf("/");
        const dir = slash === -1 ? "" : file.relative.slice(0, slash);
        const nameOffset = slash === -1 ? 0 : slash + 1;
        return (
          <Button
            variant="item"
            motion="none"
            key={file.path}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            tabIndex={-1}
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onPick(file)}
            className={`  flex h-8 w-full items-center gap-2 text-left leading-none  ${
              highlighted ? "" : ""
            }   `}
          >
            <span className="shrink-0">
              <FileTypeIcon name={file.name} isDir={false} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <MatchText
                text={file.name}
                positions={file.positions
                  .filter((pos) => pos >= nameOffset)
                  .map((pos) => pos - nameOffset)}
                active={Boolean(query.trim())}
              />
            </span>
            {dir ? (
              <span className="min-w-0 max-w-[45%] truncate font-mono text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                <MatchText
                  text={dir}
                  positions={file.positions.filter((pos) => pos < slash)}
                  active={Boolean(query.trim())}
                />
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
