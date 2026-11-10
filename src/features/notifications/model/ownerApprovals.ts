import { boundedSet, createStore } from "../../../shared/lib/store";
import { isRemoteApproval } from "./ownerApprovalRemote";
import { parseInboxApprovalDetails, type InboxApprovalDetails } from "./inboxApprovalDetails";

export type OwnerApproval = {
  id: string;
  sessionId?: string;
  /** Native action name; absent for approvals created outside the native relay. */
  action?: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  deadline: number;
  /** Structured preview of the same operation `message` states; absent for other approvals. */
  inbox?: InboxApprovalDetails;
  /** A paired phone may also answer this approval; false for secrets and desktop input. */
  remote: boolean;
};

export type OwnerApprovalOutcome = { id: string; answer?: boolean };
const store = createStore();
let requests: readonly OwnerApproval[] = [];
const pending = new Map<
  string,
  {
    resolve: (answer: boolean) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<boolean>;
    signature: string;
    allowed: () => boolean;
    release: () => void;
  }
>();
const settled = new Map<string, { signature: string; answer?: boolean }>();
const surfaces = new Map<string, number>();
const outcomes = new Set<(outcome: OwnerApprovalOutcome) => void>();
/** Every pending approval ends once, answered (`answer` set) or not (timeout, revocation, closed window). */
export function onOwnerApprovalOutcome(listener: (outcome: OwnerApprovalOutcome) => void) {
  outcomes.add(listener);
  return () => void outcomes.delete(listener);
}
export const subscribeOwnerApprovals = store.subscribe;
export const ownerApprovalsSnapshot = () => requests;
export const hasOwnerApprovalChat = (sessionId?: string) => !!sessionId && surfaces.has(sessionId);

export function registerOwnerApprovalChat(sessionId: string): () => void {
  surfaces.set(sessionId, (surfaces.get(sessionId) ?? 0) + 1);
  requests = [...requests];
  store.notify();
  return () => {
    const count = (surfaces.get(sessionId) ?? 1) - 1;
    if (count) surfaces.set(sessionId, count);
    else surfaces.delete(sessionId);
    // Publish a new snapshot so modal/chat routing updates on tab changes.
    requests = [...requests];
    store.notify();
  };
}

export function settleOwnerApproval(id: string, approved: boolean): void {
  finishOwnerApproval(id, approved);
}
export function abandonOwnerApproval(id: string): void {
  finishOwnerApproval(id);
}
function finishOwnerApproval(id: string, approved?: boolean): void {
  const entry = pending.get(id);
  const request = requests.find((request) => request.id === id);
  if (!entry || !request) return;
  clearTimeout(entry.timer);
  entry.release();
  pending.delete(id);
  let answer: boolean | undefined;
  try {
    answer = Date.now() < request.deadline && entry.allowed() ? approved : undefined;
  } catch {
    answer = undefined;
  }
  boundedSet(settled, id, { signature: entry.signature, answer }, 256);
  requests = requests.filter((request) => request.id !== id);
  if (answer === undefined) entry.reject(new Error("Application approval expired or was revoked."));
  else entry.resolve(answer);
  store.notify();
  for (const listener of outcomes) {
    try {
      listener({ id, answer });
    } catch {
      // A faulty observer never changes the owner decision.
    }
  }
}

export function requestOwnerApproval(
  payload: {
    id: string;
    sessionId?: unknown;
    action?: unknown;
    input: Record<string, unknown>;
  },
  allowed: () => boolean = () => true,
  subscribeRevocation: (listener: () => void) => () => void = () => () => {},
): Promise<boolean> {
  const input = payload.input;
  const signature = JSON.stringify([payload.sessionId, input]);
  const previous = settled.get(payload.id);
  if (previous) {
    if (previous.signature !== signature) throw new Error("Approval identity changed.");
    return previous.answer === undefined
      ? Promise.reject(new Error("Application approval is no longer pending."))
      : Promise.resolve(previous.answer);
  }
  if (!allowed()) return Promise.reject(new Error("Application approval source unavailable."));
  const existing = pending.get(payload.id);
  if (existing) {
    if (existing.signature !== signature) throw new Error("Approval identity changed.");
    return existing.promise;
  }
  if (
    typeof payload.id !== "string" ||
    !payload.id ||
    requests.length >= 24 ||
    ["title", "message", "confirmLabel", "cancelLabel"].some(
      (key) => typeof input[key] !== "string",
    ) ||
    typeof input.deadline !== "number" ||
    !Number.isSafeInteger(input.deadline) ||
    input.deadline <= Date.now() ||
    input.deadline > Date.now() + 240_000 ||
    (payload.sessionId != null && (typeof payload.sessionId !== "string" || !payload.sessionId))
  ) {
    throw new Error("Invalid application approval.");
  }
  const inbox = parseInboxApprovalDetails(input.details);
  const action = typeof payload.action === "string" ? payload.action : undefined;
  const request: OwnerApproval = {
    id: payload.id,
    sessionId: payload.sessionId as string | undefined,
    ...(action ? { action } : {}),
    title: input.title,
    message: input.message,
    confirmLabel: input.confirmLabel,
    cancelLabel: input.cancelLabel,
    deadline: input.deadline,
    inbox,
    remote: isRemoteApproval({
      action,
      title: input.title as string,
      message: input.message as string,
      details: inbox,
    }),
  } as OwnerApproval;
  let resolve!: (answer: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const timer = setTimeout(() => abandonOwnerApproval(request.id), request.deadline - Date.now());
  const release = subscribeRevocation(() => {
    if (!allowed()) abandonOwnerApproval(request.id);
  });
  pending.set(request.id, { resolve, reject, timer, promise, signature, allowed, release });
  requests = [...requests, request];
  store.notify();
  return promise;
}
