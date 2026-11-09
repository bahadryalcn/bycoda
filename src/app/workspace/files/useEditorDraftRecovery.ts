import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  listEditorDraftRecovery,
  prepareEditorDraftRestore,
  type EditorDraftRecoveryMetadata,
  type EditorDraftRecoverySource,
  type PreparedEditorDraftRestore,
} from "../../../features/files/data/editorDraftRecovery";

type Dependencies = {
  enabled?: boolean;
  allowPath: (path: string) => boolean;
  onOpen: (prepared: PreparedEditorDraftRestore) => Promise<void>;
  isTargetOpen: (documentId: string) => boolean;
};
const sourceOf = (row: EditorDraftRecoveryMetadata): EditorDraftRecoverySource => ({
  ownerId: row.ownerId,
  documentId: row.documentId,
  revision: row.revision,
  payloadDigest: row.payloadDigest,
});
export const editorDraftRecoveryKey = (row: EditorDraftRecoverySource) =>
  JSON.stringify([row.ownerId, row.documentId, row.revision, row.payloadDigest]);

/** App-owned intentions survive closing the dialog; Native owns accepted copies. */
export function useEditorDraftRecovery(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  useLayoutEffect(() => {
    latest.current = dependencies;
  });
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const intentions = useRef(
    new Map<string, { documentId: string; opened?: boolean; pending?: Promise<void> }>(),
  );
  const [records, setRecords] = useState<readonly EditorDraftRecoveryMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const available = isTauri() && dependencies.enabled !== false;
  const refresh = useCallback(async () => {
    if (!available || refreshing.current || !mounted.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const rows: EditorDraftRecoveryMetadata[] = [];
      const seen = new Set<string>();
      let after: { ownerId: string; documentId: string } | null = null;
      for (let page = 0; page < 16; page++) {
        const result = await listEditorDraftRecovery({ after, limit: 100 });
        if (!mounted.current || latest.current.enabled === false) return;
        for (const record of result.records) {
          const key = JSON.stringify([record.ownerId, record.documentId]);
          if (seen.has(key) || rows.length >= 1024) throw new Error("Recovery inventory changed");
          seen.add(key);
          rows.push(record);
        }
        if (!result.next) {
          if (mounted.current) {
            setRecords(rows);
            setError(false);
          }
          return;
        }
        after = result.next;
      }
      throw new Error("Recovery inventory bound exceeded");
    } catch {
      if (mounted.current) setError(true);
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [available]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(refresh);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  const restore = useCallback(
    (record: EditorDraftRecoveryMetadata): Promise<void> => {
      if (!available || !mounted.current || !latest.current.allowPath(record.path))
        return Promise.reject(new Error("Recovery path unavailable"));
      const source = sourceOf(record);
      const key = editorDraftRecoveryKey(source);
      let intention = intentions.current.get(key);
      if (intention?.pending) return intention.pending;
      if (intention?.opened && !latest.current.isTargetOpen(intention.documentId)) {
        intentions.current.delete(key);
        intention = undefined;
      }
      if (!intention) {
        if (intentions.current.size >= 64) {
          setErrors((previous) => new Set(previous).add(key));
          return Promise.reject(new Error("Recovery capacity reached"));
        }
        intention = { documentId: crypto.randomUUID() };
        intentions.current.set(key, intention);
      }
      setPendingKeys((previous) => new Set(previous).add(key));
      setErrors((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
      const accepted = intention;
      accepted.pending = Promise.resolve().then(async () => {
        try {
          if (
            !mounted.current ||
            latest.current.enabled === false ||
            !latest.current.allowPath(record.path)
          )
            throw new Error("Recovery path unavailable");
          const prepared = await prepareEditorDraftRestore(source, {
            documentId: accepted.documentId,
          });
          if (
            !mounted.current ||
            !(latest.current.enabled ?? true) ||
            !latest.current.allowPath(prepared.target.path)
          )
            throw new Error("Recovery path unavailable");
          await latest.current.onOpen(prepared);
          accepted.opened = true;
        } catch (failure) {
          if (mounted.current && latest.current.allowPath(record.path))
            setErrors((previous) => new Set(previous).add(key));
          throw failure;
        } finally {
          accepted.pending = undefined;
          if (mounted.current)
            setPendingKeys((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            });
        }
      });
      void accepted.pending.catch(() => {});
      return accepted.pending;
    },
    [available],
  );
  return { available, records, loading, error, refresh, restore, pendingKeys, errors };
}
