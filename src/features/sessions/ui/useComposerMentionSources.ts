import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../files/public/fileIndex";
import { buildMentionIndex, rankMentionFiles } from "../../files/public/fileMentions";
import { projectFilesTruncated, type ProjectFile } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/public/recents";
import {
  loadNoteSummaries,
  notesAsProjectFiles,
  NOTES_MENTION_SCOPE,
  peekNoteSummaries,
  rankNoteFiles,
  type NoteSummary,
} from "../../notes";
import { useComposerCrewMentions } from "./useComposerCrewMentions";
import { useComposerWorkItemMentions } from "./useComposerWorkItemMentions";
import {
  loadServerMentionInventory,
  parseServerMentionQuery,
  serverMentionOf,
  serverMentionRows,
} from "../model/serverMentions";
import { CREWS_MENTION_SCOPE } from "../model/crewMentions";
import {
  composerMentionScope,
  composerMentionScopeHint,
  scopedNoteMentionLabel,
} from "../model/composerMentionScopes";

type ScopedProjectFiles = { cwd: string; files: ProjectFile[] };

const NO_FILES: ProjectFile[] = [];
const NO_NOTES: NoteSummary[] = [];

/** A file list read for another directory is never shown for this one. */
export function visibleProjectFiles(state: ScopedProjectFiles, cwd: string): ProjectFile[] {
  return state.cwd === cwd ? state.files : NO_FILES;
}

export type ProjectIndexNotice = "incomplete" | "unknown";

/**
 * Whether a loaded index may be missing files. An empty list is "not loaded or
 * nothing to index", never a notice; a Host that does not report completeness
 * is "unknown", matching the file picker.
 */
export function projectIndexNotice(files: ProjectFile[]): ProjectIndexNotice | undefined {
  if (files.length === 0) return undefined;
  const truncated = projectFilesTruncated(files);
  if (truncated === false) return undefined;
  return truncated ? "incomplete" : "unknown";
}

/**
 * Read-only project file index for `@` mentions. The scope is the execution
 * directory: a load or subscription callback from a previous directory, or from
 * an effect that already cleaned up, cannot replace the current list.
 */
export function useComposerProjectFiles(input: {
  cwd: string;
  remote: boolean;
  /** An open mention menu refreshes a local index. */
  mentionOpen: boolean;
}): { files: ProjectFile[]; failed: boolean; retry: () => void } {
  const { cwd, remote, mentionOpen } = input;
  const [state, setState] = useState<ScopedProjectFiles>(() => ({
    cwd,
    files: peekProjectFiles(cwd) ?? NO_FILES,
  }));
  const [failedCwd, setFailedCwd] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retryCwd = useRef<string | null>(null);
  const retry = () => {
    retryCwd.current = cwd;
    setAttempt((count) => count + 1);
  };

  useEffect(() => {
    let cancelled = false;
    const apply = (files: ProjectFile[]) => {
      if (cancelled) return;
      setState({ cwd, files });
      setFailedCwd(null);
    };
    const forceRefresh = retryCwd.current === cwd;
    retryCwd.current = null;
    apply(peekProjectFiles(cwd) ?? NO_FILES);
    if (!cwd) return;
    void loadProjectFiles(cwd, forceRefresh || (mentionOpen && !remote))
      .then(apply)
      .catch((error) => {
        console.warn("Composer operation failed", error);
        if (!cancelled) setFailedCwd(cwd);
      });
    const unsubscribe = subscribeProjectFiles(() => {
      const next = peekProjectFiles(cwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [attempt, cwd, mentionOpen, remote]);

  return { files: visibleProjectFiles(state, cwd), failed: failedCwd === cwd, retry };
}

/**
 * Read-only Notes summaries for `@` mentions. They load only while the mention
 * menu can show them, and a read that finishes after that stops is dropped.
 */
function useComposerNotes(active: boolean): NoteSummary[] | null {
  const [notes, setNotes] = useState<NoteSummary[] | null>(() => peekNoteSummaries() ?? null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadNoteSummaries()
      .then((next) => {
        if (!cancelled) setNotes(next);
      })
      .catch((error) => {
        console.warn("Loading composer notes failed", error);
        if (!cancelled) setNotes((current) => current ?? NO_NOTES);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return notes;
}

/** Mention catalogs and their ranking; draft text and tokens stay with the Composer. */
export function useComposerMentionSources(input: {
  executionCwd: string;
  indexFiles: boolean;
  remote: boolean;
  notesEnabled: boolean;
  mentionOpen: boolean;
  mentionQuery: string;
}) {
  const { executionCwd, indexFiles, remote, notesEnabled, mentionOpen, mentionQuery } = input;
  const {
    files,
    failed: filesFailed,
    retry: retryFiles,
  } = useComposerProjectFiles({ cwd: indexFiles ? executionCwd : "", remote, mentionOpen });
  const notesAvailable = !remote && notesEnabled;
  const loadedNotes = useComposerNotes(notesAvailable && mentionOpen);
  const notes = loadedNotes ?? NO_NOTES;
  const scope = composerMentionScope(mentionQuery);
  const serversScoped = parseServerMentionQuery(mentionQuery) !== null;
  const [servers, setServers] = useState<Awaited<
    ReturnType<typeof loadServerMentionInventory>
  > | null>(null);
  const [serverFailedAt, setServerFailedAt] = useState<number | null>(null);
  const [serverAttempt, setServerAttempt] = useState(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the local picker with desktop SSH inventory while the menu is open.
  useEffect(() => {
    if (remote || !mentionOpen) return;
    let cancelled = false;
    void loadServerMentionInventory()
      .then((inventory) => {
        if (cancelled) return;
        setServers(inventory);
        setServerFailedAt(null);
      })
      .catch(() => {
        if (cancelled) return;
        setServers(null);
        setServerFailedAt(serverAttempt);
      });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, remote, serverAttempt]);
  const serversFailed = serverFailedAt === serverAttempt;
  const workItems = useComposerWorkItemMentions({
    cwd: executionCwd,
    active: mentionOpen && !serversScoped && !scope,
    query: mentionQuery,
  });
  const {
    rows: crewHits,
    available: crewsAvailable,
    loading: crewsLoading,
  } = useComposerCrewMentions({
    cwd: executionCwd,
    active: mentionOpen && !serversScoped && !workItems.scoped && scope !== NOTES_MENTION_SCOPE,
    query: scope === CREWS_MENTION_SCOPE ? mentionQuery.slice(scope.length) : mentionQuery,
  });
  const noteFiles = notesAvailable ? notesAsProjectFiles(notes) : [];
  const mentionIndex = buildMentionIndex([...files, ...noteFiles]);
  for (const note of noteFiles) {
    mentionIndex.labels.set(scopedNoteMentionLabel(note.relative), note);
  }
  const deferredMentionQuery = useDeferredValue(mentionQuery);
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const crews = crewHits.filter((row) => row.crew.kind === "crew");
    const members = crewHits.filter((row) => row.crew.kind === "member");
    if (scope === CREWS_MENTION_SCOPE) return [...crews, ...members];
    if (scope === NOTES_MENTION_SCOPE) {
      return notesAvailable ? rankNoteFiles(notes, mentionQuery.slice(scope.length)) : [];
    }
    const serverHits = remote || !servers ? [] : serverMentionRows(mentionQuery, servers);
    if (serversScoped) return serverHits;
    if (workItems.scoped) return workItems.rows;
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(files, deferredMentionQuery, recentOpenedFiles(executionCwd))
      : [];
    const noteHits = notesAvailable ? rankNoteFiles(notes, deferredMentionQuery) : [];
    return [
      ...workItems.rows,
      ...composerMentionScopeHint(CREWS_MENTION_SCOPE, mentionQuery, crewsAvailable),
      ...crews,
      ...composerMentionScopeHint(NOTES_MENTION_SCOPE, mentionQuery, notesAvailable),
      ...noteHits,
      ...members,
      ...serverHits,
      ...fileHits.filter((file) => file.isDir),
      ...fileHits.filter((file) => !file.isDir),
    ];
  }, [
    crewHits,
    crewsAvailable,
    executionCwd,
    files,
    deferredMentionQuery,
    mentionOpen,
    mentionQuery,
    notes,
    notesAvailable,
    remote,
    scope,
    servers,
    serversScoped,
    workItems.rows,
    workItems.scoped,
  ]);
  const filesScopedOut = Boolean(scope || workItems.scoped || serversScoped);
  return {
    mentionIndex,
    rankedFiles,
    filesFailed: !filesScopedOut && filesFailed,
    // Work-item and crew rows do not come from the file index.
    filesIndexNotice:
      !filesScopedOut && looksLikeProject(executionCwd) ? projectIndexNotice(files) : undefined,
    retryFiles,
    scope,
    scopeLoading:
      scope === CREWS_MENTION_SCOPE
        ? crewsLoading
        : scope === NOTES_MENTION_SCOPE && notesAvailable && loadedNotes === null,
    workItemsLoading: workItems.loading,
    workItemsScoped: workItems.scoped,
    workItemsAvailable: workItems.available,
    workItemsFailure: workItems.failure,
    serversScoped,
    serversAvailable: rankedFiles.some(serverMentionOf),
    serversLoading: serversScoped && !remote && !serversFailed && servers === null,
    serversFailed: serversScoped && !remote && serversFailed,
    retryServers: () => setServerAttempt((count) => count + 1),
  };
}
