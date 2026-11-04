import { useEffect, useRef, useState } from "react";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

/** An observation hint, never a proof that a provider has stopped. */
export type VoiceSessionProgress = "idle" | "working" | "quiet";
export function sessionProgressHint(
  busy: boolean,
  since: number,
  now = monotonicNow(),
): VoiceSessionProgress {
  if (!busy) return "idle";
  return elapsedSince(since, now) >= 90_000 ? "quiet" : "working";
}
export function useVoiceSessionProgress(session?: {
  id: string;
  busy?: boolean;
  blocks: readonly unknown[];
}) {
  const changed = useRef(monotonicNow());
  const [hint, setHint] = useState<VoiceSessionProgress>(session?.busy ? "working" : "idle");
  useEffect(() => {
    changed.current = monotonicNow();
    setHint(session?.busy ? "working" : "idle");
    if (!session?.busy) return;
    const timer = setInterval(() => setHint(sessionProgressHint(true, changed.current)), 5000);
    return () => clearInterval(timer);
  }, [session?.id, session?.busy, session?.blocks]);
  return session?.busy ? hint : "idle";
}
