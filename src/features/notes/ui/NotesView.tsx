import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { ContextMenu } from "../../../shared/ui/ContextMenu";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { LiveText } from "../../../shared/ui/LiveText";
import { ClampText } from "../../../shared/ui/ClampText";
import { NoteDeleteDescription } from "./NoteDeleteDescription";
import { motionAttributes } from "../../../shared/ui/Motion";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Tab, TabList, TabPanel, Tabs, TabStrip } from "../../../shared/ui/Tabs";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { NoteTagsEditor, sameTags } from "./NoteTagsEditor";
import { NoteWordCount } from "./NoteWordCount";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bridgeQueryEvents } from "../../../shared/lib/queryClient";
import { projectDisplayName } from "../../projects/model/projectNames";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { Plus, Search, File, Trash2, SlidersHorizontal, Check } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { TextField } from "../../../shared/ui/TextField";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
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
  getNote,
  loadLibraryNoteSummaries,
  NOTES_CHANGED_EVENT,
  noteSourceProject,
  noteTitle,
  peekLibraryNoteSummaries,
  peekNoteDetail,
  summarizeNote,
  searchNotes,
  upsertNote,
  requestAddNoteToChat,
  type Note,
  type NoteSummary,
} from "../notes";
import { createRecoveredNote } from "../noteImages";
import { projectKey } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";
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
import { NoteSaveStatus, noteSaveState } from "./NoteSaveStatus";
import { NoteQuickTagFilters } from "./NoteQuickTagFilters";
import { NoteChatAction } from "./NoteChatAction";
import { NoteEditorPane } from "./NoteEditorPane";
import { useNoteEditorMode } from "./useNoteEditorMode";
import { useNoteInView } from "./useNoteInView";
import { useNoteFindRequest } from "./useNoteFindRequest";
import { useNoteImageInsertion } from "./useNoteImageInsertion";
import {
  filterNoteLibrary,
  groupNoteLibrary,
  loadNoteLibraryPreferences,
  noteLibraryProjects,
  noteLibraryDate,
  noteLibraryMatchLocation,
  noteProjectKey,
  saveNoteLibraryPreferences,
  type NoteGrouping,
  type NoteSort,
} from "../noteLibrary";
import { useNoteDetail } from "../useNoteDetail";
import { OPEN_NOTE_LIBRARY_EVENT, takeNoteLibraryTarget } from "../noteNavigation";
import {
  groupCreateScope,
  noteMenuItems,
  type NoteCreateScope,
  type NoteMenuTarget,
} from "../noteLibraryMenu";
import { mergeSavedDrafts } from "./mergeSavedDrafts";
import "./notes.css";
import {
  drafts,
  DRAFT_CHANGED_EVENT,
  notifyDrafts,
  mountNotesView,
  pruneDraft,
  enqueueNoteSave,
  draftInputOwner,
  removeNoteDraft,
  type Draft,
  type Edits,
} from "../noteDrafts";
import {
  beginNoteWork,
  deriveNoteInputResult,
  noteActivityOwner,
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
import { copyNativeCaptureData } from "../../../shared/lib/native-capture-json";

const MIN_WIDTH = 240;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;

let rememberedWidth = DEFAULT_WIDTH;
let rememberedNoteId: string | null = null;

type NoteFindRequest = { noteId: string; query: string; token: number } | null;
/** A failed library mutation and, when it has one here, the action that repeats it. */
type NotesActionFailure = {
  kind: "create" | "bulk" | "chat";
  message: string;
  retry?: () => void;
};

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
  const listScroller = useRef<HTMLDivElement | null>(null);
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
    queryFn: () => loadLibraryNoteSummaries(true),
    initialData: () => peekLibraryNoteSummaries() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    // Preserve the exact published DTO/summary identity. Equal-value cache
    // reconstruction cannot carry an original writer's private view proof.
    structuralSharing: false,
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
  // A list-load failure belongs to the query: a later successful refetch clears it.
  // Create/delete/bulk failures are separate and carry their own retry, so a list
  // refresh can neither hide nor "retry" an unresolved mutation.
  const listError = notesQuery.error ? notesQuery.error.message : null;
  const [actionFailure, setActionFailure] = useState<NotesActionFailure | null>(null);
  const [, updateDrafts] = useState(0);
  useEffect(() => {
    const update = () => {
      updateDrafts((value) => value + 1);
      setNotes(mergeSavedDrafts);
    };
    window.addEventListener(DRAFT_CHANGED_EVENT, update);
    return () => window.removeEventListener(DRAFT_CHANGED_EVENT, update);
  }, []);
  const [query, setQuery] = useState("");
  const [findRequest, setFindRequest] = useState<{
    noteId: string;
    query: string;
    token: number;
  } | null>(null);
  const findSequence = useRef(0);
  const completeFind = useCallback(
    (token: number) => setFindRequest((current) => (current?.token === token ? null : current)),
    [],
  );
  const deferredQuery = useDeferredValue(query);
  const [bodyMatches, setBodyMatches] = useState<{
    query: string;
    ids: Set<string>;
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchingBody, setSearchingBody] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  useEffect(() => {
    const needle = deferredQuery.trim();
    if (!needle) {
      setSearchError(null);
      setSearchingBody(false);
      return;
    }
    setSearchingBody(true);
    let active = true;
    // Coalesce typing before asking the native body index. Stale query results
    // never join a newer set of metadata filters.
    const timer = window.setTimeout(() => {
      void searchNotes(needle).then(
        (ids) => {
          if (active) {
            setBodyMatches({ query: needle, ids: new Set(ids) });
            setSearchError(null);
            setSearchingBody(false);
          }
        },
        (cause: unknown) => {
          if (active) {
            setSearchError(cause instanceof Error ? cause.message : String(cause));
            setSearchingBody(false);
          }
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [deferredQuery, notes, searchRevision]);
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
    const cached = peekLibraryNoteSummaries();
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
  type LibraryMenu = { target: NoteMenuTarget } & (
    | { x: number; y: number }
    | { anchor: HTMLElement }
  );
  const [menu, setMenu] = useState<LibraryMenu | null>(null);
  const menuBusy = useRef(false);
  const [addingToChat, setAddingToChat] = useState(false);
  const [titleFocus, setTitleFocus] = useState<{
    id: string;
    token: number;
  } | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
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
  const creatingRef = useRef(false);
  const logos = useTabGroupLogos();
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const refresh = useCallback(async () => {
    await notesQuery.refetch();
  }, [notesQuery.refetch]);
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

  useNoteInView(listScroller, [selectedId, loading, deferredQuery, projectFilter, tagFilter]);
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
  }, [selectedId, selectedGroup]);

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
  const libraryRows = useMemo(
    () =>
      groups.flatMap((group) => [
        ...(headings ? [{ kind: "heading" as const, group }] : []),
        ...(collapsedGroups.has(group.key)
          ? []
          : group.notes.map((note) => ({ kind: "note" as const, group, note }))),
      ]),
    [groups, headings, collapsedGroups],
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
  const clearFilters = () => {
    setQuery("");
    setProjectFilter(null);
    setTagFilter(null);
  };
  // The trigger counts and resets the project/tag scope; the search box and the
  // group/sort options keep their own controls.
  const scopeFilterCount = (projectFilter !== null ? 1 : 0) + (tagFilter !== null ? 1 : 0);
  const clearScopeFilters = () => {
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
  const selectedRowGroup = selectedSummary
    ? (groups.find(
        (group) =>
          group.key === selectedGroup && group.notes.some((note) => note.id === selectedSummary.id),
      ) ?? groups.find((group) => group.notes.some((note) => note.id === selectedSummary.id)))
    : null;
  const recovered = selectedSummary
    ? (drafts.get(selectedSummary.id)?.saved ?? drafts.get(selectedSummary.id)?.base)
    : null;
  const cachedSelected = selectedSummary
    ? peekNoteDetail(selectedSummary.id, selectedSummary.updatedAt)
    : null;
  const selectedInput = useMemo(
    () =>
      selectedSummary && !cachedSelected && recovered?.updatedAt === selectedSummary.updatedAt
        ? deriveNoteInputResult(
            { ...recovered, ...selectedSummary, body: recovered.body },
            recovered,
            selectedSummary,
          )
        : selectedSummary,
    [selectedSummary, recovered, cachedSelected],
  );
  const {
    note: selected,
    loading: detailLoading,
    error: detailError,
    retrying: detailRetrying,
    retry: retryDetail,
  } = useNoteDetail(selectedInput);
  // "Edit title" from a menu opens the note first; the field exists once its editor has mounted.
  useEffect(() => {
    if (!titleFocus || selected?.id !== titleFocus.id) return;
    const input = workspaceRef.current?.querySelector<HTMLInputElement>(".note-detail-title input");
    if (!input) return;
    input.focus();
    input.select();
    setTitleFocus(null);
  }, [titleFocus, selected]);

  // Toolbar "New note" and the empty-area menu share this scope: the active filters, else the open project.
  const defaultCreateScope = (): NoteCreateScope => ({
    ...(projectFilter === ""
      ? {}
      : projectFilter !== null
        ? { sourceCwd: projects.find((project) => project.key === projectFilter)?.path }
        : cwd && looksLikeProject(cwd)
          ? { sourceCwd: cwd }
          : {}),
    ...(tagFilter ? { tags: [tagFilter] } : {}),
  });
  const createScopeLabel = (scope: NoteCreateScope) =>
    [
      scope.sourceCwd ? projectDisplayName(scope.sourceCwd) : t("No project"),
      ...(scope.tags ?? []).map((tag) => `#${tag}`),
    ].join(" · ");

  // An explicit scope (a group heading) is used as given; no scope means the library's own.
  const onCreate = async (scope?: NoteCreateScope) => {
    if (creatingRef.current) return;
    const work = beginNoteWork("library-create");
    if (!work) {
      setActionFailure({
        kind: "create",
        message: noteInputWorkError().message,
        retry: () => void onCreate(scope),
      });
      return;
    }
    setActionFailure((current) => (current?.kind === "create" ? null : current));
    creatingRef.current = true;
    setCreating(true);
    try {
      const note = await createNote(
        { title: "", body: "", ...(scope ?? defaultCreateScope()) },
        work,
      );
      setNotes(await loadLibraryNoteSummaries(true));
      setSelectedId(note.id);
      setMobileListVisible(false);
      setQuery("");
      setCollapsedGroups(new Set());
    } catch (err: unknown) {
      setActionFailure({
        kind: "create",
        message: err instanceof Error ? err.message : String(err),
        retry: () => void onCreate(scope),
      });
    } finally {
      creatingRef.current = false;
      setCreating(false);
      work();
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

  const onAddToChat = (note: Note, targetCwd?: string) => {
    requestAddNoteToChat(note, targetCwd);
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
  // Resolves to a message when the batch could not start; the confirmation then stays
  // open on the same targets so Delete retries them. Per-note failures are reported in the library.
  const deleteChecked = async (): Promise<string | null> => {
    if (!deleteTargets || bulkBusy.current) return null;
    let targets: NoteSummary[];
    try {
      targets = copyNativeCaptureData(deleteTargets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionFailure({ kind: "bulk", message });
      return message;
    }
    const activity = noteActivityOwner();
    const batch = activity.operation("bulk-delete");
    if (!batch) return noteInputWorkError().message;
    const ownerBatches = new Map([[activity, batch as NoteInputWork | null]]);
    const originals = targets.map((note) => {
      const draft = drafts.get(note.id);
      const owner = draft ? draftInputOwner(draft) : activity;
      if (!ownerBatches.has(owner)) ownerBatches.set(owner, owner.operation("bulk-delete"));
      return ownerBatches.get(owner)!;
    });
    if (originals.some((work) => !work)) {
      ownerBatches.forEach((work) => work?.());
      // The confirmation stays open with the same selection; retry runs it again.
      const message = noteInputWorkError().message;
      setActionFailure({ kind: "bulk", message, retry: () => void deleteChecked() });
      return message;
    }
    bulkBusy.current = true;
    setBulkDeleting(true);
    const removed = new Set<string>();
    const failures: string[] = [];
    const failedNotes: NoteSummary[] = [];
    // Freeze selected drafts before awaiting existing writes. Their unmount cleanup
    // and debounce timers must never recreate a deleted document.
    for (const note of targets) {
      const draft = drafts.get(note.id);
      if (draft) draft.skipSave.current = true;
    }
    try {
      for (const [index, note] of targets.entries()) {
        try {
          await enqueueNoteSave(
            note.id,
            async (latest, queued) => {
              const draft = drafts.get(note.id);
              const version = latest ?? draft?.saved ?? note;
              await deleteNote(note.id, version.updatedAt, queued);
            },
            originals[index]!,
          );
          removed.add(note.id);
          removeNoteDraft(note.id);
        } catch (reason) {
          const draft = drafts.get(note.id);
          if (draft) draft.skipSave.current = false;
          failures.push(
            `${note.title}: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
          failedNotes.push(note);
        }
      }
      setNotes((current) => current.filter((note) => !removed.has(note.id)));
      setSelectedId((current) =>
        current && removed.has(current)
          ? (notes.find((note) => !removed.has(note.id))?.id ?? null)
          : current,
      );
      setCheckedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
      notifyDrafts();
      // Partial failures stay tied to the notes that failed; retry asks again for those only.
      setActionFailure(
        failures.length
          ? {
              kind: "bulk",
              message: failures.join("\n"),
              retry: () => setDeleteTargets(failedNotes),
            }
          : null,
      );
      setDeleteTargets(null);
      if (!failures.length) setSelectionMode(false);
    } finally {
      ownerBatches.forEach((work) => work?.());
      bulkBusy.current = false;
      setBulkDeleting(false);
      selectionButton.current?.focus();
    }
    return null;
  };

  const openMenu = (
    target: NoteMenuTarget,
    place: { x: number; y: number } | { anchor: HTMLElement },
  ) => setMenu({ target, ...place });
  const addNoteToChatFromMenu = async (summary: NoteSummary) => {
    if (menuBusy.current) return;
    menuBusy.current = true;
    setAddingToChat(true);
    const retry = () => void addNoteToChatFromMenu(summary);
    try {
      const stored = selected?.id === summary.id ? selected : await getNote(summary.id);
      if (!stored) throw new Error(t("This note could not be found."));
      // The open note's unsaved edits travel with it, exactly like the editor's own button.
      const edits = drafts.get(summary.id)?.edits.current ?? {};
      const body = edits.body ?? stored.body;
      const note: Note = {
        ...stored,
        ...edits,
        body,
        title: (edits.title ?? stored.title).trim() || noteTitle(body),
      };
      if (!body.trim()) throw new Error(t("This note has no content to add to chat."));
      onAddToChat(note);
    } catch (err: unknown) {
      setActionFailure({
        kind: "chat",
        message: err instanceof Error ? err.message : String(err),
        retry,
      });
    } finally {
      menuBusy.current = false;
      setAddingToChat(false);
    }
  };
  const pickMenu = (id: string) => {
    const open = menu;
    setMenu(null);
    if (!open) return;
    const { target } = open;
    if (target.kind === "library") {
      if (id === "new-note") void onCreate();
      return;
    }
    if (target.kind === "group") {
      if (id === "new-note")
        void onCreate(groupCreateScope(libraryPreferences.grouping, target) ?? {});
      else if (id === "toggle-group")
        setCollapsedGroups((current) => {
          const next = new Set(current);
          if (next.has(target.key)) next.delete(target.key);
          else next.add(target.key);
          return next;
        });
      return;
    }
    // The note may have been deleted or filtered away while the menu was open.
    const summary = notes.find((note) => note.id === target.id);
    if (!summary) return;
    if (id === "open" || id === "edit-title") {
      setSelectedGroup(target.group);
      setSelectedId(summary.id);
      setMobileListVisible(false);
      if (id === "edit-title") setTitleFocus({ id: summary.id, token: ++findSequence.current });
    } else if (id === "add-to-chat") void addNoteToChatFromMenu(summary);
    else if (id === "toggle-check") {
      if (selectionMode) toggleChecked(summary.id);
      else {
        setSelectionMode(true);
        setCheckedIds(new Set([summary.id]));
      }
    } else if (id === "delete") setDeleteTargets([summary]);
    else if (id === "delete-selected")
      setDeleteTargets(notes.filter((note) => checkedIds.has(note.id)));
  };
  const menuNote =
    menu?.target.kind === "note"
      ? notes.find((note) => note.id === (menu.target as { id: string }).id)
      : undefined;

  const list = (
    <div
      ref={resize.setPaneRef}
      {...surfaceAttributes(
        { frame: "pane", edge: "right", variant: "transparent" },
        "note-library-sidebar relative flex h-full min-h-0 shrink-0 flex-col",
      )}
    >
      <div className="flex min-h-9 shrink-0 items-center gap-1 px-2 pt-1">
        <LiveText
          size="caption"
          tone="secondary"
          truncate
          className="min-w-0 flex-1 ps-1 tabular-nums"
          text={
            filtered
              ? t("{p0} of {p1} notes", { p0: visible.length, p1: notes.length })
              : t("{p0} notes", { p0: notes.length })
          }
        />
        {notes.length > 0 || selectionMode ? (
          <Button
            ref={selectionButton}
            variant="ghost"
            size="sm"
            label={t("Select notes")}
            selected={selectionMode}
            aria-pressed={selectionMode}
            disabled={bulkDeleting}
            onClick={() => {
              setSelectionMode((current) => !current);
              setCheckedIds(new Set());
            }}
          >
            <Check className="icon-sm" />
            {t("Select notes")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          loading={creating}
          onClick={() => void onCreate()}
          startIcon={<Plus className="icon-sm" />}
        >
          {t("New note")}
        </Button>
      </div>
      {notes.length > 0 || filtered || loading ? (
        <div className="flex shrink-0 items-center gap-1 px-2 py-1">
          <SearchInputGroup appearance="field" className="min-w-0 flex-1">
            <Search className="icon-xs shrink-0" tone="secondary" aria-hidden="true" />
            <SearchInput
              focusOwner="group"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Filter notes")}
              aria-label={t("Filter notes")}
              aria-busy={searchingBody}
              spellCheck={false}
              autoComplete="off"
            />
            {searchingBody ? (
              <span role="status" aria-label={t("Searching note content…")}>
                <WorkingIndicator size="xs" />
              </span>
            ) : null}
          </SearchInputGroup>
          <FilterTrigger
            label={t("Filters and options")}
            icon={<SlidersHorizontal className="icon-sm" />}
            activeCount={scopeFilterCount}
            onReset={clearScopeFilters}
            resetLabel={t("Reset project and tag filters")}
            size="sm"
            ref={filtersButton}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onClick={(event) => {
              event.currentTarget.focus();
              setFiltersOpen((open) => !open);
            }}
            className="shrink-0"
          />
        </div>
      ) : null}
      <NoteQuickTagFilters tags={allTags} selected={tagFilter} onSelect={setTagFilter} />
      {filtersOpen ? (
        <Popover
          anchor={filtersButton}
          align="end"
          width={320}
          kind="dialog"
          aria-label={t("Filters and options")}
          flow="scroll"
          onDismiss={(reason) => {
            setFiltersOpen(false);
            // The shared trigger re-renders with its count while a filter changes, so
            // return focus to the current trigger instead of the one that opened this.
            if (reason === "escape") filtersButton.current?.focus();
          }}
          className="note-filters-popover"
        >
          <div className="note-library-controls">
            <SearchableSelect
              hideLabel
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
              hideLabel
              label={t("Filter by tag")}
              value={tagFilter ?? ""}
              onChange={(value) => setTagFilter(value || null)}
              options={[
                { value: "", label: t("All tags") },
                ...allTags.map((tag) => ({ value: tag, label: "#" + tag })),
              ]}
            />
            <Select
              hideLabel
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
              hideLabel
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
        <div {...surfaceAttributes({ frame: "stroke", edge: "block-end" }, "note-bulk-actions")}>
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
            label={t("{p0} selected", { p0: checkedIds.size })}
            size="caption"
            tone="secondary"
            className="note-select-all"
          />
          <Button
            tone="danger"
            disabled={checkedIds.size === 0 || bulkDeleting}
            onClick={() => setDeleteTargets(notes.filter((note) => checkedIds.has(note.id)))}
          >
            <Trash2 className="icon-sm" />
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
      {filtered ? (
        <div className="flex justify-end px-2 pb-1">
          <Button variant="link" onClick={clearFilters}>
            {t("Clear filters")}
          </Button>
        </div>
      ) : null}
      <div
        ref={listScroller}
        className="min-h-0 flex-1 overflow-hidden flex flex-col"
        onScroll={() => setMenu((current) => (current && "x" in current ? null : current))}
        onContextMenu={(event) => {
          // Rows and headings own their menus; only empty space and the empty state reach here.
          if ((event.target as Element).closest("button, a, input, [role='alert']")) return;
          event.preventDefault();
          openMenu({ kind: "library" }, { x: event.clientX, y: event.clientY });
        }}
      >
        {actionFailure ? (
          <Alert tone="danger" className="">
            {t("Could not load or update notes: ")}
            {actionFailure.message}{" "}
            {actionFailure.retry ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                loading={
                  actionFailure.kind === "create"
                    ? creating
                    : actionFailure.kind === "chat"
                      ? addingToChat
                      : bulkDeleting
                }
                onClick={() => actionFailure.retry?.()}
                className="underline"
              >
                {t("Retry")}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" type="button" onClick={() => setActionFailure(null)}>
              {t("Dismiss")}
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
          <SurfaceLoading className="py-10" title={t("Loading notes…")} />
        ) : (
          <div data-note-library className="min-h-0 flex flex-1 flex-col">
            <ContinuousList
              fill
              className="p-1.5 overscroll-none"
              label={t("Notes")}
              items={libraryRows}
              stateKey={`notes:${JSON.stringify([libraryPreferences.grouping, libraryPreferences.sort, projectFilter, tagFilter])}`}
              itemKey={(row) =>
                row.kind === "heading"
                  ? `group:${row.group.key}`
                  : `note:${row.group.key}:${row.note.id}`
              }
              requiredKey={
                selectedSummary && selectedRowGroup
                  ? `note:${selectedRowGroup.key}:${selectedSummary.id}`
                  : null
              }
              estimateSize={76}
              loading={notesQuery.isFetching || searchingBody}
              error={listError ?? searchError}
              onRetry={() => {
                if (listError) void refresh();
                else setSearchRevision((value) => value + 1);
              }}
              emptyMessage={
                searchingBody
                  ? t("Searching note content…")
                  : filtered
                    ? t("No matching notes")
                    : t("No notes yet. Save a turn from the transcript, or create one here.")
              }
              renderItem={(row) =>
                row.kind === "heading" ? (
                  <div role="listitem">
                    <NoteGroupHeading
                      group={{ ...row.group, totalNotes: row.group.notes.length }}
                      label={
                        row.group.label ||
                        (libraryPreferences.grouping === "project"
                          ? t("No project")
                          : t("Untagged"))
                      }
                      collapsed={collapsedGroups.has(row.group.key)}
                      menuOpen={menu?.target.kind === "group" && menu.target.key === row.group.key}
                      onToggle={() =>
                        setCollapsedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(row.group.key)) next.delete(row.group.key);
                          else next.add(row.group.key);
                          return next;
                        })
                      }
                      onMenu={(place) =>
                        openMenu(
                          {
                            kind: "group",
                            key: row.group.key,
                            label:
                              row.group.label ||
                              (libraryPreferences.grouping === "project"
                                ? t("No project")
                                : t("Untagged")),
                            path: row.group.path,
                          },
                          place,
                        )
                      }
                    />
                  </div>
                ) : (
                  <div role="listitem" className="note-selectable-row">
                    {selectionMode ? (
                      <Checkbox
                        aria-label={t("Select note: {p0}", { p0: row.note.title })}
                        checked={checkedIds.has(row.note.id)}
                        disabled={bulkDeleting}
                        onChange={() => toggleChecked(row.note.id)}
                      />
                    ) : null}
                    <NoteCard
                      note={row.note}
                      group={row.group.key}
                      grouping={libraryPreferences.grouping}
                      sort={libraryPreferences.sort}
                      query={deferredQuery}
                      bodyMatches={
                        bodyMatches?.query === deferredQuery.trim() ? bodyMatches.ids : undefined
                      }
                      active={selectedSummary?.id === row.note.id}
                      logos={logos}
                      mascots={groupMascots}
                      colors={groupColors}
                      customColors={groupCustomColors}
                      onSelect={() => {
                        if (selectionMode) {
                          toggleChecked(row.note.id);
                          return;
                        }
                        setSelectedGroup(row.group.key);
                        setSelectedId(row.note.id);
                        setMobileListVisible(false);
                      }}
                      onNavigate={(event) => navigateNote(event, row.note.id, row.group.key)}
                      menuOpen={menu?.target.kind === "note" && menu.target.id === row.note.id}
                      onMenu={(place) =>
                        openMenu({ kind: "note", id: row.note.id, group: row.group.key }, place)
                      }
                    />
                  </div>
                )
              }
            />
          </div>
        )}
      </div>
      <Sash
        {...resize.sashProps}
        label={t("Resize notes list")}
        appearance="hidden"
        className="absolute inset-y-0 -right-px"
      />
    </div>
  );

  return (
    <Text
      as="div"
      size="inherit"
      tone="primary"
      role="region"
      aria-label={t("Notes")}
      ref={workspaceRef}
      data-app-notes
      data-library-visible={mobileListVisible}
      className="notes-workspace flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <PaneHeader
        dragRegion
        chromeInset={!besideRail ? true : compactRail ? "compact" : false}
        className="select-none"
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        trailing={IS_MAC ? null : <WindowControls />}
      >
        <ToolHeader>
          <Text
            as="div"
            size="secondary"
            tone="inherit"
            className="flex min-w-0 flex-1 items-center gap-2 px-3"
          >
            <File className="icon-sm shrink-0" tone="secondary" strokeWidth={1.75} />
            <Text size="inherit" tone="primary" truncate className="min-w-0">
              {t("Notes")}
            </Text>
          </Text>
        </ToolHeader>
      </PaneHeader>
      <div className="note-mobile-navigation">
        <TabStrip
          label={t("Notes sections")}
          value={mobileListVisible ? "list" : "editor"}
          onValueChange={(value) => setMobileListVisible(value === "list")}
          items={[
            { value: "list", label: t("Notes") },
            { value: "editor", label: t("Editor") },
          ]}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {list}
        <div
          inert={bulkDeleting}
          className="notes-workspace-detail flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {selectedSummary && !visible.some((note) => note.id === selectedSummary.id) ? (
            <Text
              as="div"
              size="caption"
              tone="secondary"
              className="flex flex-wrap items-center gap-2 border-b border-stroke px-5 py-2"
            >
              {t("This note is outside the current filters.")}
              <Button variant="ghost" size="sm" type="button" onClick={clearFilters}>
                {t("Clear filters")}
              </Button>
            </Text>
          ) : null}
          {selected && deferredQuery.trim() ? (
            <Text
              as="div"
              size="caption"
              tone="secondary"
              className="flex flex-wrap items-center gap-2 px-4 py-1"
            >
              {t("Search in this note")}
              <Button
                variant="link"
                onClick={() =>
                  setFindRequest({
                    noteId: selected.id,
                    query: deferredQuery.trim(),
                    token: ++findSequence.current,
                  })
                }
              >
                {t("Find in note")}
              </Button>
            </Text>
          ) : null}
          {detailError ? (
            <Alert tone="danger" className="">
              {t("Could not load or update notes: ")}
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
          {detailLoading && !selected ? (
            <SurfaceLoading className="flex-1" title={t("Loading note…")} />
          ) : (
            <NoteDetail
              findRequest={findRequest}
              onFindHandled={completeFind}
              note={selected}
              availableTags={allTags}
              recents={recents}
              activeCwd={cwd}
              onSaved={onSaved}
              onAddToChat={onAddToChat}
            />
          )}
        </div>
      </div>
      {deleteTargets ? (
        <ConfirmDialog
          key={deleteTargets.map((note) => note.id).join(",")}
          request={{
            title:
              deleteTargets.length === 1
                ? t("Delete note permanently?")
                : t("Delete {p0} notes permanently?", { p0: deleteTargets.length }),
            message: <NoteDeleteDescription targets={deleteTargets} visible={visible} />,
            confirmLabel: t("Confirm delete"),
            onConfirm: async () => {
              const problem = await deleteChecked();
              if (problem) throw new Error(problem);
            },
          }}
          onSettle={() => {
            if (!bulkBusy.current) setDeleteTargets(null);
          }}
        />
      ) : null}
      {menu ? (
        <ContextMenu
          {...("anchor" in menu
            ? { anchor: menu.anchor, side: "bottom" as const, align: "start" as const }
            : { x: menu.x, y: menu.y })}
          ariaLabel={t("Note actions")}
          width={236}
          header={
            <Text as="div" size="caption" tone="secondary" className="min-w-0 px-2 py-1">
              <Text size="inherit" tone="primary" weight="medium" truncate className="block">
                {menu.target.kind === "note"
                  ? menuNote?.title || t("Untitled")
                  : menu.target.kind === "group"
                    ? menu.target.label
                    : t("Notes")}
              </Text>
              {menu.target.kind === "note" && menuNote?.sourceCwd ? (
                <Text size="inherit" tone="inherit" truncate className="block">
                  {projectDisplayName(menuNote.sourceCwd)}
                </Text>
              ) : null}
            </Text>
          }
          items={noteMenuItems(menu.target, {
            openId: selectedId,
            selectionMode,
            checkedIds,
            creating,
            deleting: bulkDeleting,
            collapsed: menu.target.kind === "group" && collapsedGroups.has(menu.target.key),
            scopeLabel: createScopeLabel(defaultCreateScope()),
          })}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Text>
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
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {project}
      </Text>
    </span>
  );
}

function NoteCard({
  note,
  group,
  grouping,
  sort,
  query,
  bodyMatches,
  active,
  logos,
  mascots,
  colors,
  customColors,
  onSelect,
  onNavigate,
  menuOpen,
  onMenu,
}: {
  note: NoteSummary;
  group: string;
  grouping: NoteGrouping;
  sort: NoteSort;
  query: string;
  bodyMatches?: ReadonlySet<string>;
  active: boolean;
  onSelect: () => void;
  onNavigate: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  menuOpen: boolean;
  onMenu: (place: MenuPlace) => void;
} & ProjectMarks) {
  useLocale();
  const date = noteLibraryDate(note, sort);
  const validDate = Number.isFinite(date.timestamp) && date.timestamp > 0;
  const time = validDate ? formatRelativeTime(new Date(date.timestamp).toISOString()) : "";
  const project = noteSourceProject(note.sourceCwd);
  const match = noteLibraryMatchLocation(note, query, bodyMatches);
  const hint = [note.title, note.sourceCwd || project, ...note.tags].filter(Boolean).join(" · ");
  return (
    <ActionHost selected={active} className="min-w-0 flex-1 items-start">
      {/* The tag badges hold their own "+N" button, which cannot sit inside the row button: the tag
        line is a sibling laid over the row (clicks outside the badges fall through to the row)
        and the row keeps the line's height. It also holds the gutter the row actions cover. */}
      <div className="relative min-w-0 flex-1">
        <Button
          data-action-primary=""
          variant="item"
          layout="stacked"
          motion="none"
          tooltip={hint}
          aria-current={active ? "true" : undefined}
          aria-haspopup="menu"
          data-note-id={note.id}
          data-note-group={group}
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (isMenuKey(event)) {
              event.preventDefault();
              onMenu({ anchor: event.currentTarget });
            } else onNavigate(event);
          }}
          className="w-full min-w-0"
        >
          <ClampText
            as="span"
            lines={2}
            expandable={false}
            size="secondary"
            tone="inherit"
            weight="medium"
            className="min-w-0 wrap-anywhere"
          >
            {note.title || t("Untitled")}
          </ClampText>
          <ClampText as="span" lines={1} expandable={false} size="caption" tone="secondary">
            {match === "content" ? t("Match in note") : note.preview || t("No preview")}
          </ClampText>
          <Text
            size="micro"
            tone="secondary"
            className="flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden"
          >
            {grouping !== "project" && project && note.sourceCwd ? (
              <Text size="inherit" tone="inherit" truncate className="min-w-0 max-w-full">
                <NoteProjectMark
                  cwd={note.sourceCwd}
                  logos={logos}
                  mascots={mascots}
                  colors={colors}
                  customColors={customColors}
                />
              </Text>
            ) : null}
            {time ? (
              <Timestamp
                value={date.timestamp}
                format="relative"
                prefix={t(date.label)}
                className="shrink-0"
              />
            ) : null}
            {!note.preview ? <span className="sr-only">{t("No preview")}</span> : null}
            {/* Empty trailing gutter: the row actions sit over it, so the title, preview and meta never move. */}
            {note.tags.length ? null : (
              <span data-action-yield="" aria-hidden="true" className="ms-auto shrink-0" />
            )}
          </Text>
          {note.tags.length ? <span aria-hidden="true" className="mt-1 block h-4" /> : null}
        </Button>
        {note.tags.length ? (
          <div className="pointer-events-none absolute inset-x-[calc(var(--space-3)+1px)] bottom-[calc(var(--space-2)+1px)] flex h-4 items-center gap-2">
            <BadgeList
              label={t("Tags")}
              size="xs"
              items={note.tags.map((tag) => ({ id: tag, label: `#${tag}` }))}
              className="pointer-events-auto"
            />
            <span data-action-yield="" aria-hidden="true" className="ms-auto shrink-0" />
          </div>
        ) : null}
      </div>
      <div
        data-action-slot="collapse"
        data-action-anchor="end"
        className="flex shrink-0 items-center"
      >
        <InlineAction
          label={t("Actions for {p0}", { p0: note.title || t("Untitled") })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu({ anchor: event.currentTarget })}
        >
          <MoreHorizontal className="icon-sm" />
        </InlineAction>
      </div>
    </ActionHost>
  );
}

type MenuPlace = { x: number; y: number } | { anchor: HTMLElement };
/** The keyboard routes to a context menu: the Menu key and Shift+F10. */
function isMenuKey(event: ReactKeyboardEvent) {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/** A project or tag group's heading: expand/collapse, with the group's own actions beside it. */
function NoteGroupHeading({
  group,
  label,
  collapsed,
  menuOpen,
  onToggle,
  onMenu,
}: {
  group: { key: string; path?: string; totalNotes: number };
  label: string;
  collapsed: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onMenu: (place: MenuPlace) => void;
}) {
  useLocale();
  return (
    <SectionLabel
      collapsible
      expanded={!collapsed}
      onExpandedChange={onToggle}
      count={group.totalNotes}
      className="note-group-heading mt-1"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (!isMenuKey(event)) return;
        event.preventDefault();
        onMenu({
          anchor: event.target instanceof HTMLElement ? event.target : event.currentTarget,
        });
      }}
      actions={
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Actions for {p0}", { p0: label })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu({ anchor: event.currentTarget })}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
      }
    >
      {group.path ? (
        <Tooltip label={group.path}>
          <span>{label}</span>
        </Tooltip>
      ) : (
        label
      )}
    </SectionLabel>
  );
}

function NoteDetail({
  note,
  availableTags,
  recents,
  activeCwd,
  onSaved,
  onAddToChat,
  findRequest,
  onFindHandled,
}: {
  note: Note | null;
  availableTags: string[];
  recents: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onAddToChat: (note: Note, targetCwd?: string) => void;
  findRequest?: NoteFindRequest;
  onFindHandled?: (token: number) => void;
}) {
  useLocale();
  if (!note) {
    return (
      <EmptyState icon={<File />} description={t("Select a note")} className="min-w-0 flex-1" />
    );
  }
  return (
    <NoteEditor
      key={note.id}
      note={note}
      availableTags={availableTags}
      recents={recents}
      activeCwd={activeCwd}
      onSaved={onSaved}
      onAddToChat={onAddToChat}
      findRequest={findRequest}
      onFindHandled={onFindHandled}
    />
  );
}

function NoteEditor({
  note,
  availableTags,
  recents,
  activeCwd,
  onSaved,
  onAddToChat,
  findRequest,
  onFindHandled,
}: {
  note: Note;
  availableTags: string[];
  recents: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onAddToChat: (note: Note, targetCwd?: string) => void;
  findRequest?: NoteFindRequest;
  onFindHandled?: (token: number) => void;
}) {
  useLocale();
  const modesId = useId();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [previewEditing, setPreviewEditing] = useState(false);
  // Mode, narrow-pane routing and toolbar target; find and image insertion read
  // the committed values through its refs.
  const {
    detailRef,
    narrow,
    mode,
    visibleMode,
    modeRef,
    setMode,
    showSource,
    toolbarTarget,
    setToolbarTarget,
    toolbarTargetRef,
  } = useNoteEditorMode(note.id, previewEditing);
  const blank = !note.body.trim() && note.title === "Untitled";
  const [draftState] = useState(() => {
    const existing = drafts.get(note.id);
    // Reuse even a clean logical record: StrictMode can invoke this initializer
    // twice, and a second disposable record must not replace the live owner.
    const draft: Draft = existing ?? {
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
  const [tagPublication, setTagPublication] = useState<{
    value: string[];
    proof?: NativeInputPublication;
  } | null>(null);
  const [bodyPublication, setBodyPublication] = useState<{
    value: string;
    proof?: NativeInputPublication;
  } | null>(null);
  const inputOwner = draftInputOwner(draftState);
  const preparing = useNotePreparing(inputOwner);
  useNoteExternal(inputOwner, note);
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
  const editsRef = draftState.edits;
  const bodyRef = useRef(body);
  const projectChangeRef = draftState.project;
  const noteRef = useRef(note);
  const titleFieldRef = useRef<HTMLInputElement>(null);
  const finalizeRef = useRef<{ title: string } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const previewViewRef = useRef<EditorView | null>(null);
  const previewRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const recoveringRef = useRef(false);
  const [saveAction, setSaveAction] = useState<"save" | "retry" | null>(null);
  const saveActionRef = useRef<"save" | "retry" | null>(null);
  const skipSave = draftState.skipSave;
  const saveTimer = useRef<number | null>(null);
  const saveTimerWork = useRef<NoteInputWork | null>(null);
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
  // Picker, preview paste, DOM and native drops; the draft owner applies the body.
  const { imageBusy, dropZoneRef, dropZoneHandlers, insertImage, pasteImages, onPreviewPaste } =
    useNoteImageInsertion({
      noteId: note.id,
      inputOwner,
      draftState,
      bodyRef,
      modeRef,
      toolbarTargetRef,
      editorViewRef,
      previewViewRef,
      previewRangeRef,
      onInserted: (value) => {
        editNote({ body: value });
        setSaveError(null);
        scheduleSave();
      },
      onError: setSaveError,
    });
  useNoteTextInput(inputOwner, "title", titleFieldRef);
  useNoteInputState(inputOwner, "library-state", {
    mode: visibleMode,
    previewEditing,
    previewRange: previewRangeRef.current,
    saving,
    recovering,
    imageBusy,
    finalize: finalizeRef.current,
  });
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

  const editNote = useCallback(
    (change: Edits) => {
      if (!inputOwner.allowed()) return;
      const next = { ...editsRef.current, ...change };
      editsRef.current = next;
      if (change.body !== undefined) bodyRef.current = change.body;
      if (change.tags !== undefined)
        setTagPublication({
          value: change.tags,
          proof: inputOwner.publishControl("tags", change.tags),
        });
      if (change.body !== undefined)
        setBodyPublication({
          value: change.body,
          proof: inputOwner.publishControl("source", change.body),
        });
      setEdits(next);
      inputOwner.changed();
    },
    [inputOwner],
  );

  const persist = useCallback(async (latest?: Note, parent?: NoteInputWork) => {
    if (skipSave.current || draftState.unadmittedInputs?.length) return;
    const current = latest ?? draftState.saved ?? noteRef.current;
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
      const publishedTags = remaining.tags ?? saved.tags;
      setTagPublication({
        value: publishedTags,
        proof: inputOwner.publishControl("tags", publishedTags, parent),
      });
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
      if (parent) parent.apply(() => acceptSaved(current));
      else acceptSaved(current);
      return current;
    }
    setSaving(true);
    try {
      const saved = await upsertNote(
        {
          id: current.id,
          expectedUpdatedAt: current.updatedAt,
          title: nextTitle,
          body: nextBody,
          tags: nextTags,
          ...(finalizeSlug ? { finalizeSlug: true } : {}),
          ...(nextProject ? { sourceCwd: nextProject.path } : {}),
        },
        parent,
      );
      const publish = () => {
        if (finalizeSlug && finalizeRef.current === finalizeRequest) finalizeRef.current = null;
        acceptSaved(saved);
        onSavedRef.current(saved);
      };
      if (parent) parent.apply(publish);
      else publish();
      return saved;
    } catch (err: unknown) {
      const failed = () => setSaveError(err instanceof Error ? err.message : String(err));
      if (parent) parent.apply(failed);
      else failed();
      return current;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveNow = useCallback(
    (parent?: NoteInputWork) => {
      const delayed = saveTimerWork.current;
      if (draftState.unadmittedInputs?.length) {
        if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        saveTimerWork.current = null;
        delayed?.();
        return Promise.resolve();
      }
      const work = inputOwner.operation("save-request", parent ?? delayed ?? undefined);
      if (!work) {
        if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
        return Promise.resolve();
      }
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      saveTimerWork.current = null;
      return enqueueNoteSave(note.id, persist, work)
        .catch((error) => setSaveError(String(error)))
        .finally(() => {
          delayed?.();
          work();
        });
    },
    [note.id, persist, inputOwner],
  );

  const saveFromAction = async (action: "save" | "retry") => {
    if (saving || recovering || saveActionRef.current) return;
    const work = inputOwner.operation(action);
    if (!work) {
      if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
      return;
    }
    saveActionRef.current = action;
    setSaveAction(action);
    try {
      await saveNow(work);
    } finally {
      saveActionRef.current = null;
      setSaveAction(null);
      work();
    }
  };

  const scheduleSave = useCallback(() => {
    const work = inputOwner.operation("autosave-delay");
    if (!work) {
      if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
      return;
    }
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimerWork.current?.();
    saveTimerWork.current = work;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow(work);
    }, 400);
  }, [saveNow, inputOwner]);

  useNoteFindRequest({
    findRequest,
    noteId: note.id,
    narrow,
    mode,
    showSource,
    editorViewRef,
    onFindHandled,
  });

  useEffect(() => {
    draftState.mounts = (draftState.mounts ?? 0) + 1;
    inputOwner.changed();
    return () => {
      draftState.mounts = Math.max(0, (draftState.mounts ?? 1) - 1);
      inputOwner.external(() => {});
      if (inputOwner.closed() && !saveTimerWork.current) {
        pruneDraft(note.id, draftState);
        return;
      }
      if (noteRef.current.slugPending) {
        finalizeRef.current = {
          title:
            (editsRef.current.title ?? noteRef.current.title).trim() || noteTitle(bodyRef.current),
        };
      }
      void saveNow().finally(() => pruneDraft(note.id, draftState));
    };
  }, [saveNow, draftState, note.id, inputOwner]);

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
        {...noteInputBudgetHandlers(inputOwner, (field) =>
          field.getAttribute("aria-label") === t("Add note tag")
            ? "tags"
            : field.getAttribute("aria-label") === t("Note title")
              ? "title"
              : undefined,
        )}
        className="note-detail-content"
        allowNotes={false}
        cwd={sourceCwd ?? undefined}
        contentVersion={body}
      >
        <header className="note-detail-header">
          <div className="note-detail-titlerow">
            <TextField
              label={t("Note title")}
              appearance="quiet"
              fieldVariant="compact"
              error={titleError}
              hideLabel
              ref={titleFieldRef}
              value={title}
              onChange={(event) => {
                const value = event.target.value;
                if (!inputOwner.allowed() || !inputOwner.canRetainText("title", value)) {
                  inputOwner.external(() => {
                    draftState.unadmittedInputs = [
                      ...new Set([...(draftState.unadmittedInputs ?? []), "title"]),
                    ];
                    editsRef.current = { ...editsRef.current, title: value };
                    setEdits(editsRef.current);
                    setSaveError(
                      t(
                        "This input was not admitted. Your text is retained; open the note to edit it.",
                      ),
                    );
                  });
                  return;
                }
                draftState.unadmittedInputs = draftState.unadmittedInputs?.filter(
                  (key) => key !== "title",
                );
                finalizeRef.current = null;
                editNote({ title: value });
                scheduleSave();
              }}
              onBlur={() => {
                if (!inputOwner.allowed() || draftState.unadmittedInputs?.includes("title")) return;
                const next = title.trim() || noteTitle(body);
                if (next !== title) editNote({ title: next });
                if (noteRef.current.slugPending) finalizeRef.current = { title: next };
                void saveNow();
              }}
              onKeyDown={onTitleKeyDown}
              readOnly={preparing}
              fieldClassName="note-detail-title"
              textSize="title"
              weight="medium"
              leading="snug"
              placeholder={t("Untitled")}
            />
            <div className="note-detail-actions">
              {preparing ? (
                <LoadingText>{t("Preparing checkpoint…")}</LoadingText>
              ) : (
                <NoteSaveStatus
                  state={noteSaveState({
                    deleting: false,
                    saveError,
                    titleError,
                    recovering,
                    saving: Boolean(saving || saveAction),
                    dirty,
                  })}
                />
              )}
              <NoteChatAction
                projectCwd={sourceCwd ?? activeCwd}
                recents={recents}
                disabled={!canAddToChat}
                onAdd={(targetCwd) => onAddToChat(draft, targetCwd)}
              />
              <Button
                variant="ghost"
                iconOnly
                label={t("Details")}
                ref={actionsButton}
                aria-haspopup="dialog"
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((open) => !open)}
              >
                <MoreHorizontal className="icon-sm" />
              </Button>
              {actionsOpen ? (
                <Popover
                  anchor={actionsButton}
                  align="end"
                  width={340}
                  role="dialog"
                  aria-label={t("Details")}
                  onDismiss={() => setActionsOpen(false)}
                  autoFocus
                  className="note-details-popover"
                >
                  <Text as="div" weight="medium" className="note-details-title wrap-anywhere">
                    {title.trim() || note.title || t("Untitled")}
                  </Text>
                  <DescriptionList size="sm">
                    <DescriptionItem term={t("Project")} truncate tooltip={sourceCwd ?? undefined}>
                      {sourceCwd ? projectDisplayName(sourceCwd) : t("No project")}
                    </DescriptionItem>
                    {note.slug ? (
                      <DescriptionItem term={t("File")} truncate monospace>
                        {`${note.slug}.md`}
                      </DescriptionItem>
                    ) : null}
                    <DescriptionItem term={t("Tags")}>
                      {tags.length ? tags.map((tag) => `#${tag}`).join(" ") : t("None")}
                    </DescriptionItem>
                    <DescriptionItem term={t("Created")}>
                      {formatDate(note.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </DescriptionItem>
                    <DescriptionItem term={t("Updated")}>
                      {formatDate(note.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
                      {time ? ` · ${time}` : ""}
                    </DescriptionItem>
                  </DescriptionList>
                </Popover>
              ) : null}
            </div>
          </div>
          <Text
            as="div"
            size="caption"
            tone="secondary"
            leading="inherit"
            className="note-detail-meta"
          >
            <div className="flex min-w-0 items-center gap-1" aria-label={t("Note project")}>
              <SearchableProjectPicker
                cwd={sourceCwd ?? "~"}
                recents={recents}
                mode="move"
                railCwd={activeCwd}
                buttonClassName="px-1.5"
                onSelectProject={(path) => {
                  if (!inputOwner.allowed()) return;
                  const change = { path };
                  projectChangeRef.current = change;
                  setProjectChange(change);
                  inputOwner.changed();
                  void saveNow();
                }}
              />
            </div>
            <div className="note-detail-tags">
              <NoteTagsEditor
                availableTags={availableTags}
                inputObserver={inputOwner.observer("tags")}
                inputPublication={
                  tagPublication?.value === tags
                    ? tagPublication.proof
                    : inputOwner.resultControlPublication(note, "tags", tags)
                }
                tags={tags}
                onChange={(next) => {
                  if (!inputOwner.allowed()) return;
                  editNote({ tags: next });
                  scheduleSave();
                }}
              />
            </div>
            <Text size="caption" tone="muted" leading="inherit" className="note-detail-words">
              <NoteWordCount body={body} />
            </Text>
          </Text>
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
                loading={saveAction === "retry"}
                disabled={recovering || (saving && saveAction !== "retry")}
                onClick={() => void saveFromAction("retry")}
                className="shrink-0 underline hover:no-underline"
              >
                {t("Retry")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={recovering}
                disabled={saving}
                onClick={async () => {
                  if (recoveringRef.current) return;
                  const work = inputOwner.operation("recovery-copy");
                  if (!work) {
                    if (!inputOwner.closed()) setSaveError(noteInputWorkError(inputOwner).message);
                    return;
                  }
                  recoveringRef.current = true;
                  setRecovering(true);
                  try {
                    const submittedEdits = { ...editsRef.current };
                    const submittedProject = projectChangeRef.current;
                    await createRecoveredNote({ title, body, tags, sourceCwd }, work);
                    const remaining = { ...editsRef.current };
                    if (remaining.title === submittedEdits.title) delete remaining.title;
                    if (remaining.body === submittedEdits.body) delete remaining.body;
                    if (remaining.tags === submittedEdits.tags) delete remaining.tags;
                    editsRef.current = remaining;
                    bodyRef.current = remaining.body ?? noteRef.current.body;
                    setEdits(remaining);
                    if (projectChangeRef.current === submittedProject) {
                      projectChangeRef.current = null;
                      setProjectChange(null);
                    }
                    setSaveError(null);
                    window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
                  } catch (error) {
                    setSaveError(error instanceof Error ? error.message : String(error));
                  } finally {
                    recoveringRef.current = false;
                    setRecovering(false);
                    work();
                  }
                }}
              >
                {t("Save as new note")}
              </Button>
            </Alert>
          ) : null}
        </header>
        <Tabs
          value={visibleMode}
          onValueChange={(next) => setMode(next as typeof mode)}
          panels="shared"
          id={modesId}
        >
          <div className="note-editor-toolbar">
            <TabList label={t("Note sections")}>
              <Tab value="preview">{t("Document")}</Tab>
              <Tab value="source">{t("Source")}</Tab>
              {narrow ? null : <Tab value="split">{t("Split")}</Tab>}
            </TabList>
            <NoteMarkdownToolbar
              viewRef={
                visibleMode === "preview"
                  ? previewViewRef
                  : visibleMode === "source"
                    ? editorViewRef
                    : previewEditing && toolbarTarget === "preview"
                      ? previewViewRef
                      : editorViewRef
              }
              editing={editing}
              imageBusy={imageBusy}
              onInsertImage={() => void insertImage()}
            />
          </div>
          <TabPanel
            ref={dropZoneRef}
            tabIndex={undefined}
            data-external-drop-owner="note-images"
            aria-busy={imageBusy}
            {...motionAttributes(
              { transition: "colors", duration: "standard" },
              "note-editor-body relative rounded-(--ui-radius-card) border border-(--ui-card-border)",
            )}
            {...dropZoneHandlers}
          >
            <div className={visibleMode === "split" ? "note-layout note-split" : "note-layout"}>
              {/* Stays mounted in preview so undo history survives the switch. */}
              <NoteEditorPane
                label={t("Source")}
                scrollKey={`${note.id}:source`}
                hidden={visibleMode === "preview"}
                split={visibleMode === "split"}
              >
                <NoteMarkdownEditor
                  inputObserver={inputOwner.observer("source")}
                  inputPublication={
                    bodyPublication?.value === body
                      ? bodyPublication.proof
                      : inputOwner.resultControlPublication(note, "source", body)
                  }
                  viewRef={editorViewRef}
                  minHeight={0}
                  autoFocus={blank && visibleMode === "source"}
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
              <NoteEditorPane
                label={t("Document")}
                document
                scrollKey={`${note.id}:document`}
                hidden={visibleMode === "source"}
                split={visibleMode === "split"}
              >
                <NoteEditablePreview
                  stateObserver={inputOwner.observer("preview-state")}
                  inputObserver={inputOwner.observer("preview-block")}
                  canMutate={inputOwner.allowed}
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
            </div>
          </TabPanel>
        </Tabs>
      </SurfaceSelection>
    </div>
  );
}
