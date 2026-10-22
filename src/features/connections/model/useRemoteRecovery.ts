import { useEffect, useState } from "react";
import {
  claimAutoContinue,
  isAutoContinueDue,
  markAutoContinueDue,
} from "../../sessions/model/autoContinue";
import { loadAutoContinueInterrupted } from "../../settings/model/settings";
import type { HostSession } from "./protocol";
import { shouldAutoContinueRemote } from "./remoteRecovery";
import { unwatchRun, watchKey, watchRun, watchedRun } from "./remoteTurnWatch";

/**
 * Follows what the host reports about a conversation's turn across app
 * restarts and reconnects: remembers a run it saw working, and when the host
 * later says that run was interrupted, sends "Continue" once if the setting is
 * on and nothing is queued. A run that ended is simply forgotten; nothing is
 * ever sent for a turn that finished while the app was away.
 */
export function useRemoteRecovery(input: {
  environmentId: string;
  /** The tab's id: where the one-shot claim and the pane's notice are kept. */
  shellId: string;
  hostSessionId?: string;
  status?: HostSession["status"];
  runId?: string;
  /** `status` came from the host just now, not from a copy kept from earlier. */
  fresh: boolean;
  providerSessionId?: string;
  /** The saved queue has been read, so its length can be trusted. */
  queueLoaded: boolean;
  queuedCount: number;
  /** A message can be sent now: reachable, idle, nothing in flight. */
  ready: boolean;
  send: () => boolean;
}): void {
  const { environmentId, shellId, hostSessionId, runId, queueLoaded, fresh } = input;
  // A copy of the snapshot from before this pane opened, or from before the
  // machine dropped, says nothing about the host's turn now.
  const status = fresh ? input.status : undefined;
  const [, render] = useState(0);
  const key = hostSessionId ? watchKey(environmentId, hostSessionId) : undefined;

  // Remember a run while it works; forget it once it ended.
  useEffect(() => {
    if (!key || !status) return;
    if (status === "running" && runId) watchRun(key, runId);
    else if (status === "idle") unwatchRun(key);
  }, [key, status, runId]);

  // Decide once, when the host reports a run this app saw working as lost.
  useEffect(() => {
    if (!key || status !== "interrupted" || !queueLoaded) return;
    const watched = watchedRun(key);
    if (!watched) return;
    unwatchRun(key);
    if (
      shouldAutoContinueRemote({
        status,
        runId,
        watchedRunId: watched,
        providerSessionId: input.providerSessionId,
        enabled: loadAutoContinueInterrupted(),
        queuedCount: input.queuedCount,
      })
    ) {
      markAutoContinueDue(shellId);
      // The pane hides its Continue notice while the send is pending.
      render((value) => value + 1);
    }
  }, [key, status, runId, queueLoaded]);

  // Send it as soon as the machine can take it, then never again.
  useEffect(() => {
    if (!input.ready || !isAutoContinueDue(shellId)) return;
    // Delay past React StrictMode's dev remount so the claim is not spent on a
    // discarded tree.
    const timer = setTimeout(() => {
      if (!claimAutoContinue(shellId)) return;
      // The user may have continued by hand while this waited.
      if (status === "interrupted") input.send();
      render((value) => value + 1);
    }, 0);
    return () => clearTimeout(timer);
  });
}
