import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { t, useLocale } from "../../../shared/i18n/technical";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { historyField, indentLess, indentMore, isolateHistory } from "@codemirror/commands";
import { foldGutter, foldKeymap, getIndentUnit, indentUnit } from "@codemirror/language";
import type { MergeView } from "@codemirror/merge";
import {
  Annotation,
  Compartment,
  countColumn,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";
import { formatInteger } from "../../../shared/lib/numbers";
import { minimalSetup } from "codemirror";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isLightScheme } from "../../settings/public/appearance";
import { loadAutosave, loadFormatOnSave, subscribeAutosave } from "../../settings/public/settings";
import { formatProjectText, hasBundledFormatter } from "../../../shared/lib/format";
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
} from "../../source-control/public/DiffCommentComposer";

import {
  DiffLayoutToggle,
  useResponsiveDiffLayout,
} from "../../source-control/public/DiffLayoutToggle";
import { hasConflictMarkers } from "../../source-control/public/conflictMarkers";
import { nextConflictedFile } from "../../source-control/public/conflictSection";
import { requestOpenCommit } from "../../source-control/public/GitFileInspector";
import { editorAutocomplete } from "../editor/editorAutocomplete";
import { editorBlame, refreshBlame } from "../editor/editorBlame";
import { conflictBlocks, editorConflicts, stepConflict } from "../editor/editorConflicts";
import { languageForPath, schemeExtensions } from "../editor/editorChrome";
import { editorReadability } from "../editor/editorReadability";
import { editorWrappedIndent } from "../editor/editorWrappedIndent";
import {
  preserveEditorViewport,
  replaceEditorDoc,
  normalizeLineBreaks,
  scrollLineToTop,
  topVisibleLine,
} from "../editor/editorDoc";
import { editorTyping, tryExpandEmmet } from "../editor/editorEditing";
import { EditorSelectionMenu, type EditorSelectionTarget } from "./EditorSelectionMenu";
import { EditorContextMenu, type EditorContextTarget } from "./EditorContextMenu";
import { editorCodeSelection, formatEditorSelectionReference } from "../model/editorSelection";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
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
import { editorZoom } from "../editor/editorZoom";
import { attachSplitOverview, editorOverview } from "../editor/editorOverview";
import { EditorConflictBar } from "./EditorConflictBar";
import {
  ConflictLayout,
  conflictSourcesFromMarkers,
} from "../../source-control/public/ConflictLayout";
import { MergeConflictEditor } from "../../source-control/public/MergeConflictEditor";

import { useInlineBlame, useInlineBlameUnavailableReason } from "./InlineBlameToggle";

import { FILE_EDITOR_AUTOSAVE_DELAY_MS } from "../editor/editorTiming";
import {
  editorSharedHistory,
  isSharedPeerChange,
  sharedDocumentSaved,
  type SharedDocumentHooks,
} from "../editor/editorSharedHistory";
import { registerClosingEditor } from "../model/editorClose";
import {
  installEditorInputGate,
  applyExternalEditorUpdate,
  type MountedEditorObserver,
  type EditorWorkTicket,
} from "./useMountedEditorClosure";

type EditorNavigationRequest = EditorNavigation & { token: number };

const editorScheme = new Compartment();
const editorGitConfig = new Compartment();
const editorBlameConfig = new Compartment();
const inlineBlameExtension = editorBlame({ onOpenCommit: requestOpenCommit });

export function CodeMirrorEditor(props: Parameters<typeof StandardCodeMirrorEditor>[0]) {
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  const dirtyRef = useRef(false);
  const internalSaveRef = useRef<((parent?: EditorWorkTicket) => Promise<boolean>) | null>(null);
  const pending = useRef(new Set<Promise<void>>());
  const saveRequestRef = props.saveRequestRef ?? internalSaveRef;
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    propsRef.current.onDirtyChange(dirty);
  }, []);
  const onSave = useCallback((text: string, ticket?: EditorWorkTicket) => {
    const write = ticket ? propsRef.current.onSave(text, ticket) : propsRef.current.onSave(text);
    pending.current.add(write);
    void write.then(
      () => pending.current.delete(write),
      () => pending.current.delete(write),
    );
    return write;
  }, []);
  const onMergedDocumentChange = useCallback((document: Text) => {
    propsRef.current.onEdit?.();
    propsRef.current.onDocChange?.(document.toString());
    propsRef.current.onDocumentChange?.(document);
  }, []);
  useEffect(
    () =>
      registerClosingEditor({
        path: props.path,
        dirty: () => dirtyRef.current,
        settle: async () => {
          while (pending.current.size) await Promise.allSettled(pending.current);
        },
        save: () => saveRequestRef.current?.() ?? Promise.resolve(false),
      }),
    [props.path, saveRequestRef],
  );
  const [merge, setMerge] = useState(() => hasConflictMarkers(props.value));
  useLayoutEffect(() => {
    props.captureObserver?.changed();
    if (merge && props.initialDraft === undefined) props.captureObserver?.attach(null);
  }, [merge, props.initialDraft, props.captureObserver]);
  // Conflict markers arriving in a new value switch to merge mode (latched once on).
  const [seenValue, setSeenValue] = useState(props.value);
  if (seenValue !== props.value) {
    setSeenValue(props.value);
    if (!merge && hasConflictMarkers(props.value)) setMerge(true);
  }
  return merge && props.initialDraft === undefined ? (
    <MergeConflictEditor
      path={props.path}
      cwd={props.cwd}
      value={props.value}
      active={props.active}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      canSave={props.canAutosave}
      onDocumentChange={onMergedDocumentChange}
      captureObserver={props.captureObserver}
      saveRequestRef={saveRequestRef}
      onOpenFile={props.onOpenFile}
    />
  ) : (
    <StandardCodeMirrorEditor
      {...props}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      saveRequestRef={saveRequestRef}
    />
  );
}

function StandardCodeMirrorEditor({
  path,
  cwd,
  commentPath,
  value,
  initialDraft,
  initialDirty = false,
  retainedState,
  showDiff,
  gitOriginal,
  active,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onSave,
  onPeerSaved,
  canAutosave,
  onStageGit,
  onDocChange,
  onDocumentChange,
  captureObserver,
  onEdit,
  shown = true,
  saveRequestRef,
  onOpenFile,
  formatOnSave = true,
}: {
  path: string;
  cwd: string;
  commentPath: string;
  value: string;
  /** Recovered edits start dirty against value, which remains the disk baseline. */
  initialDraft?: string;
  /** Explicit recovery copies remain unsaved until a successful file write. */
  initialDirty?: boolean;
  /** Parent-scoped carry survives replacement of this editor component. */
  retainedState?: { current: EditorCarry | null };
  showDiff: boolean;
  gitOriginal: string | null;
  active: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (dirty: boolean) => void;
  onErrorCountChange: (count: number) => void;
  onSave: (content: string, ticket?: EditorWorkTicket) => Promise<void>;
  /** Another editor on this file, showing the same text, saved `content`. */
  onPeerSaved?: (content: string) => void;
  canAutosave: () => boolean;
  onStageGit?: (contents: string) => Promise<void>;
  /** Receives the whole text after each change: pass it only while it is shown. */
  onDocChange?: (content: string) => void;
  /** Admits the actual immutable document before deferred persistence starts. */
  onDocumentChange?: (document: Text) => void;
  captureObserver?: MountedEditorObserver;
  /** Cheap per-change notice that copies no text. */
  onEdit?: () => void;
  /** False while covered by another tab: git refreshes wait until it is shown. */
  shown?: boolean;
  /** Runs the same save flow as Ctrl/Cmd+S before an external preview. */
  saveRequestRef?: { current: ((parent?: EditorWorkTicket) => Promise<boolean>) | null };
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
  const initialDirtyRef = useRef(initialDirty);
  const activeRef = useRef(active);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onErrorCountChangeRef = useRef(onErrorCountChange);
  const onSaveRef = useRef(onSave);
  const onPeerSavedRef = useRef(onPeerSaved);
  const canAutosaveRef = useRef(canAutosave);
  const onStageGitRef = useRef(onStageGit);
  const canStage = onStageGit !== undefined;
  const onDocChangeRef = useRef(onDocChange);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const captureObserverRef = useRef(captureObserver);
  useLayoutEffect(() => {
    captureObserverRef.current = captureObserver;
  }, [captureObserver]);
  const onEditRef = useRef(onEdit);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const blameStale = useRef(false);
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const valueRef = useRef(value);
  const initialDraftRef = useRef(initialDraft);
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
  const localCarryRef = useRef<EditorCarry | null>(null);
  const carryRef = retainedState ?? localCarryRef;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const diffLayout = useResponsiveDiffLayout(hostRef);
  // Keep the editable result in the conflict-aware editor. Sources use their own
  // read-only panes; resolving the last block must not rebuild the result as a diff.
  const [conflictInline, setConflictInline] = useState(() => hasConflictMarkers(value));
  const [conflictSources, setConflictSources] = useState(() =>
    hasConflictMarkers(value) ? conflictSourcesFromMarkers(value) : null,
  );
  const conflictLayoutActive = conflictSources !== null;
  // Both latch on when a new value brings conflict markers; they never turn back off.
  const [seenConflictValue, setSeenConflictValue] = useState(value);
  if (seenConflictValue !== value) {
    setSeenConflictValue(value);
    if (hasConflictMarkers(value)) {
      if (!conflictInline) setConflictInline(true);
      if (!conflictSources) setConflictSources(conflictSourcesFromMarkers(value));
    }
  }
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
  const [formatError, setFormatError] = useState<{
    message: string;
    generation: number;
    saved: boolean;
  } | null>(null);
  const [contextTarget, setContextTarget] = useState<EditorContextTarget | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const scheduleBlameRef = useRef<(() => void) | null>(null);
  const saveNowRef = useRef<((parent?: EditorWorkTicket) => Promise<boolean>) | null>(null);
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
  onPeerSavedRef.current = onPeerSaved;
  canAutosaveRef.current = canAutosave;
  onStageGitRef.current = onStageGit;
  onDocChangeRef.current = onDocChange;
  onEditRef.current = onEdit;
  onDocumentChangeRef.current = onDocumentChange;
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
    let composing = false;
    let compositionSettling = false;
    let view: EditorView;
    let split: MergeView | null = null;
    const carry = carryRef.current;
    carryRef.current = null;

    const markDirty = () => {
      const saved = savedDocumentRef.current;
      setDirty(initialDirtyRef.current || (saved ? !view.state.doc.eq(saved) : false));
    };

    const formatDocument = async (manual = false, parent?: EditorWorkTicket) => {
      if (disposed || (!parent && (view.state.readOnly || !view.state.facet(EditorView.editable))))
        return;
      const settled = captureObserverRef.current?.operation("formatter", parent);
      if (captureObserverRef.current && !settled) return;
      const generation = ++formatGeneration;
      const before = view.state.doc;
      const selection = view.state.selection;
      setFormatError(null);
      try {
        const result = await formatProjectText(path, before.toString(), selection.main.head);
        if (disposed || generation !== formatGeneration || view.state.doc !== before) return;
        if (!result) {
          if (manual || hasBundledFormatter(path))
            setFormatError({
              message: t("No formatter is available for this file, or its syntax is invalid."),
              generation,
              saved: false,
            });
          return generation;
        }
        const apply = () =>
          replaceEditorDoc(view, result.formatted, {
            annotations: [isolateHistory.of("full")],
            selection: view.state.selection.eq(selection)
              ? { anchor: Math.min(Math.max(0, result.cursorOffset), result.formatted.length) }
              : undefined,
            scroller: scrollerRef.current ?? undefined,
          });
        if (settled) settled.apply(apply);
        else apply();
      } catch (error) {
        if (!disposed && generation === formatGeneration && view.state.doc === before)
          setFormatError({
            message: error instanceof Error ? error.message : String(error),
            generation,
            saved: false,
          });
      } finally {
        settled?.();
      }
      return generation;
    };

    /** Resolves true once the document reached the disk. */
    const saveDocument = (automatic = false, parent?: EditorWorkTicket): Promise<boolean> => {
      const settled = captureObserverRef.current?.operation("editor-save", parent);
      if (captureObserverRef.current && !settled) return Promise.resolve(false);
      const retryPendingAutosave = autosaveTimer !== 0 && loadAutosave();
      window.clearTimeout(autosaveTimer);
      const generation = ++saveGeneration;
      setFormatError((current) => (current?.saved ? { ...current, saved: false } : current));
      return (async () => {
        let savedFormatGeneration: number | undefined;
        if (formatOnSaveRef.current && loadFormatOnSave()) {
          savedFormatGeneration = await formatDocument(false, settled ?? undefined);
          if (disposed || generation !== saveGeneration) return false;
        }

        const document = view.state.doc;
        if (automatic && !canAutosaveRef.current()) return false;
        try {
          if (settled && captureObserverRef.current?.closed())
            await onSaveRef.current(document.toString(), settled);
          else await onSaveRef.current(document.toString());
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
        const apply = () => {
          savedDocumentRef.current = document;
          initialDirtyRef.current = false;
          markDirty();
          if (view.state.doc === document && savedFormatGeneration === formatGeneration)
            setFormatError((current) =>
              current?.generation === savedFormatGeneration ? { ...current, saved: true } : current,
            );
        };
        if (settled) settled.apply(apply);
        else apply();
        sharedDocumentSaved(view, document);
        scheduleBlame();
        return true;
      })().finally(() => settled?.());
    };
    const save = (automatic = false) => {
      void saveDocument(automatic);
      return true;
    };
    saveNowRef.current = (parent) => saveDocument(false, parent);
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
        if (!blameOnRef.current) return;
        if (!shownRef.current) blameStale.current = true;
        else if (!document.hidden) scheduleBlame();
      },
      { cwd: gitTargetRef.current.cwd },
    );

    function cancelAutosave() {
      if (!autosaveTimer) return;
      window.clearTimeout(autosaveTimer);
      autosaveTimer = 0;
      captureObserverRef.current?.changed();
    }

    function scheduleAutosave() {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = 0;
      captureObserverRef.current?.changed();
      if (!loadAutosave()) return;
      autosaveTimer = window.setTimeout(() => {
        autosaveTimer = 0;
        captureObserverRef.current?.changed();
        if (dirtyRef.current && loadAutosave() && canAutosaveRef.current()) {
          save(true);
        }
      }, FILE_EDITOR_AUTOSAVE_DELAY_MS);
    }

    // Folding would pull one pane's lines out of line with the other, and the
    // pair scrolls as a whole, so the editor's own scrollbar has no job.
    const openContextMenu = (editor: EditorView, x = 0, y = 0) => {
      selectionMeasureVersion++;
      setSelectionTarget(null);
      setContextError(null);
      const position = x || y ? editor.posAtCoords({ x, y }) : null;
      // Preserve the selected code when opening its menu; otherwise move the caret.
      if (
        position !== null &&
        !editor.state.selection.ranges.some(
          (range) => !range.empty && position >= range.from && position <= range.to,
        )
      ) {
        editor.dispatch({ selection: { anchor: position } });
      }
      selectionMeasureVersion++;
      setSelectionTarget(null);
      const caret = editor.coordsAtPos(editor.state.selection.main.head);
      setContextTarget({
        x: x || caret?.left || 0,
        y: y || caret?.bottom || 0,
        view: editor,
        isCurrent: () => !disposed,
        ...(editor === view
          ? {
              format: () => void formatDocument(true),
              save: () => {
                save();
              },
            }
          : {}),
      });
    };
    const contextMenu = EditorView.domEventHandlers({
      contextmenu(event, editor) {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(editor, event.clientX, event.clientY);
        return true;
      },
      keydown(event, editor) {
        if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return false;
        event.preventDefault();
        openContextMenu(editor);
        return true;
      },
    });
    // Other editors on this file share this text; see editorSharedHistory.
    const sharedDocument: SharedDocumentHooks = {
      external: (apply) => applyExternalEditorUpdate(captureObserverRef.current, apply),
      saved: (document) =>
        applyExternalEditorUpdate(captureObserverRef.current, () => {
          if (disposed) return;
          savedDocumentRef.current = document;
          initialDirtyRef.current = false;
          markDirty();
          if (!dirtyRef.current) cancelAutosave();
          onPeerSavedRef.current?.(document.toString());
          scheduleBlame();
        }),
      peerLeft: () => {
        if (disposed || !dirtyRef.current) return false;
        scheduleAutosave();
        return true;
      },
    };
    const extensions: Extension[] = [
      contextMenu,
      editorZoom(),
      minimalSetup,
      carry?.state.field(historyField, false)
        ? historyField.init(() => carry.state.field(historyField))
        : [],
      // Text and undo/redo shared with other editors on this file, e.g. its review tab.
      editorSharedHistory(path, sharedDocument),
      editorGitConfig.of(showDiffRef.current && !splitDiff ? editorGit(gitOptions) : []),
      // Ahead of the line numbers, so the blame gutter is the leftmost one.
      editorBlameConfig.of(blameOnRef.current ? inlineBlameExtension : []),
      editorConflicts,
      lineNumbers(),
      splitDiff ? [] : foldGutter(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      editorWrappedIndent,
      language.of([]),
      editorScheme.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
      editorReadability(path),
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
        if (update.startState.readOnly !== update.state.readOnly)
          captureObserverRef.current?.changed();
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
        setFormatError((current) => (current?.saved ? { ...current, saved: false } : current));
        captureObserverRef.current?.changed();
        const blockCount = conflictBlocks(update.state).length;
        setConflictCount(blockCount);
        if (blockCount > 0) setHadConflicts(true);
        onEditRef.current?.();
        onDocChangeRef.current?.(update.state.doc.toString());
        if (update.transactions.some((tr) => tr.annotation(diskReload))) {
          return;
        }
        onDocumentChangeRef.current?.(update.state.doc);
        markDirty();
        // The editor that made a shared edit saves it; one pending save at a time.
        if (update.transactions.some(isSharedPeerChange)) cancelAutosave();
        else scheduleAutosave();
      }),
      EditorView.domEventHandlers({
        compositionstart: () => {
          composing = true;
          captureObserverRef.current?.changed();
        },
        compositionend: () => {
          composing = false;
          compositionSettling = true;
          captureObserverRef.current?.changed();
          view.requestMeasure({
            read: () => null,
            write: () => {
              if (!disposed && !view.compositionStarted) {
                compositionSettling = false;
                captureObserverRef.current?.changed();
              }
            },
          });
        },
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
    // Path and layout changes rebuild extensions, while the document identity stays intact.
    const initialDoc = carry?.doc ?? initialDraftRef.current ?? valueRef.current;
    let leftView: EditorView | null = null;
    if (splitDiff) {
      split = createSplitDiff({
        parent: host,
        original: gitOriginalRef.current ?? "",
        doc: initialDoc,
        extensions,
        originalExtensions: [
          contextMenu,
          editorZoom(),
          minimalSetup,
          editorReadability(path),
          editorNavigation(cwd, path, (...args) => onOpenFileRef.current?.(...args)),
          lineNumbers(),
          EditorView.lineWrapping,
          editorWrappedIndent,
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
    const inputGate = installEditorInputGate(view, captureObserverRef.current);
    const originalGate = leftView
      ? installEditorInputGate(leftView, captureObserverRef.current)
      : null;
    splitRef.current = split;
    const detachSplitOverview = split ? attachSplitOverview(split) : null;
    scrollerRef.current = split ? split.dom : view.scrollDOM;
    if (carry?.saved) {
      savedDocumentRef.current = carry.saved;
      markDirty();
    } else {
      savedDocumentRef.current =
        initialDraftRef.current === undefined
          ? view.state.doc
          : EditorState.create({ doc: valueRef.current }).doc;
      markDirty();
    }
    viewRef.current = view;
    captureObserverRef.current?.attach({
      setClosed(closed) {
        inputGate.setClosed(closed);
        originalGate?.setClosed(closed);
        if (!closed && dirtyRef.current) scheduleAutosave();
      },
      read() {
        if (disposed) throw new Error("Editor view retired");
        return {
          text: view.state.doc.toString(),
          composing: composing || compositionSettling || view.composing,
          compositionStarted: view.compositionStarted,
          readOnly: view.state.readOnly,
          pendingAutosave: dirtyRef.current && autosaveTimer !== 0,
          kind: "source",
        };
      },
    });
    const initialBlockCount = conflictBlocks(view.state).length;
    setConflictCount(initialBlockCount);
    if (initialBlockCount > 0) setHadConflicts(true);
    if (blameOnRef.current) scheduleBlame();
    lockOverscroll(scrollerRef.current as HTMLDivElement);
    if (carry) {
      view.dispatch({
        selection: carry.state.selection,
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
    // Source-control previews keep keyboard navigation in the changed-file list.
    if (
      activeRef.current &&
      (!carry || carry.focused) &&
      !(showDiffRef.current && document.activeElement?.matches("[data-git-file]"))
    )
      view.focus();

    void languageForPath(path).then((extension) => {
      if (!disposed && extension) {
        const reconfigure = { effects: language.reconfigure(extension) };
        applyExternalEditorUpdate(captureObserverRef.current, () => {
          view.dispatch(reconfigure);
          leftView?.dispatch(reconfigure);
        });
      }
    });

    const unsubscribeAutosave = subscribeAutosave(scheduleAutosave);
    return () => {
      disposed = true;
      setContextTarget(null);
      captureObserverRef.current?.attach(null);
      inputGate.release();
      originalGate?.release();
      unsubscribeAutosave();
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
        doc: view.state.doc,
        saved: savedDocumentRef.current,
        state: view.state,
        topLine: topVisibleLine(view, scrollerRef.current ?? view.scrollDOM),
        focused: view.hasFocus || Boolean(split?.a.hasFocus),
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
    carryRef,
    syncChunkNav,
  ]);

  useEffect(() => {
    const reconfigure = {
      effects: editorScheme.reconfigure(schemeExtensions(colorScheme)),
    };
    applyExternalEditorUpdate(captureObserverRef.current, () => {
      viewRef.current?.dispatch(reconfigure);
      leftViewRef.current?.dispatch(reconfigure);
    });
  }, [colorScheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    applyExternalEditorUpdate(captureObserverRef.current, () =>
      view.dispatch({
        effects: editorBlameConfig.reconfigure(blameOn ? inlineBlameExtension : []),
      }),
    );
    if (blameOn) scheduleBlameRef.current?.();
    else setBlameError(null);
  }, [blameOn]);

  useEffect(() => {
    if (!shown || !blameStale.current) return;
    blameStale.current = false;
    if (blameOnRef.current) scheduleBlameRef.current?.();
  }, [shown]);

  // The file stays unmerged in git until it is staged, whatever the buffer says.
  useEffect(() => {
    if (conflictCount > 0 || !hadConflicts || !gitRelative) {
      setStillUnmerged(false);
      return;
    }
    // Hidden: no git polling; showing the editor checks again.
    if (!shown) return;
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
  }, [conflictCount, cwd, gitRelative, hadConflicts, shown]);

  // The note belongs to the file it was raised for, so another file shows none.
  const [fileNoteState, setFileNoteState] = useState<{ path: string; message: string } | null>(
    null,
  );
  const fileNote = fileNoteState?.path === path ? fileNoteState.message : null;
  const setFileNote = useCallback(
    (message: string | null) => setFileNoteState(message === null ? null : { path, message }),
    [path],
  );

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
  }, [cwd, gitRelative, onOpenFile, setFileNote]);

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
    applyExternalEditorUpdate(captureObserverRef.current, () => {
      view.dispatch({
        effects: editorGitConfig.reconfigure(showDiff ? editorGit(gitOptions) : []),
      });
      if (showDiff) {
        setGitOriginal(view, gitOriginalRef.current);
        syncChunkNav(view);
      } else {
        setChunkNav(null);
      }
    });
  }, [canStage, showDiff, splitDiff]);

  useEffect(() => {
    if (splitRef.current)
      applyExternalEditorUpdate(captureObserverRef.current, () =>
        setSplitCanStage(splitRef.current!, canStage),
      );
  }, [canStage, splitDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    const split = splitRef.current;
    let changed = false;
    applyExternalEditorUpdate(captureObserverRef.current, () =>
      preserveEditorViewport(
        view,
        () => {
          changed = split
            ? setSplitOriginal(split, gitOriginal ?? "")
            : setGitOriginal(view, gitOriginal);
        },
        scrollerRef.current ?? view.scrollDOM,
      ),
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
    const apply = () => {
      const applied = replaceEditorDoc(view, value, {
        annotations: [Transaction.addToHistory.of(false), diskReload.of(true)],
        scroller: scrollerRef.current ?? undefined,
      });
      if (!applied || view.state.doc.toString() !== normalizeLineBreaks(value)) return;
      savedDocumentRef.current = view.state.doc;
      setDirty(false);
      if (showDiff) {
        chunkNavPinnedRef.current = null;
        syncChunkNav(view);
      }
    };
    if (captureObserverRef.current) captureObserverRef.current.external(apply);
    else apply();
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
    if (showDiff && activeEl?.matches("[data-git-file]")) return;
    if (activeEl && view.dom.contains(activeEl) && activeEl !== view.contentDOM) {
      return;
    }
    view.focus();
  }, [active, path, showDiff]);

  // The selection menu never outlives the editor being active.
  if (!active && selectionTarget !== null) setSelectionTarget(null);
  if (!active && contextTarget !== null) setContextTarget(null);

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
          <InlineError className="shrink-0 px-3 py-1">
            {t(formatError.saved ? "Saved, but formatting failed: " : "Formatting failed: ")}
            {formatError.message}
          </InlineError>
        ) : null}
        {contextError ? (
          <InlineError className="shrink-0 px-3 py-1">{contextError}</InlineError>
        ) : null}
        {blameOn && blameError ? (
          <p
            role="status"
            className="shrink-0 truncate px-3 py-1 text-ui-caption text-(--ui-text-muted)"
            title={blameError}
          >
            {t("Blame unavailable: ")}
            {blameError}
          </p>
        ) : null}
        <ConflictLayoutFrame path={path} sources={conflictSources}>
          <div
            ref={hostRef}
            data-diff-layout={diffLayout}
            data-editor-shown={shown}
            className="relative min-h-0 min-w-0 flex-1"
          />
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
      {contextTarget ? (
        <EditorContextMenu
          target={contextTarget}
          path={commentPath}
          onClose={() => setContextTarget(null)}
          onError={setContextError}
        />
      ) : null}
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
      className="flex min-h-(--ui-control-height-compact) shrink-0 items-center justify-between gap-2 px-2"
      role="toolbar"
      aria-label={t("Jump between changes")}
    >
      <DiffChunkStat additions={additions} deletions={deletions} />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Previous change")}
          motion="none"
          type="button"
          disabled={total === 0 || index <= 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPrev}
        >
          <ChevronUp className="icon-sm" strokeWidth={1.75} />
        </Button>
        <span className="min-w-10 text-center text-ui-micro font-medium tabular-nums text-(--ui-text-secondary) select-none">
          {total === 0 ? "0/0" : `${index + 1}/${total}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Next change")}
          motion="none"
          type="button"
          disabled={total === 0 || index >= total - 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNext}
        >
          <ChevronDown className="icon-sm" strokeWidth={1.75} />
        </Button>
        <DiffLayoutToggle />
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
    <span className="flex min-w-0 shrink-0 items-center gap-1.5 font-sans text-ui-micro font-medium tabular-nums">
      {additions > 0 ? (
        <span className="text-(--ui-tone-success-fg)">+{formatInteger(additions)}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-(--ui-tone-danger-fg)">-{formatInteger(deletions)}</span>
      ) : null}
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

export type EditorCarry = {
  /** Document and history carried when path-specific extensions are rebuilt. */
  doc: Text | null;
  saved: Text | null;
  state: EditorState;
  topLine: number;
  focused: boolean;
};
