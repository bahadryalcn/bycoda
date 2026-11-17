import { getGroupLockView, hideGroup, unhideGroupForRemote, verifyLockPassword } from "./groupLock";

/** A request the local Host relays from a phone; the password is only in this job. */
export type RemoteGroupLockJob = { id: string } & (
  | { kind: "unlock"; groupId: string; password: string }
  | { kind: "authorizeHidden"; password: string }
  | { kind: "setHidden"; groupId: string; hidden: boolean }
);

/** The verdict only: hash, salt and attempt counters never leave this window. */
export type RemoteGroupLockReply = {
  id: string;
  result?: "ok" | "wrong" | "throttled";
  retryAfterMs?: number;
  error?: "failed";
};

async function passwordVerdict(
  password: string,
  noPassword: "ok" | "wrong",
): Promise<Pick<RemoteGroupLockReply, "result" | "retryAfterMs">> {
  const verified = await verifyLockPassword(password);
  if (verified.ok) return { result: "ok" };
  if (verified.reason === "no-password") return { result: noPassword };
  return {
    result: verified.reason === "blocked" ? "throttled" : "wrong",
    retryAfterMs: verified.retryAfterMs,
  };
}

/**
 * Runs one phone request with the desktop's own password check and attempt
 * throttle, so a phone and the desktop share one set of guesses. It never unlocks
 * the desktop: the Host keeps the phone's grant, not this window.
 */
export async function runRemoteGroupLockJob(
  job: RemoteGroupLockJob,
): Promise<RemoteGroupLockReply> {
  const reply = (value: Omit<RemoteGroupLockReply, "id">): RemoteGroupLockReply => ({
    id: job.id,
    ...value,
  });
  try {
    if (job.kind === "unlock") {
      const verdict = await passwordVerdict(job.password, "wrong");
      if (verdict.result !== "ok") return reply(verdict);
      // An unknown group, one that is not locked and a wrong password all answer "wrong".
      const view = getGroupLockView();
      const locked =
        view.lock.lockedGroupIds.has(job.groupId) && !view.hiddenGroupIds.has(job.groupId);
      return reply(locked ? verdict : { result: "wrong" });
    }
    if (job.kind === "authorizeHidden")
      // Without a password the desktop lets anyone restore hidden groups; the phone matches that.
      return reply(await passwordVerdict(job.password, "ok"));
    const changed = job.hidden
      ? await hideGroup(job.groupId)
      : await unhideGroupForRemote(job.groupId);
    return reply(changed ? { result: "ok" } : { error: "failed" });
  } catch {
    // Unreadable privacy storage: nothing is granted, and the phone is told to retry.
    return reply({ error: "failed" });
  }
}
