import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../files/public/fileIndex";
import { buildMentionIndex, rankMentionFiles } from "../../files/public/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/public/recents";
import {
  loadNoteSummaries,
  notesAsProjectFiles,
  peekNoteSummaries,
  rankNoteFiles,
  type NoteSummary,
} from "../../notes";
import { useComposerCrewMentions } from "./useComposerCrewMentions";

type ScopedProjectFiles = { cwd: string; files: ProjectFile[] };

const NO_FILES: ProjectFile[] = [];
const NO_NOTES: NoteSummary[] = [];

/** A file list read for another directory is never shown for this one. */
export function visibleProjectFiles(state: ScopedProjectFiles, cwd: string): ProjectFile[] {
  return state.cwd === cwd ? state.files : NO_FILES;
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
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

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
  const crewHits = useComposerCrewMentions({
    cwd: executionCwd,
    active: mentionOpen,
    query: mentionQuery,
  });
  const mentionFiles = useMemo(
    () => (!remote && notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files),
    [files, notes, notesEnabled, remote],
  );
  const mentionIndex = useMemo(() => buildMentionIndex(mentionFiles), [mentionFiles]);
  const deferredMentionQuery = useDeferredValue(mentionQuery);
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(files, deferredMentionQuery, recentOpenedFiles(executionCwd))
      : [];
    const noteHits = !remote && notesEnabled ? rankNoteFiles(notes, deferredMentionQuery) : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [...crewHits, ...noteHits, ...fileHits.filter((file) => !seen.has(file.path))];
  }, [
    crewHits,
    executionCwd,
    files,
    deferredMentionQuery,
    mentionOpen,
    notes,
    notesEnabled,
    remote,
  ]);
  return { mentionIndex, rankedFiles, filesFailed, retryFiles };
}
