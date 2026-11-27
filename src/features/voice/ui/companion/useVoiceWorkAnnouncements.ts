import { useEffect, useEffectEvent, useState } from "react";
import {
  voiceWorkEnded,
  VoiceWorkUpdates,
  type VoiceUpdate,
} from "../../model/voiceWorkAnnouncements";
import type { VoiceWorkEntry, VoiceWorkLedger } from "../../model/voiceWorkLedger";

/**
 * Watches delegated work in app state and announces when it ends. The ledger learns progress from
 * sessions (busy flag) and Assistant jobs; each newly finished or failed entry, and every update
 * passed to the returned `announce`, waits in a queue the companion owns until `open` (the shared
 * announcement gate) is true. `deliver` then speaks it on whichever client is live and returns
 * false when no client can take it, so it stays queued across reconnects.
 */
export function useVoiceWorkAnnouncements(input: {
  ledger: VoiceWorkLedger;
  sessions: readonly { id: string; busy?: boolean; title?: string }[];
  jobs: readonly { id: string; status: string; title?: string }[] | undefined;
  open: boolean;
  deliver: (update: VoiceUpdate) => boolean;
  /** Entries another announcer already reports. */
  skip?: (entry: VoiceWorkEntry) => boolean;
}) {
  const [queue] = useState(() => new VoiceWorkUpdates());
  const [pending, setPending] = useState(0);
  const deliver = useEffectEvent(input.deliver);
  const skip = useEffectEvent((entry: VoiceWorkEntry) => input.skip?.(entry) === true);
  const { ledger, sessions, jobs, open } = input;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Feeds session and job state from the app stores into the persisted work ledger, which lives outside React.
  useEffect(() => {
    // Sessions or jobs changed: let the ledger see linked work start and end.
    const ended = ledger.observe({
      sessions: sessions.map((session) => ({
        id: session.id,
        busy: Boolean(session.busy),
        ...(session.title ? { title: session.title } : {}),
      })),
      jobs: (jobs ?? []).map((job) => ({
        id: job.id,
        status: job.status,
        ...(job.title ? { title: job.title } : {}),
      })),
    });
    const announced = ended.filter((entry) => !skip(entry)).map(voiceWorkEnded);
    if (announced.length) setPending(queue.add(announced));
  }, [ledger, sessions, jobs, queue]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Hands held updates to the live provider connection once the announcement gate opens.
  useEffect(() => {
    // The gate opened or an update arrived: speak held updates on the client that is live now.
    if (!open || !pending) return;
    const due = queue.take();
    const undelivered = due.filter((update) => !deliver(update));
    if (undelivered.length) queue.restore(undelivered);
    setPending(queue.size);
  }, [open, pending, queue]);
  return (update: VoiceUpdate) => setPending(queue.add([update]));
}
