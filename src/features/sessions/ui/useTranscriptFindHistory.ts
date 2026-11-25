import { useEffect, useEffectEvent, useRef, useState } from "react";

type ReadHistory = (signal: AbortSignal) => Promise<number | void> | void;

/** Each page is read once per cursor while Find has a query. Closing Find stops further reads. */
export function useTranscriptFindHistory(
  cursor: string | undefined,
  read: ReadHistory | undefined,
  externallyLoading: boolean,
) {
  const [attempt, retry] = useState(0);
  const [failure, setFailure] = useState<{ cursor: string; attempt: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useEffectEvent((signal: AbortSignal) => read?.(signal));
  const available = !!read;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- stop a Find-owned read when its cursor is replaced, hidden, closed or retried
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [cursor, attempt],
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- fetch the current missing source only while the Find panel requests it
  useEffect(() => {
    if (cursor === undefined || !available || externallyLoading || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const failed = () => {
      if (!controller.signal.aborted) setFailure({ cursor, attempt });
    };
    void Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return load(controller.signal);
      })
      .then((added) => {
        // Successful page/block publication advances the cursor. Legacy readers can return void.
        if (!added) failed();
      }, failed);
  }, [cursor, attempt, available, externallyLoading]);
  return {
    failed:
      cursor !== undefined &&
      (!available || (failure?.cursor === cursor && failure.attempt === attempt)),
    retry: () => retry((value) => value + 1),
  };
}
