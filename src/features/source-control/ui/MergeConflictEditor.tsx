import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
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
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { languageForPath, schemeExtensions } from "../../files/editor/editorChrome";
import { editorSearch } from "../../files/editor/editorSearch";
import { editorZoom } from "../../files/editor/editorZoom";
import { hasConflictMarkers } from "../model/conflictMarkers";
import { nextConflictedFile } from "../model/conflictSection";
import {
  chooseMergeRegion,
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
  onSave: (text: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  canSave: () => boolean;
  onResolved?: () => void;
  onOpenFile?: (path: string) => void;
  saveRequestRef?: { current: (() => Promise<boolean>) | null };
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
  const propsRef = useRef(props);
  propsRef.current = props;
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const chooseRef = useRef<(id: number, side: MergeChoice) => void>(() => {});
  const busyRef = useRef(false);
  const savedRef = useRef<EditorState | null>(null);
  const theme = useRef(new Compartment());
  const editability = useRef(new Compartment());
  const scheme = useColorScheme();
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;

  useEffect(() => {
    let cancelled = false;
    const prepare = (base: string | null | undefined) => {
      if (!cancelled) setInitial(createMergeResolution(props.value, base));
    };
    if (props.base !== undefined) prepare(props.base);
    else
      void gitConflictStages(cwd, displayPath(path, cwd)).then(
        (stages) => prepare(stages.binary || stages.tooLarge ? null : stages.base),
        () => prepare(null), // Marker sources still allow resolution without a base.
      );
    return () => {
      cancelled = true;
    };
  }, [cwd, path, props.value, props.base]);

  useEffect(() => {
    if (!host.current || !initial) return;
    const language = new Compartment();
    let disposed = false;
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
        editability.current.of([
          EditorState.readOnly.of(!!propsRef.current.disabled),
          mergeActionsDisabled.of(!!propsRef.current.disabled),
        ]),
        mergeResultActions(
          (id, side) => chooseRef.current(id, side),
          (id) => selectMergeRegion(view, id),
        ),
        EditorView.contentAttributes.of({ "aria-label": t("Resolved output") }),
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
          if (next !== before) setState(next);
          if (!update.docChanged && next.regions === before.regions) return;
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
    viewRef.current = view;
    savedRef.current = view.state;
    setState(initial.resolution);
    saveRef.current = async () => {
      if (busyRef.current || propsRef.current.disabled) return false;
      if (
        mergeResolution(view.state).regions.some((region) => region.choice === null) ||
        hasConflictMarkers(view.state.doc.toString())
      ) {
        setError(
          t("Resolve every conflict before saving. Use a source or confirm your edited result."),
        );
        return false;
      }
      if (!propsRef.current.canSave()) {
        setError(t("The file changed on disk. Reopen it before saving your resolution."));
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      const snapshot = view.state;
      try {
        await propsRef.current.onSave(snapshot.doc.toString());
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
        busyRef.current = false;
        if (!disposed) setBusy(false);
      }
    };
    const requestRef = propsRef.current.saveRequestRef;
    if (requestRef) requestRef.current = () => saveRef.current?.() ?? Promise.resolve(false);
    void languageForPath(path).then((extension) => {
      if (!disposed) view.dispatch({ effects: language.reconfigure(extension ?? []) });
    });
    if (propsRef.current.active) view.focus();
    return () => {
      disposed = true;
      viewRef.current = null;
      saveRef.current = null;
      if (requestRef) requestRef.current = null;
      view.destroy();
    };
  }, [initial, path]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: theme.current.reconfigure(schemeExtensions(scheme)) });
  }, [scheme]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editability.current.reconfigure([
        EditorState.readOnly.of(disabled || busy),
        mergeActionsDisabled.of(disabled || busy),
      ]),
    });
  }, [disabled, busy]);
  useEffect(() => {
    if (active) viewRef.current?.requestMeasure();
  }, [active]);

  const pending = state.regions.filter((region) => region.choice === null).length;
  const choose = (id: number, side: MergeChoice) => {
    if (viewRef.current && !busyRef.current && !disabled) {
      setResolved(false);
      chooseMergeRegion(viewRef.current, id, side);
    }
  };
  chooseRef.current = choose;
  const stage = async () => {
    if (!(await saveRef.current?.()) || !viewRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gitStageFile(cwd, displayPath(path, cwd));
      notifyGitChanged(cwd, "index");
      setResolved(true);
      propsRef.current.onResolved?.();
    } catch (error) {
      setError(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const nextFile = async () => {
    try {
      const next = nextConflictedFile(await gitConflicts(cwd), displayPath(path, cwd));
      if (next) propsRef.current.onOpenFile?.(`${cwd.replace(/[\\/]+$/, "")}/${next}`);
      else setError(t("No other conflicted files"));
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <div className="merge-conflict-editor">
      {error ? (
        <p className="conflict-editor-error" role="alert">
          {error}
        </p>
      ) : null}
      {resolved ? (
        <p className="conflict-editor-status" role="status">
          {t("All conflicts resolved")}
        </p>
      ) : null}
      {!initial ? <p role="status">{t("Loading conflict versions")}</p> : null}
      <ConflictLayout
        path={path}
        {...sources}
        dirty={dirty}
        controls={
          state.regions.length
            ? {
                state,
                disabled: disabled || busy,
                choose,
                select: (id) => {
                  if (viewRef.current) selectMergeRegion(viewRef.current, id);
                },
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
              <Search size={14} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              motion="none"
              disabled={!initial || disabled || busy || pending > 0 || resolved}
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
