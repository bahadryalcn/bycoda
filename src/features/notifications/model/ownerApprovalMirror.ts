import type {
  ApprovalMirrorEntry,
  APPROVALS_RPC,
} from "../../../shared/model/host-contracts/approvals";
import { ownerApprovalSignature } from "../../../shared/model/ownerApprovalSignature";
import type { z } from "zod";
import type { OwnerApproval, OwnerApprovalOutcome } from "./ownerApprovals";

/** The decision poll while any remote approval waits. */
export const APPROVAL_POLL_MS = 2_000;
const MAX_BATCH = 24;

type MirrorParams = z.infer<(typeof APPROVALS_RPC)["approvals.mirror"]["params"]>;
type Decisions = z.infer<(typeof APPROVALS_RPC)["approvals.decisions"]["result"]>;

export type OwnerApprovalMirrorDeps = {
  /** Calls this computer's Host. */
  request: <T>(method: string, params: unknown) => Promise<T>;
  approvals: () => readonly OwnerApproval[];
  subscribe: (listener: () => void) => () => void;
  onOutcome: (listener: (outcome: OwnerApprovalOutcome) => void) => () => void;
  /** Answers the native dialog exactly as the owner's click does. */
  settle: (id: string, approved: boolean) => void;
  setTimer?: (run: () => void, ms: number) => () => void;
};

const signatureOf = (approval: OwnerApproval) =>
  ownerApprovalSignature({
    id: approval.id,
    title: approval.title,
    message: approval.message,
    confirmLabel: approval.confirmLabel,
    cancelLabel: approval.cancelLabel,
    deadline: approval.deadline,
    remote: approval.remote,
    details: approval.inbox,
  });

/**
 * Mirrors the desktop's pending owner approvals to this computer's Host and applies a phone's answer.
 * The native dialog stays the single authority: a phone decision settles an approval only while the same
 * approval is still pending here, is remote, and shows exactly what the phone saw (same signature).
 */
export function startOwnerApprovalMirror(deps: OwnerApprovalMirrorDeps): () => void {
  const setTimer =
    deps.setTimer ??
    ((run, ms) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    });
  const sent = new Map<string, string>();
  const outcomes: { id: string; outcome: "answered" | "ended"; approved?: boolean }[] = [];
  let stopped = false;
  let busy = false;
  let again = false;

  const mirror = async () => {
    const current = deps.approvals();
    const upsert: ApprovalMirrorEntry[] = [];
    for (const approval of current) {
      if (sent.has(approval.id) || upsert.length >= MAX_BATCH) continue;
      upsert.push({
        id: approval.id,
        title: approval.title,
        message: approval.message,
        confirmLabel: approval.confirmLabel,
        cancelLabel: approval.cancelLabel,
        deadline: approval.deadline,
        remote: approval.remote,
        ...(approval.inbox ? { details: approval.inbox } : {}),
        signature: await signatureOf(approval),
      });
    }
    // An outcome only matters to the Host once it has seen the approval; others never reached it.
    const known = (id: string) => sent.has(id) || upsert.some((entry) => entry.id === id);
    for (let index = outcomes.length - 1; index >= 0; index -= 1)
      if (!known(outcomes[index].id) && !deps.approvals().some((a) => a.id === outcomes[index].id))
        outcomes.splice(index, 1);
    const remove = outcomes.filter((outcome) => known(outcome.id)).slice(0, MAX_BATCH);
    if (upsert.length === 0 && remove.length === 0) return;
    const params: MirrorParams = { upsert, remove };
    await deps.request("approvals.mirror", params);
    for (const entry of upsert) sent.set(entry.id, entry.signature);
    for (const entry of remove) {
      sent.delete(entry.id);
      outcomes.splice(outcomes.indexOf(entry), 1);
    }
  };

  const apply = async () => {
    const waiting = deps.approvals().filter((approval) => approval.remote && sent.has(approval.id));
    if (waiting.length === 0) return;
    const { decisions } = await deps.request<Decisions>("approvals.decisions", {});
    for (const decision of decisions) {
      const local = deps.approvals().find((approval) => approval.id === decision.id);
      if (!local || !local.remote) continue;
      if ((await signatureOf(local)) !== decision.signature) continue;
      // Still the same pending approval after the async hash: settle like a click.
      if (deps.approvals().some((approval) => approval === local)) {
        deps.settle(local.id, decision.approved);
      }
    }
  };

  const run = async () => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await mirror();
        await apply();
      } while (again && !stopped);
    } catch {
      // The Host may be unreachable or not yet know this window as the desktop; the next tick retries.
    } finally {
      busy = false;
    }
  };

  const offSubscribe = deps.subscribe(() => void run());
  const offOutcome = deps.onOutcome(({ id, answer }) => {
    outcomes.push(
      answer === undefined
        ? { id, outcome: "ended" }
        : { id, outcome: "answered", approved: answer },
    );
    void run();
  });
  const stopTimer = setTimer(() => {
    if (deps.approvals().length > 0 || outcomes.length > 0) void run();
  }, APPROVAL_POLL_MS);
  void run();
  return () => {
    stopped = true;
    offSubscribe();
    offOutcome();
    stopTimer();
  };
}
