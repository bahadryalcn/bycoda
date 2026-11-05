import { invoke } from "@tauri-apps/api/core";
import {
  pinAttempt,
  pinReceipt,
  type NativePinAuthority,
  type PinReceipt,
  type PinTarget,
} from "../data/sessionPinReceipts";
import {
  executeOrganizationOperation,
  previewOrganizationOperation,
  type OrganizationOperation,
} from "./sessionOrganizationOperations";
import {
  hydrateSessionOrganization,
  type SessionOrganizationResult,
} from "./sessionOrganizationStore";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { newRequestId } from "../../../shared/lib/id/requestId";

const SCOPE = "session-pin-saga.v1";
type Entry = { key: string; version: number; value: unknown };
type Snapshot = { entries: Entry[]; revision: number };
type Outcome = { applied: boolean };
export type PinSagaStep = {
  viewSessionId: string;
  viewCwd: string;
  viewKind: "local" | "remote";
  target: PinTarget;
  operationId: string;
  desiredPinned: boolean;
  expectedVersion: number;
  expectedAuthority?: NativePinAuthority | null;
  previousPinned: boolean;
  state: "not-started" | "pending" | "applied" | "superseded" | "refused";
  receipt?: PinReceipt;
  attempts?: Array<{ operationId: string; receipt: PinReceipt }>;
};
export type PinSaga = {
  id: string;
  organizationId: string;
  organization: OrganizationOperation | null;
  steps: PinSagaStep[];
  state: "prepared" | "pins-applied" | "applied" | "partial" | "accepted";
};
export type PinSagaResult =
  | { state: "applied"; saga: PinSaga; organization?: SessionOrganizationResult }
  | {
      state: "partial" | "conflict" | "unknown" | "applied-unavailable";
      saga: PinSaga;
      operationId?: string;
    };
let pageToken: Promise<string> | undefined;
const token = () =>
  (pageToken ??= invoke<string>("canonical_store_page_token").catch((error: unknown) => {
    pageToken = undefined;
    throw error;
  }));
const key = (id: string) => `saga:${id}`;
async function read(id: string): Promise<Snapshot> {
  return invoke("canonical_store_read", { scope: SCOPE, keys: [key(id)] });
}

function validateSaga(value: unknown): asserts value is PinSaga {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pin saga; recovery is required.");
  const saga = value as PinSaga;
  if (
    typeof saga.id !== "string" ||
    !saga.id ||
    typeof saga.organizationId !== "string" ||
    !saga.organizationId ||
    !["prepared", "pins-applied", "applied", "partial", "accepted"].includes(saga.state) ||
    !Array.isArray(saga.steps) ||
    (saga.organization !== null &&
      (!saga.organization ||
        typeof saga.organization !== "object" ||
        typeof saga.organization.kind !== "string"))
  )
    throw new Error("Invalid pin saga; recovery is required.");
  const ids = new Set<string>();
  for (const step of saga.steps) {
    if (
      !step ||
      typeof step.operationId !== "string" ||
      !step.operationId ||
      ids.has(step.operationId) ||
      typeof step.viewSessionId !== "string" ||
      !step.viewSessionId ||
      typeof step.viewCwd !== "string" ||
      !step.viewCwd ||
      !["local", "remote"].includes(step.viewKind) ||
      typeof step.desiredPinned !== "boolean" ||
      typeof step.previousPinned !== "boolean" ||
      !Number.isSafeInteger(step.expectedVersion) ||
      step.expectedVersion < 0 ||
      !["not-started", "pending", "applied", "superseded", "refused"].includes(step.state) ||
      !step.target ||
      typeof step.target.sessionId !== "string" ||
      !step.target.sessionId ||
      (step.target.kind !== "native" && step.target.kind !== "host") ||
      (step.target.kind === "native" &&
        (typeof step.target.cwd !== "string" ||
          !step.target.cwd ||
          isRemoteProjectPath(step.target.cwd))) ||
      (step.target.kind === "host" &&
        (!step.target.machineId || !step.target.environmentId || !step.target.projectId)) ||
      (step.viewKind === "remote" && (step.target.kind !== "host" || !step.target.environmentId)) ||
      (step.expectedAuthority != null &&
        (step.target.kind !== "native" ||
          typeof step.expectedAuthority.environmentId !== "string" ||
          !step.expectedAuthority.environmentId ||
          !Number.isSafeInteger(step.expectedAuthority.generation) ||
          step.expectedAuthority.generation < 0 ||
          step.expectedAuthority.phase !== "NATIVE" ||
          step.expectedAuthority.minWriterProtocol !== 2)) ||
      (step.state === "applied" &&
        (!step.receipt ||
          step.receipt.state !== "applied" ||
          step.receipt.pinned !== step.desiredPinned))
    )
      throw new Error("Invalid pin saga step; recovery is required.");
    ids.add(step.operationId);
  }
  if (
    (saga.state === "applied" && saga.steps.some((step) => step.state !== "applied")) ||
    (saga.state === "accepted" && saga.steps.some((step) => step.state === "pending"))
  )
    throw new Error("Invalid pin saga settlement; recovery is required.");
}

async function scanPinSagas(): Promise<{ sagas: PinSaga[]; revision: number }> {
  let after: string | null = null;
  let revision: number | null = null;
  const sagas: PinSaga[] = [];
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
      if (entry.key.startsWith("saga:")) {
        validateSaga(entry.value);
        if (entry.key !== key(entry.value.id)) throw new Error("Pin saga identity mismatch.");
        sagas.push(entry.value);
      }
    }
    if (page.entries.length < 128) return { sagas, revision: page.revision };
  }
}

export async function listPinSagas(): Promise<PinSaga[]> {
  return (await scanPinSagas()).sagas;
}

/** Explicitly retain a proven partial result; pending/unknown effects cannot be acknowledged. */
export async function acknowledgePartialPinSaga(
  id: string,
): Promise<"applied" | "conflict" | "unknown"> {
  const snapshot = await read(id);
  const saga = snapshot.entries[0]?.value;
  validateSaga(saga);
  if (
    saga.id !== id ||
    saga.state !== "partial" ||
    saga.steps.some((step) => step.state === "pending")
  )
    throw new Error("Pin outcome is not ready for acknowledgement.");
  return write(snapshot, { ...saga, state: "accepted" });
}

async function write(
  snapshot: Snapshot,
  saga: PinSaga,
): Promise<"applied" | "conflict" | "unknown"> {
  const operationId = newRequestId();
  const args = {
    scope: SCOPE,
    pageToken: await token(),
    operationId,
    checks: [{ key: key(saga.id), version: snapshot.entries[0]?.version ?? null }],
    writes: [{ key: key(saga.id), value: saga }],
    expectedRevision: snapshot.revision,
    legacy: [],
    claim: null,
  };
  try {
    return (await invoke<Outcome>("canonical_store_transaction", args)).applied
      ? "applied"
      : "conflict";
  } catch {
    try {
      const receipt = await invoke<Outcome | null>("canonical_store_receipt", {
        scope: SCOPE,
        operationId,
      });
      return receipt ? (receipt.applied ? "applied" : "conflict") : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/** Persist every exact pin target, desired value, version and operation ID before dispatch. */
export async function preparePinSaga(saga: PinSaga): Promise<"applied" | "conflict" | "unknown"> {
  const captured = structuredClone(saga);
  validateSaga(captured);
  if (
    !captured.id ||
    captured.state !== "prepared" ||
    captured.steps.some((step) => step.state !== "not-started")
  )
    throw new Error("Invalid pin saga.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const scan = await scanPinSagas();
    if (
      scan.sagas.some(
        (entry) =>
          entry.id !== captured.id && entry.state !== "applied" && entry.state !== "accepted",
      )
    )
      return "conflict";
    const snapshot = await read(captured.id);
    if (snapshot.revision !== scan.revision) continue;
    if (snapshot.entries.length) {
      if (JSON.stringify(snapshot.entries[0].value) !== JSON.stringify(captured))
        throw new Error("Pin saga ID was reused.");
      return "applied";
    }
    return write(snapshot, captured);
  }
  return "conflict";
}

/** A pending step is reconciled only by its original receipt; missing is unknown. */
export async function resumePinSaga(id: string): Promise<PinSagaResult> {
  for (;;) {
    let snapshot = await read(id);
    const persistedSaga = snapshot.entries[0]?.value;
    validateSaga(persistedSaga);
    let saga = persistedSaga;
    if (saga.id !== id) throw new Error("Pin saga identity mismatch.");
    if (saga.state === "partial" || saga.state === "accepted") return { state: "partial", saga };
    if (saga.state === "applied") {
      if (!saga.organization) return { state: "applied", saga };
      try {
        const organization = await executeOrganizationOperation(
          saga.organizationId,
          saga.organization,
        );
        return organization.state === "applied"
          ? { state: "applied", saga, organization }
          : { state: "applied-unavailable", saga, operationId: saga.organizationId };
      } catch {
        return { state: "applied-unavailable", saga, operationId: saga.organizationId };
      }
    }
    const index = saga.steps.findIndex((step) => step.state !== "applied");
    if (index < 0) {
      if (!saga.organization) {
        const done = { ...saga, state: "applied" as const };
        const saved = await write(snapshot, done);
        return saved === "applied"
          ? { state: "applied", saga: done }
          : { state: "applied-unavailable", saga, operationId: saga.id };
      }
      const organization = await executeOrganizationOperation(
        saga.organizationId,
        saga.organization,
      );
      if (organization.state !== "applied") {
        if (organization.state === "conflict") {
          const partial = { ...saga, state: "partial" as const };
          const saved = await write(snapshot, partial);
          return {
            state: saved === "applied" ? "partial" : saved,
            saga: saved === "applied" ? partial : saga,
          };
        }
        return {
          state: organization.state === "applied-unavailable" ? "applied-unavailable" : "unknown",
          saga,
          operationId: organization.operationId,
        };
      }
      const done = { ...saga, state: "applied" as const };
      const saved = await write(snapshot, done);
      return saved === "applied"
        ? { state: "applied", saga: done, organization }
        : { state: "applied-unavailable", saga, operationId: saga.id };
    }
    let step = saga.steps[index];
    if (step.state === "superseded" || step.state === "refused") return { state: "partial", saga };
    let receipt: PinReceipt | null;
    if (step.state === "pending") {
      try {
        receipt = await pinReceipt(step.target, step.operationId);
      } catch {
        return { state: "unknown", saga, operationId: step.operationId };
      }
      if (!receipt) return { state: "unknown", saga, operationId: step.operationId };
    } else {
      if (saga.organization) {
        try {
          previewOrganizationOperation(await hydrateSessionOrganization(), saga.organization);
        } catch {
          const partial = { ...saga, state: "partial" as const };
          const saved = await write(snapshot, partial);
          return {
            state: saved === "applied" ? "partial" : saved,
            saga: saved === "applied" ? partial : saga,
          };
        }
      }
      const pending = {
        ...saga,
        steps: saga.steps.map((item, at) =>
          at === index ? { ...item, state: "pending" as const } : item,
        ),
      };
      const saved = await write(snapshot, pending);
      if (saved !== "applied") return { state: saved, saga };
      saga = pending;
      step = pending.steps[index];
      const attempt = await pinAttempt(
        step.target,
        step.operationId,
        step.desiredPinned,
        step.expectedVersion,
        step.expectedAuthority,
      );
      if (attempt.state === "unknown")
        return { state: "unknown", saga, operationId: attempt.operationId };
      receipt = attempt;
      try {
        snapshot = await read(id);
      } catch {
        const evidenced: PinSaga = {
          ...saga,
          steps: saga.steps.map((item, at) =>
            at === index && receipt!.state !== "current"
              ? {
                  ...item,
                  state: receipt!.state as "applied" | "superseded" | "refused",
                  receipt: receipt!,
                }
              : item,
          ),
        };
        return { state: "unknown", saga: evidenced, operationId: step.operationId };
      }
      const observed = snapshot.entries[0]?.value as PinSaga | undefined;
      if (!observed || JSON.stringify(observed) !== JSON.stringify(saga))
        return { state: "conflict", saga };
    }
    if (receipt.state === "current") throw new Error("Invalid pin receipt.");
    if (
      receipt.state === "superseded" &&
      receipt.pinned === step.previousPinned &&
      JSON.stringify(receipt.authority ?? null) ===
        JSON.stringify(step.expectedAuthority ?? null) &&
      (step.attempts?.length ?? 0) < 4
    ) {
      const retry: PinSaga = {
        ...saga,
        steps: saga.steps.map((item, at) =>
          at === index
            ? {
                ...item,
                attempts: [
                  ...(item.attempts ?? []),
                  { operationId: item.operationId, receipt: receipt! },
                ],
                operationId: newRequestId(),
                expectedVersion: receipt!.version,
                state: "not-started" as const,
              }
            : item,
        ),
      };
      const saved = await write(snapshot, retry);
      if (saved !== "applied") return { state: saved, saga };
      continue;
    }
    const updated: PinSaga = {
      ...saga,
      state: receipt.state === "applied" ? "prepared" : "partial",
      steps: saga.steps.map((item, at) =>
        at === index
          ? {
              ...item,
              state: receipt!.state as "applied" | "superseded" | "refused",
              receipt: receipt!,
            }
          : item,
      ),
    };
    const saved = await write(snapshot, updated);
    if (saved !== "applied") return { state: saved, saga };
  }
}
