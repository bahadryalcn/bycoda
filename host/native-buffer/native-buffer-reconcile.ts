import { createHash } from "node:crypto";

const MAX_BLOCKED_REPORTED = 100;

/** Only an ESRCH probe proves a predecessor gone; anything else keeps its fence. */
export function assertProcessDead(processId: number) {
  try {
    process.kill(processId, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
  }
  throw new Error("Previous native process is not proven dead");
}

export type BlockedPredecessor = { instanceId: string; processId: number };

/** Dirty or unknown predecessors keep their recovery fence; the Host answers that as a state. */
export function createReconcileOutcome(
  warn: (line: string) => void = (line) => console.warn(line),
) {
  const logged = new Map<string, string>();
  return (clientId: string, blocked: BlockedPredecessor[]) => {
    if (!blocked.length) {
      logged.delete(clientId);
      return { acknowledged: true as const };
    }
    const fingerprint = blocked
      .map((entry) => `${entry.instanceId}:${entry.processId}`)
      .sort()
      .join(",");
    // Log once per change of the blocking set, not once per periodic report.
    if (logged.get(clientId) !== fingerprint) {
      logged.set(clientId, fingerprint);
      warn(
        `Native buffer reconcile: ${blocked.length} earlier instance(s) hold dirty or unknown buffers and need explicit owner recovery`,
      );
    }
    return {
      state: "recovery-required" as const,
      total: blocked.length,
      blocked: blocked.slice(0, MAX_BLOCKED_REPORTED),
      fingerprint: createHash("sha256").update(fingerprint).digest("hex"),
    };
  };
}
