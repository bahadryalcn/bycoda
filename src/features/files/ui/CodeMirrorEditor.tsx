import { t, useLocale } from "../../../shared/i18n/technical";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { indentLess, indentMore, isolateHistory } from "@codemirror/commands";
import { foldGutter, foldKeymap, getIndentUnit, indentUnit } from "@codemirror/language";
import type { MergeView } from "@codemirror/merge";
import {
  Annotation,
  Compartment,
  countColumn,
  EditorSelection,
  Prec,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";

import { formatInteger } from "../../../shared/lib/numbers";
import { minimalSetup } from "codemirror";
import { useCallback, useEffect, useRef, useState } from "react";

import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isLightScheme } from "../../settings/model/appearance";
import { loadAutosave, loadFormatOnSave } from "../../settings/model/settings";
import { formatProjectText } from "../../../shared/lib/format";
import {
  gitBlame,
  gitConflicts,
  gitStageFile,
  notifyGitChanged,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";

import { displayPath } from "../../../shared/lib/paths";
import type { EditorNavigation, OpenFileFn } from "../../search/model/search";

import {
  DiffCommentComposer,
  type DiffCommentComposerTarget,
} from "../../source-control/ui/DiffCommentComposer";
import { DiffLayoutToggle, useDiffLayout } from "../../source-control/ui/DiffLayoutToggle";
import { hasConflictMarkers } from "../../source-control/model/conflictMarkers";
import { nextConflictedFile } from "../../source-control/model/conflictSection";
import { requestOpenCommit } from "../../source-control/ui/GitFileInspector";
import { editorAutocomplete } from "../editor/editorAutocomplete";
import { editorBlame, refreshBlame } from "../editor/editorBlame";
import { conflictBlocks, editorConflicts, stepConflict } from "../editor/editorConflicts";
import { languageForPath, schemeExtensions } from "../editor/editorChrome";
import {
  preserveEditorViewport,
  replaceEditorDoc,
  scrollLineToTop,
  topVisibleLine,
} from "../editor/editorDoc";
import { editorMatching, editorTyping, tryExpandEmmet } from "../editor/editorEditing";
import { EditorSelectionMenu, type EditorSelectionTarget } from "./EditorSelectionMenu";
import { editorCodeSelection, formatEditorSelectionReference } from "../model/editorSelection";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import {
  diffActiveChunkIndex,
  diffLineStatsForView,
  diffNavigablePositions,
  diffNavUpdateRelevant,
  diffScrollToChunk,
  editorGit,
  setGitOriginal,
} from "../editor/editorGit";
import {
  createSplitDiff,
  setSplitCanStage,
  setSplitOriginal,
  splitLineStats,
  splitNavigablePositions,
  splitNavUpdateRelevant,
} from "../editor/editorSplitDiff";
import { editorLint } from "../editor/editorLint";
import { editorNavigation } from "../editor/editorNavigation";
import { editorSearch } from "../editor/editorSearch";
import { editorScrollbar } from "../editor/editorScrollbar";
import { attachSplitOverview, editorOverview } from "../editor/editorOverview";
import { EditorConflictBar } from "./EditorConflictBar";
import { ConflictLayout, conflictSourcesFromMarkers } from "../../source-control/ui/ConflictLayout";

import { useInlineBlame, useInlineBlameUnavailableReason } from "./InlineBlameToggle";

import { FILE_EDITOR_AUTOSAVE_DELAY_MS } from "../editor/editorTiming";

type EditorNavigationRequest = EditorNavigation & { token: number };

const editorScheme = new Compartment();
const editorGitConfig = new Compartment();
const editorBlameConfig = new Compartment();
const inlineBlameExtension = editorBlame({ onOpenCommit: requestOpenCommit });

export function CodeMirrorEditor({
  path,
  cwd,
  commentPath,
  value,
  showDiff,
  gitOriginal,
  active,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onSave,
  canAutosave,
  onStageGit,
  onDocChange,
  saveRequestRef,
  onOpenFile,
  formatOnSave = true,
}: {
  path: string;
  cwd: string;
  commentPath: string;
  value: string;
  showDiff: boolean;
  gitOriginal: string | null;
  active: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (dirty: boolean) => void;
  onErrorCountChange: (count: number) => void;
  onSave: (content: string) => Promise<void>;
  canAutosave: () => boolean;
  onStageGit?: (contents: string) => Promise<void>;
  onDocChange?: (content: string) => void;
  /** Runs the same save flow as Ctrl/Cmd+S before an external preview. */
  saveRequestRef?: { current: (() => Promise<boolean>) | null };
  /** Lets the conflict bar step to the next conflicted file. */
  onOpenFile?: OpenFileFn;
  formatOnSave?: boolean;
}) {
  useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const leftViewRef = useRef<EditorView | null>(null);
  const savedDocumentRef = useRef<Text | null>(null);
  const dirtyRef = useRef(false);
  const activeRef = useRef(active);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onErrorCountChangeRef = useRef(onErrorCountChange);
  const onSaveRef = useRef(onSave);
  const canAutosaveRef = useRef(canAutosave);
  const onStageGitRef = useRef(onStageGit);
  const canStage = onStageGit !== undefined;
  const onDocChangeRef = useRef(onDocChange);
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const valueRef = useRef(value);
  const navigationTokenRef = useRef<number | undefined>(undefined);
  const pendingNavigationRef = useRef<EditorNavigationRequest | null>(null);
  const gitOriginalRef = useRef(gitOriginal);
  const chunkNavPinnedRef = useRef<number | null>(null);
  // The side-by-side pair, when that layout is showing. `viewRef` is then its
  // right pane, so saving, dirty tracking and reloads need no second path.
  const splitRef = useRef<MergeView | null>(null);
  // What scrolls the editor: its own scroller, or the pair's shared container.
  const scrollerRef = useRef<HTMLElement | null>(null);
  // What a rebuilt editor needs to pick up where the last one stopped.
  const carryRef = useRef<EditorCarry | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const diffLayout = useDiffLayout();
  // Keep the editable result in the conflict-aware editor. Sources use their own
  // read-only panes; resolving the last block must not rebuild the result as a diff.
  const [conflictInline, setConflictInline] = useState(() => hasConflictMarkers(value));
  const [conflictSources, setConflictSources] = useState(() =>
    hasConflictMarkers(value) ? conflictSourcesFromMarkers(value) : null,
  );
  const conflictLayoutActive = conflictSources !== null;
  useEffect(() => {
    if (!conflictInline && hasConflictMarkers(value)) setConflictInline(true);
    if (!conflictSources && hasConflictMarkers(value))
      setConflictSources(conflictSourcesFromMarkers(value));
  }, [conflictInline, conflictSources, value]);
  // Without a "before" there is nothing to put on the left.
  const splitDiff = showDiff && diffLayout === "split" && gitOriginal !== null && !conflictInline;
  const [conflictCount, setConflictCount] = useState(0);
  // Set once a block was seen, so "Mark resolved" is only offered after a
  // resolution here and not on every file that was merged before.
  const [hadConflicts, setHadConflicts] = useState(false);
  const [stillUnmerged, setStillUnmerged] = useState(false);
  const [marking, setMarking] = useState<{
    busy: boolean;
    error: string | null;
  }>({
    busy: false,
    error: null,
  });
  const blameReason = useInlineBlameUnavailableReason(cwd, path);
  const gitRelative = blameReason === null ? displayPath(path, cwd) : null;
  const gitTargetRef = useRef({ cwd, relative: gitRelative });
  gitTargetRef.current = { cwd, relative: gitRelative };
  const blameOn = useInlineBlame() && blameReason === null;
  const blameOnRef = useRef(blameOn);
  blameOnRef.current = blameOn;
  const [blameError, setBlameError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const scheduleBlameRef = useRef<(() => void) | null>(null);
  const saveNowRef = useRef<(() => Promise<boolean>) | null>(null);
  const [chunkNav, setChunkNav] = useState<{
    positions: number[];
    index: number;
    additions: number;
    deletions: number;
  } | null>(null);
  const [commentTarget, setCommentTarget] = useState<DiffCommentComposerTarget | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<EditorSelectionTarget | null>(null);
  const gitOptions = {
    onStage: canStage ? (contents: string) => onStageGitRef.current?.(contents) : undefined,
    onComment: setCommentTarget,
  };
  activeRef.current = active;
  onDirtyChangeRef.current = onDirtyChange;
  onErrorCountChangeRef.current = onErrorCountChange;
  onSaveRef.current = onSave;
  canAutosaveRef.current = canAutosave;
  onStageGitRef.current = onStageGit;
  onDocChangeRef.current = onDocChange;
  valueRef.current = value;
  gitOriginalRef.current = gitOriginal;

  const syncChunkNav = useCallback((view: EditorView, fromScroll = true) => {
    const split = splitRef.current;
    const positions = split ? splitNavigablePositions(split) : diffNavigablePositions(view);
    const { additions, deletions } = split ? splitLineStats(split) : diffLineStatsForView(view);
    if (positions.length === 0) {
      setChunkNav((current) =>
        current && current.positions.length === 0
          ? current
          : {
              positions: [],
              index: 0,
              additions: 0,
              deletions: 0,
            },
      );
      chunkNavPinnedRef.current = null;
      return;
    }
    let index = chunkNavPinnedRef.current;
    if (fromScroll || index === null || index < 0 || index >= positions.length) {
      index = diffActiveChunkIndex(view, positions, scrollerRef.current ?? view.scrollDOM);
    }
    chunkNavPinnedRef.current = index;
    setChunkNav((current) => {
      if (
        current &&
        current.index === index &&
        current.additions === additions &&
        current.deletions === deletions &&
        current.positions.length === positions.length &&
        current.positions.every((pos, i) => pos === positions[i])
      ) {
        return current;
      }
      return { positions, index, additions, deletions };
    });
  }, []);

  const stepChunkNav = useCallback(
    (delta: number) => {
      const view = viewRef.current;
      if (!view || !chunkNav || chunkNav.positions.length === 0) return;
      const next = Math.min(chunkNav.positions.length - 1, Math.max(0, chunkNav.index + delta));
      if (next === chunkNav.index) return;
      chunkNavPinnedRef.current = next;
      diffScrollToChunk(view, chunkNav.positions[next]);
      setChunkNav({
        positions: chunkNav.positions,
        index: next,
        additions: chunkNav.additions,
        deletions: chunkNav.deletions,
      });
    },
    [chunkNav],
  );

  const showDiffRef = useRef(showDiff);
  showDiffRef.current = showDiff;
  const formatOnSaveRef = useRef(formatOnSave);
  formatOnSaveRef.current = formatOnSave;
  const setDirty = (nextDirty: boolean) => {
    if (dirtyRef.current === nextDirty) return;
    dirtyRef.current = nextDirty;
    onDirtyChangeRef.current(nextDirty);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const language = new Compartment();
    let disposed = false;
    let selectionMeasureVersion = 0;
    let saveGeneration = 0;
    let formatGeneration = 0;
    let autosaveTimer = 0;
    let view: EditorView;
    let split: MergeView | null = null;
    const carry = carryRef.current;
    carryRef.current = null;

    const markDirty = () => {
      const saved = savedDocumentRef.current;
      setDirty(saved ? !view.state.doc.eq(saved) : false);
    };

    const formatDocument = async (manual = false) => {
      const generation = ++formatGeneration;
      const before = view.state.doc;
      const selection = view.state.selection;
      setFormatError(null);
      try {
        const result = await formatProjectText(path, before.toString(), selection.main.head);
        if (disposed || generation !== formatGeneration || view.state.doc !== before) return;
        if (!result) {
          if (manual)
            setFormatError(t("No formatter is available for this file, or its syntax is invalid."));
          return;
        }
        replaceEditorDoc(view, result.formatted, {
          annotations: [isolateHistory.of("full")],
          selection: view.state.selection.eq(selection)
            ? { anchor: Math.min(Math.max(0, result.cursorOffset), result.formatted.length) }
            : undefined,
          scroller: scrollerRef.current ?? undefined,
        });
      } catch (error) {
        if (manual && !disposed && generation === formatGeneration)
          setFormatError(error instanceof Error ? error.message : String(error));
      }
    };

    /** Resolves true once the document reached the disk. */
    const saveDocument = (automatic = false): Promise<boolean> => {
      const retryPendingAutosave = autosaveTimer !== 0 && loadAutosave();
      window.clearTimeout(autosaveTimer);
      const generation = ++saveGeneration;
      return (async () => {
        if (formatOnSaveRef.current && loadFormatOnSave()) {
          await formatDocument();
          if (disposed || generation !== saveGeneration) return false;
        }

        const document = view.state.doc;
        if (automatic && !canAutosaveRef.current()) return false;
        try {
          await onSaveRef.current(document.toString());
        } catch {
          if (
            retryPendingAutosave &&
            !disposed &&
            generation === saveGeneration &&
            dirtyRef.current
          ) {
            scheduleAutosave();
          }
          return false;
        }
        if (disposed || generation !== saveGeneration) return true;
        savedDocumentRef.current = document;
        markDirty();
        scheduleBlame();
        return true;
      })();
    };
    const save = (automatic = false) => {
      void saveDocument(automatic);
      return true;
    };
    saveNowRef.current = () => saveDocument();
    if (saveRequestRef) saveRequestRef.current = saveNowRef.current;

    // Blame describes what is on disk, so it is fetched when it is switched on,
    // after a save and when git reports a change. One timer folds those into a
    // single request.
    let blameTimer = 0;
    const loadBlame = async () => {
      const { cwd: root, relative } = gitTargetRef.current;
      if (disposed || !blameOnRef.current || !relative) return;
      try {
        await refreshBlame(
          view,
          savedDocumentRef.current ?? view.state.doc,
          () => gitBlame(root, relative),
          () => !disposed && blameOnRef.current,
        );
        if (!disposed) setBlameError(null);
      } catch (error: unknown) {
        if (disposed || !blameOnRef.current) return;
        setBlameError(error instanceof Error ? error.message : String(error));
      }
    };
    function scheduleBlame() {
      window.clearTimeout(blameTimer);
      blameTimer = window.setTimeout(() => void loadBlame(), 120);
    }
    scheduleBlameRef.current = scheduleBlame;
    const unsubscribeGit = subscribeGitChanged(
      () => {
        if (blameOnRef.current && !document.hidden) scheduleBlame();
      },
      { cwd: gitTargetRef.current.cwd },
    );

    function scheduleAutosave() {
      window.clearTimeout(autosaveTimer);
      if (!loadAutosave()) return;
      autosaveTimer = window.setTimeout(() => {
        autosaveTimer = 0;
        if (dirtyRef.current && loadAutosave() && canAutosaveRef.current()) {
          save(true);
        }
      }, FILE_EDITOR_AUTOSAVE_DELAY_MS);
    }

    // Folding would pull one pane's lines out of line with the other, and the
    // pair scrolls as a whole, so the editor's own scrollbar has no job.
    const extensions: Extension[] = [
      minimalSetup,
      editorGitConfig.of(showDiffRef.current && !splitDiff ? editorGit(gitOptions) : []),
      // Ahead of the line numbers, so the blame gutter is the leftmost one.
      editorBlameConfig.of(blameOnRef.current ? inlineBlameExtension : []),
      editorConflicts,
      lineNumbers(),
      splitDiff ? [] : foldGutter(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      wrappedLineIndent,
      language.of([]),
      editorScheme.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
      editorMatching,
      editorTyping(path),
      editorAutocomplete,
      editorLint(path, (count) => onErrorCountChangeRef.current(count)),
      editorNavigation(cwd, path, (...args) => onOpenFileRef.current?.(...args)),
      splitDiff ? [] : [editorOverview, editorScrollbar],
      editorSearch,
      Prec.high(
        keymap.of([
          ...(splitDiff ? [] : foldKeymap),
          { key: "Mod-s", run: () => save(), preventDefault: true },
          {
            key: "Mod-l",
            run: (view) => {
              const selection = editorCodeSelection(view.state, commentPath);
              if (!selection) return false;
              requestAddToChat(formatEditorSelectionReference(selection), "plain");
              selectionMeasureVersion++;
              setSelectionTarget(null);
              return true;
            },
          },
          {
            key: "Alt-Shift-f",
            run: () => {
              void formatDocument(true);
              return true;
            },
            preventDefault: true,
          },
          {
            key: "Tab",
            run: (view) => {
              if (completionStatus(view.state) === "active" && acceptCompletion(view)) {
                return true;
              }
              return tryExpandEmmet(view) || indentOrInsertTab(view);
            },
            shift: indentLess,
            preventDefault: true,
          },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        if (
          update.transactions.some(
            (tr) =>
              (tr.selection || tr.docChanged) &&
              !tr.annotation(diskReload) &&
              !tr.annotation(sourceNavigation),
          )
        ) {
          pendingNavigationRef.current = null;
        }
        if (update.selectionSet) {
          const version = ++selectionMeasureVersion;
          setSelectionTarget(null);
          // Measure after CodeMirror lays out the new selection, then update React.
          update.view.requestMeasure({
            key: setSelectionTarget,
            read: (view) =>
              editorSelectionTarget(view, commentPath, scrollerRef.current ?? view.scrollDOM),
            write: (target) => {
              if (!disposed && version === selectionMeasureVersion) setSelectionTarget(target);
            },
          });
        } else if (update.docChanged) {
          selectionMeasureVersion++;
          setSelectionTarget(null);
        }
        if (!update.docChanged) return;
        setConflictCount(conflictBlocks(update.state).length);
        onDocChangeRef.current?.(update.state.doc.toString());
        if (update.transactions.some((tr) => tr.annotation(diskReload))) {
          return;
        }
        markDirty();
        scheduleAutosave();
      }),
      EditorView.domEventHandlers({
        blur: () => {
          pendingNavigationRef.current = null;
          selectionMeasureVersion++;
          setSelectionTarget(null);
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!showDiffRef.current) return;
        const relevant = splitDiff ? splitNavUpdateRelevant(update) : diffNavUpdateRelevant(update);
        if (!relevant) return;
        chunkNavPinnedRef.current = null;
        syncChunkNav(update.view);
      }),
    ];
    // Unsaved edits survive a rebuild; anything else re-reads the file.
    const initialDoc = carry?.doc ?? valueRef.current;
    let leftView: EditorView | null = null;
    if (splitDiff) {
      split = createSplitDiff({
        parent: host,
        original: gitOriginalRef.current ?? "",
        doc: initialDoc,
        extensions,
        originalExtensions: [
          minimalSetup,
          editorNavigation(cwd, path, (...args) => onOpenFileRef.current?.(...args)),
          lineNumbers(),
          EditorView.lineWrapping,
          wrappedLineIndent,
          language.of([]),
          editorScheme.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
        ],
        stage: () => onStageGitRef.current,
      });
      view = split.b;
      leftView = split.a;
      leftViewRef.current = leftView;
    } else {
      view = new EditorView({ doc: initialDoc, parent: host, extensions });
    }
    splitRef.current = split;
    const detachSplitOverview = split ? attachSplitOverview(split) : null;
    scrollerRef.current = split ? split.dom : view.scrollDOM;
    if (carry?.saved) {
      savedDocumentRef.current = carry.saved;
    } else {
      savedDocumentRef.current = view.state.doc;
      dirtyRef.current = false;
    }
    viewRef.current = view;
    setConflictCount(conflictBlocks(view.state).length);
    if (blameOnRef.current) scheduleBlame();
    lockOverscroll(scrollerRef.current as HTMLDivElement);
    if (carry) {
      view.dispatch({
        selection: { anchor: Math.min(carry.head, view.state.doc.length) },
      });
      scrollLineToTop(view, carry.topLine);
      if (dirtyRef.current) scheduleAutosave();
    }
    if (showDiffRef.current) {
      if (!splitDiff && gitOriginalRef.current) {
        setGitOriginal(view, gitOriginalRef.current);
      }
      syncChunkNav(view);
    } else {
      setChunkNav({
        positions: [],
        index: 0,
        additions: 0,
        deletions: 0,
      });
    }
    if (activeRef.current) view.focus();

    void languageForPath(path).then((extension) => {
      if (!disposed && extension) {
        const reconfigure = { effects: language.reconfigure(extension) };
        view.dispatch(reconfigure);
        leftView?.dispatch(reconfigure);
      }
    });

    return () => {
      disposed = true;
      window.clearTimeout(autosaveTimer);
      window.clearTimeout(blameTimer);
      unsubscribeGit();
      saveNowRef.current = null;
      if (saveRequestRef) saveRequestRef.current = null;
      scheduleBlameRef.current = null;
      setConflictCount(0);
      onErrorCountChangeRef.current(0);
      lockOverscroll(null);
      carryRef.current = {
        doc: dirtyRef.current ? view.state.doc : null,
        saved: dirtyRef.current ? savedDocumentRef.current : null,
        head: view.state.selection.main.head,
        topLine: topVisibleLine(view, scrollerRef.current ?? view.scrollDOM),
      };
      viewRef.current = null;
      leftViewRef.current = null;
      splitRef.current = null;
      scrollerRef.current = null;
      savedDocumentRef.current = null;
      setChunkNav(null);
      setSelectionTarget(null);
      detachSplitOverview?.();
      if (split) split.destroy();
      else view.destroy();
    };
  }, [
    lockOverscroll,
    path,
    saveRequestRef,
    // Switching between one editor and MergeView changes the DOM ownership.
    // Inline diff visibility and format-on-save reconfigure the existing editor.
    splitDiff,
    conflictLayoutActive,
    syncChunkNav,
  ]);

  useEffect(() => {
    const reconfigure = {
      effects: editorScheme.reconfigure(schemeExtensions(colorScheme)),
    };
    viewRef.current?.dispatch(reconfigure);
    leftViewRef.current?.dispatch(reconfigure);
  }, [colorScheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editorBlameConfig.reconfigure(blameOn ? inlineBlameExtension : []),
    });
    if (blameOn) scheduleBlameRef.current?.();
    else setBlameError(null);
  }, [blameOn]);

  useEffect(() => {
    if (conflictCount > 0) setHadConflicts(true);
  }, [conflictCount]);

  // The file stays unmerged in git until it is staged, whatever the buffer says.
  useEffect(() => {
    if (conflictCount > 0 || !hadConflicts || !gitRelative) {
      setStillUnmerged(false);
      return;
    }
    let cancelled = false;
    const check = () => {
      gitConflicts(cwd).then(
        (files) => {
          if (!cancelled) setStillUnmerged(files.includes(gitRelative));
        },
        () => {
          if (!cancelled) setStillUnmerged(false);
        },
      );
    };
    check();
    const unsubscribe = subscribeGitChanged(check, { cwd });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conflictCount, cwd, gitRelative, hadConflicts]);

  const [fileNote, setFileNote] = useState<string | null>(null);
  useEffect(() => setFileNote(null), [path]);

  // The next file git still lists as unmerged, wrapping around.
  const openNextConflictedFile = useCallback(async () => {
    if (!onOpenFile) return;
    try {
      const next = nextConflictedFile(await gitConflicts(cwd), gitRelative);
      if (!next) {
        setFileNote("No other conflicted files");
        return;
      }
      setFileNote(null);
      onOpenFile(`${cwd.replace(/[\\/]+$/, "")}/${next}`);
    } catch (error: unknown) {
      setFileNote(error instanceof Error ? error.message : String(error));
    }
  }, [cwd, gitRelative, onOpenFile]);

  const markResolved = useCallback(async () => {
    if (!gitRelative) return;
    setMarking({ busy: true, error: null });
    try {
      const saved = (await saveNowRef.current?.()) ?? false;
      if (!saved || dirtyRef.current) throw new Error("Couldn't save the file");
      await gitStageFile(cwd, gitRelative);
      notifyGitChanged(cwd, "index");
      setHadConflicts(false);
      setMarking({ busy: false, error: null });
    } catch (error: unknown) {
      setMarking({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [cwd, gitRelative]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || splitDiff) return;
    view.dispatch({
      effects: editorGitConfig.reconfigure(showDiff ? editorGit(gitOptions) : []),
    });
    if (showDiff) {
      setGitOriginal(view, gitOriginalRef.current);
      syncChunkNav(view);
    } else {
      setChunkNav(null);
    }
  }, [canStage, showDiff, splitDiff]);

  useEffect(() => {
    if (splitRef.current) setSplitCanStage(splitRef.current, canStage);
  }, [canStage, splitDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    const split = splitRef.current;
    let changed = false;
    preserveEditorViewport(
      view,
      () => {
        changed = split
          ? setSplitOriginal(split, gitOriginal ?? "")
          : setGitOriginal(view, gitOriginal);
      },
      scrollerRef.current ?? view.scrollDOM,
    );
    if (!changed) return;
    chunkNavPinnedRef.current = null;
    syncChunkNav(view);
  }, [gitOriginal, showDiff, splitDiff, syncChunkNav]);

  useEffect(() => {
    const view = viewRef.current;
    const scroller = scrollerRef.current;
    if (!view || !scroller || !showDiff) return;
    const onScroll = () => {
      chunkNavPinnedRef.current = null;
      syncChunkNav(view);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [showDiff, splitDiff, syncChunkNav, path]);

  // The text is only copied out while someone wants it. When the listener is
  // attached (the preview comes into view), catch up on what was typed before.
  const wantsDocChange = onDocChange !== undefined;
  useEffect(() => {
    const view = viewRef.current;
    if (!wantsDocChange || !view) return;
    onDocChangeRef.current?.(view.state.doc.toString());
  }, [wantsDocChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || dirtyRef.current) return;
    if (view.state.doc.toString() === value) return;
    replaceEditorDoc(view, value, {
      annotations: [Transaction.addToHistory.of(false), diskReload.of(true)],
      scroller: scrollerRef.current ?? undefined,
    });
    savedDocumentRef.current = view.state.doc;
    setDirty(false);
    if (showDiff) {
      chunkNavPinnedRef.current = null;
      syncChunkNav(view);
    }
  }, [showDiff, syncChunkNav, value]);

  useEffect(() => {
    if (!navigation) {
      pendingNavigationRef.current = null;
      return;
    }
    if (navigationTokenRef.current !== navigation.token) {
      navigationTokenRef.current = navigation.token;
      pendingNavigationRef.current = navigation;
    }
    const pending = pendingNavigationRef.current;
    if (!pending) return;
    const view = viewRef.current;
    if (!view) return;

    let cancelled = false;
    const run = () => {
      if (cancelled || pendingNavigationRef.current !== pending) return;
      revealNavigation(view, pending);
      // Retry a clamped location only while its line has not arrived and
      // the user has not moved the caret, edited the file, or left the editor.
      if (pending.line <= view.state.doc.lines) {
        pendingNavigationRef.current = null;
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));

    return () => {
      cancelled = true;
    };
  }, [navigation, value]);

  useEffect(() => {
    if (!active) return;
    const view = viewRef.current;
    if (!view) return;
    view.requestMeasure();
    const activeEl = document.activeElement;
    if (activeEl && view.dom.contains(activeEl) && activeEl !== view.contentDOM) {
      return;
    }
    view.focus();
  }, [active, path]);

  useEffect(() => {
    if (!active) setSelectionTarget(null);
  }, [active]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {showDiff ? (
          <DiffChunkNav
            index={chunkNav?.index ?? 0}
            total={chunkNav?.positions.length ?? 0}
            additions={chunkNav?.additions ?? 0}
            deletions={chunkNav?.deletions ?? 0}
            onPrev={() => stepChunkNav(-1)}
            onNext={() => stepChunkNav(1)}
          />
        ) : null}
        <EditorConflictBar
          count={conflictCount}
          canMarkResolved={hadConflicts && stillUnmerged}
          marking={marking.busy}
          error={marking.error}
          onPrev={() => viewRef.current && stepConflict(viewRef.current, -1)}
          onNext={() => viewRef.current && stepConflict(viewRef.current, 1)}
          onNextFile={onOpenFile && gitRelative ? () => void openNextConflictedFile() : undefined}
          fileNote={fileNote}
          onMarkResolved={() => void markResolved()}
        />
        {formatError ? (
          <p
            role="alert"
            className="shrink-0 border-b border-stroke px-3 py-1 text-[11px] text-content/65"
          >
            {t("Formatting failed: ")}
            {formatError}
          </p>
        ) : null}
        {blameOn && blameError ? (
          <p
            role="status"
            className="shrink-0 truncate border-b border-stroke px-3 py-1 text-[11px] text-content/45"
            title={blameError}
          >
            {t("Blame unavailable: ")}
            {blameError}
          </p>
        ) : null}
        <ConflictLayoutFrame path={path} sources={conflictSources}>
          <div ref={hostRef} className="relative min-h-0 flex-1" />
        </ConflictLayoutFrame>
      </div>
      {commentTarget ? (
        <DiffCommentComposer
          path={commentPath}
          target={commentTarget}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
      <EditorSelectionMenu selection={selectionTarget} onDismiss={() => setSelectionTarget(null)} />
    </>
  );
}

function ConflictLayoutFrame({
  path,
  sources,
  children,
}: {
  path: string;
  sources: ReturnType<typeof conflictSourcesFromMarkers> | null;
  children: React.ReactNode;
}) {
  return sources ? (
    <ConflictLayout path={path} {...sources}>
      {children}
    </ConflictLayout>
  ) : (
    children
  );
}

function editorSelectionTarget(
  view: EditorView,
  path: string,
  scroller: HTMLElement,
): EditorSelectionTarget | null {
  const reference = editorCodeSelection(view.state, path);
  if (!reference || !view.hasFocus) return null;
  const selection = view.state.selection.main;
  const coordinates = view.coordsAtPos(selection.head, selection.head === selection.from ? 1 : -1);
  if (!coordinates) return null;

  const viewport = scroller.getBoundingClientRect();
  if (
    coordinates.bottom < viewport.top ||
    coordinates.top > viewport.bottom ||
    coordinates.right < viewport.left ||
    coordinates.left > viewport.right
  ) {
    return null;
  }

  return {
    ...reference,
    anchor: new DOMRect(
      coordinates.left,
      coordinates.top,
      Math.max(1, coordinates.right - coordinates.left),
      Math.max(1, coordinates.bottom - coordinates.top),
    ),
  };
}

function DiffChunkNav({
  index,
  total,
  additions,
  deletions,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  additions: number;
  deletions: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  useLocale();
  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-stroke px-3 pr-1"
      role="toolbar"
      aria-label={t("Jump between changes")}
    >
      <DiffChunkStat additions={additions} deletions={deletions} />
      <div className="flex items-center gap-0.5">
        <DiffLayoutToggle className="mr-1" />
        <button
          type="button"
          title={t("Previous change")}
          aria-label={t("Previous change")}
          disabled={total === 0 || index <= 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPrev}
          className="grid size-6 place-items-center rounded text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35"
        >
          <ChevronUp className="size-3.5" strokeWidth={1.75} />
        </button>
        <span className="min-w-10 px-0.5 text-center font-mono text-[10.5px] font-medium tabular-nums text-content/55 select-none">
          {total === 0 ? "0/0" : `${index + 1}/${total}`}
        </span>
        <button
          type="button"
          title={t("Next change")}
          aria-label={t("Next change")}
          disabled={total === 0 || index >= total - 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNext}
          className="grid size-6 place-items-center rounded text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35"
        >
          <ChevronDown className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

function DiffChunkStat({ additions, deletions }: { additions: number; deletions: number }) {
  useLocale();
  if (additions <= 0 && deletions <= 0) {
    return <span className="min-w-0 flex-1" />;
  }
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5 font-sans text-[11px] font-semibold tabular-nums">
      {additions > 0 ? <span className="text-success">+{formatInteger(additions)}</span> : null}
      {deletions > 0 ? <span className="text-danger">-{formatInteger(deletions)}</span> : null}
    </span>
  );
}

function revealNavigation(view: EditorView, target: EditorNavigation) {
  const lineNumber = Math.min(Math.max(1, target.line), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  const column = Math.max(1, target.column ?? 1);
  const anchor = Math.min(line.from + column - 1, line.to);
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    annotations: sourceNavigation.of(true),
  });
  view.focus();
}

const diskReload = Annotation.define<boolean>();
const sourceNavigation = Annotation.define<boolean>();

function indentOrInsertTab(view: EditorView): boolean {
  const { state, dispatch } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore(view);
  }

  const unit = state.facet(indentUnit);
  if (unit === "\t") {
    dispatch(
      state.update(state.replaceSelection("\t"), {
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  const width = getIndentUnit(state);
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const column = countColumn(line.text.slice(0, range.head - line.from), state.tabSize);
        const insert = " ".repeat(width - (column % width) || width);
        return {
          changes: { from: range.head, insert },
          range: EditorSelection.cursor(range.head + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
}

type LineRange = { from: number; to: number };

type EditorCarry = {
  /** Set only when the old editor held unsaved edits. */
  doc: Text | null;
  saved: Text | null;
  head: number;
  topLine: number;
};

const wrappedLineIndent = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(indentDecorations(state, [{ from: 0, to: state.doc.length }]), true);
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) return decorations;
    const ranges: LineRange[] = [];
    transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = transaction.state.doc.lineAt(fromB).from;
      const to = transaction.state.doc.lineAt(toB).to;
      ranges.push({ from, to });
    });
    const changedLines = mergeLineRanges(ranges);
    return decorations.map(transaction.changes).update({
      filter: (from) => !changedLines.some((range) => from >= range.from && from <= range.to),
      add: indentDecorations(transaction.state, changedLines),
      sort: true,
    });
  },
  provide: (field) => EditorView.decorations.from(field),
});

function indentDecorations(state: EditorState, ranges: LineRange[]) {
  const decorations = [];
  for (const range of ranges) {
    let line = state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      const columns = leadingIndentColumns(line.text, state.tabSize);
      if (columns > 0) {
        const indent = Math.min(columns, 40);
        decorations.push(
          Decoration.line({
            attributes: {
              class: "cm-wrapped-indent",
              style: `padding-left: calc(${indent}ch + 6px); text-indent: -${indent}ch`,
            },
          }).range(line.from),
        );
      }
      if (line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return decorations;
}

function leadingIndentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      break;
    }
  }
  return columns;
}

function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
