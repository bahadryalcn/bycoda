import { boundedSet, createStore } from "../../../shared/lib/store";
import { logOwnerRequest } from "./notificationLog";

/** A masked request for one secret. The owner's text is never kept in this store. */
export type OwnerSecretInput = {
  id: string;
  sessionId?: string;
  title: string;
  message: string;
  fieldLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  deadline: number;
};

export const MAX_OWNER_SECRET_LENGTH = 8192;
const MAX_DEADLINE_MS = 240_000;
const store = createStore();
let requests: readonly OwnerSecretInput[] = [];
const pending = new Map<
  string,
  {
    resolve: (value: string | null) => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<string | null>;
    signature: string;
    allowed: () => boolean;
    release: () => void;
  }
>();
/** How a request ended; never its value. */
export type OwnerSecretOutcome = "submitted" | "cancelled" | "expired";
/** Only identity and outcome are retained after a request settles, so a replay can never re-deliver a value. */
const settled = new Map<string, { signature: string; outcome: OwnerSecretOutcome }>();
/** How a settled request ended, for the notification log. */
export const ownerSecretOutcome = (id: string) => settled.get(id)?.outcome;
export const subscribeOwnerSecretInputs = store.subscribe;
export const ownerSecretInputsSnapshot = () => requests;

/** Resolves with the owner's text, or `null` when cancelled, expired or the source was revoked. */
export function requestOwnerSecretInput(
  payload: { id: string; sessionId?: unknown; input: Record<string, unknown> },
  allowed: () => boolean = () => true,
  subscribeRevocation: (listener: () => void) => () => void = () => () => {},
): Promise<string | null> {
  const input = payload.input;
  const signature = JSON.stringify([payload.sessionId, input]);
  const previous = settled.get(payload.id);
  if (previous) {
    if (previous.signature !== signature) throw new Error("Secret request identity changed.");
    return Promise.resolve(null);
  }
  if (!allowed()) return Promise.resolve(null);
  const existing = pending.get(payload.id);
  if (existing) {
    if (existing.signature !== signature) throw new Error("Secret request identity changed.");
    return existing.promise;
  }
  if (
    typeof payload.id !== "string" ||
    !payload.id ||
    requests.length >= 24 ||
    ["title", "message", "fieldLabel", "confirmLabel", "cancelLabel"].some(
      (key) => typeof input[key] !== "string",
    ) ||
    typeof input.deadline !== "number" ||
    !Number.isSafeInteger(input.deadline) ||
    input.deadline <= Date.now() ||
    input.deadline > Date.now() + MAX_DEADLINE_MS ||
    (payload.sessionId != null && (typeof payload.sessionId !== "string" || !payload.sessionId))
  ) {
    throw new Error("Invalid secret request.");
  }
  const request: OwnerSecretInput = {
    id: payload.id,
    sessionId: payload.sessionId as string | undefined,
    title: input.title as string,
    message: input.message as string,
    fieldLabel: input.fieldLabel as string,
    confirmLabel: input.confirmLabel as string,
    cancelLabel: input.cancelLabel as string,
    deadline: input.deadline,
  };
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((done) => {
    resolve = done;
  });
  const timer = setTimeout(
    () => abandonOwnerSecretInput(request.id),
    request.deadline - Date.now(),
  );
  const release = subscribeRevocation(() => {
    if (!allowed()) abandonOwnerSecretInput(request.id);
  });
  pending.set(request.id, { resolve, timer, promise, signature, allowed, release });
  requests = [...requests, request];
  store.notify();
  return promise;
}

/** Settles with the owner's text. Returns false, and keeps nothing, when the request is no longer open. */
export function submitOwnerSecretInput(id: string, value: string): boolean {
  if (
    typeof value !== "string" ||
    !value ||
    new TextEncoder().encode(value).length > MAX_OWNER_SECRET_LENGTH
  )
    return false;
  return finishOwnerSecretInput(id, value);
}

/** Owner cancel, deadline or revoked source. Each settles the request with `null`. */
export function cancelOwnerSecretInput(id: string): void {
  finishOwnerSecretInput(id, null);
}
export const abandonOwnerSecretInput = cancelOwnerSecretInput;

function finishOwnerSecretInput(id: string, value: string | null): boolean {
  const entry = pending.get(id);
  const request = requests.find((request) => request.id === id);
  if (!entry || !request) return false;
  clearTimeout(entry.timer);
  entry.release();
  pending.delete(id);
  let accepted = value;
  try {
    if (value !== null && (Date.now() >= request.deadline || !entry.allowed())) accepted = null;
  } catch {
    accepted = null;
  }
  const outcome: OwnerSecretOutcome =
    accepted !== null ? "submitted" : Date.now() >= request.deadline ? "expired" : "cancelled";
  boundedSet(settled, id, { signature: entry.signature, outcome }, 256);
  requests = requests.filter((request) => request.id !== id);
  store.notify();
  entry.resolve(accepted);
  // Only the title and how it ended reach the log; the value never does.
  logOwnerRequest({ id, title: request.title, outcome });
  return accepted !== null;
}
