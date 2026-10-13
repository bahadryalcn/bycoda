import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n";
import {
  Check,
  ChevronDown,
  Copy,
  File,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
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
import { MOD } from "../../../platform/tauri/platform";

/** The note each session last had open, so reopening the panel resumes it. */
const lastNoteBySession = new Map<string, string>();
// An initial blank document belongs to the session, even across quick remounts.
const initialNotes = new Map<string, Promise<Note>>();

function createSessionNote(sessionId: string, project: string) {
  return createNote({
    title: "",
    body: "",
    sourceSessionId: sessionId,
    ...(project ? { sourceCwd: project } : {}),
  });
}

function initialSessionNote(sessionId: string, project: string): Promise<Note> {
  const pending = initialNotes.get(sessionId);
  if (pending) return pending;
  const promise = createSessionNote(sessionId, project).finally(() => {
    if (initialNotes.get(sessionId) === promise) initialNotes.delete(sessionId);
  });
  initialNotes.set(sessionId, promise);
  return promise;
}

// Saves of one note run in order and outlive the editor that started them, so a
// reload never reads the list before a pending edit has been written.
const pendingSaves = new Map<string, Promise<void>>();

function enqueueSave(id: string, run: () => Promise<void>) {
  const previous = pendingSaves.get(id) ?? Promise.resolve();
  const next = previous.then(run, run).finally(() => {
    if (pendingSaves.get(id) === next) pendingSaves.delete(id);
  });
  pendingSaves.set(id, next);
  return next;
}

async function settlePendingSaves() {
  await Promise.allSettled([...pendingSaves.values()]);
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
  const resize = useDragResize({
    direction: "left",
    min: NOTES_PANEL_MIN_WIDTH,
    max: () => notesPanelMaxWidth(window.innerWidth),
    defaultWidth: NOTES_PANEL_DEFAULT_WIDTH,
    initial: loadNotesPanelWidth(),
    onCommit: saveNotesPanelWidth,
  });
  const listLock = useLockOverscroll<HTMLDivElement>();
  const [notes, setNotes] = useState<NoteSummary[]>(() => peekNoteSummaries() ?? []);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => lastNoteBySession.get(sessionId) ?? null,
  );
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [listLimit, setListLimit] = useState(40);
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
  const { note: selectedDetail, error: detailError, retry: retryDetail } = useNoteDetail(selected);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (note: NoteSummary) =>
      !needle || `${note.title} ${note.slug}`.toLocaleLowerCase().includes(needle);
    return {
      session: offered.session.filter(matches),
      project: offered.project.filter(matches),
    };
  }, [offered, query]);
  const visibleSession = filtered.session.slice(0, listLimit);
  const visibleProject = filtered.project.slice(0, Math.max(0, listLimit - visibleSession.length));

  useEffect(() => {
    if (!selected) return;
    if (selected.sourceSessionId === sessionId) lastNoteBySession.set(sessionId, selected.id);
    if (selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId, sessionId]);

  useEffect(() => {
    if (!loaded || selected || error) return;
    let cancelled = false;
    setCreating(true);
    void initialSessionNote(sessionId, project)
      .then((created) => {
        setNotes((current) => [
          summarizeNote(created),
          ...current.filter((item) => item.id !== created.id),
        ]);
        if (cancelled) return;
        setSelectedId(created.id);
        setWantFocus(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        setCreating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, selected, error, sessionId, project]);

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createSessionNote(sessionId, project);
      setNotes((current) => [summarizeNote(created), ...current]);
      setSelectedId(created.id);
      setListOpen(false);
      setWantFocus(true);
      setError(null);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const onSaved = useCallback((saved: Note) => {
    setNotes((current) =>
      current.map((item) => (item.id === saved.id ? summarizeNote(saved) : item)),
    );
  }, []);

  const onDelete = useCallback(async (id: string) => {
    try {
      await deleteNote(id);
      setNotes((current) => current.filter((item) => item.id !== id));
      setError(null);
      return true;
    } catch (err: unknown) {
      setError(errorText(err));
      return false;
    }
  }, []);

  const onLink = useCallback(
    async (id: string) => {
      try {
        await settlePendingSaves();
        const saved = await linkNoteToSession(id, sessionId);
        onSaved(saved);
        lastNoteBySession.set(sessionId, saved.id);
        setError(null);
      } catch (err: unknown) {
        setError(errorText(err));
      }
    },
    [sessionId, onSaved],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (listOpen) setListOpen(false);
    else setNotesPanelOpen(false);
  };

  const shortcut = keybindingShortcutLabel(NOTES_PANEL_COMMAND, `${MOD}N`);
  const closeLabel = shortcut ? `Close notes (${shortcut})` : "Close notes";
  const hasNotes = offered.session.length + offered.project.length > 0;

  return (
    <aside
      ref={resize.setPaneRef}
      role="complementary"
      aria-label={t("Session notes")}
      data-notes-panel
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-stroke text-content"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize notes panel")}
        className={`absolute inset-y-0 -left-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
        <button
          type="button"
          aria-expanded={listOpen}
          aria-label={t("Switch note")}
          title={t("Switch note")}
          onClick={() => {
            setListOpen((open) => !open);
            setQuery("");
            setListLimit(40);
          }}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] hover:bg-content/10"
        >
          <File className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{selected?.title ?? t("Notes")}</span>
          <ChevronDown
            className={`size-3 shrink-0 text-content/45 transition-transform ${
              listOpen ? "rotate-180" : ""
            }`}
            strokeWidth={1.75}
          />
        </button>
        <PanelIconButton
          label={t("New note")}
          disabled={creating || !loaded}
          onClick={() => void onCreate()}
        >
          {creating ? (
            <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Plus className="size-3.5" strokeWidth={1.75} />
          )}
        </PanelIconButton>
        <PanelIconButton label={closeLabel} onClick={() => setNotesPanelOpen(false)}>
          <X className="size-3.5" strokeWidth={1.75} />
        </PanelIconButton>
      </div>
      {listOpen ? (
        <div
          ref={listLock}
          className="max-h-56 shrink-0 overflow-y-auto overscroll-none border-b border-stroke p-1.5"
        >
          <input
            aria-label={t("Search notes")}
            placeholder={t("Search notes")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setListLimit(40);
            }}
            className="mb-1 h-7 w-full rounded border border-stroke bg-transparent px-2 text-[12px] outline-none focus:border-content/40"
          />
          <NoteGroup
            label={t("This session")}
            notes={visibleSession}
            activeId={selected?.id}
            onSelect={(id) => {
              setSelectedId(id);
              setListOpen(false);
              setWantFocus(true);
            }}
          />
          <NoteGroup
            label={t("Project notes")}
            notes={visibleProject}
            activeId={selected?.id}
            onSelect={(id) => {
              setSelectedId(id);
              setListOpen(false);
              setWantFocus(true);
            }}
          />
          {filtered.session.length + filtered.project.length > listLimit ? (
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-content/10"
              onClick={() => setListLimit((limit) => limit + 40)}
            >
              {t("Show more")}
            </button>
          ) : null}
          {hasNotes || error || !loaded ? null : (
            <p className="px-2 py-1.5 text-[12px] text-content/50">{t("No notes yet.")}</p>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 py-2 text-[12px] text-danger/90">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void refresh()}>
            {t("Retry")}
          </button>
        </p>
      ) : null}
      {detailError ? (
        <p role="alert" className="px-3 py-2 text-[12px] text-content">
          {detailError}{" "}
          <button type="button" className="underline" onClick={retryDetail}>
            {t("Retry")}
          </button>
        </p>
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
      ) : error ? null : (
        <div className="grid min-h-0 flex-1 place-items-center">
          <LoaderCircle className="size-4 animate-spin text-content/40" strokeWidth={1.75} />
        </div>
      )}
    </aside>
  );
}

function PanelIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function NoteGroup({
  label,
  notes,
  activeId,
  onSelect,
}: {
  label: string;
  notes: NoteSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  useLocale();
  if (notes.length === 0) return null;
  return (
    <section aria-label={label} className="mb-1 last:mb-0">
      <h3 className="px-2 pb-1 pt-1.5 text-[11px] text-content/45">{label}</h3>
      <ul className="flex flex-col gap-0.5">
        {notes.map((note) => {
          const time = formatRelativeTime(new Date(note.updatedAt).toISOString());
          return (
            <li key={note.id}>
              <button
                type="button"
                title={note.title}
                aria-current={note.id === activeId ? "true" : undefined}
                onClick={() => onSelect(note.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                  note.id === activeId
                    ? "bg-selection text-content"
                    : "text-content/80 hover:bg-content/5 hover:text-content"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{note.title}</span>
                {time ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-content/45">{time}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
  onDelete: (id: string) => Promise<boolean>;
  sessionId: string;
  onLink: (id: string) => Promise<void>;
}) {
  useLocale();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linking, setLinking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const savedRef = useRef(note);
  const titleTouched = useRef(false);
  const finalizeRequested = useRef(false);
  const skipSave = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (!autoFocus) return;
    field.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  const save = useCallback(async () => {
    if (skipSave.current) return;
    const current = savedRef.current;
    const nextBody = bodyRef.current;
    const typed = titleRef.current.trim();
    // An untouched placeholder title follows the first line, as on the Notes screen.
    const nextTitle =
      typed && (typed !== "Untitled" || titleTouched.current) ? typed : noteTitle(nextBody);
    const finalizeSlug =
      !!current.slugPending && finalizeRequested.current && !!typed && typed !== "Untitled";
    if (!finalizeSlug && nextTitle === current.title && nextBody === current.body) return;
    try {
      const saved = await upsertNote({
        id: current.id,
        title: nextTitle,
        body: nextBody,
        tags: current.tags,
        ...(finalizeSlug ? { finalizeSlug: true } : {}),
      });
      savedRef.current = saved;
      if (finalizeSlug) finalizeRequested.current = false;
      setSaveError(null);
      onSavedRef.current(saved);
      if (!titleTouched.current) {
        titleRef.current = saved.title;
        setTitle(saved.title);
      }
    } catch (err: unknown) {
      setSaveError(errorText(err));
    }
  }, []);

  const saveNow = useCallback(
    (finalize = false) => {
      if (finalize) finalizeRequested.current = true;
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return enqueueSave(note.id, save);
    },
    [note.id, save],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, 400);
  }, [saveNow]);

  useEffect(
    () => () => {
      void saveNow(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    },
    [saveNow],
  );

  const copy = () => {
    void navigator.clipboard
      ?.writeText(bodyRef.current)
      .then(() => {
        setCopied(true);
        if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => undefined);
  };

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <InlineEdit
        value={title}
        label={t("Note title")}
        placeholder={t("Untitled")}
        className="bycoda-note-inline-title"
        onSave={async (next) => {
          const previous = titleRef.current;
          titleTouched.current = true;
          titleRef.current = next;
          setTitle(next);
          await saveNow(true);
          if (savedRef.current.title !== (next.trim() || noteTitle(bodyRef.current))) {
            titleRef.current = previous;
            setTitle(previous);
            throw new Error(t("Could not save note"));
          }
        }}
      />
      <textarea
        ref={field}
        value={body}
        onChange={(event) => {
          bodyRef.current = event.target.value;
          setBody(event.target.value);
          scheduleSave();
        }}
        onBlur={() => void saveNow()}
        aria-label={t("Note")}
        placeholder={t("Write markdown…")}
        spellCheck={false}
        className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-3 py-2 font-mono text-[13px] leading-5 text-content outline-none placeholder:text-content/35"
      />
      {saveError ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[12px] text-danger/90"
        >
          <span className="min-w-0 flex-1">
            {t("Could not save: ")}
            {saveError}
          </span>
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              void saveNow();
            }}
            className="shrink-0 underline hover:no-underline"
          >
            {t("Retry")}
          </button>
        </div>
      ) : null}
      <div className="flex h-9 shrink-0 items-center gap-1 border-t border-stroke px-2">
        <PanelIconButton
          label={copied ? t("Copied") : t("Copy note")}
          disabled={!hasBody}
          onClick={copy}
        >
          {copied ? (
            <Check className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.75} />
          )}
        </PanelIconButton>
        <button
          type="button"
          disabled={!hasBody}
          title={t("Add the selection, or the whole note, to the composer")}
          onClick={sendToChat}
          className="h-6 rounded-md px-2 text-[12px] text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40"
        >
          {t("Add to chat")}
        </button>
        {note.sourceSessionId !== sessionId ? (
          <button
            type="button"
            disabled={linking}
            onClick={() => {
              setLinking(true);
              void saveNow()
                .then(() => onLink(note.id))
                .finally(() => setLinking(false));
            }}
            className="h-6 rounded-md px-2 text-[12px] text-content/70 hover:bg-content/10 disabled:opacity-40"
          >
            {t("Link to this session")}
          </button>
        ) : null}
        <span className="min-w-0 flex-1" />
        <PanelIconButton
          label={t("Delete note")}
          disabled={deleting}
          onClick={() => {
            if (skipSave.current) return;
            skipSave.current = true;
            setDeleting(true);
            if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
            void enqueueSave(note.id, async () => {
              const deleted = await onDelete(note.id);
              if (!deleted) {
                skipSave.current = false;
                setDeleting(false);
                scheduleSave();
              }
            });
          }}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </PanelIconButton>
      </div>
    </div>
  );
});
