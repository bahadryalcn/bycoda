import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { openSearchPanel } from "@codemirror/search";
import {
  gitConflicts,
  gitConflictStages,
  gitStageFile,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import { Search } from "../../../shared/ui/icons";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { languageForPath, schemeExtensions } from "../../files/editor/editorChrome";
import { editorReadability } from "../../files/editor/editorReadability";
import { editorSearch } from "../../files/editor/editorSearch";
import { editorZoom } from "../../files/editor/editorZoom";
import {
  installEditorInputGate,
  applyExternalEditorUpdate,
  type MountedEditorObserver,
  type EditorWorkTicket,
} from "../../files/ui/useMountedEditorClosure";
import { hasConflictMarkers } from "../model/conflictMarkers";
import { nextConflictedFile } from "../model/conflictSection";
import {
  chooseMergeRegion,
  chooseAllMergeRegions,
  createMergeResolution,
  mergeResolution,
  mergeResolutionField,
  mergeResolutionHistory,
  selectMergeRegion,
  type MergeChoice,
  type MergeResolution,
} from "../model/mergeResolution";
import { ConflictLayout, conflictSourcesFromMarkers } from "./ConflictLayout";
import { mergeActionsDisabled, mergeResultActions } from "./mergeResultActions";

export type MergeConflictEditorProps = {
  path: string;
  cwd: string;
  value: string;
  base?: string | null;
  active: boolean;
  disabled?: boolean;
  onSave: (text: string, ticket?: EditorWorkTicket) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  /** Captures result text only; unresolved region choices remain separate state. */
  onDocumentChange?: (document: Text) => void;
  captureObserver?: MountedEditorObserver;
  canSave: () => boolean;
  onResolved?: () => void;
  onOpenFile?: (path: string) => void;
  saveRequestRef?: { current: ((parent?: EditorWorkTicket) => Promise<boolean>) | null };
};

/** One merge session owns immutable sources and an editable, marker-free result.
 * Unresolved decisions live in editor state/history, never in the saved JSON. */
export function MergeConflictEditor(props: MergeConflictEditorProps) {
  useLocale();
  const { path, cwd, active, disabled = false } = props;
  const [sources] = useState(() => conflictSourcesFromMarkers(props.value));
  const [initial, setInitial] = useState<ReturnType<typeof createMergeResolution> | null>(null);
  const [state, setState] = useState<MergeResolution>({ regions: [], active: 0 });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const inputGateRef = useRef<ReturnType<typeof installEditorInputGate> | null>(null);
  const previousDisabled = useRef(disabled);
  const propsRef = useRef(props);
  propsRef.current = props;
  const saveRef = useRef<((parent?: EditorWorkTicket) => Promise<boolean>) | null>(null);
  const [loadRetry, setLoadRetry] = useState(0);
  const blockedLoad = useRef(false);
  const chooseRef = useRef<(id: number, side: MergeChoice) => void>(() => {});
  const busyRef = useRef(false);
  const savedRef = useRef<EditorState | null>(null);
  const theme = useRef(new Compartment());
  const editability = useRef(new Compartment());
  const scheme = useColorScheme();
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const preparing = props.captureObserver?.closed() ?? false;
  useEffect(() => {
    if (!preparing && blockedLoad.current) {
      blockedLoad.current = false;
      setLoadRetry((value) => value + 1);
    }
  }, [preparing]);

  useEffect(() => {
    const settled = propsRef.current.captureObserver?.operation("merge-load");
    if (propsRef.current.captureObserver && !settled) {
      blockedLoad.current = true;
      propsRef.current.captureObserver.external(() => {});
      return;
    }
    let cancelled = false;
    const prepare = (base: string | null | undefined) => {
      if (!cancelled) setInitial(createMergeResolution(props.value, base));
    };
    if (props.base !== undefined) {
      try {
        prepare(props.base);
      } finally {
        settled?.();
      }
    } else
      void gitConflictStages(cwd, displayPath(path, cwd))
        .then(
          (stages) => prepare(stages.binary || stages.tooLarge ? null : stages.base),
          () => prepare(null), // Marker sources still allow resolution without a base.
        )
        .finally(() => settled?.());
    return () => {
      cancelled = true;
    };
  }, [cwd, path, props.value, props.base, loadRetry]);

  useEffect(() => {
    if (!host.current || !initial) return;
    const language = new Compartment();
    let disposed = false;
    let composing = false;
    let compositionSettling = false;
    const field = mergeResolutionField.init(() => initial.resolution);
    const view = new EditorView({
      parent: host.current,
      doc: initial.doc,
      extensions: [
        minimalSetup,
        lineNumbers(),
        editorSearch,
        editorZoom(),
        field,
        mergeResolutionHistory,
        theme.current.of(schemeExtensions(schemeRef.current)),
        language.of([]),
        editorReadability(path),
        editability.current.of([
          EditorState.readOnly.of(!!propsRef.current.disabled),
          mergeActionsDisabled.of(!!propsRef.current.disabled),
        ]),
        mergeResultActions(
          (id, side) => chooseRef.current(id, side),
          (id) =>
            applyExternalEditorUpdate(propsRef.current.captureObserver, () =>
              selectMergeRegion(view, id),
            ),
        ),
        EditorView.contentAttributes.of({ "aria-label": t("Resolved output") }),
        EditorView.domEventHandlers({
          compositionstart: () => {
            composing = true;
            propsRef.current.captureObserver?.changed();
          },
          compositionend: () => {
            composing = false;
            compositionSettling = true;
            propsRef.current.captureObserver?.changed();
            view.requestMeasure({
              read: () => null,
              write: () => {
                if (!disposed && !view.compositionStarted) {
                  compositionSettling = false;
                  propsRef.current.captureObserver?.changed();
                }
              },
            });
          },
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void saveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.decorations.compute([mergeResolutionField], (state) => {
          const merge = mergeResolution(state);
          return Decoration.set(
            merge.regions.flatMap((region) => {
              const first = state.doc.lineAt(region.from).number;
              const last = state.doc.lineAt(Math.max(region.from, region.to - 1)).number;
              return Array.from({ length: last - first + 1 }, (_, offset) =>
                Decoration.line({
                  class:
                    region.choice === null ? "conflict-result-pending" : "conflict-result-resolved",
                  attributes: {
                    "data-merge-region": String(region.id),
                    "data-merge-active": String(region.id === merge.active),
                  },
                }).range(state.doc.line(first + offset).from),
              );
            }),
            true,
          );
        }),
        EditorView.updateListener.of((update) => {
          const next = mergeResolution(update.state);
          const before = mergeResolution(update.startState);
          if (
            update.docChanged ||
            next !== before ||
            update.startState.readOnly !== update.state.readOnly
          )
            propsRef.current.captureObserver?.changed();
          if (next !== before) setState(next);
          if (!update.docChanged && next.regions === before.regions) return;
          if (update.docChanged) propsRef.current.onDocumentChange?.(update.state.doc);
          setResolved(false);
          const saved = savedRef.current;
          const changed =
            !!saved &&
            (!update.state.doc.eq(saved.doc) ||
              next.regions.some(
                (region, id) => region.choice !== mergeResolution(saved).regions[id]?.choice,
              ));
          setDirty(changed);
          propsRef.current.onDirtyChange(changed);
          setError(null);
        }),
      ],
    });
    const inputGate = installEditorInputGate(view, propsRef.current.captureObserver);
    inputGateRef.current = inputGate;
    viewRef.current = view;
    propsRef.current.captureObserver?.attach({
      setClosed: inputGate.setClosed,
      read() {
        if (disposed) throw new Error("Merge editor view retired");
        const resolution = mergeResolution(view.state);
        return {
          text: view.state.doc.toString(),
          composing: composing || compositionSettling || view.composing,
          compositionStarted: view.compositionStarted,
          readOnly: view.state.readOnly,
          pendingAutosave: false,
          kind: "merge",
          mergeState: {
            active: resolution.active,
            regions: resolution.regions.map((region) => ({ ...region })),
          },
        };
      },
    });
    savedRef.current = view.state;
    setState(initial.resolution);
    saveRef.current = async (parent) => {
      if (busyRef.current || propsRef.current.disabled) return false;
      const settled = propsRef.current.captureObserver?.operation("merge-save", parent);
      if (propsRef.current.captureObserver && !settled) return false;
      if (
        mergeResolution(view.state).regions.some((region) => region.choice === null) ||
        hasConflictMarkers(view.state.doc.toString())
      ) {
        settled?.();
        setError(
          t("Resolve every conflict before saving. Use a source or confirm your edited result."),
        );
        return false;
      }
      if (!propsRef.current.canSave()) {
        settled?.();
        setError(t("The file changed on disk. Reopen it before saving your resolution."));
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      const snapshot = view.state;
      try {
        if (settled && propsRef.current.captureObserver?.closed())
          await propsRef.current.onSave(snapshot.doc.toString(), settled);
        else await propsRef.current.onSave(snapshot.doc.toString());
        if (disposed) return true;
        savedRef.current = snapshot;
        const changed =
          !view.state.doc.eq(snapshot.doc) ||
          mergeResolution(view.state).regions.some(
            (region, id) => region.choice !== mergeResolution(snapshot).regions[id]?.choice,
          );
        setDirty(changed);
        propsRef.current.onDirtyChange(changed);
        return true;
      } catch (error) {
        if (!disposed) setError(String(error));
        return false;
      } finally {
        settled?.();
        busyRef.current = false;
        if (!disposed) setBusy(false);
      }
    };
    const requestRef = propsRef.current.saveRequestRef;
    if (requestRef)
      requestRef.current = (parent) => saveRef.current?.(parent) ?? Promise.resolve(false);
    void languageForPath(path).then((extension) => {
      if (!disposed)
        applyExternalEditorUpdate(propsRef.current.captureObserver, () =>
          view.dispatch({ effects: language.reconfigure(extension ?? []) }),
        );
    });
    if (propsRef.current.active) view.focus();
    return () => {
      disposed = true;
      propsRef.current.captureObserver?.attach(null);
      inputGate.release();
      if (inputGateRef.current === inputGate) inputGateRef.current = null;
      viewRef.current = null;
      saveRef.current = null;
      if (requestRef) requestRef.current = null;
      view.destroy();
    };
  }, [initial, path]);

  useEffect(() => {
    applyExternalEditorUpdate(propsRef.current.captureObserver, () =>
      viewRef.current?.dispatch({ effects: theme.current.reconfigure(schemeExtensions(scheme)) }),
    );
  }, [scheme]);
  useEffect(() => {
    const apply = () =>
      viewRef.current?.dispatch({
        effects: editability.current.reconfigure([
          EditorState.readOnly.of(disabled || busy),
          mergeActionsDisabled.of(disabled || busy),
        ]),
      });
    if (previousDisabled.current !== disabled)
      applyExternalEditorUpdate(propsRef.current.captureObserver, apply);
    else if (inputGateRef.current) inputGateRef.current.maintain(apply);
    else apply();
    previousDisabled.current = disabled;
  }, [disabled, busy]);
  useEffect(() => {
    if (active) viewRef.current?.requestMeasure();
  }, [active]);

  const pending = state.regions.filter((region) => region.choice === null).length;
  const choose = (id: number, side: MergeChoice) => {
    if (
      viewRef.current &&
      !busyRef.current &&
      !disabled &&
      (!propsRef.current.captureObserver || propsRef.current.captureObserver.allowed())
    ) {
      setResolved(false);
      chooseMergeRegion(viewRef.current, id, side);
    }
  };
  chooseRef.current = choose;
  const stage = async () => {
    const settled = propsRef.current.captureObserver?.operation("merge-stage");
    if (propsRef.current.captureObserver && !settled) return;
    try {
      if (!(await saveRef.current?.(settled ?? undefined)) || !viewRef.current) return;
      busyRef.current = true;
      setBusy(true);
      await gitStageFile(cwd, displayPath(path, cwd));
      notifyGitChanged(cwd, "index");
      setResolved(true);
      propsRef.current.onResolved?.();
    } catch (error) {
      setError(String(error));
    } finally {
      settled?.();
      busyRef.current = false;
      setBusy(false);
    }
  };
  const nextFile = async () => {
    const settled = applyExternalEditorUpdate(propsRef.current.captureObserver, () =>
      propsRef.current.captureObserver?.operation("merge-navigation"),
    );
    try {
      const next = nextConflictedFile(await gitConflicts(cwd), displayPath(path, cwd));
      if (next) propsRef.current.onOpenFile?.(`${cwd.replace(/[\\/]+$/, "")}/${next}`);
      else setError(t("No other conflicted files"));
    } catch (error) {
      setError(String(error));
    } finally {
      settled?.();
    }
  };
  return (
    <div className="merge-conflict-editor">
      {error ? <InlineError className="conflict-editor-status">{error}</InlineError> : null}
      {resolved ? (
        <InlineMessage tone="success" className="conflict-editor-status">
          {t("All conflicts resolved")}
        </InlineMessage>
      ) : null}
      {!initial ? (
        <LoadingText className="conflict-editor-status">
          {t("Loading conflict versions")}
        </LoadingText>
      ) : null}
      <ConflictLayout
        cwd={cwd}
        path={path}
        {...sources}
        dirty={dirty}
        controls={
          state.regions.length
            ? {
                state,
                disabled: disabled || busy || preparing,
                choose,
                chooseAll: (side) => {
                  if (
                    viewRef.current &&
                    !busyRef.current &&
                    !disabled &&
                    (!propsRef.current.captureObserver ||
                      propsRef.current.captureObserver.allowed())
                  )
                    chooseAllMergeRegions(viewRef.current, side);
                },
                select: (id) => {
                  if (viewRef.current)
                    applyExternalEditorUpdate(propsRef.current.captureObserver, () =>
                      selectMergeRegion(viewRef.current!, id),
                    );
                },
                view: () => viewRef.current,
                measure: () => {
                  const view = viewRef.current;
                  if (!view) return;
                  view.requestMeasure();
                  const state = mergeResolution(view.state);
                  const region = state.regions[state.active];
                  if (region)
                    view.dispatch({
                      effects: EditorView.scrollIntoView(region.from, { y: "center" }),
                    });
                },
              }
            : undefined
        }
        resultActions={
          <>
            {props.onOpenFile ? (
              <Button
                variant="ghost"
                size="sm"
                motion="none"
                disabled={busy || disabled}
                onClick={() => void nextFile()}
              >
                {t("Next file")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              motion="none"
              iconOnly
              label={t("Find in this pane")}
              onClick={() => {
                if (viewRef.current) openSearchPanel(viewRef.current);
              }}
            >
              <Search className="icon-sm" />
            </Button>
            <Button
              variant="primary"
              size="sm"
              motion="none"
              disabled={!initial || disabled || busy || preparing || pending > 0 || resolved}
              tooltip={
                pending
                  ? t("Resolve every conflict first")
                  : resolved
                    ? t("Saved and staged")
                    : t("Save the file and stage it")
              }
              onClick={() => void stage()}
            >
              {resolved ? t("Staged") : t("Save and stage")}
            </Button>
          </>
        }
      >
        <div ref={host} className="conflict-result-editor" />
      </ConflictLayout>
    </div>
  );
}
