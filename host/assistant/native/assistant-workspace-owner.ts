import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import {
  validateRoomWorkspaceAction,
  type RoomWorkspaceAction,
} from "../room/assistant-room-workspace";

type Action = Exclude<
  RoomWorkspaceAction,
  "workspace.operation.status" | "workspace.sessions.submit.status"
>;
export type WorkspaceOwnerSource = {
  environmentId: string;
  threadId: string;
  projectId: string;
  targetProjectCwd: string;
  targetDeviceHash: string;
  installationId: string;
  registryRevision: string;
  visibilityEpoch: number;
  policyGeneration: string;
  action: Action;
  originalInput: Record<string, unknown>;
  requestId: string;
};
type Source = WorkspaceOwnerSource;
type State = "prepared" | "unknown" | "ownerAccepted" | "completed";
export type WorkspaceOwnerReceipt = Omit<Source, "originalInput"> & {
  operationHash: string;
  state: State;
};
const actions = new Set<Action>([
  "workspace.projects.select",
  "workspace.sessions.create",
  "workspace.sessions.open",
  "workspace.sessions.submit",
  "workspace.sessions.stop",
  "organization.patch",
]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const workspaceOperationJson = (
  source: Pick<Source, "action" | "targetProjectCwd" | "originalInput">,
) => JSON.stringify([source.action, source.targetProjectCwd, source.originalInput]);
const operationDigest = (source: Pick<Source, "action" | "targetProjectCwd" | "originalInput">) =>
  createHash("sha256").update(workspaceOperationJson(source), "utf8").digest("hex");
const sameSource = (left: Omit<Source, "originalInput">, right: Omit<Source, "originalInput">) =>
  left.environmentId === right.environmentId &&
  left.threadId === right.threadId &&
  left.projectId === right.projectId &&
  left.targetProjectCwd === right.targetProjectCwd &&
  left.targetDeviceHash === right.targetDeviceHash &&
  left.installationId === right.installationId &&
  left.registryRevision === right.registryRevision &&
  left.visibilityEpoch === right.visibilityEpoch &&
  left.policyGeneration === right.policyGeneration &&
  left.action === right.action &&
  left.requestId === right.requestId;
const identity = (source: Pick<Source, "environmentId" | "threadId" | "requestId">) =>
  hash([source.environmentId, source.threadId, source.requestId]);

/** Durable one-shot native workspace handoff. Stores only source identity and input fingerprint. */
export class AssistantWorkspaceOwner {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS assistant_workspace_owner (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ),
    );
  }
  async prepare(
    source: Source,
    current: () => Promise<boolean>,
    valid: () => boolean,
  ): Promise<WorkspaceOwnerReceipt> {
    await this.ready;
    if (
      source.environmentId !== this.store.environmentId ||
      !source.threadId ||
      source.threadId.length > 200 ||
      !source.projectId ||
      source.projectId.length > 200 ||
      !source.targetProjectCwd ||
      source.targetProjectCwd.length > 4096 ||
      !/^[a-f0-9]{64}$/.test(source.targetDeviceHash) ||
      !source.installationId ||
      !source.registryRevision ||
      !source.policyGeneration ||
      !Number.isSafeInteger(source.visibilityEpoch) ||
      source.visibilityEpoch < 0 ||
      !actions.has(source.action) ||
      !source.requestId ||
      source.requestId.length > 200 ||
      Buffer.byteLength(JSON.stringify(source.originalInput), "utf8") > 32768
    )
      throw new Error("Invalid native workspace owner source.");
    validateRoomWorkspaceAction(source.action, source.originalInput, source.requestId);
    if (!valid() || !(await current()) || !valid())
      throw new Error("Native workspace source is unavailable.");
    const { originalInput: _originalInput, ...bound } = source;
    const operationHash = operationDigest(source);
    const next: WorkspaceOwnerReceipt = { ...bound, operationHash, state: "prepared" };
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Native workspace source changed.");
      const id = identity(source),
        row = await this.store.db
          .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
          .get(id);
      if (row) {
        const previous = JSON.parse(String(row.value)) as WorkspaceOwnerReceipt;
        if (!sameSource(previous, next) || previous.operationHash !== next.operationHash)
          throw new Error(
            "Workspace operation identity was reused with different source or input.",
          );
        return previous;
      }
      if (
        Number(
          (await this.store.db
            .prepare("SELECT COUNT(*) AS count FROM assistant_workspace_owner")
            .get())!.count,
        ) >= 10000
      )
        throw new Error("Native workspace receipt capacity reached.");
      await this.store.db
        .prepare("INSERT INTO assistant_workspace_owner(id,value) VALUES(?,?)")
        .run(id, JSON.stringify(next));
      if (!valid()) throw new Error("Native workspace source changed.");
      return next;
    }, "critical");
  }
  /** Persist unknown before relay; crash or observer timeout can never cause an automatic resend. */
  async claim(receipt: WorkspaceOwnerReceipt, valid: () => boolean): Promise<boolean> {
    await this.ready;
    return this.store.transaction(async () => {
      if (!valid()) return false;
      const id = identity(receipt),
        row = await this.store.db
          .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
          .get(id);
      const current = row ? (JSON.parse(String(row.value)) as WorkspaceOwnerReceipt) : null;
      if (
        !current ||
        current.state !== "prepared" ||
        current.operationHash !== receipt.operationHash ||
        !sameSource(current, receipt)
      )
        return false;
      await this.store.db
        .prepare("UPDATE assistant_workspace_owner SET value=? WHERE id=?")
        .run(JSON.stringify({ ...current, state: "unknown" }), id);
      if (!valid()) throw new Error("Native workspace source changed.");
      return true;
    }, "critical");
  }
  /** Once signed native ownership was committed under the admission lease, later
   * registry changes govern new work and do not revoke this exact transfer. */
  async authorize(
    input: { environmentId: string; threadId: string; requestId: string; operationHash: string },
    deviceHash: string,
  ): Promise<boolean> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
      .get(identity(input));
    const receipt = row ? (JSON.parse(String(row.value)) as WorkspaceOwnerReceipt) : null;
    if (
      !receipt ||
      receipt.environmentId !== this.store.environmentId ||
      input.environmentId !== receipt.environmentId ||
      receipt.threadId !== input.threadId ||
      receipt.requestId !== input.requestId ||
      receipt.operationHash !== input.operationHash ||
      receipt.targetDeviceHash !== deviceHash ||
      receipt.state !== "ownerAccepted"
    )
      return false;
    return true;
  }
  async settle(
    receipt: WorkspaceOwnerReceipt,
    state: "ownerAccepted" | "completed" | "unknown",
    valid: () => boolean,
  ): Promise<WorkspaceOwnerReceipt> {
    await this.ready;
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Native workspace source changed.");
      const id = identity(receipt),
        row = await this.store.db
          .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
          .get(id);
      const current = row ? (JSON.parse(String(row.value)) as WorkspaceOwnerReceipt) : null;
      if (
        !current ||
        current.operationHash !== receipt.operationHash ||
        !sameSource(current, receipt) ||
        current.state === "prepared"
      )
        throw new Error("Native workspace receipt identity changed.");
      const rank: Record<State, number> = {
        prepared: 0,
        unknown: 1,
        ownerAccepted: 2,
        completed: 3,
      };
      const next = rank[state] > rank[current.state] ? { ...current, state } : current;
      if (next !== current)
        await this.store.db
          .prepare("UPDATE assistant_workspace_owner SET value=? WHERE id=?")
          .run(JSON.stringify(next), id);
      if (!valid()) throw new Error("Native workspace source changed.");
      return next;
    }, "critical");
  }
  async status(
    source: Source,
    current: () => Promise<boolean>,
    valid: () => boolean,
  ): Promise<WorkspaceOwnerReceipt | null> {
    await this.ready;
    if (!valid() || !(await current()) || !valid())
      throw new Error("Native workspace source is unavailable.");
    validateRoomWorkspaceAction(source.action, source.originalInput, source.requestId);
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
      .get(identity(source));
    if (!row) return null;
    const receipt = JSON.parse(String(row.value)) as WorkspaceOwnerReceipt;
    const { originalInput: _originalInput, ...bound } = source;
    if (receipt.operationHash !== operationDigest(source) || !sameSource(receipt, bound))
      throw new Error("Native workspace status source changed.");
    if (!valid() || !(await current()) || !valid())
      throw new Error("Native workspace source is unavailable.");
    return receipt;
  }
  /** Internal recovery lookup; caller must qualify and compare the full source. */
  async lookup(
    environmentId: string,
    threadId: string,
    requestId: string,
  ): Promise<WorkspaceOwnerReceipt | null> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_workspace_owner WHERE id=?")
      .get(identity({ environmentId, threadId, requestId }));
    return row ? (JSON.parse(String(row.value)) as WorkspaceOwnerReceipt) : null;
  }
}
