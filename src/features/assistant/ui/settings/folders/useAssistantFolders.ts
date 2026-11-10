import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../../../shared/i18n";
import type { AssistantFoldersResponse } from "../../../../../shared/model/assistantFolders";
import type { assistantRequest } from "../../../model/assistantClient";

type OwnerRequest = typeof assistantRequest;
export type FoldersDraftState = { dirty: boolean; pending: boolean };
export type FoldersDraft = { paths: string[]; runWithoutAsking: boolean };

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const fromSaved = (saved: AssistantFoldersResponse): FoldersDraft => ({
  paths: saved.folders.map((folder) => folder.path),
  runWithoutAsking: saved.runWithoutAsking,
});

/**
 * The Assistant folders' own draft, version and save. A saved list is confirmed by the Host's
 * response (it returns canonical paths), never inferred from the draft. Only the owner's request
 * writes it; the Room and voice cannot.
 */
export function useAssistantFolders(
  request: OwnerRequest,
  saveRef?: { current: (() => Promise<void>) | null },
  onDraftStateChange?: (state: FoldersDraftState) => void,
) {
  const [saved, setSaved] = useState<AssistantFoldersResponse | null>(null);
  const [draft, setDraft] = useState<FoldersDraft>({ paths: [], runWithoutAsking: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(fromSaved(saved));

  const fetchLatest = useCallback(() => {
    const mine = ++generation.current;
    return request({ op: "folders.get" })
      .then((result) => {
        if (mine !== generation.current) return;
        if (!result.assistantFolders) throw new Error(t("The folder list could not be read."));
        setSaved(result.assistantFolders);
        setDraft(fromSaved(result.assistantFolders));
        setConflict(false);
        setError("");
      })
      .catch((cause) => {
        if (mine === generation.current) setLoadError(message(cause));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, [request]);
  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return fetchLatest();
  }, [fetchLatest]);
  useEffect(() => {
    // The first fetch starts from the initial loading state, so it sets nothing synchronously.
    void fetchLatest();
    const owner = generation;
    return () => {
      owner.current++;
    };
  }, [fetchLatest]);

  const save = useCallback(async () => {
    if (!saved || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await request({
        op: "folders.set",
        expectedVersion: saved.version,
        paths: draft.paths,
        runWithoutAsking: draft.runWithoutAsking,
      });
      if (!result.assistantFolders)
        throw new Error(t("The folder list save was not confirmed. Check before retrying."));
      setSaved(result.assistantFolders);
      setDraft(fromSaved(result.assistantFolders));
      setConflict(false);
    } catch (cause) {
      if (/changed/i.test(message(cause))) {
        setConflict(true);
        const conflictMessage = t("Settings changed elsewhere. Reload to continue.");
        setError(conflictMessage);
        throw new Error(conflictMessage);
      }
      setError(message(cause));
      throw cause;
    } finally {
      setPending(false);
    }
  }, [saved, pending, draft, request]);

  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      if (dirty) await latest.current();
    };
  });
  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null;
    },
    [saveRef],
  );
  useEffect(() => {
    onDraftStateChange?.({ dirty, pending });
  }, [onDraftStateChange, dirty, pending]);

  return {
    saved,
    draft,
    loading,
    loadError,
    pending,
    error,
    conflict,
    dirty,
    change: (next: Partial<FoldersDraft>) => setDraft((current) => ({ ...current, ...next })),
    reload: load,
  };
}
