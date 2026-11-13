import { useEffect, useMemo, useRef, useState } from "react";
import { getNote, peekNoteDetail, type Note, type NoteSummary } from "./notes";
import { beginNoteWork, deriveNoteInputResult, noteInputWorkError } from "./notesInputOwners";
import { t } from "../../shared/i18n";

/** An editor mounts only after the selected body arrives; a summary is never an editable blank note. */
export function useNoteDetail(summary: NoteSummary | Note | null) {
  const [retryCount, setRetryCount] = useState(0);
  const retryKey = useRef<string | null>(null);
  const fetchingRef = useRef<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const retained = useRef<Note | null>(null);
  const [result, setResult] = useState<{
    id: string;
    version: number;
    note: Note | null;
    error: string | null;
  } | null>(null);
  const id = summary?.id;
  const version = summary?.updatedAt;
  const cached = summary
    ? "body" in summary
      ? summary
      : peekNoteDetail(summary.id, summary.updatedAt)
    : null;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the selected note's admitted detail read and cancel its publication when selection or version changes.
  useEffect(() => {
    if (!id || version === undefined) return;
    const key = JSON.stringify([id, version]);
    const forced = retryKey.current === key;
    retryKey.current = null;
    if (!forced && peekNoteDetail(id, version)) return;
    const work = beginNoteWork("note-detail-consumer");
    if (!work) {
      fetchingRef.current = null;
      setFetching(null);
      setResult({ id, version, note: null, error: noteInputWorkError().message });
      return;
    }
    fetchingRef.current = key;
    setFetching(key);
    let active = true;
    void getNote(id, work)
      .then(async (note) => {
        if (!active) return;
        // A newer summary may share an older in-flight body read. Retry once,
        // then expose a recoverable error instead of accepting a stale CAS base.
        if (note && note.updatedAt < version) note = await getNote(id, work);
        if (!active) return;
        if (note && note.updatedAt < version)
          throw new Error(t("This note changed on the computer. Refresh it before saving."));
        setResult({ id, version, note, error: note ? null : "Note was not found" });
      })
      .catch((cause: unknown) => {
        if (active)
          setResult({
            id,
            version,
            note: null,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      })
      .finally(() => {
        if (active) {
          fetchingRef.current = null;
          setFetching(null);
        }
        work();
      });
    return () => {
      active = false;
      if (fetchingRef.current === key) fetchingRef.current = null;
    };
  }, [id, version, retryCount]);
  const current = result && result.id === id && result.version === version ? result : null;
  const fresh = cached ?? current?.note ?? null;
  if (fresh) retained.current = fresh;
  const detail = fresh ?? (retained.current?.id === id ? retained.current : null);
  // Moving a note changes project metadata without changing its body version.
  const note = useMemo(
    () =>
      detail && summary && detail.updatedAt === summary.updatedAt
        ? deriveNoteInputResult({ ...detail, ...summary, body: detail.body }, detail, summary)
        : detail,
    [detail, summary],
  );
  return {
    note,
    loading: Boolean(summary && !note && !current?.error),
    error: current?.error ?? null,
    retrying: fetching === JSON.stringify([id, version]) && Boolean(current?.error),
    retry: () => {
      if (!id || version === undefined) return;
      const key = JSON.stringify([id, version]);
      if (fetchingRef.current === key) return;
      fetchingRef.current = key;
      retryKey.current = key;
      setFetching(key);
      setRetryCount((value) => value + 1);
    },
  };
}
