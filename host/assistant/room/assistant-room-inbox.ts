import { createHash } from "node:crypto";
import { parseRemoteInboxOperation } from "../../../src/features/inbox/model/remoteInbox";
import { roomOperationInput } from "./assistant-room-operation-input";

export type RoomInboxSource = {
  environmentId: string;
  threadId: string;
  projectId: string;
  projectCwd: string;
  deviceHash: string;
};
type Receipt = {
  signature: string;
  source: RoomInboxSource;
  provider: string;
  accountProof?: string;
  state: "pending" | "completed" | "uncertain";
  result?: unknown;
};
const actions = new Set([
  "inbox.providers.list",
  "inbox.details",
  "inbox.thread",
  "inbox.comment",
  "inbox.reviewContext",
  "inbox.review",
  "inbox.prAction",
  "inbox.result",
]);
export const isRoomInboxAction = (action: string) => actions.has(action);

/** Native owns credential snapshots, exact record discovery, review and physical I/O. */
export class AssistantRoomInbox {
  private readonly active = new Map<string, { signature: string; result: Promise<unknown> }>();
  constructor(
    private readonly ports: {
      read(key: string): Promise<Receipt | undefined>;
      write(key: string, receipt: Receipt): Promise<void>;
      execute(
        input: Record<string, unknown>,
        source: RoomInboxSource,
        authorized: () => Promise<boolean>,
      ): Promise<unknown>;
    },
  ) {}

  async call(
    action: string,
    input: Record<string, unknown>,
    source: RoomInboxSource,
    requestId: string,
    authorized: () => Promise<boolean>,
  ) {
    if (
      !actions.has(action) ||
      Object.values(source).some((value) => !value) ||
      !(await authorized())
    )
      throw new Error("Room Inbox source unavailable.");
    const originalId = String(input.requestId ?? "");
    if (
      !originalId ||
      originalId.length > 200 ||
      originalId.includes("\0") ||
      (action !== "inbox.result" && originalId !== requestId)
    )
      throw new Error("Inbox original operation identity changed.");
    const key = `room-inbox:${createHash("sha256")
      .update(JSON.stringify([source.environmentId, source.threadId, source.projectId, originalId]))
      .digest("hex")}`;
    const currentResult = async (receipt: Receipt) => {
      if (!(await authorized())) throw new Error("Room Inbox authority changed.");
      if (
        ["environmentId", "threadId", "projectId", "projectCwd", "deviceHash"].some(
          (field) =>
            receipt.source[field as keyof RoomInboxSource] !==
            source[field as keyof RoomInboxSource],
        )
      )
        throw new Error("Original Inbox source identity changed.");
      if (receipt.state !== "completed") return { requestId: originalId, state: "uncertain" };
      const proof =
        receipt.accountProof ?? (receipt.result as { accountProof?: unknown })?.accountProof;
      if (typeof proof !== "string" || !proof)
        throw new Error("Refresh the original provider discovery; account source is unavailable.");
      const checked = await this.ports.execute(
        {
          requestId,
          provider: receipt.provider,
          accountProof: proof,
          operation: { action: "source-check", cwd: source.projectCwd },
        },
        source,
        authorized,
      );
      if (
        !checked ||
        typeof checked !== "object" ||
        Array.isArray(checked) ||
        Object.keys(checked).length !== 1 ||
        (checked as { current?: unknown }).current !== true
      )
        throw new Error("Room Inbox account source could not be verified.");
      if (!(await authorized())) throw new Error("Room Inbox authority changed.");
      return { requestId: originalId, state: "completed", result: receipt.result };
    };
    if (action === "inbox.result") {
      const receipt = await this.ports.read(key);
      return receipt ? currentResult(receipt) : { requestId: originalId, state: "unknown" };
    }
    const item = input.item as { provider?: unknown; projectPath?: unknown } | undefined;
    if (item?.projectPath !== undefined && item.projectPath !== source.projectCwd)
      throw new Error("Inbox record belongs to another project.");
    const provider = action === "inbox.providers.list" ? input.provider : item?.provider;
    if (provider !== "github" && provider !== "jira")
      throw new Error("Choose the GitHub or Jira provider for this Room request.");
    const operation = parseRemoteInboxOperation(
      {
        ...input,
        ...(item ? { item: { ...item, projectPath: source.projectCwd } } : {}),
        projectId: source.projectId,
        action:
          action === "inbox.providers.list"
            ? "list"
            : action === "inbox.prAction"
              ? "pr-action"
              : action === "inbox.reviewContext"
                ? "review-context"
                : action.slice(6),
        ...(action === "inbox.providers.list"
          ? {
              query: {
                assignedToMe: input.assignedToMe,
                state: input.state,
                search: input.search,
                githubKinds: input.githubKinds,
              },
            }
          : {}),
      },
      [{ id: source.projectId, cwd: source.projectCwd }],
    );
    const accountProof = typeof input.accountProof === "string" ? input.accountProof : undefined;
    if (action !== "inbox.providers.list" && !accountProof)
      throw new Error("Use the accountProof returned by the original provider list.");
    const signature = createHash("sha256")
      .update(
        JSON.stringify([
          action,
          roomOperationInput(input, originalId),
          [
            source.environmentId,
            source.threadId,
            source.projectId,
            source.projectCwd,
            source.deviceHash,
          ],
        ]),
      )
      .digest("hex");
    const previous = await this.ports.read(key);
    if (previous) {
      if (previous.signature !== signature)
        throw new Error("Inbox request identity was reused with changed input.");
      return currentResult(previous);
    }
    const active = this.active.get(key);
    if (active) {
      if (active.signature !== signature)
        throw new Error("Inbox request identity was reused with changed input.");
      return { requestId: originalId, state: "uncertain" };
    }
    const work = async () => {
      const receipt: Receipt = {
        signature,
        source: { ...source },
        provider,
        ...(accountProof ? { accountProof } : {}),
        state: "pending",
      };
      await this.ports.write(key, receipt);
      try {
        if (!(await authorized())) throw new Error("Room Inbox authority changed.");
        const result = await this.ports.execute(
          { requestId: originalId, provider, operation, ...(accountProof ? { accountProof } : {}) },
          source,
          authorized,
        );
        if (!(await authorized())) throw new Error("Room Inbox authority changed.");
        const completed: Receipt = { ...receipt, state: "completed", result };
        await this.ports.write(key, completed);
        return { requestId: originalId, state: "completed", result };
      } catch {
        await this.ports.write(key, { ...receipt, state: "uncertain" });
        return { requestId: originalId, state: "uncertain" };
      }
    };
    const pending = { signature, result: work() };
    this.active.set(key, pending);
    try {
      return await pending.result;
    } finally {
      if (this.active.get(key) === pending) this.active.delete(key);
    }
  }
}
