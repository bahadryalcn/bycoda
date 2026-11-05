import { invoke, isTauri } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";

// Both keys share one revision so a move can update folders and order atomically.
const SCOPE = "session-organization.v1";
const FOLDERS = "bycoda.sessionFolders";
const ORDER = "bycoda.sessionOrder";
const KEYS = [FOLDERS, ORDER] as const;
// Non-native browser fixtures retain their localStorage implementation.
export const NATIVE_SESSION_ORGANIZATION_ACTIVE = isTauri();
type StoreKey = (typeof KEYS)[number];
type Entry = { key: string; version: number; value: unknown };
type Snapshot = { entries: Entry[]; revision: number };
type Outcome = {
  applied: boolean;
  revision: number;
  compacted: boolean;
  entries: Array<{ key: string; version: number; value?: unknown }>;
};
type RecordValue = Record<string, unknown>;
export type SessionOrganizationState = { folders: RecordValue; order: RecordValue };
export type SessionOrganizationGesture = {
  /** Stable identity of the user gesture, retained while its outcome is unknown. */
  id: string;
  /** Immutable, serializable user intent retained before the first attempt. */
  descriptor: unknown;
  /** Recompute only after a proven conflict, using the newly read state. */
  apply: (state: SessionOrganizationState) => SessionOrganizationState;
};
export type SessionOrganizationResult =
  | { state: "applied"; value: SessionOrganizationState; previous?: SessionOrganizationState }
  | { state: "applied-unavailable"; operationId: string }
  | { state: "conflict" }
  | { state: "unknown"; operationId: string };

let cached: SessionOrganizationState | undefined;
let pageToken: Promise<string> | undefined;
let pendingImport: string | undefined;
let hydration: Promise<SessionOrganizationState> | undefined;
const runningGestures = new Map<string, Promise<SessionOrganizationResult>>();
const token = () =>
  (pageToken ??= invoke<string>("canonical_store_page_token").catch((error: unknown) => {
    pageToken = undefined;
    throw error;
  }));

function parse(raw: unknown): RecordValue {
  if (typeof raw !== "string")
    throw new Error("Invalid session organization data; recovery is required.");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session organization data; recovery is required.");
  return value as RecordValue;
}

function fromSnapshot(snapshot: Snapshot): SessionOrganizationState {
  const raw = (key: StoreKey) => snapshot.entries.find((entry) => entry.key === key)?.value ?? "{}";
  return { folders: parse(raw(FOLDERS)), order: parse(raw(ORDER)) };
}

function publish(value: SessionOrganizationState): SessionOrganizationState {
  cached = structuredClone(value);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("bycoda:session-organization-change"));
  return structuredClone(value);
}

export function cachedSessionOrganization(): SessionOrganizationState | undefined {
  return cached && structuredClone(cached);
}

export function subscribeSessionOrganization(
  onChange: () => void,
  onError: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("bycoda:session-organization-change", onChange);
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let requested = 0;
  let refreshing = false;
  const refresh = () => {
    requested++;
    if (refreshing) return;
    refreshing = true;
    void (async () => {
      let seen = 0;
      while (!disposed && seen !== requested) {
        seen = requested;
        await hydrateSessionOrganization();
      }
    })()
      .catch(onError)
      .finally(() => {
        refreshing = false;
      });
  };
  if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
    void listenWindowAsync<{ scope: string; revision: number }>(
      "canonical-store-changed",
      (event) => {
        if (event.payload.scope === SCOPE || event.payload.scope === "session-pin-saga.v1")
          refresh();
      },
    ).then((release) => {
      if (disposed) release();
      else {
        unlisten = release;
        refresh();
      }
    }, onError);
  } else refresh();
  if (NATIVE_SESSION_ORGANIZATION_ACTIVE) window.addEventListener("focus", refresh);
  // Other desktop processes cannot receive this process's window events.
  const poll = NATIVE_SESSION_ORGANIZATION_ACTIVE
    ? window.setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, 5_000)
    : undefined;
  return () => {
    disposed = true;
    unlisten?.();
    if (poll !== undefined) window.clearInterval(poll);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("bycoda:session-organization-change", onChange);
  };
}

async function read(extra: string[] = []): Promise<Snapshot> {
  return invoke<Snapshot>("canonical_store_read", { scope: SCOPE, keys: [...KEYS, ...extra] });
}

type GestureLedger = {
  id: string;
  descriptor: unknown;
  attempt: number;
  state: "pending" | "applied" | "rejected";
};
const gestureKey = (id: string) => `gesture:${id}`;
const attemptId = (id: string, attempt: number) => `${id}:effect:${attempt}`;

/** Lists retained gesture descriptors from a revision-fenced native snapshot. */
export async function listSessionOrganizationGestures(): Promise<GestureLedger[]> {
  if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) return [];
  const prefix = "gesture:";
  let after: string | null = null;
  let revision: number | null = null;
  const result: GestureLedger[] = [];
  for (;;) {
    const page: Snapshot = await invoke("canonical_store_list", {
      scope: SCOPE,
      after,
      limit: 128,
      expectedRevision: revision,
    });
    revision = page.revision;
    for (const entry of page.entries) {
      after = entry.key;
      if (entry.key.startsWith(prefix)) {
        const value = entry.value as GestureLedger | null;
        if (
          !value ||
          typeof value !== "object" ||
          typeof value.id !== "string" ||
          !value.id ||
          entry.key !== gestureKey(value.id) ||
          !Number.isSafeInteger(value.attempt) ||
          value.attempt < 0 ||
          !["pending", "applied", "rejected"].includes(value.state) ||
          value.descriptor === undefined
        )
          throw new Error("Invalid organization gesture; recovery is required.");
        result.push(value);
      }
    }
    if (page.entries.length < 128) return result;
  }
}

/** A missing effect receipt is inconclusive even when the intent exists. */
export async function unresolvedSessionOrganizationGestures(): Promise<
  Array<{ id: string; operationId: string }>
> {
  const unresolved: Array<{ id: string; operationId: string }> = [];
  for (const gesture of await listSessionOrganizationGestures()) {
    if (gesture.state !== "pending") continue;
    const operationId = attemptId(gesture.id, gesture.attempt);
    if (!(await reconcileSessionOrganizationReceipt(operationId)))
      unresolved.push({ id: gesture.id, operationId });
  }
  return unresolved;
}

/** Imports the exact legacy bytes once. Invalid data remains recoverable and blocks edits. */
export async function hydrateSessionOrganization(): Promise<SessionOrganizationState> {
  if (hydration) return structuredClone(await hydration);
  hydration = hydrateOnce();
  try {
    return structuredClone(await hydration);
  } finally {
    hydration = undefined;
  }
}

async function hydrateOnce(): Promise<SessionOrganizationState> {
  if (!NATIVE_SESSION_ORGANIZATION_ACTIVE)
    return publish({
      folders: parse(localStorage.getItem(FOLDERS) ?? "{}"),
      order: parse(localStorage.getItem(ORDER) ?? "{}"),
    });
  for (;;) {
    if (pendingImport) {
      const receipt = await reconcileSessionOrganizationReceipt(pendingImport);
      if (!receipt)
        throw new Error(`Session organization import outcome is unknown: ${pendingImport}`);
      pendingImport = undefined;
    }
    const snapshot = await read();
    const missing = KEYS.filter((key) => !snapshot.entries.some((entry) => entry.key === key));
    if (!missing.length) return publish(fromSnapshot(snapshot));
    const raw = missing.map((key) => ({ key, raw: localStorage.getItem(key) ?? "{}" }));
    const operationId = crypto.randomUUID();
    const args = {
      scope: SCOPE,
      pageToken: await token(),
      operationId,
      checks: missing.map((key) => ({ key, version: null })),
      writes: raw.map(({ key, raw: value }) => ({ key, value })),
      legacy: raw,
      expectedRevision: snapshot.revision,
      claim: null,
    };
    let outcome: Outcome;
    pendingImport = operationId;
    try {
      outcome = await invoke<Outcome>("canonical_store_transaction", args);
    } catch {
      const receipt = await reconcileSessionOrganizationReceipt(operationId);
      if (!receipt)
        throw new Error(`Session organization import outcome is unknown: ${operationId}`);
      outcome = receipt;
    }
    pendingImport = undefined;
    if (outcome.applied) return publish(fromSnapshot(await read()));
    // Only a durable conflict receipt permits another import attempt.
  }
}

/** Null is inconclusive: the original transaction may still be in flight. */
export async function reconcileSessionOrganizationReceipt(
  operationId: string,
): Promise<Outcome | null> {
  return invoke<Outcome | null>("canonical_store_receipt", { scope: SCOPE, operationId });
}

/** The callback expresses the gesture, never an already computed replacement snapshot. */
export function mutateSessionOrganization(
  gesture: SessionOrganizationGesture,
): Promise<SessionOrganizationResult> {
  const running = runningGestures.get(gesture.id);
  if (running) return running;
  const result = mutateOnce(gesture);
  runningGestures.set(gesture.id, result);
  void result
    .finally(() => {
      runningGestures.delete(gesture.id);
    })
    .catch(() => undefined);
  return result;
}

async function mutateOnce(gesture: SessionOrganizationGesture): Promise<SessionOrganizationResult> {
  if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) {
    const current = await hydrateSessionOrganization();
    const next = gesture.apply(structuredClone(current));
    localStorage.setItem(FOLDERS, JSON.stringify(next.folders));
    localStorage.setItem(ORDER, JSON.stringify(next.order));
    return { state: "applied", value: publish(next) };
  }
  await hydrateSessionOrganization();
  const { listPinSagas } = await import("./sessionPinSaga");
  const pendingSaga = (await listPinSagas()).find(
    (saga) =>
      saga.state !== "applied" && saga.state !== "accepted" && saga.organizationId !== gesture.id,
  );
  if (pendingSaga) return { state: "unknown", operationId: pendingSaga.id };
  const unresolved = await unresolvedSessionOrganizationGestures();
  const other = unresolved.find((item) => item.id !== gesture.id);
  if (other) return { state: "unknown", operationId: other.operationId };
  const ledgerKey = gestureKey(gesture.id);
  const descriptor = JSON.stringify(gesture.descriptor);
  let mayDispatch = false;
  for (let conflicts = 0; conflicts < 8; conflicts++) {
    let snapshot = await read([ledgerKey]);
    let entry = snapshot.entries.find((item) => item.key === ledgerKey);
    let ledger = entry?.value as GestureLedger | undefined;
    if (
      entry &&
      (!ledger ||
        ledger.id !== gesture.id ||
        JSON.stringify(ledger.descriptor) !== descriptor ||
        !Number.isSafeInteger(ledger.attempt) ||
        ledger.attempt < 0 ||
        !["pending", "applied", "rejected"].includes(ledger.state))
    )
      throw new Error("Invalid or mismatched organization gesture; recovery is required.");
    if (ledger?.state === "applied") return { state: "applied", value: fromSnapshot(snapshot) };
    if (ledger?.state === "rejected") return { state: "conflict" };
    if (ledger && !mayDispatch) {
      const originalId = attemptId(gesture.id, ledger.attempt);
      let receipt: Outcome | null;
      try {
        receipt = await reconcileSessionOrganizationReceipt(originalId);
      } catch {
        return { state: "unknown", operationId: originalId };
      }
      if (!receipt) return { state: "unknown", operationId: originalId };
      if (receipt.applied) {
        try {
          return { state: "applied", value: fromSnapshot(await read()) };
        } catch {
          return { state: "applied-unavailable", operationId: originalId };
        }
      }
    }
    if (!ledger || !mayDispatch) {
      const attempt = ledger ? ledger.attempt + 1 : 0;
      const nextLedger: GestureLedger = {
        id: gesture.id,
        descriptor: gesture.descriptor,
        attempt,
        state: "pending",
      };
      const preparationId = crypto.randomUUID();
      const args = {
        scope: SCOPE,
        pageToken: await token(),
        operationId: preparationId,
        checks: [{ key: ledgerKey, version: entry?.version ?? null }],
        writes: [{ key: ledgerKey, value: nextLedger }],
        legacy: [],
        expectedRevision: snapshot.revision,
        claim: null,
      };
      let prepared: Outcome | null;
      try {
        prepared = await invoke<Outcome>("canonical_store_transaction", args);
      } catch {
        try {
          prepared = await reconcileSessionOrganizationReceipt(preparationId);
        } catch {
          return { state: "unknown", operationId: preparationId };
        }
        if (!prepared) return { state: "unknown", operationId: preparationId };
      }
      if (!prepared.applied) return { state: "conflict" };
      mayDispatch = true;
      try {
        snapshot = await read([ledgerKey]);
      } catch {
        return { state: "unknown", operationId: attemptId(gesture.id, attempt) };
      }
      entry = snapshot.entries.find((item) => item.key === ledgerKey);
      ledger = entry?.value as GestureLedger | undefined;
      if (
        !ledger ||
        ledger.id !== gesture.id ||
        ledger.attempt !== attempt ||
        ledger.state !== "pending"
      )
        throw new Error("Organization gesture changed before dispatch.");
    }
    let previous: SessionOrganizationState;
    try {
      previous = fromSnapshot(snapshot);
    } catch {
      return { state: "unknown", operationId: attemptId(gesture.id, ledger.attempt) };
    }
    let next: SessionOrganizationState;
    try {
      next = gesture.apply(structuredClone(previous));
    } catch (error) {
      const rejectionId = crypto.randomUUID();
      let rejected: Outcome | null;
      try {
        rejected = await invoke<Outcome>("canonical_store_transaction", {
          scope: SCOPE,
          pageToken: await token(),
          operationId: rejectionId,
          checks: [{ key: ledgerKey, version: entry?.version ?? null }],
          writes: [{ key: ledgerKey, value: { ...ledger, state: "rejected" } }],
          legacy: [],
          expectedRevision: snapshot.revision,
          claim: null,
        });
      } catch {
        try {
          rejected = await reconcileSessionOrganizationReceipt(rejectionId);
        } catch {
          rejected = null;
        }
      }
      if (!rejected?.applied)
        return { state: "unknown", operationId: attemptId(gesture.id, ledger.attempt) };
      throw error;
    }
    const operationId = attemptId(gesture.id, ledger.attempt);
    let pageToken: string;
    try {
      pageToken = await token();
    } catch {
      return { state: "unknown", operationId };
    }
    const args = {
      scope: SCOPE,
      pageToken,
      operationId,
      checks: [...KEYS, ledgerKey].map((key) => ({
        key,
        version: snapshot.entries.find((item) => item.key === key)?.version ?? null,
      })),
      writes: [
        { key: FOLDERS, value: JSON.stringify(next.folders) },
        { key: ORDER, value: JSON.stringify(next.order) },
        { key: ledgerKey, value: { ...ledger, state: "applied" } },
      ],
      legacy: [],
      expectedRevision: snapshot.revision,
      claim: null,
    };
    let outcome: Outcome;
    try {
      outcome = await invoke<Outcome>("canonical_store_transaction", args);
    } catch {
      try {
        const receipt = await reconcileSessionOrganizationReceipt(operationId);
        if (!receipt) return { state: "unknown", operationId };
        outcome = receipt;
      } catch {
        return { state: "unknown", operationId };
      }
    }
    // A committed receipt is decisive even if a later refresh fails.
    if (outcome.applied) {
      return { state: "applied", value: next, previous };
    }
    mayDispatch = false;
  }
  return { state: "conflict" };
}
