import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { TagInput } from "../../../shared/ui/TagInput";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bridgeQueryEvents } from "../../../shared/lib/queryClient";
import { projectDisplayName } from "../../projects/model/projectNames";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import { t, useLocale } from "../../../shared/i18n";
import {
  LoaderCircle,
  Plus,
  Search,
  File,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
  MessageSquarePlus,
  Check,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { TextField } from "../../../shared/ui/TextField";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  createNote,
  noteTitleError,
  deleteNote,
  loadNoteSummaries,
  MAX_NOTE_TAGS,
  NOTES_CHANGED_EVENT,
  normalizeNoteTags,
  noteSourceProject,
  noteTitle,
  peekNoteSummaries,
  summarizeNote,
  searchNotes,
  upsertNote,
  requestAddNoteToChat,
  type Note,
  type NoteSummary,
} from "../notes";
import {
  createRecoveredNote,
  insertNoteImagesMarkdown,
  saveNoteImagesFromFiles,
  saveNoteImagesFromPaths,
  type NoteImageAsset,
} from "../noteImages";
import { projectKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { pickImageFiles } from "../../../platform/tauri/fs";
import { filesFromClipboard } from "../../sessions/model/attachments";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { openReplacePanel } from "../../files/editor/editorSearch";
import { NoteMarkdownEditor, NoteMarkdownToolbar } from "./NoteMarkdownEditor";
import { NoteEditablePreview } from "./NoteEditablePreview";
import { NoteEditorPane } from "./NoteEditorPane";
import {
  filterNoteLibrary,
  groupNoteLibrary,
  loadNoteLibraryPreferences,
  noteLibraryProjects,
  noteProjectKey,
  saveNoteLibraryPreferences,
  type NoteGrouping,
  type NoteSort,
} from "../noteLibrary";
import { useNoteDetail } from "../useNoteDetail";
import { OPEN_NOTE_LIBRARY_EVENT, takeNoteLibraryTarget } from "../noteNavigation";
import { noteLibraryItemIndex, windowNoteLibrary } from "../noteLibraryWindow";
import { LIST_PAGE_SIZE } from "../../../shared/lib/listWindow";
import "./notes.css";
import {
  drafts,
  DRAFT_CHANGED_EVENT,
  notifyDrafts,
  mountNotesView,
  pruneDraft,
  noteSaveQueues,
  enqueueNoteSave,
  type Draft,
  type Edits,
} from "../noteDrafts";

const MIN_WIDTH = 240;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;

let rememberedWidth = DEFAULT_WIDTH;
let rememberedNoteId: string | null = null;
let rememberedLibraryStart = 0;
let rememberedLibraryScroll = 0;

type NoteViewMode = "preview" | "source" | "split";

type Props = {
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  recents: RecentProject[];
  onClose: () => void;
  onToggleSidebar?: () => void;
};

export function NotesView({
  besideRail = false,
  compactRail = false,
  cwd,
  recents,
  onClose,
  onToggleSidebar,
}: Props) {
  useLocale();
  useEffect(mountNotesView, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const listLock = useLockOverscroll<HTMLDivElement>();
  const listScroller = useRef<HTMLDivElement | null>(null);
  const setListScroller = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element && listScroller.current)
        rememberedLibraryScroll = listScroller.current.scrollTop;
      listScroller.current = element;
      listLock(element);
    },
    [listLock],
  );
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });
  const queryClient = useQueryClient();
  const queryVisible = useQueryVisible();
  const notesQuery = useQuery({
    queryKey: ["notes", "summaries"],
    enabled: queryVisible,
    queryFn: () => loadNoteSummaries(true),
    initialData: () => peekNoteSummaries() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
  });
  const notes = notesQuery.data ?? [];
  const loading = notesQuery.isPending;
  const setNotes = useCallback(
    (update: NoteSummary[] | ((current: NoteSummary[]) => NoteSummary[])) => {
      queryClient.setQueryData<NoteSummary[]>(["notes", "summaries"], (current) =>
        typeof update === "function" ? update(current ?? []) : update,
      );
    },
    [queryClient],
  );
  const [error, setError] = useState<string | null>(null);
  const [, updateDrafts] = useState(0);
  useEffect(() => {
    const update = () => {
      updateDrafts((value) => value + 1);
      setNotes((current) =>
        current.map((note) => {
          const saved = drafts.get(note.id)?.saved;
          return saved && saved.updatedAt > note.updatedAt ? summarizeNote(saved) : note;
        }),
      );
    };
    window.addEventListener(DRAFT_CHANGED_EVENT, update);
    return () => window.removeEventListener(DRAFT_CHANGED_EVENT, update);
  }, []);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [bodyMatches, setBodyMatches] = useState<{ query: string; ids: Set<string> } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  useEffect(() => {
    const needle = deferredQuery.trim();
    if (!needle) {
      setSearchError(null);
      return;
    }
    let active = true;
    // Coalesce typing before asking the native body index. Stale query results
    // never join a newer set of metadata filters.
    const timer = window.setTimeout(() => {
      void searchNotes(needle).then(
        (ids) => {
          if (active) {
            setBodyMatches({ query: needle, ids: new Set(ids) });
            setSearchError(null);
          }
        },
        (cause: unknown) => {
          if (active) setSearchError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [deferredQuery, notes]);
  const [libraryPreferences, setLibraryPreferences] = useState(loadNoteLibraryPreferences);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set<string>());
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const pendingListFocus = useRef<{ id: string; group: string } | null>(null);
  const projects = useMemo(() => noteLibraryProjects(notes), [notes]);
  const allTags = useMemo(() => [...new Set(notes.flatMap((note) => note.tags))].sort(), [notes]);
  useEffect(() => saveNoteLibraryPreferences(libraryPreferences), [libraryPreferences]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const cached = peekNoteSummaries();
    return (
      cached?.find((note) => note.id === rememberedNoteId)?.id ??
      cached?.[0]?.id ??
      rememberedNoteId
    );
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [mobileListVisible, setMobileListVisible] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [selectionNotes, setSelectionNotes] = useState(notesQuery.data);
  const [deleteTargets, setDeleteTargets] = useState<NoteSummary[] | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulkBusy = useRef(false);
  const selectionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const reveal = () => {
      const target = takeNoteLibraryTarget();
      if (!target) return;
      setQuery("");
      setTagFilter(null);
      setProjectFilter(target.cwd ? projectKey(target.cwd) : null);
      setCollapsedGroups(new Set());
      if (target.id) setSelectedId(target.id);
      setMobileListVisible(!target.id);
    };
    reveal();
    window.addEventListener(OPEN_NOTE_LIBRARY_EVENT, reveal);
    return () => window.removeEventListener(OPEN_NOTE_LIBRARY_EVENT, reveal);
  }, []);
  if (selectionNotes !== notesQuery.data) {
    setSelectionNotes(notesQuery.data);
    const available = new Set(notes.map((note) => note.id));
    setCheckedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }
  const [creating, setCreating] = useState(false);
  const logos = useTabGroupLogos();
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const refresh = useCallback(async () => {
    const result = await notesQuery.refetch();
    setError(result.error ? result.error.message : null);
  }, [notesQuery.refetch]);
  useEffect(() => {
    if (notesQuery.error) setError(notesQuery.error.message);
  }, [notesQuery.error]);
  useEffect(() => {
    if (loading) return;
    setSelectedId((current) => {
      const preferred = current ?? rememberedNoteId;
      const recovery = preferred ? drafts.get(preferred) : null;
      if (
        preferred &&
        (notes.some((note) => note.id === preferred) ||
          (recovery &&
            (recovery.error ||
              recovery.project.current ||
              Object.keys(recovery.edits.current).length)))
      )
        return preferred;
      return notes[0]?.id ?? null;
    });
  }, [notes, loading]);
  useEffect(
    () =>
      bridgeQueryEvents(
        queryClient,
        (receive) => {
          window.addEventListener(NOTES_CHANGED_EVENT, receive);
          return () => window.removeEventListener(NOTES_CHANGED_EVENT, receive);
        },
        () => ({ queryKey: ["notes", "summaries"] }),
      ),
    [queryClient],
  );

  useEffect(() => {
    rememberedNoteId = selectedId;
  }, [selectedId]);

  const [libraryStart, setLibraryStart] = useState(rememberedLibraryStart);
  useEffect(() => {
    rememberedLibraryStart = libraryStart;
  }, [libraryStart]);
  useEffect(() => {
    if (listScroller.current) listScroller.current.scrollTop = rememberedLibraryScroll;
  }, []);

  useEffect(() => {
    listScroller.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, loading, libraryStart]);
  useEffect(() => {
    const requested = pendingListFocus.current;
    if (!requested) return;
    const button = [
      ...(listScroller.current?.querySelectorAll<HTMLButtonElement>("[data-note-id]") ?? []),
    ].find(
      (node) => node.dataset.noteId === requested.id && node.dataset.noteGroup === requested.group,
    );
    if (button) {
      button.focus();
      pendingListFocus.current = null;
    }
  }, [selectedId, selectedGroup, libraryStart]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor's find panel closes on Escape before Notes does.
      if (event.key !== "Escape" || event.defaultPrevented || hasActiveOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      if (bulkBusy.current) return;
      if (selectionMode) {
        setSelectionMode(false);
        setCheckedIds(new Set());
        selectionButton.current?.focus();
      } else onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

  const visible = useMemo(
    () =>
      filterNoteLibrary(notes, {
        query: deferredQuery,
        project: projectFilter,
        tag: tagFilter,
        sort: libraryPreferences.sort,
        bodyMatches: bodyMatches?.query === deferredQuery.trim() ? bodyMatches.ids : undefined,
      }),
    [notes, deferredQuery, projectFilter, tagFilter, libraryPreferences.sort, bodyMatches],
  );
  const groups = useMemo(
    () => groupNoteLibrary(visible, libraryPreferences.grouping),
    [visible, libraryPreferences.grouping],
  );
  const headings = libraryPreferences.grouping !== "none";
  const selectedIndex = noteLibraryItemIndex(
    groups,
    collapsedGroups,
    selectedId,
    headings,
    selectedGroup,
  );
  const navigable = useMemo(
    () =>
      groups.flatMap((group) =>
        collapsedGroups.has(group.key)
          ? []
          : group.notes.map((note) => ({ note, group: group.key })),
      ),
    [groups, collapsedGroups],
  );
  const navigateNote = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: string,
    group: string,
  ) => {
    const index = navigable.findIndex((item) => item.note.id === id && item.group === group);
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? navigable.length - 1
              : -1;
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    event.preventDefault();
    const target = navigable[next];
    if (!target) return;
    pendingListFocus.current = { id: target.note.id, group: target.group };
    setSelectedGroup(target.group);
    setSelectedId(target.note.id);
  };
  useEffect(() => {
    setLibraryStart(
      selectedIndex >= 0 ? Math.floor(selectedIndex / LIST_PAGE_SIZE) * LIST_PAGE_SIZE : 0,
    );
  }, [selectedId, selectedIndex, deferredQuery, projectFilter, tagFilter]);
  const libraryWindow = useMemo(
    () => windowNoteLibrary(groups, collapsedGroups, libraryStart, headings),
    [groups, collapsedGroups, libraryStart, headings],
  );
  const clearFilters = () => {
    setQuery("");
    setProjectFilter(null);
    setTagFilter(null);
  };
  const filtered = Boolean(query.trim() || projectFilter !== null || tagFilter !== null);

  const recovery = selectedId ? drafts.get(selectedId) : null;
  const selectedSummary =
    visible.find((note) => note.id === selectedId) ??
    notes.find((note) => note.id === selectedId) ??
    (recovery &&
    (recovery.error || recovery.project.current || Object.keys(recovery.edits.current).length)
      ? summarizeNote(recovery.saved ?? recovery.base)
      : null) ??
    null;
  const recovered = selectedSummary
    ? (drafts.get(selectedSummary.id)?.saved ?? drafts.get(selectedSummary.id)?.base)
    : null;
  const selectedInput = useMemo(
    () =>
      selectedSummary && recovered?.updatedAt === selectedSummary.updatedAt
        ? { ...recovered, ...selectedSummary, body: recovered.body }
        : selectedSummary,
    [selectedSummary, recovered],
  );
  const {
    note: selected,
    loading: detailLoading,
    error: detailError,
    retry: retryDetail,
  } = useNoteDetail(selectedInput);

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote({
        title: "",
        body: "",
        ...(projectFilter === ""
          ? {}
          : projectFilter !== null
            ? { sourceCwd: projects.find((project) => project.key === projectFilter)?.path }
            : cwd && looksLikeProject(cwd)
              ? { sourceCwd: cwd }
              : {}),
        ...(tagFilter ? { tags: [tagFilter] } : {}),
      });
      setNotes(await loadNoteSummaries(true));
      setSelectedId(note.id);
      setMobileListVisible(false);
      setQuery("");
      setCollapsedGroups(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onSaved = (note: Note) => {
    setNotes((current) => {
      const next = current.map((item) => (item.id === note.id ? summarizeNote(note) : item));
      next.sort(
        (a, b) =>
          (b.contentUpdatedAt ?? b.updatedAt) - (a.contentUpdatedAt ?? a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
      return next;
    });
  };

  const onDelete = async (id: string, expectedUpdatedAt?: number) => {
    try {
      await deleteNote(id, expectedUpdatedAt);
      drafts.delete(id);
      notifyDrafts();
      setNotes((current) => current.filter((note) => note.id !== id));
      setSelectedId((current) => {
        if (current !== id) return current;
        return notes.find((note) => note.id !== id)?.id ?? null;
      });
      // A list refresh failure must not turn a successful deletion into failure.
      void refresh();
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const onAddToChat = (note: Note) => {
    requestAddNoteToChat(note);
    onClose();
  };

  const toggleChecked = (id: string) => {
    if (bulkBusy.current) return;
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const deleteChecked = async () => {
    if (!deleteTargets || bulkBusy.current) return;
    bulkBusy.current = true;
    setBulkDeleting(true);
    const removed = new Set<string>();
    const failures: string[] = [];
    // Freeze selected drafts before awaiting existing writes. Their unmount cleanup
    // and debounce timers must never recreate a deleted document.
    for (const note of deleteTargets) {
      const draft = drafts.get(note.id);
      if (draft) draft.skipSave.current = true;
    }
    try {
      for (const note of deleteTargets) {
        try {
          await enqueueNoteSave(note.id, async (latest) => {
            const draft = drafts.get(note.id);
            const version = latest ?? draft?.saved ?? note;
            await deleteNote(note.id, version.updatedAt);
          });
          removed.add(note.id);
          drafts.delete(note.id);
        } catch (reason) {
          const draft = drafts.get(note.id);
          if (draft) draft.skipSave.current = false;
          failures.push(
            `${note.title}: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      }
      setNotes((current) => current.filter((note) => !removed.has(note.id)));
      setCheckedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
      notifyDrafts();
      setError(failures.length ? failures.join("\n") : null);
      setDeleteTargets(null);
      if (!failures.length) setSelectionMode(false);
    } finally {
      bulkBusy.current = false;
      setBulkDeleting(false);
      selectionButton.current?.focus();
    }
  };

  const list = (
    <div
      ref={resize.setPaneRef}
      className="note-library-sidebar relative flex h-full min-h-0 shrink-0 flex-col border-r border-stroke"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-(--ui-tone-neutral-border) px-2">
        <div className="relative flex h-7 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
          <TextField
            label={t("Filter notes")}
            clearable
            hideLabel
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Filter notes")}
            aria-label={t("Filter notes")}
            spellCheck={false}
            autoComplete="off"
            fieldClassName="bycoda-arc-field--search"
          />
        </div>
        <Button
          iconOnly
          label={t("Filters and options")}
          variant="ghost"
          size="sm"
          selected={projectFilter !== null || tagFilter !== null}
          ref={filtersButton}
          type="button"
          title={t("Filters and options")}
          aria-label={t("Filters and options")}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={(event) => {
            event.currentTarget.focus();
            setFiltersOpen((open) => !open);
          }}
          className="shrink-0"
          data-active={projectFilter !== null || tagFilter !== null || undefined}
        >
          <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
          {projectFilter !== null || tagFilter !== null ? (
            <span className="note-filter-dot" />
          ) : null}
        </Button>
        <Button
          ref={selectionButton}
          variant="ghost"
          iconOnly
          label={t("Select notes")}
          selected={selectionMode}
          aria-pressed={selectionMode}
          disabled={bulkDeleting}
          onClick={() => {
            setSelectionMode((current) => !current);
            setCheckedIds(new Set());
          }}
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          iconOnly
          label={t("New note")}
          variant="ghost"
          size="sm"
          loading={creating}
          type="button"
          title={t("New note")}
          aria-label={t("New note")}
          disabled={creating}
          onClick={() => void onCreate()}
          className="shrink-0"
        >
          {creating ? (
            <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Plus className="size-3.5" strokeWidth={1.75} />
          )}
        </Button>
      </div>
      {filtersOpen ? (
        <Popover
          anchor={filtersButton}
          align="end"
          width={320}
          role="dialog"
          aria-label={t("Filters and options")}
          autoFocus
          onDismiss={() => setFiltersOpen(false)}
          className="note-filters-popover"
        >
          <div className="note-library-controls">
            <SearchableSelect
              label={t("Filter by project")}
              value={projectFilter ?? "all"}
              onChange={(value) => setProjectFilter(value === "all" ? null : value)}
              options={[
                { value: "all", label: t("All projects") + " (" + notes.length + ")" },
                {
                  value: "",
                  label:
                    t("No project") +
                    " (" +
                    notes.filter((note) => !noteProjectKey(note)).length +
                    ")",
                },
                ...projects.map((project) => ({
                  value: project.key,
                  label:
                    (projects.filter((item) => item.name === project.name).length > 1
                      ? project.path
                      : project.name) +
                    " (" +
                    project.count +
                    ")",
                  description: project.path,
                })),
              ]}
            />
            <SearchableSelect
              label={t("Filter by tag")}
              value={tagFilter ?? ""}
              onChange={(value) => setTagFilter(value || null)}
              options={[
                { value: "", label: t("All tags") },
                ...allTags.map((tag) => ({ value: tag, label: "#" + tag })),
              ]}
            />
            <Select
              label={t("Group notes by")}
              value={libraryPreferences.grouping}
              onValueChange={(value) =>
                setLibraryPreferences((current) => ({
                  ...current,
                  grouping: value as NoteGrouping,
                }))
              }
              options={[
                { value: "project", label: t("Project") },
                { value: "tag", label: t("Tags") },
                { value: "none", label: t("No grouping") },
              ]}
            />
            <Select
              label={t("Sort notes by")}
              value={libraryPreferences.sort}
              onValueChange={(value) =>
                setLibraryPreferences((current) => ({ ...current, sort: value as NoteSort }))
              }
              options={[
                { value: "updated", label: t("Recently updated") },
                { value: "created", label: t("Recently created") },
                { value: "title", label: t("Title A–Z") },
              ]}
            />
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t("Clear filters")}
            </Button>
          </div>
        </Popover>
      ) : null}
      {selectionMode ? (
        <div className="note-bulk-actions">
          <label className="note-select-all">
            <Checkbox
              aria-label={t("Select all filtered notes")}
              disabled={bulkDeleting || visible.length === 0}
              checked={visible.length > 0 && visible.every((note) => checkedIds.has(note.id))}
              indeterminate={
                visible.some((note) => checkedIds.has(note.id)) &&
                !visible.every((note) => checkedIds.has(note.id))
              }
              onChange={(event) => {
                const checked = event.target.checked;
                setCheckedIds((current) => {
                  const next = new Set(current);
                  for (const note of visible) {
                    if (checked) next.add(note.id);
                    else next.delete(note.id);
                  }
                  return next;
                });
              }}
            />
            <span>{t("{p0} selected", { p0: checkedIds.size })}</span>
          </label>
          <Button
            tone="danger"
            disabled={checkedIds.size === 0 || bulkDeleting}
            onClick={() => setDeleteTargets(notes.filter((note) => checkedIds.has(note.id)))}
          >
            <Trash2 className="size-3.5" />
            {t("Delete selected")}
          </Button>
          <Button
            variant="ghost"
            disabled={bulkDeleting}
            onClick={() => {
              setSelectionMode(false);
              setCheckedIds(new Set());
            }}
          >
            {t("Cancel")}
          </Button>
        </div>
      ) : null}
      <div
        className="flex min-h-9 items-center justify-between gap-2 border-b border-stroke px-3 text-[11px] text-content/65"
        aria-live="polite"
      >
        <span>{t("{p0} of {p1} notes", { p0: visible.length, p1: notes.length })}</span>
        {filtered ? (
          <Button variant="ghost" size="sm" type="button" onClick={clearFilters}>
            {t("Clear filters")}
          </Button>
        ) : null}
      </div>
      <div
        ref={setListScroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none"
        onScroll={(event) => {
          rememberedLibraryScroll = event.currentTarget.scrollTop;
        }}
      >
        {error ? (
          <Alert tone="danger" className="">
            {t("Could not load or update notes: ")}
            {error}{" "}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void refresh()}
              className="underline"
            >
              {t("Retry")}
            </Button>
          </Alert>
        ) : null}
        {searchError ? (
          <Alert tone="danger" className="">
            {t("Could not load or update notes: ")}
            {searchError}{" "}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void refresh()}
              className="underline"
            >
              {t("Retry")}
            </Button>
          </Alert>
        ) : null}
        {[...drafts]
          .filter(([id, draft]) => id !== selectedId && draft.error)
          .map(([id, draft]) => (
            <Alert tone="danger" key={id} className="">
              {t("Unsaved note: ")}
              {draft.error}{" "}
              <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedId(id)}>
                {t("Recover draft")}
              </Button>
            </Alert>
          ))}
        {loading && notes.length === 0 ? (
          <div className="flex justify-center py-10 text-content/40">
            <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : error && notes.length === 0 ? null : visible.length === 0 ? (
          <EmptyState
            description={
              filtered
                ? t("No matching notes")
                : t("No notes yet. Save a turn from the transcript, or create one here.")
            }
          />
        ) : (
          <div className="p-1.5" data-note-library>
            {libraryWindow.groups.map((group) => (
              <section key={group.key}>
                {libraryPreferences.grouping !== "none" ? (
                  <Button
                    variant="item"
                    size="sm"
                    motion="none"
                    type="button"
                    className="note-group-heading"
                    title={group.path}
                    aria-expanded={!collapsedGroups.has(group.key)}
                    onClick={() =>
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                  >
                    <ChevronDown
                      className={`size-3 shrink-0 ${collapsedGroups.has(group.key) ? "-rotate-90" : ""}`}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {group.label ||
                        (libraryPreferences.grouping === "project"
                          ? t("No project")
                          : t("Untagged"))}
                    </span>
                    <span className="tabular-nums text-content/60">{group.totalNotes}</span>
                  </Button>
                ) : null}
                {collapsedGroups.has(group.key) ? null : (
                  <ul className="flex flex-col gap-0.5">
                    {group.notes.map((note) => (
                      <li key={note.id} className="note-selectable-row">
                        {selectionMode ? (
                          <Checkbox
                            aria-label={t("Select note: {p0}", { p0: note.title })}
                            checked={checkedIds.has(note.id)}
                            disabled={bulkDeleting}
                            onChange={() => toggleChecked(note.id)}
                          />
                        ) : null}
                        <NoteCard
                          note={note}
                          group={group.key}
                          active={selectedSummary?.id === note.id}
                          logos={logos}
                          mascots={groupMascots}
                          colors={groupColors}
                          customColors={groupCustomColors}
                          onSelect={() => {
                            if (selectionMode) {
                              toggleChecked(note.id);
                              return;
                            }
                            setSelectedGroup(group.key);
                            setSelectedId(note.id);
                            setMobileListVisible(false);
                          }}
                          onNavigate={(event) => navigateNote(event, note.id, group.key)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      {libraryWindow.total > LIST_PAGE_SIZE ? (
        <nav className="note-library-pages" aria-label={t("Notes")}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={libraryWindow.start === 0}
            onClick={() => {
              setLibraryStart(libraryWindow.start - LIST_PAGE_SIZE);
              if (listScroller.current) listScroller.current.scrollTop = 0;
            }}
          >
            {t("Back")}
          </Button>
          <span aria-live="polite" className="tabular-nums">
            {Math.floor(libraryWindow.start / LIST_PAGE_SIZE) + 1} /{" "}
            {Math.ceil(libraryWindow.total / LIST_PAGE_SIZE)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={libraryWindow.end >= libraryWindow.total}
            onClick={() => {
              setLibraryStart(libraryWindow.end);
              if (listScroller.current) listScroller.current.scrollTop = 0;
            }}
          >
            {t("Show more")}
          </Button>
        </nav>
      ) : null}
      <div
        {...resize.separatorProps}
        aria-label={t("Resize notes list")}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </div>
  );

  return (
    <div
      role="region"
      aria-label={t("Notes")}
      data-app-notes
      data-library-visible={mobileListVisible}
      className="notes-workspace flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <File className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-content">{t("Notes")}</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div className="note-mobile-navigation">
        <Button
          variant="tab"
          selected={mobileListVisible}
          aria-pressed={mobileListVisible}
          onClick={() => setMobileListVisible(true)}
        >
          {t("Notes")}
        </Button>
        <Button
          variant="tab"
          selected={!mobileListVisible}
          aria-pressed={!mobileListVisible}
          onClick={() => setMobileListVisible(false)}
        >
          {t("Editor")}
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {list}
        <div
          inert={bulkDeleting}
          className="notes-workspace-detail flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {selectedSummary && !visible.some((note) => note.id === selectedSummary.id) ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-stroke px-5 py-2 text-[12px] text-content/70">
              {t("This note is outside the current filters.")}
              <Button variant="ghost" size="sm" type="button" onClick={clearFilters}>
                {t("Clear filters")}
              </Button>
            </div>
          ) : null}
          {detailError ? (
            <Alert tone="danger" className="">
              {t("Could not load or update notes: ")}
              {detailError}{" "}
              <Button variant="ghost" size="sm" type="button" onClick={retryDetail}>
                {t("Retry")}
              </Button>
            </Alert>
          ) : null}
          {detailLoading && !selected ? (
            <div role="status" className="grid min-h-0 flex-1 place-items-center">
              <LoaderCircle className="size-4 animate-spin text-content/40" strokeWidth={1.75} />
            </div>
          ) : (
            <NoteDetail
              note={selected}
              recents={recents}
              activeCwd={cwd}
              onSaved={onSaved}
              onDelete={onDelete}
              onAddToChat={onAddToChat}
            />
          )}
        </div>
      </div>
      {deleteTargets ? (
        <Modal
          title={t("Delete {p0} notes permanently?", { p0: deleteTargets.length })}
          size="sm"
          onClose={() => {
            if (!bulkBusy.current) setDeleteTargets(null);
          }}
        >
          <div className="note-delete-description">
            <p>
              {t(
                "This cannot be undone. Unsaved changes in the selected notes will also be deleted.",
              )}
            </p>
            <ul>
              {deleteTargets.slice(0, 5).map((note) => (
                <li key={note.id}>{note.title}</li>
              ))}
            </ul>
            {deleteTargets.length > 5 ? (
              <p>{t("And {p0} more", { p0: deleteTargets.length - 5 })}</p>
            ) : null}
          </div>
          <div className="note-delete-actions">
            <Button disabled={bulkDeleting} onClick={() => setDeleteTargets(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              tone="danger"
              loading={bulkDeleting}
              onClick={() => void deleteChecked()}
            >
              {t("Confirm delete")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

type ProjectMarks = {
  logos: Record<string, string>;
  mascots: Record<string, string>;
  colors: Record<string, number>;
  customColors: Record<string, string>;
};

function NoteProjectMark({
  cwd,
  logos,
  mascots,
  colors,
  customColors,
}: { cwd: string } & ProjectMarks) {
  useLocale();
  const project = projectDisplayName(cwd);
  const key = projectKey(cwd);
  const logoPath = resolveTabGroupLogo(key, logos);
  const mascotName = resolveTabGroupMascot(key, mascots);
  const mascotColor = resolveTabGroupColor(key, colors, customColors, project);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {logoPath ? (
        <ProjectLogoIcon
          path={logoPath}
          className="size-3.5 shrink-0 rounded-sm"
          imageClassName="size-3.5"
        />
      ) : (
        <ProjectMascot
          project={project}
          color={mascotColor}
          name={mascotName}
          className="size-3 shrink-0"
        />
      )}
      <span className="min-w-0 truncate">{project}</span>
    </span>
  );
}

function NoteDetailTab({
  id,
  controls,
  label,
  selected,
  onSelect,
}: {
  id: string;
  controls: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  return (
    <Button
      variant="tab"
      size="sm"
      motion="none"
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      onClick={onSelect}
      selected={selected}
    >
      {label}
    </Button>
  );
}

function NoteCard({
  note,
  group,
  active,
  logos,
  mascots,
  colors,
  customColors,
  onSelect,
  onNavigate,
}: {
  note: NoteSummary;
  group: string;
  active: boolean;
  onSelect: () => void;
  onNavigate: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
} & ProjectMarks) {
  useLocale();
  const preview = note.preview;
  const project = noteSourceProject(note.sourceCwd);
  const time = formatRelativeTime(new Date(note.updatedAt).toISOString());
  const hint = [note.title, project].filter(Boolean).join(" · ");
  return (
    <Button
      variant="item"
      motion="none"
      selected={active}
      type="button"
      title={hint}
      aria-current={active ? "true" : undefined}
      data-note-id={note.id}
      data-note-group={group}
      onClick={onSelect}
      onKeyDown={onNavigate}
      className="note-library-card flex w-full flex-col"
    >
      <span className="flex items-center gap-2">
        {project && note.sourceCwd ? (
          <span className="min-w-0 flex-1 text-[11px] text-content/50">
            <NoteProjectMark
              cwd={note.sourceCwd}
              logos={logos}
              mascots={mascots}
              colors={colors}
              customColors={customColors}
            />
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {time ? (
          <span className="shrink-0 text-[11px] tabular-nums text-content/45">{time}</span>
        ) : null}
      </span>
      <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
        {note.title}
      </span>
      {preview ? (
        <span className="mt-1 line-clamp-1 text-[12px] leading-snug text-content/45">
          {preview}
        </span>
      ) : null}
      {note.tags.length > 0 ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden">
          {note.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} size="sm" className="max-w-24 truncate">
              #{tag}
            </Badge>
          ))}
          {note.tags.length > 3 ? (
            <span className="shrink-0 text-(length:--ui-font-caption) text-(--ui-text-secondary)">+{note.tags.length - 3}</span>
          ) : null}
        </span>
      ) : null}
    </Button>
  );
}

function NoteDetail({
  note,
  recents,
  activeCwd,
  onSaved,
  onDelete,
  onAddToChat,
}: {
  note: Note | null;
  recents: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onDelete: (id: string, expectedUpdatedAt?: number) => Promise<boolean>;
  onAddToChat: (note: Note) => void;
}) {
  useLocale();
  if (!note) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <File className="mb-3 size-6 text-content/30" strokeWidth={1.75} />
        <p className="text-[13px] text-content/45">{t("Select a note")}</p>
      </div>
    );
  }
  return (
    <NoteEditor
      key={note.id}
      note={note}
      recents={recents}
      activeCwd={activeCwd}
      onSaved={onSaved}
      onDelete={onDelete}
      onAddToChat={onAddToChat}
    />
  );
}

function NoteEditor({
  note,
  recents,
  activeCwd,
  onSaved,
  onDelete,
  onAddToChat,
}: {
  note: Note;
  recents: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onDelete: (id: string, expectedUpdatedAt?: number) => Promise<boolean>;
  onAddToChat: (note: Note) => void;
}) {
  useLocale();
  const modesId = useId();
  const panelId = `${modesId}-panel`;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const detailRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<"source" | "preview">("source");
  useEffect(() => {
    const node = detailRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width <= 780);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const blank = !note.body.trim() && note.title === "Untitled";
  const [mode, setModeState] = useRetainedState<NoteViewMode>(
    `note-editor:${note.id}:mode`,
    "split",
  );
  const setMode = (next: NoteViewMode) => {
    if (narrow && mode === "split" && next !== "split") setNarrowPane(next);
    else setModeState(next);
    setToolbarTarget("source");
  };
  // Narrow panels show one pane without overwriting the retained desktop mode.
  const visibleMode = narrow && mode === "split" ? narrowPane : mode;
  const modeRef = useRef(visibleMode);
  modeRef.current = visibleMode;
  const [draftState] = useState(() => {
    const existing = drafts.get(note.id);
    const recover =
      existing &&
      (Object.keys(existing.edits.current).length > 0 ||
        existing.project.current ||
        existing.error ||
        noteSaveQueues.has(note.id));
    const draft: Draft = (recover ? existing : undefined) ?? {
      edits: { current: {} },
      project: { current: null },
      skipSave: { current: false },
      error: null,
      base: note,
    };
    drafts.set(note.id, draft);
    return draft;
  });
  const [edits, setEdits] = useState<Edits>(draftState.edits.current);
  const title = edits.title ?? note.title;
  const titleError = noteTitleError(title);
  const body = edits.body ?? note.body;
  const tags = edits.tags ?? note.tags;
  // Keep only an unsaved choice locally so completed moves survive reopening.
  const [projectChange, setProjectChange] = useState<{ path: string } | null>(
    draftState.project.current,
  );
  const sourceCwd = projectChange?.path ?? note.sourceCwd;
  const [saveError, setSaveErrorState] = useState<string | null>(draftState.error);
  const setSaveError = (error: string | null) => {
    draftState.error = error;
    setSaveErrorState(error);
    notifyDrafts();
  };
  const [deleting, setDeleting] = useState(false);
  const [imageDrag, setImageDrag] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const editsRef = draftState.edits;
  const bodyRef = useRef(body);
  const projectChangeRef = draftState.project;
  const noteRef = useRef(note);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const titleFieldRef = useRef<HTMLInputElement>(null);
  const finalizeRef = useRef<{ title: string } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const previewViewRef = useRef<EditorView | null>(null);
  const previewRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [previewEditing, setPreviewEditing] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<"source" | "preview">("source");
  const toolbarTargetRef = useRef(toolbarTarget);
  toolbarTargetRef.current = toolbarTarget;
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const lastDropAt = useRef(0);
  const skipSave = draftState.skipSave;
  const saveTimer = useRef<number | null>(null);
  const onSavedRef = useRef(onSaved);
  bodyRef.current = body;
  // A refreshed row must not silently rebase an existing draft onto another
  // writer's mutation token. Only a clean editor may adopt it automatically.
  if (!Object.keys(editsRef.current).length && !projectChangeRef.current) {
    noteRef.current = note;
    draftState.base = note;
    draftState.saved = note;
  } else {
    noteRef.current = draftState.saved ?? draftState.base;
  }
  onSavedRef.current = onSaved;
  const time = formatRelativeTime(new Date(note.updatedAt).toISOString());
  useEffect(() => {
    const sync = () => {
      setEdits({ ...draftState.edits.current });
      setProjectChange(draftState.project.current);
      setSaveErrorState(draftState.error);
    };
    window.addEventListener(DRAFT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DRAFT_CHANGED_EVENT, sync);
  }, [draftState]);

  const editNote = useCallback((change: Edits) => {
    const next = { ...editsRef.current, ...change };
    editsRef.current = next;
    if (change.body !== undefined) bodyRef.current = change.body;
    setEdits(next);
  }, []);

  const persist = useCallback(async (latest?: Note) => {
    if (skipSave.current) return;
    const current = latest ?? noteRef.current;
    const changes = editsRef.current;
    const nextBody = changes.body ?? current.body;
    const titleFocused = document.activeElement === titleFieldRef.current;
    const nextTitle =
      (changes.title ?? current.title).trim() ||
      (titleFocused ? current.title : noteTitle(nextBody));
    if (noteTitleError(nextTitle)) return current;
    const nextTags = changes.tags ?? current.tags;
    const nextProject = projectChangeRef.current;
    const acceptSaved = (saved: Note) => {
      draftState.saved = saved;
      draftState.base = saved;
      noteRef.current = saved;
      // A completed save only clears the edits included in that request.
      const remaining = { ...editsRef.current };
      if (
        remaining.title === changes.title &&
        !titleFocused &&
        document.activeElement !== titleFieldRef.current
      )
        delete remaining.title;
      if (remaining.body === changes.body) delete remaining.body;
      if (remaining.tags === changes.tags) delete remaining.tags;
      editsRef.current = remaining;
      bodyRef.current = remaining.body ?? saved.body;
      setEdits(remaining);
      if (projectChangeRef.current === nextProject) {
        projectChangeRef.current = null;
        setProjectChange(null);
      }
      setSaveError(null);
    };
    const finalizeRequest = finalizeRef.current;
    const finalizeSlug = !!current.slugPending && finalizeRequest?.title === nextTitle;
    if (
      !finalizeSlug &&
      nextTitle === current.title &&
      nextBody === current.body &&
      sameTags(nextTags, current.tags) &&
      (!nextProject || nextProject.path === current.sourceCwd)
    ) {
      acceptSaved(current);
      return current;
    }
    setSaving(true);
    try {
      const saved = await upsertNote({
        id: current.id,
        expectedUpdatedAt: current.updatedAt,
        title: nextTitle,
        body: nextBody,
        tags: nextTags,
        ...(finalizeSlug ? { finalizeSlug: true } : {}),
        ...(nextProject ? { sourceCwd: nextProject.path } : {}),
      });
      if (finalizeSlug && finalizeRef.current === finalizeRequest) finalizeRef.current = null;
      acceptSaved(saved);
      onSavedRef.current(saved);
      return saved;
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return current;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveNow = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    return enqueueNoteSave(note.id, persist);
  }, [note.id, persist]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, 400);
  }, [saveNow]);

  const insertionRange = useCallback(() => {
    if (
      toolbarTargetRef.current === "preview" &&
      previewRangeRef.current &&
      previewViewRef.current
    ) {
      const { from, to } = previewViewRef.current.state.selection.main;
      return { start: previewRangeRef.current.from + from, end: previewRangeRef.current.from + to };
    }
    const view = editorViewRef.current;
    if (!view || modeRef.current === "preview") {
      const end = bodyRef.current.length;
      return { start: end, end };
    }
    const { from, to } = view.state.selection.main;
    return { start: from, end: to };
  }, []);

  const addDroppedImages = useCallback(
    async (load: () => Promise<NoteImageAsset[]>, range: { start: number; end: number }) => {
      setImageBusy(true);
      setImageDrag(false);
      try {
        const images = await load();
        const inserted = insertNoteImagesMarkdown(bodyRef.current, range.start, range.end, images);
        editNote({ body: inserted.value });
        setSaveError(null);
        scheduleSave();
        window.requestAnimationFrame(() => {
          const view = editorViewRef.current;
          if (!view || modeRef.current === "preview") return;
          view.focus();
          view.dispatch({
            selection: {
              anchor: Math.min(inserted.cursor, view.state.doc.length),
            },
            scrollIntoView: true,
          });
        });
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setImageBusy(false);
      }
    },
    [editNote, scheduleSave],
  );

  const pasteImages = useCallback(
    (files: File[]) => {
      const range = insertionRange();
      void addDroppedImages(() => saveNoteImagesFromFiles(note.id, files), range);
    },
    [addDroppedImages, insertionRange, note.id],
  );

  const insertImage = useCallback(async () => {
    // Read the caret before the dialog takes focus from the editor.
    const range = insertionRange();
    let paths: string[] | null;
    try {
      paths = await pickImageFiles();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!paths) return;
    await addDroppedImages(() => saveNoteImagesFromPaths(note.id, paths), range);
  }, [addDroppedImages, insertionRange, note.id]);

  // The editor takes its own pastes; this catches a paste on the preview.
  const onPreviewPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || modeRef.current !== "preview") return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    const images = filesFromClipboard(event.clipboardData).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    pasteImages(images);
  };

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const toClientPoint = (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) {
        return { x: x / scale, y: y / scale };
      }
      return { x, y };
    };
    const overDropZone = (x: number, y: number) => {
      const zone = dropZoneRef.current;
      if (!zone) return false;
      const point = toClientPoint(x, y);
      const rect = zone.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setImageDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const over = overDropZone(x, y);
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setImageDrag(over);
          return;
        }
        if (event.payload.type !== "drop") return;
        setImageDrag(false);
        if (!over || Date.now() - lastDropAt.current < 250) return;
        lastDropAt.current = Date.now();
        const range = insertionRange();
        const paths = event.payload.paths;
        void addDroppedImages(() => saveNoteImagesFromPaths(note.id, paths), range);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addDroppedImages, insertionRange, note.id]);

  useEffect(() => {
    draftState.mounts = (draftState.mounts ?? 0) + 1;
    return () => {
      draftState.mounts = Math.max(0, (draftState.mounts ?? 1) - 1);
      if (noteRef.current.slugPending) {
        finalizeRef.current = {
          title:
            (editsRef.current.title ?? noteRef.current.title).trim() || noteTitle(bodyRef.current),
        };
      }
      void saveNow().finally(() => pruneDraft(note.id, draftState));
    };
  }, [saveNow, draftState, note.id]);

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const onEditorShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The editor handles these itself while it has focus.
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (!(IS_MAC ? event.metaKey : event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (key !== "f" && key !== "h") return;
    event.preventDefault();
    if (visibleMode === "preview") setMode("source");
    window.requestAnimationFrame(() => {
      const view = editorViewRef.current;
      if (view) (key === "h" ? openReplacePanel : openSearchPanel)(view);
    });
  };

  const editing = visibleMode !== "preview" || previewEditing;
  const dirty =
    title !== note.title ||
    body !== note.body ||
    !sameTags(tags, note.tags) ||
    Boolean(projectChange);
  const canAddToChat = Boolean(body.trim());
  const draft: Note = {
    ...note,
    title: title.trim() || noteTitle(body),
    body,
    tags,
    sourceCwd,
  };

  return (
    <div
      ref={(node) => {
        detailRef.current = node;
        lockOverscroll(node);
      }}
      // Focusable so a paste over the preview reaches onPreviewPaste.
      tabIndex={-1}
      onKeyDown={onEditorShortcut}
      onPaste={onPreviewPaste}
      className="note-detail min-h-0 min-w-0 flex-1"
    >
      <SurfaceSelection
        className="note-detail-content"
        allowNotes={false}
        cwd={sourceCwd ?? undefined}
        contentVersion={body}
      >
        <header className="note-detail-header">
          <div className="note-detail-identity flex min-w-0 items-center gap-2 text-[12px] text-content/50">
            <File className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{t("Note")}</span>
            {note.slug ? <span className="min-w-0 truncate">{note.slug}</span> : null}
            <SearchableProjectPicker
              cwd={sourceCwd ?? "~"}
              recents={recents}
              mode="move"
              railCwd={activeCwd}
              buttonClassName="px-1.5"
              onSelectProject={(path) => {
                const change = { path };
                projectChangeRef.current = change;
                setProjectChange(change);
                void saveNow();
              }}
            />
            {time ? (
              <span className="note-detail-updated">
                {t("Updated ")}
                {time}
              </span>
            ) : null}
          </div>
          <TextField
            label={t("Note title")}
            error={titleError}
            hideLabel
            ref={titleFieldRef}
            value={title}
            onChange={(event) => {
              finalizeRef.current = null;
              editNote({ title: event.target.value });
              scheduleSave();
            }}
            onBlur={() => {
              const next = title.trim() || noteTitle(body);
              if (next !== title) editNote({ title: next });
              if (noteRef.current.slugPending) finalizeRef.current = { title: next };
              void saveNow();
            }}
            onKeyDown={onTitleKeyDown}
            aria-label={t("Note title")}
            fieldClassName="note-detail-title"
            placeholder={t("Untitled")}
          />
          <details className="note-detail-tags">
            <summary>
              {t("Tags")}
              {tags.length ? ` · ${tags.length}` : ""}
            </summary>
            <NoteTagsEditor
              tags={tags}
              onChange={(next) => {
                editNote({ tags: next });
                scheduleSave();
              }}
            />
          </details>
          <div className="note-detail-actions">
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={!canAddToChat}
              onClick={() => onAddToChat(draft)}
            >
              <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
              {t("Add to chat")}
            </Button>
            <Button
              variant={dirty || saveError ? "secondary" : "ghost"}
              size="sm"
              loading={saving}
              disabled={deleting}
              onClick={() => void saveNow()}
            >
              {t("Save")}
            </Button>
            <span className="note-detail-delete">
            <ConfirmMorph
              disabled={deleting}
              label={t("Delete")}
              icon={<Trash2 className="size-3.5" />}
              prompt={t("Delete note permanently?")}
              confirmTimeout={0}
              onConfirm={async () => {
                setDeleting(true);
                skipSave.current = true;
                if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
                try {
                  await enqueueNoteSave(note.id, async () => {
                    if (!(await onDelete(note.id, noteRef.current.updatedAt)))
                      throw new Error(t("Delete failed"));
                  });
                } catch (reason) {
                  skipSave.current = false;
                  setDeleting(false);
                  scheduleSave();
                  throw reason;
                }
              }}
            />
            </span>
          </div>
          <span role="status" className="note-detail-status">
            {saveError || saving || dirty ? (
              <Badge
                tone={saveError ? "danger" : saving ? "info" : "warning"}
                appearance="subtle"
              >
                {saving && !saveError ? t("Saving…") : t("Unsaved changes")}
              </Badge>
            ) : null}
            <span className="note-detail-words">
              <NoteWordCount body={body} />
            </span>
          </span>
          {saveError ? (
            <Alert tone="danger" className="note-detail-error">
              <span>
                {t("Could not save note: ")}
                {saveError}
              </span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setSaveError(null);
                  void saveNow();
                }}
                className="shrink-0 underline hover:no-underline"
              >
                {t("Retry")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={recovering}
                onClick={async () => {
                  setRecovering(true);
                  try {
                    await createRecoveredNote({ title, body, tags, sourceCwd });
                    editsRef.current = {};
                    projectChangeRef.current = null;
                    setEdits({});
                    setSaveError(null);
                    window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
                  } catch (error) {
                    setSaveError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRecovering(false);
                  }
                }}
              >
                {t("Save as new note")}
              </Button>
            </Alert>
          ) : null}
        </header>
        <div className="note-editor-toolbar flex flex-wrap items-center gap-x-4 border-b border-stroke">
          <div
            role="tablist"
            aria-label={t("Note sections")}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const tabs = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              ];
              const index = tabs.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
            className="flex shrink-0 items-stretch gap-4"
          >
            <NoteDetailTab
              id={`${modesId}-preview`}
              controls={panelId}
              label={t("Edit preview")}
              selected={visibleMode === "preview"}
              onSelect={() => setMode("preview")}
            />
            <NoteDetailTab
              id={`${modesId}-source`}
              controls={panelId}
              label={t("Source")}
              selected={visibleMode === "source"}
              onSelect={() => setMode("source")}
            />
            {narrow ? null : (
              <NoteDetailTab
                id={`${modesId}-split`}
                controls={panelId}
                label={t("Split")}
                selected={mode === "split"}
                onSelect={() => setMode("split")}
              />
            )}
          </div>
          <NoteMarkdownToolbar
            viewRef={previewEditing && toolbarTarget === "preview" ? previewViewRef : editorViewRef}
            editing={editing}
            imageBusy={imageBusy}
            onInsertImage={() => void insertImage()}
          />
        </div>
        <div
          ref={dropZoneRef}
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${modesId}-${visibleMode}`}
          data-external-drop-owner="note-images"
          aria-busy={imageBusy}
          className={`note-editor-body relative rounded-lg border transition-colors ${
            imageDrag
              ? "border-(--ui-border-accent) bg-(--ui-surface-selected)"
              : "border-transparent"
          }`}
          onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
            if (!hasDroppedFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setImageDrag(true);
          }}
          onDragLeave={(event: ReactDragEvent<HTMLDivElement>) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            setImageDrag(false);
          }}
          onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
            if (!hasDroppedFiles(event.dataTransfer)) return;
            event.preventDefault();
            setImageDrag(false);
            if (Date.now() - lastDropAt.current < 250) return;
            lastDropAt.current = Date.now();
            const files = [...event.dataTransfer.files];
            if (files.length === 0) return;
            const range = insertionRange();
            void addDroppedImages(() => saveNoteImagesFromFiles(note.id, files), range);
          }}
        >
          {imageDrag || imageBusy ? (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-background-base/80 text-[12px] text-content/70 backdrop-blur-sm">
              {imageBusy ? t("Adding images…") : t("Drop images here")}
            </div>
          ) : null}
          <div className={visibleMode === "split" ? "note-layout note-split" : "note-layout"}>
            {/* Stays mounted in preview so undo history survives the switch. */}
            <NoteEditorPane
              label={t("Source")}
              hidden={visibleMode === "preview"}
              split={visibleMode === "split"}
            >
              <NoteMarkdownEditor
                viewRef={editorViewRef}
                minHeight={0}
                autoFocus={blank}
                value={body}
                onChange={(next) => {
                  editNote({ body: next });
                  scheduleSave();
                }}
                onSave={() => void saveNow()}
                onPasteImages={pasteImages}
                onFocus={() => setToolbarTarget("source")}
              />
            </NoteEditorPane>
            {visibleMode === "source" ? null : (
              <NoteEditorPane label={t("Edit preview")} split={visibleMode === "split"}>
                <NoteEditablePreview
                  value={body}
                  cwd={sourceCwd}
                  viewRef={previewViewRef}
                  rangeRef={previewRangeRef}
                  onEditingChange={setPreviewEditing}
                  onFocus={() => setToolbarTarget("preview")}
                  onChange={(next) => {
                    editNote({ body: next });
                    scheduleSave();
                  }}
                  onSave={() => void saveNow()}
                  onPasteImages={pasteImages}
                />
              </NoteEditorPane>
            )}
          </div>
        </div>
      </SurfaceSelection>
    </div>
  );
}

function NoteTagsEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  useLocale();
  return (
    <TagInput
      label={t("Tags")}
      hideLabel
      value={tags}
      maxTags={MAX_NOTE_TAGS}
      normalize={normalizeNoteTags}
      backspaceBehavior="remove"
      formatTag={(tag) => `#${tag}`}
      placeholder={t("Add tag…")}
      removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
      inputProps={{ "aria-label": t("Add note tag"), spellCheck: false, autoComplete: "off" }}
      onValueChange={(next) => {
        if (!sameTags(next, tags)) onChange(next);
      }}
    />
  );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function hasDroppedFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return [...data.types].some((type) => type === "Files" || type === "application/x-moz-file");
}

function NoteWordCount({ body }: { body: string }) {
  useLocale();
  const deferredBody = useDeferredValue(body);
  const count = useMemo(
    () => (deferredBody.trim() ? deferredBody.trim().split(/\s+/u).length : 0),
    [deferredBody],
  );
  return t("{p0} words", { p0: count });
}
