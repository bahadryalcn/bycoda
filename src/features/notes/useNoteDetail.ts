import { useEffect, useMemo, useRef, useState } from "react";
import { getNote, peekNoteDetail, type Note, type NoteSummary } from "./notes";

/** An editor mounts only after the selected body arrives; a summary is never an editable blank note. */
export function useNoteDetail(summary: NoteSummary | Note | null) {
  const [retryCount, setRetryCount] = useState(0);
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
  useEffect(() => {
    if (!id || version === undefined) return;
    if (!retryCount && peekNoteDetail(id, version)) return;
    let active = true;
    void getNote(id).then(
      (note) => {
        if (active) setResult({ id, version, note, error: note ? null : "Note was not found" });
      },
      (cause: unknown) => {
        if (active)
          setResult({
            id,
            version,
            note: null,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      },
    );
    return () => {
      active = false;
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
        ? { ...detail, ...summary, body: detail.body }
        : detail,
    [detail, summary],
  );
  return {
    note,
    loading: Boolean(summary && !note && !current?.error),
    error: current?.error ?? null,
    retry: () => {
      setResult(null);
      setRetryCount((value) => value + 1);
    },
  };
}
