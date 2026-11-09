import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CrewDefinition } from "../model/crew";
import { adoptSaved, crewFingerprint, outgoingCrew, shouldAutosave } from "../model/crewBulk";

export type CrewAutosaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

type Mirror = {
  returned: CrewDefinition | undefined;
  lastSent: string | undefined;
  failed: { fingerprint: string; message: string } | undefined;
};

type Live = {
  draft: CrewDefinition | null;
  saved: CrewDefinition | undefined;
  valid: boolean;
  enabled: boolean;
  save: (definition: CrewDefinition) => Promise<CrewDefinition>;
  onSaved: (returned: CrewDefinition, sent: CrewDefinition) => void;
};

// The stored copy this draft is compared with: the newest of the listed and the returned one.
function baseline(
  listed: CrewDefinition | undefined,
  id: string | undefined,
  known: Mirror,
): CrewDefinition | undefined {
  return known.returned &&
    known.returned.id === id &&
    known.returned.updatedAt >= (listed?.updatedAt ?? 0)
    ? known.returned
    : listed;
}

function isPending(state: Live, known: Mirror): boolean {
  return (
    !!state.draft &&
    state.enabled &&
    shouldAutosave(
      state.draft,
      baseline(state.saved, state.draft.id, known),
      state.valid,
      known.lastSent,
      known.failed?.fingerprint,
    )
  );
}

/**
 * Saves a stored crew's valid draft shortly after the last edit. One save runs at a
 * time; edits made meanwhile are sent next. A failure waits for `retry` or the next
 * edit instead of looping. Closing the editor sends whatever is still pending.
 * `enabled` is false while another action owns the crew or a revision conflict is open.
 */
export function useCrewAutosave(input: Live & { delayMs?: number }) {
  const { delayMs = AUTOSAVE_DELAY_MS, ...current } = input;
  const live = useRef<Live>(current);
  useLayoutEffect(() => {
    live.current = current;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const [returned, setReturned] = useState<CrewDefinition>();
  const [lastSent, setLastSent] = useState<string>();
  const [failed, setFailed] = useState<{ fingerprint: string; message: string }>();
  const [saving, setSaving] = useState(false);
  const mirror = useRef({ returned, lastSent, failed });
  useLayoutEffect(() => {
    mirror.current = { returned, lastSent, failed };
  });

  const pending = (state: Live) => isPending(state, mirror.current);

  const pump = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        while (pending(live.current)) {
          const sent = outgoingCrew(live.current.draft!);
          setSaving(true);
          try {
            const result = await live.current.save(sent);
            mirror.current = {
              ...mirror.current,
              returned: result,
              lastSent: crewFingerprint(sent),
              failed: undefined,
            };
            setReturned(result);
            setLastSent(crewFingerprint(sent));
            setFailed(undefined);
            // An edit made during the request is sent next with the new revision. The
            // re-render that adopts it may not have happened yet, so adopt it here too.
            const draft = live.current.draft;
            if (draft?.id === result.id)
              live.current = { ...live.current, draft: adoptSaved(draft, sent, result) };
            live.current.onSaved(result, sent);
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : String(reason);
            const next = { fingerprint: crewFingerprint(sent), message };
            mirror.current = { ...mirror.current, failed: next };
            setFailed(next);
            return;
          }
          // Newer edits wait for their own debounce rather than chaining saves.
          if (timer.current) return;
        }
      } finally {
        setSaving(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
    // `pending` and the refs it reads are stable by construction.
  }, []);

  const fingerprint = input.draft ? crewFingerprint(input.draft) : undefined;
  useEffect(() => {
    if (!pending(live.current)) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      pump().catch(() => {});
    }, delayMs);
    return () => {
      clearTimeout(timer.current);
      timer.current = undefined;
    };
    // Re-arm on any change of what would be sent or of whether sending is allowed.
  }, [fingerprint, input.valid, input.enabled, input.saved, returned, lastSent, failed, delayMs]);

  // Closing the editor must not drop a pending change.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      pump().catch(() => {});
    },
    [pump],
  );

  /** Sends anything pending and resolves true when the stored crew matches the draft. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await pump();
      if (!pending(live.current)) break;
    }
    const draft = live.current.draft;
    const failedNow = !!draft && mirror.current.failed?.fingerprint === crewFingerprint(draft);
    return !failedNow && !pending(live.current);
  }, [pump]);

  const retry = useCallback(() => {
    mirror.current = { ...mirror.current, failed: undefined };
    setFailed(undefined);
    pump().catch(() => {});
  }, [pump]);

  const dirty = isPending(input, { returned, lastSent, failed });
  const failedNow = !!failed && failed.fingerprint === fingerprint;
  const status: CrewAutosaveStatus = failedNow
    ? "error"
    : saving || dirty
      ? "saving"
      : lastSent
        ? "saved"
        : "idle";
  return { status, error: failedNow ? failed.message : "", retry, flush };
}
