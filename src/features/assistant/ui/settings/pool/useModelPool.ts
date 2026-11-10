import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../../../shared/i18n";
import type {
  AssistantModelPoolResponse,
  AssistantModelPoolRow,
} from "../../../../../shared/model/assistantModelPool";
import type { assistantRequest } from "../../../model/assistantClient";
import { poolIsValid, validatePool } from "../../../model/assistantModelPoolDraft";

type OwnerRequest = typeof assistantRequest;
export type PoolDraftState = { dirty: boolean; pending: boolean };

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const same = (a: readonly AssistantModelPoolRow[], b: readonly AssistantModelPoolRow[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The pool's own draft, version and save. `request` keeps the Host binding the settings dialog opened
 * with. A saved pool is confirmed by the Host's response, never inferred from the draft.
 */
export function useModelPool(
  request: OwnerRequest,
  saveRef?: { current: (() => Promise<void>) | null },
  onDraftStateChange?: (state: PoolDraftState) => void,
) {
  const [pool, setPool] = useState<AssistantModelPoolResponse | null>(null);
  const [rows, setRows] = useState<AssistantModelPoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const dirty = pool !== null && !same(rows, pool.rows);

  const fetchLatest = useCallback(() => {
    const mine = ++generation.current;
    return request({ op: "models.pool.get" })
      .then((result) => {
        if (mine !== generation.current) return;
        if (!result.modelPool) throw new Error(t("The model list could not be read."));
        setPool(result.modelPool);
        setRows(result.modelPool.rows);
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
    if (!pool || pending) return;
    if (!poolIsValid(validatePool(rows))) throw new Error(t("Fix the model list before saving."));
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const result = await request({
        op: "models.pool.set",
        expectedVersion: pool.version,
        rows,
      });
      if (!result.modelPool)
        throw new Error(t("The model list save was not confirmed. Check before retrying."));
      setPool(result.modelPool);
      setRows(result.modelPool.rows);
      setConflict(false);
      setSaved(true);
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
  }, [pool, pending, rows, request]);

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

  const change = useCallback((next: AssistantModelPoolRow[]) => {
    setSaved(false);
    setRows(next);
  }, []);
  const revert = useCallback(() => {
    if (!pool) return;
    setRows(pool.rows);
    setError("");
    setConflict(false);
    setSaved(false);
  }, [pool]);

  return {
    pool,
    rows,
    loading,
    loadError,
    pending,
    error,
    conflict,
    saved: saved && !dirty,
    dirty,
    change,
    revert,
    reload: load,
    save: () => save().catch(() => undefined),
  };
}
