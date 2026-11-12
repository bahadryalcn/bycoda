import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { NoteBodyField } from "./NoteBodyField";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Sash } from "../../../shared/ui/Sash";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { motionAttributes } from "../../../shared/ui/Motion";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { requestOpenNoteLibrary } from "../noteNavigation";
import "./notes.css";
import { ExpandingButtonGroup } from "../../../shared/ui/ExpandingButtonGroup";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n";
import { ChevronDown, Copy, File, Link, Plus, Trash2, X } from "../../../shared/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { looksLikeProject } from "../../projects/model/recents";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import {
  createNote,
  deleteNote,
  loadNoteSummaries,
  linkNoteToSession,
  NOTES_CHANGED_EVENT,
  noteTitle,
  peekNoteSummaries,
  summarizeNote,
  requestAddNoteToChat,
  upsertNote,
  type Note,
  type NoteSummary,
} from "../notes";
import { useNoteDetail } from "../useNoteDetail";
import { createRecoveredNote } from "../noteImages";
import {
  loadNotesPanelWidth,
  NOTES_PANEL_COMMAND,
  NOTES_PANEL_DEFAULT_WIDTH,
  NOTES_PANEL_MIN_WIDTH,
  notesPanelFocusRequested,
  notesPanelMaxWidth,
  panelNotes,
  pickPanelNote,
  saveNotesPanelWidth,
  setNotesPanelOpen,
  takeNotesPanelFocusRequest,
} from "../notesPanel";
import { keybindingShortcutLabel } from "../../settings/model/settings";
import { ALT, MOD } from "../../../platform/tauri/platform";
import {
  NoteInputOwner,
  beginNoteWork,
  noteInputWorkError,
  type NoteInputWork,
} from "../notesInputOwners";
import {
  useNoteExternal,
  useNoteInputState,
  useNotePreparing,
  useNoteTextInput,
  noteInputBudgetHandlers,
} from "../useNoteInput";
import type { NativeInputPublication } from "../../../shared/lib/native-input-observer";

/** The note each session last had open, so reopening the panel resumes it. */
const lastNoteBySession = new Map<string, string>();

function createSessionNote(sessionId: string, project: string, parent?: NoteInputWork) {
  return createNote(
    {
      title: "",
      body: "",
      sourceSessionId: sessionId,
      ...(project ? { sourceCwd: project } : {}),
    },
    parent,
  );
}

// Saves of one note run in order and outlive the editor that started them, so a
// reload never reads the list before a pending edit has been written.
const pendingSaves = new Map<string, Promise<void>>();
type NoteDraft = {
  title: string;
  body: string;
  base: Note;
  owner?: NoteInputOwner;
  mounts?: number;
  error?: string | null;
  skipSave?: boolean;
  conflict?: boolean;
  unadmittedInputs?: string[];
};
const editorDrafts = new Map<string, NoteDraft>();

function enqueueSave(
  id: string,
  run: (work?: NoteInputWork) => Promise<void>,
  parent?: NoteInputWork,
) {
  const work = beginNoteWork("session-note-queue", parent);
  if (!work) return Promise.reject(noteInputWorkError());
  const previous = pendingSaves.get(id) ?? Promise.resolve();
  const persist = () => work.apply(() => run(work));
  const next = previous.then(persist, persist).finally(() => {
    if (pendingSaves.get(id) === next) pendingSaves.delete(id);
    work();
  });
  pendingSaves.set(id, next);
  return next;
}

async function settlePendingSaves() {
  await Promise.allSettled(pendingSaves.values());
}

type Props = {
  sessionId: string;
  cwd: string;
};

/**
 * Right-docked notes for the focused session. It reads and writes the same
 * notes as the Notes screen: this session's notes first, then the project's.
 */
export function SessionNotesPanel({ sessionId, cwd }: Props) {
  return <SessionNotesContent key={sessionId} sessionId={sessionId} cwd={cwd} />;
}

function SessionNotesContent({ sessionId, cwd }: Props) {
  useLocale();
  const project = looksLikeProject(cwd) ? cwd : "";
  const {
    width: panelWidth,
    setPaneRef,
    sashProps,
  } = useDragResize({
    direction: "left",
    min: NOTES_PANEL_MIN_WIDTH,
    max: () => notesPanelMaxWidth(window.innerWidth),
    defaultWidth: NOTES_PANEL_DEFAULT_WIDTH,
    initial: loadNotesPanelWidth(),
    onCommit: saveNotesPanelWidth,
  });
  const [notes, setNotes] = useState<NoteSummary[]>(() => peekNoteSummaries() ?? []);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => lastNoteBySession.get(sessionId) ?? null,
  );
  const [listOpen, setListOpen] = useState(false);
  const listButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useRetainedState(`session-notes:${sessionId}:query`, "");
  const [creating, setCreating] = useState(false);
  const [wantFocus, setWantFocus] = useState(notesPanelFocusRequested);
  const focused = useCallback(() => {
    takeNotesPanelFocusRequest();
    setWantFocus(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await settlePendingSaves();
      setNotes(await loadNoteSummaries(peekNoteSummaries() === null));
      setError(null);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => {
      void settlePendingSaves()
        .then(() => loadNoteSummaries(true))
        .then(setNotes)
        .catch((err: unknown) => setError(errorText(err)));
    };
    window.addEventListener(NOTES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(NOTES_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const offered = useMemo(() => panelNotes(notes, sessionId, project), [notes, sessionId, project]);
  const selected = pickPanelNote(offered, selectedId);
  const {
    note: selectedDetail,
    error: detailError,
    retry: retryDetail,
    retrying: detailRetrying,
  } = useNoteDetail(selected);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (note: NoteSummary) =>
      !needle || `${note.title} ${note.slug}`.toLocaleLowerCase().includes(needle);
    return {
      session: offered.session.filter(matches),
      project: offered.project.filter(matches),
    };
  }, [offered, query]);
  const pickerRows = useMemo(
    () => [
      ...(filtered.session.length ? [{ kind: "heading" as const, id: "session" }] : []),
      ...filtered.session.map((note) => ({ kind: "note" as const, group: "session", note })),
      ...(filtered.project.length ? [{ kind: "heading" as const, id: "project" }] : []),
      ...filtered.project.map((note) => ({ kind: "note" as const, group: "project", note })),
    ],
    [filtered],
  );

  useEffect(() => {
    if (!selected) return;
    lastNoteBySession.set(sessionId, selected.id);
    if (selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId, sessionId]);

  const onCreate = async () => {
    if (creating) return;
    const work = beginNoteWork("session-note-create");
    if (!work) {
      setError(noteInputWorkError().message);
      return;
    }
    setCreating(true);
    try {
      const created = await createSessionNote(sessionId, project, work);
      setNotes((current) => [summarizeNote(created), ...current]);
      setSelectedId(created.id);
      setListOpen(false);
      setWantFocus(true);
      setError(null);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setCreating(false);
      work();
    }
  };

  const onSaved = useCallback((saved: Note) => {
    setNotes((current) =>
      current.map((item) => (item.id === saved.id ? summarizeNote(saved) : item)),
    );
  }, []);

  const onDelete = useCallback(
    async (id: string, expectedUpdatedAt?: number, parent?: NoteInputWork) => {
      try {
        await deleteNote(id, expectedUpdatedAt, parent);
        setNotes((current) => current.filter((item) => item.id !== id));
        setError(null);
        return true;
      } catch (err: unknown) {
        setError(errorText(err));
        return false;
      }
    },
    [],
  );

  const onLink = useCallback(
    async (id: string, parent?: NoteInputWork) => {
      try {
        await settlePendingSaves();
        const saved = await linkNoteToSession(id, sessionId, parent);
        onSaved(saved);
        lastNoteBySession.set(sessionId, saved.id);
        setError(null);
      } catch (err: unknown) {
        setError(errorText(err));
        return false;
      }
      return true;
    },
    [sessionId, onSaved],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "Escape" ||
      event.nativeEvent.isComposing ||
      event.defaultPrevented ||
      hasActiveOverlay()
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (listOpen) setListOpen(false);
    else setNotesPanelOpen(false);
  };

  const shortcut = keybindingShortcutLabel(NOTES_PANEL_COMMAND, `${MOD}${ALT}N`);
  const hasNotes = offered.session.length + offered.project.length > 0;

  return (
    <Text
      as="aside"
      size="inherit"
      tone="primary"
      ref={setPaneRef}
      role="complementary"
      aria-label={t("Session notes")}
      data-notes-panel
      onKeyDown={onKeyDown}
      {...surfaceAttributes(
        { frame: "pane", edge: "left", variant: "transparent" },
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col",
      )}
    >
      <Sash
        {...sashProps}
        label={t("Resize notes panel")}
        appearance="hidden"
        className="absolute inset-y-0 -left-px"
      />
      <div data-notes-header className="flex h-9 shrink-0 items-center gap-1 px-2">
        <Button
          ref={listButton}
          variant="ghost"
          motion="none"
          aria-expanded={listOpen}
          aria-label={t("Switch note")}
          aria-haspopup="dialog"
          tooltip={selected?.title ?? t("Switch note")}
          tooltipWhen={selected ? "overflow" : "always"}
          onClick={(event) => {
            event.currentTarget.focus();
            setListOpen((open) => !open);
          }}
          className="min-w-0 flex-1"
        >
          <File className="icon-sm shrink-0" tone="secondary" strokeWidth={1.75} />
          <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
            {selected?.title ?? t("Notes")}
          </Text>
          <ChevronDown
            {...motionAttributes(
              { transition: "transform", duration: "standard" },
              `icon-xs shrink-0 ${listOpen ? "rotate-180" : ""}`,
            )}
            tone="secondary"
            strokeWidth={1.75}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("New note")}
          motion="none"
          loading={creating}
          disabled={!loaded}
          onClick={() => void onCreate()}
        >
          <Plus className="icon-sm" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Close notes")}
          shortcut={shortcut}
          motion="none"
          onClick={() => setNotesPanelOpen(false)}
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </Button>
      </div>
      {listOpen ? (
        <Popover
          anchor={listButton}
          width={Math.max(NOTES_PANEL_MIN_WIDTH, panelWidth)}
          maxHeight={420}
          kind="dialog"
          aria-label={t("Switch note")}
          onDismiss={() => setListOpen(false)}
          className="session-note-picker"
        >
          <SearchInput
            appearance="field"
            aria-label={t("Search notes")}
            placeholder={t("Search notes")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            containerClassName="mb-1 w-full"
          />
          {pickerRows.length ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ContinuousList
                fill
                className="session-note-picker-list"
                gutter="stable"
                label={t("Switch note")}
                items={pickerRows}
                stateKey={`session-notes:${sessionId}:${project}`}
                itemKey={(row) =>
                  row.kind === "heading" ? `heading:${row.id}` : `note:${row.group}:${row.note.id}`
                }
                requiredKey={
                  selected
                    ? `note:${offered.session.some((note) => note.id === selected.id) ? "session" : "project"}:${selected.id}`
                    : null
                }
                estimateSize={38}
                renderItem={(row) => {
                  if (row.kind === "heading")
                    return (
                      <div role="listitem">
                        <SectionLabel className="px-2">
                          {row.id === "session" ? t("This session") : t("Project notes")}
                        </SectionLabel>
                      </div>
                    );
                  const time = formatRelativeTime(new Date(row.note.updatedAt).toISOString());
                  return (
                    <div role="listitem">
                      <Button
                        variant="item"
                        size="sm"
                        type="button"
                        tooltip={row.note.title}
                        tooltipWhen="overflow"
                        aria-current={row.note.id === selected?.id ? "true" : undefined}
                        onClick={() => {
                          setSelectedId(row.note.id);
                          setListOpen(false);
                          setWantFocus(true);
                        }}
                        motion="none"
                        selected={row.note.id === selected?.id}
                        className="flex w-full items-center gap-2"
                      >
                        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                          {row.note.title}
                        </Text>
                        {time ? (
                          <Text size="micro" tone="secondary" className="shrink-0 tabular-nums">
                            {time}
                          </Text>
                        ) : null}
                      </Button>
                    </div>
                  );
                }}
              />
            </div>
          ) : null}
          {filtered.session.length + filtered.project.length === 0 && loaded && !error ? (
            <EmptyState
              size="inline"
              kind={query.trim() ? "filtered" : "empty"}
              description={query.trim() ? t("No matching notes") : t("No notes yet.")}
            />
          ) : null}
          <Button
            variant="ghost"
            fullWidth
            onClick={() => requestOpenNoteLibrary({ cwd: project })}
          >
            {t("Open note library")}
          </Button>
        </Popover>
      ) : null}
      {error ? (
        <Alert tone="danger">
          {error}{" "}
          <Button variant="ghost" size="sm" type="button" onClick={() => void refresh()}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      {detailError ? (
        <Alert tone="danger">
          {detailError}{" "}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={detailRetrying}
            onClick={retryDetail}
          >
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      {selectedDetail ? (
        <PanelNoteEditor
          key={selectedDetail.id}
          note={selectedDetail}
          autoFocus={wantFocus}
          onFocused={focused}
          onSaved={onSaved}
          onDelete={onDelete}
          sessionId={sessionId}
          onLink={onLink}
        />
      ) : error ? null : loaded && !selected ? (
        <EmptyState
          icon={<File />}
          description={t("No notes for this session yet.")}
          className="min-h-0 flex-1"
          action={
            <>
              <Button variant="primary" loading={creating} onClick={() => void onCreate()}>
                {t("New note")}
              </Button>
              {hasNotes ? (
                <Button variant="ghost" onClick={() => setListOpen(true)}>
                  {t("Browse project notes")}
                </Button>
              ) : null}
            </>
          }
        />
      ) : (
        <LoadingText layout="fill" className="min-h-0 flex-1">
          {t("Loading notes…")}
        </LoadingText>
      )}
      <div
        {...surfaceAttributes(
          { frame: "stroke", edge: "block-start" },
          "session-notes-library-link",
        )}
      >
        <Button
          variant="ghost"
          fullWidth
          onClick={() =>
            requestOpenNoteLibrary({ id: selected?.id, cwd: selected?.sourceCwd ?? project })
          }
        >
          {t("Open note library")}
        </Button>
      </div>
    </Text>
  );
}

const PanelNoteEditor = memo(function PanelNoteEditor({
  note,
  autoFocus,
  onFocused,
  onSaved,
  onDelete,
  sessionId,
  onLink,
}: {
  note: Note;
  autoFocus: boolean;
  onFocused: () => void;
  onSaved: (note: Note) => void;
  onDelete: (id: string, expectedUpdatedAt?: number, parent?: NoteInputWork) => Promise<boolean>;
  sessionId: string;
  onLink: (id: string, parent?: NoteInputWork) => Promise<boolean>;
}) {
  useLocale();
  const draftKey = `${sessionId}:${note.id}`;
  const [restored] = useState(() => {
    const draft = editorDrafts.get(draftKey) ?? { title: note.title, body: note.body, base: note };
    editorDrafts.set(draftKey, draft);
    return draft;
  });
  if (restored.owner?.isRetiring()) restored.owner = undefined;
  const inputOwner = (restored.owner ??= new NoteInputOwner(() => ({
    surface: restored.mounts ? "session-dock" : "retained-draft",
    sourceSurface: "session-dock",
    noteId: note.id,
    sessionRelation: sessionId,
    base: restored.base,
    canonical: { ...restored.base, title: restored.title, body: restored.body },
    error: restored.error,
    skipSave: restored.skipSave,
    conflict: restored.conflict,
    unadmittedInputs: restored.unadmittedInputs,
  })));
  const preparing = useNotePreparing(inputOwner);
  useNoteExternal(inputOwner, note);
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [titleState, setTitleState] = useState<{
    value: string;
    publication?: NativeInputPublication;
  }>(() => ({ value: restored?.title ?? note.title }));
  const title = titleState.value;
  const setTitle = (value: string, parent?: NoteInputWork) =>
    setTitleState({ value, publication: inputOwner.publishControl("title", value, parent) });
  const [body, setBody] = useState(restored?.body ?? note.body);
  const { copyAsync } = useCopyFeedback({ resetKeys: [note.id, body] });
  const [saveError, setSaveErrorState] = useState<string | null>(restored.error ?? null);
  const setSaveError = (error: string | null) => {
    restored.error = error;
    setSaveErrorState(error);
    inputOwner.changed();
  };
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [linking, setLinking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useNoteTextInput(inputOwner, "body", field);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const savedRef = useRef(restored?.base ?? note);
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const retainDraft = useCallback(() => {
    if (!live.current && restored.mounts) {
      inputOwner.changed();
      return;
    }
    Object.assign(restored, {
      title: titleRef.current,
      body: bodyRef.current,
      base: savedRef.current,
    });
    editorDrafts.set(draftKey, restored);
    inputOwner.changed();
  }, [draftKey, restored, inputOwner]);
  useLayoutEffect(() => {
    const previous = savedRef.current;
    if (note.updatedAt < previous.updatedAt) return;
    if (note.title === previous.title && note.body === previous.body) {
      savedRef.current = note;
      retainDraft();
      return;
    }
    const dirty = bodyRef.current !== previous.body || titleRef.current !== previous.title;
    if (dirty) {
      conflictRef.current = true;
      setConflict(true);
      retainDraft();
      return;
    }
    savedRef.current = note;
    titleRef.current = note.title;
    bodyRef.current = note.body;
    setTitle(note.title);
    setBody(note.body);
    retainDraft();
  }, [note, retainDraft]);
  const titleTouched = useRef(false);
  const finalizeRequested = useRef(false);
  const skipSave = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveTimerWork = useRef<NoteInputWork | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (!autoFocus) return;
    field.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  useNoteInputState(inputOwner, "session-state", {
    saving,
    recovering,
    linking,
    deleting,
    conflict,
    saveError,
    skipSave: skipSave.current,
    titleTouched: titleTouched.current,
    finalizeRequested: finalizeRequested.current,
  });
  const save = useCallback(
    async (parent?: NoteInputWork) => {
      if (skipSave.current || conflictRef.current || restored.unadmittedInputs?.length) return;
      const current = restored.base;
      const nextBody = restored.body;
      const typed = restored.title.trim();
      // An untouched placeholder title follows the first line, as on the Notes screen.
      const nextTitle =
        typed && (typed !== "Untitled" || titleTouched.current) ? typed : noteTitle(nextBody);
      const finalizeSlug =
        !!current.slugPending && finalizeRequested.current && !!typed && typed !== "Untitled";
      if (!finalizeSlug && nextTitle === current.title && nextBody === current.body) return;
      setSaving(true);
      try {
        const saved = await upsertNote(
          {
            id: current.id,
            expectedUpdatedAt: current.updatedAt,
            title: nextTitle,
            body: nextBody,
            tags: current.tags,
            ...(finalizeSlug ? { finalizeSlug: true } : {}),
          },
          parent,
        );
        const publish = () => {
          // A metadata refresh may overtake an in-flight response.
          if (
            savedRef.current.updatedAt > saved.updatedAt ||
            restored.base.updatedAt > saved.updatedAt
          ) {
            retainDraft();
            return;
          }
          savedRef.current = saved;
          restored.base = saved;
          const retained = editorDrafts.get(draftKey);
          if (retained?.body === nextBody && retained.title.trim() === typed) {
            if (!restored.mounts && !inputOwner.hasUnappliedPrivateInputs())
              editorDrafts.delete(draftKey);
            else
              Object.assign(restored, {
                base: saved,
                title: titleRef.current,
                body: bodyRef.current,
              });
          } else if (
            retained &&
            retained.base.body === current.body &&
            retained.base.title === current.title
          ) {
            retained.base = saved;
            editorDrafts.set(draftKey, retained);
          }
          if (finalizeSlug) finalizeRequested.current = false;
          setSaveError(null);
          if (live.current) onSavedRef.current(saved);
          if (!titleTouched.current && live.current) {
            titleRef.current = saved.title;
            setTitle(saved.title, parent);
          }
        };
        if (parent) parent.apply(publish);
        else publish();
      } catch (err: unknown) {
        const failed = () => {
          retainDraft();
          setSaveError(errorText(err));
        };
        if (parent) parent.apply(failed);
        else failed();
      } finally {
        setSaving(false);
      }
    },
    [draftKey, retainDraft],
  );

  const saveNow = useCallback(
    (finalize = false, parent?: NoteInputWork) => {
      const delayed = saveTimerWork.current;
      if (restored.unadmittedInputs?.length) {
        if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        saveTimerWork.current = null;
        delayed?.();
        return Promise.resolve();
      }
      const work = inputOwner.operation("session-save-request", parent ?? delayed ?? undefined);
      if (!work) {
        if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
        return Promise.resolve();
      }
      if (finalize) finalizeRequested.current = true;
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      saveTimerWork.current = null;
      return enqueueSave(note.id, save, work)
        .catch((error) => setSaveError(String(error)))
        .finally(() => {
          delayed?.();
          work();
        });
    },
    [note.id, save, inputOwner],
  );

  const scheduleSave = useCallback(() => {
    const work = inputOwner.operation("session-autosave-delay");
    if (!work) {
      if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
      return;
    }
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimerWork.current?.();
    saveTimerWork.current = work;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow(false, work);
    }, 400);
  }, [saveNow, inputOwner]);

  useEffect(() => {
    restored.mounts = (restored.mounts ?? 0) + 1;
    return () => {
      restored.mounts = Math.max(0, (restored.mounts ?? 1) - 1);
      inputOwner.external(() => {});
      if (inputOwner.closed() && !saveTimerWork.current) return;
      void saveNow(true).finally(() => {
        if (
          !restored.mounts &&
          !inputOwner.hasUnappliedPrivateInputs() &&
          (!editorDrafts.has(draftKey) ||
            (restored.title === restored.base.title && restored.body === restored.base.body))
        ) {
          editorDrafts.delete(draftKey);
          inputOwner.retire();
        }
      });
    };
  }, [saveNow, restored, inputOwner, draftKey]);

  const copy = () =>
    copyAsync(() => navigator.clipboard.writeText(bodyRef.current), { parallel: true });

  const sendToChat = () => {
    const el = field.current;
    const selection =
      el && el.selectionStart !== el.selectionEnd
        ? bodyRef.current.slice(el.selectionStart, el.selectionEnd)
        : "";
    if (selection) requestAddToChat(selection, "plain");
    else
      requestAddNoteToChat({
        ...note,
        title: titleRef.current,
        body: bodyRef.current,
      });
  };

  const hasBody = Boolean(body.trim());

  return (
    <SurfaceSelection
      {...noteInputBudgetHandlers(inputOwner, (field) =>
        field.getAttribute("aria-label") === t("Note title")
          ? "title"
          : field.getAttribute("aria-label") === t("Note")
            ? "body"
            : undefined,
      )}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      allowNotes={false}
      sessionId={sessionId}
      contentVersion={body}
    >
      <InlineEdit
        inputObserver={inputOwner.observer("title")}
        inputPublication={titleState.publication}
        value={title}
        label={t("Note title")}
        placeholder={t("Untitled")}
        className="bycoda-note-inline-title"
        onSave={async (next) => {
          const work = inputOwner.operation("session-title-submit");
          if (!work) throw noteInputWorkError(inputOwner);
          try {
            const previous = titleRef.current;
            titleTouched.current = true;
            titleRef.current = next;
            setTitle(next, work);
            retainDraft();
            await saveNow(true, work);
            if (savedRef.current.title !== (next.trim() || noteTitle(bodyRef.current))) {
              titleRef.current = previous;
              setTitle(previous, work);
              throw new Error(t("Could not save note"));
            }
          } finally {
            work();
          }
        }}
      />
      <NoteBodyField
        label={t("Note")}
        ref={field}
        value={body}
        onChange={(event) => {
          const value = event.target.value;
          if (!inputOwner.allowed() || !inputOwner.canRetainText("body", value)) {
            inputOwner.external(() => {
              restored.unadmittedInputs = [
                ...new Set([...(restored.unadmittedInputs ?? []), "body"]),
              ];
              bodyRef.current = value;
              setBody(value);
              retainDraft();
              setSaveError(
                t("This input was not admitted. Your text is retained; open the note to edit it."),
              );
            });
            return;
          }
          restored.unadmittedInputs = restored.unadmittedInputs?.filter((key) => key !== "body");
          bodyRef.current = value;
          setBody(value);
          retainDraft();
          scheduleSave();
        }}
        onBlur={() => void saveNow()}
        readOnly={preparing}
        placeholder={t("Write markdown…")}
        spellCheck={false}
      />
      {conflict ? (
        <Alert tone="warning">
          <span>{t("This note changed elsewhere. Your draft is preserved.")}</span>
          <Button
            variant="ghost"
            onClick={() => {
              if (!inputOwner.allowed()) return;
              savedRef.current = note;
              conflictRef.current = false;
              setConflict(false);
              retainDraft();
              void saveNow();
            }}
          >
            {t("Keep my draft")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (!inputOwner.allowed()) return;
              savedRef.current = note;
              titleRef.current = note.title;
              bodyRef.current = note.body;
              setTitle(note.title);
              setBody(note.body);
              retainDraft();
              editorDrafts.delete(draftKey);
              conflictRef.current = false;
              setConflict(false);
            }}
          >
            {t("Use saved version")}
          </Button>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert tone="danger">
          <span className="min-w-0 flex-1">
            {t("Could not save: ")}
            {saveError}
          </span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              if (!inputOwner.allowed()) return;
              setSaveError(null);
              void saveNow();
            }}
          >
            {t("Retry")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={recovering}
            onClick={async () => {
              const work = inputOwner.operation("session-recovery-copy");
              if (!work) {
                if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
                return;
              }
              const submittedTitle = titleRef.current;
              const submittedBody = bodyRef.current;
              setRecovering(true);
              try {
                await createRecoveredNote(
                  {
                    title: submittedTitle,
                    body: submittedBody,
                    tags: savedRef.current.tags,
                    sourceCwd: savedRef.current.sourceCwd,
                    sourceSessionId: sessionId,
                  },
                  work,
                );
                if (titleRef.current === submittedTitle && bodyRef.current === submittedBody) {
                  skipSave.current = true;
                  restored.skipSave = true;
                  editorDrafts.delete(draftKey);
                } else retainDraft();
                setSaveError(null);
                window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
              } catch (error) {
                setSaveError(errorText(error));
              } finally {
                setRecovering(false);
                work();
              }
            }}
          >
            {t("Save as new note")}
          </Button>
        </Alert>
      ) : null}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 px-2 py-1">
        {preparing ? (
          <span role="status">{t("Preparing checkpoint…")}</span>
        ) : (
          <NoteSaveStatus
            className="session-note-status"
            state={
              deleting
                ? "deleting"
                : saveError
                  ? "failed"
                  : conflict
                    ? "conflict"
                    : recovering
                      ? "recovering"
                      : saving
                        ? "saving"
                        : body !== note.body || title !== note.title
                          ? "unsaved"
                          : "saved"
            }
          />
        )}
        <ExpandingButtonGroup
          label={t("Note actions")}
          size="sm"
          defaultExpanded="chat"
          confirmDuration={1200}
          items={[
            {
              id: "copy",
              label: t("Copy note"),
              icon: <Copy />,
              disabled: !hasBody,
              onSelect: copy,
              doneLabel: t("Copied"),
            },
            {
              id: "chat",
              label: t("Add to chat"),
              icon: <Plus />,
              disabled: !hasBody,
              onSelect: sendToChat,
            },
            ...(note.sourceSessionId !== sessionId
              ? [
                  {
                    id: "link",
                    label: t("Link to this session"),
                    icon: <Link />,
                    disabled: linking,
                    onSelect: async () => {
                      const work = inputOwner.operation("session-link");
                      if (!work) return false;
                      setLinking(true);
                      try {
                        await saveNow(false, work);
                        return await onLink(note.id, work);
                      } finally {
                        setLinking(false);
                        work();
                      }
                    },
                  },
                ]
              : []),
          ]}
        />
        <span className="min-w-0 flex-1" />
        <ConfirmMorph
          label={t("Delete note")}
          icon={<Trash2 className="icon-sm" />}
          prompt={t("Delete note permanently?")}
          confirmTimeout={0}
          disabled={deleting}
          onConfirm={async () => {
            if (skipSave.current) return;
            const work = inputOwner.operation("session-delete");
            if (!work) return;
            skipSave.current = true;
            setDeleting(true);
            if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
            saveTimerWork.current?.();
            saveTimerWork.current = null;
            try {
              await enqueueSave(
                note.id,
                async (queued) => {
                  const deleted = await onDelete(note.id, savedRef.current.updatedAt, queued);
                  if (deleted) editorDrafts.delete(draftKey);
                  if (!deleted) {
                    skipSave.current = false;
                    setDeleting(false);
                    scheduleSave();
                    throw new Error(t("Could not delete note"));
                  }
                },
                work,
              );
            } finally {
              work();
            }
          }}
        />
      </div>
    </SurfaceSelection>
  );
});
