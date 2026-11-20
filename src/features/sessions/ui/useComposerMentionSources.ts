import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
  const retry = () => setAttempt((count) => count + 1);

  useEffect(() => {
    let cancelled = false;
    const apply = (files: ProjectFile[]) => {
      if (cancelled) return;
      setState({ cwd, files });
      setFailedCwd(null);
    };
    apply(peekProjectFiles(cwd) ?? NO_FILES);
    if (!cwd) return;
    void loadProjectFiles(cwd, mentionOpen && !remote)
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
export function useComposerNotes(active: boolean): NoteSummary[] {
  const [notes, setNotes] = useState<NoteSummary[]>(() => peekNoteSummaries() ?? NO_NOTES);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadNoteSummaries()
      .then((next) => {
        if (!cancelled) setNotes(next);
      })
      .catch((error) => console.warn("Loading composer notes failed", error));
    return () => {
      cancelled = true;
    };
  }, [active]);

  return notes;
}

/** Mention catalogs and their ranking; draft text and tokens stay with the Composer. */
export function useComposerMentionSources(input: {
  executionCwd: string;
  remote: boolean;
  notesEnabled: boolean;
  mentionOpen: boolean;
  mentionQuery: string;
}) {
  const { executionCwd, remote, notesEnabled, mentionOpen, mentionQuery } = input;
  const {
    files,
    failed: filesFailed,
    retry: retryFiles,
  } = useComposerProjectFiles({ cwd: executionCwd, remote, mentionOpen });
  const notes = useComposerNotes(!remote && mentionOpen && notesEnabled);
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
    active: mentionOpen && !serversScoped,
    query: mentionQuery,
  });
  const crewHits = useComposerCrewMentions({
    cwd: executionCwd,
    active: mentionOpen && !serversScoped,
    query: mentionQuery,
  });
  const mentionFiles = !remote && notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files;
  const mentionIndex = buildMentionIndex(mentionFiles);
  const deferredMentionQuery = useDeferredValue(mentionQuery);
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const serverHits = remote || !servers ? [] : serverMentionRows(mentionQuery, servers);
    if (serversScoped) return serverHits;
    if (workItems.scoped) return workItems.rows;
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(files, deferredMentionQuery, recentOpenedFiles(executionCwd))
      : [];
    const noteHits = !remote && notesEnabled ? rankNoteFiles(notes, deferredMentionQuery) : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [
      ...crewHits,
      ...serverHits,
      ...workItems.rows,
      ...noteHits,
      ...fileHits.filter((file) => !seen.has(file.path)),
    ];
  }, [
    crewHits,
    executionCwd,
    files,
    deferredMentionQuery,
    mentionOpen,
    mentionQuery,
    notes,
    notesEnabled,
    remote,
    servers,
    serversScoped,
    workItems.rows,
    workItems.scoped,
  ]);
  return {
    mentionIndex,
    rankedFiles,
    filesFailed: !workItems.scoped && !serversScoped && filesFailed,
    // Work-item and crew rows do not come from the file index.
    filesIndexNotice:
      !workItems.scoped && !serversScoped && looksLikeProject(executionCwd)
        ? projectIndexNotice(files)
        : undefined,
    retryFiles,
    workItemsLoading: workItems.loading,
    workItemsScoped: workItems.scoped,
    workItemsAvailable: workItems.available,
    serversScoped,
    serversAvailable: rankedFiles.some(serverMentionOf),
    serversLoading: serversScoped && !remote && !serversFailed && servers === null,
    serversFailed: serversScoped && !remote && serversFailed,
    retryServers: () => setServerAttempt((count) => count + 1),
  };
}
