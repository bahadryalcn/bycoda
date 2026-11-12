import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { FilePickerError } from "./FilePickerError";
import { projectFilesTruncated } from "../../../platform/tauri/fs";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Modal } from "../../../shared/ui/Modal";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Search } from "../../../shared/ui/icons";
import { useKeyedActiveIndex } from "../../../shared/hooks/useKeyedActiveIndex";
import { appName } from "../../../shared/lib/appName";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import {
  useEffect,
  useId,
  useMemo,
  useDeferredValue,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  recentOpenedFiles,
  rememberOpenedFile,
  type RankedFile,
} from "../model/fileIndex";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { isRemoteProjectPath, looksLikeProject } from "../../projects/public/recents";
import type { OpenFileFn } from "../../search/model/search";
import { ActionList, FileList, type Action, type RankedAction } from "./FilePickerLists";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { ALT, MOD, SHIFT } from "../../../platform/tauri/platform";
import { keybindingShortcutLabel, loadNotesEnabled } from "../../settings/public/settings";
import { NOTES_PANEL_COMMAND } from "../../notes/notesPanel";
import { LAYOUT_PRESETS } from "../../workspace/model/layoutPresets";
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
    {
      id: "open-crews",
      get label() {
        return t("Open Crews");
      },
      hint: keybindingShortcutLabel("App: Open Crews", `${MOD}${SHIFT}E`) ?? undefined,
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
  const projectLabels = useProjectLabels();
  const peekFiles = () => peekProjectFiles(cwd);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [query, setQuery] = useState(initialQuery);
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
  // Opening (or retargeting) the picker restarts it from the initial query and
  // the first row; a shrinking result list clamps the highlighted row.
  const sessionKey = open ? `${cwd}|${initialQuery}` : null;
  const [seenSessionKey, setSeenSessionKey] = useState<string | null>(null);
  if (seenSessionKey !== sessionKey) {
    setSeenSessionKey(sessionKey);
    if (sessionKey !== null) {
      setQuery(initialQuery);
      setRetrying(false);
      setError(null);
    }
  }
  const [activeIndex, setActive] = useKeyedActiveIndex(sessionKey ?? "closed", optionCount);
  const rankingPending = !paletteMode && deferredQuery !== query;

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
  return (
    <Modal
      padding="none"
      title={pickerLabel}
      context={looksLikeProject(cwd) ? projectDisplayNameFrom(cwd, projectLabels) : undefined}
      size="md"
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
          <Text
            as="div"
            size="inherit"
            tone="secondary"
            className="flex items-center gap-2 border-b border-stroke py-2.5 px-2"
          >
            <Search className="icon-sm shrink-0" strokeWidth={1.75} />
            <SearchInput
              ref={search}
              clearable={false}
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
          </Text>
        </div>
        {!paletteMode && (error || retrying) ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="flex min-w-0 items-start gap-2 px-3 py-2"
          >
            {error ? <FilePickerError error={error} /> : null}
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
          </Text>
        ) : null}
        {!paletteMode &&
        !loading &&
        looksLikeProject(cwd) &&
        projectFilesTruncated(files) !== false ? (
          <Text as="p" size="caption" tone="secondary" className="px-3 pb-2">
            {projectFilesTruncated(files)
              ? t("File index is incomplete; some files may not appear.")
              : t("File index completeness is unknown; some files may not appear.")}
          </Text>
        ) : null}
        {empty && !(error && !files.length) ? (
          <Text role="status" as="p" size="caption" tone="secondary" className="px-3 pb-3 pt-1">
            {empty}
          </Text>
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
  if (paletteMode) return actionCount === 0 ? t("No matching commands") : null;
  if (error && fileCount === 0) return error;
  if (!looksLikeProject(cwd)) return t("Open a project to search files");
  if (loading && fileCount === 0) return t("Indexing files…");
  if (fileCount === 0) return t("No files found");
  if (matchCount === 0) {
    return query.trim() ? t("No matching files") : t("Type a file name to search");
  }
  return null;
}
