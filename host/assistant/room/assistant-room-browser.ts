import { createHash } from "node:crypto";
import type { SessionBrowserRegistry } from "../../browser/shared-browser";
import {
  ConversationPreviewWorkflow,
  type ConversationPreviewInput,
  type PreviewBrowserState,
  type PreviewPresentation,
} from "../../conversation/conversation-preview";
import {
  managementReceiptKey,
  type ManagementReceipt,
} from "../../conversation/conversation-management-tools";
import { roomOperationInput } from "./assistant-room-operation-input";
import { validateConversationTool } from "../../conversation/conversation-tools";

const actions = new Set([
  "browser.status",
  "browser.claim",
  "browser.release",
  "browser.open",
  "browser.frame",
  "browser.read",
  "browser.resize",
  "browser.preview",
  "browser.input",
  "browser.close",
  "browser.operation.status",
]);
export const isRoomBrowserAction = (action: string) => actions.has(action);
export type RoomBrowserSource = {
  environmentId: string;
  projectId: string;
  projectCwd: string;
  threadId: string;
  deviceHash: string;
};
export function createRoomBrowserTools(ports: {
  registry: Pick<SessionBrowserRegistry, "dispatchForRoom">;
  previews: ConversationPreviewWorkflow;
  describe(value: object): Promise<unknown>;
  present?(source: RoomBrowserSource): Promise<PreviewPresentation>;
  receipt(key: string): Promise<ManagementReceipt | undefined>;
  saveReceipt(key: string, value: ManagementReceipt): Promise<void>;
}) {
  const pending = new Map<string, { signature: string; result: Promise<unknown> }>();
  return {
    async call(
      action: string,
      input: Record<string, unknown>,
      source: RoomBrowserSource,
      requestId: string,
      authorized: () => Promise<boolean>,
      ownerControl?: { takeover: boolean },
      presentation?: () => Promise<PreviewPresentation>,
    ) {
      if (
        !actions.has(action) ||
        !requestId ||
        Object.values(source).some((value) => typeof value !== "string" || !value) ||
        [
          "projectId",
          "projectCwd",
          "roomProjectCwd",
          "sessionId",
          "threadId",
          "environmentId",
          "ownerPresentationScope",
        ].some((key) => Object.hasOwn(input, key))
      )
        throw new Error("A real qualified Room browser source is required.");
      const credential = createHash("sha256")
        .update(
          JSON.stringify([
            "assistant-thread-browser",
            source.environmentId,
            source.projectId,
            source.projectCwd,
            source.threadId,
          ]),
        )
        .digest("hex");
      const { deviceHash: _deviceHash, ...context } = source;
      const check = async () => {
        if (!(await authorized())) throw new Error("Room browser authority changed.");
      };
      const receiptKey = (operationId: string) =>
        managementReceiptKey(
          {
            kind: "assistant-thread",
            threadId: source.threadId,
            projectId: source.projectId,
            provider: "assistant",
          },
          operationId,
        );
      const signature = (original: Record<string, unknown>, operationId: string) =>
        createHash("sha256")
          .update(
            JSON.stringify([
              "browser.input",
              roomOperationInput({ ...original, roomBrowserOwner: credential }, operationId),
            ]),
          )
          .digest("hex");
      const dispatch = async (method: string, params: Record<string, unknown>) => {
        await check();
        const result = await ports.registry.dispatchForRoom(
          method,
          { ...params, ...context, roomProjectCwd: source.projectCwd },
          credential,
          ownerControl,
        );
        await check();
        return result;
      };
      await check();
      if (action === "browser.operation.status") {
        if (
          typeof input.operationId !== "string" ||
          !input.operationId ||
          input.operationId.length > 200 ||
          !input.originalInput ||
          typeof input.originalInput !== "object" ||
          Array.isArray(input.originalInput)
        )
          throw new Error("Original browser input identity is required.");
        validateConversationTool("browser.input", input.originalInput as Record<string, unknown>);
        const receipt = await ports.receipt(receiptKey(input.operationId));
        await check();
        if (!receipt) return { operationId: input.operationId, state: "unknown" };
        if (
          receipt.signature !==
          signature(input.originalInput as Record<string, unknown>, input.operationId)
        )
          throw new Error("Original browser input changed.");
        return {
          operationId: input.operationId,
          ...receipt,
          state: receipt.state === "pending" ? "uncertain" : receipt.state,
        };
      }
      if (action === "browser.preview")
        return ports.previews.run(
          input as unknown as ConversationPreviewInput,
          {
            kind: "assistant-thread",
            threadId: source.threadId,
            projectId: source.projectId,
            principalId: credential,
          },
          {
            authorize: check,
            browser: async (method, params) =>
              (await dispatch(method, params)) as unknown as PreviewBrowserState,
            present: async () => {
              await check();
              if (!presentation && !ports.present)
                throw new Error(
                  "The Room browser is available; its native panel owner is not connected. Page readiness does not prove a visible panel.",
                );
              const result = await (presentation ? presentation() : ports.present!(source));
              await check();
              return result;
            },
          },
        );
      if (action === "browser.input") {
        validateConversationTool(action, input);
        const key = receiptKey(requestId),
          expected = signature(input, requestId);
        const active = pending.get(key);
        if (active) {
          if (active.signature !== expected)
            throw new Error("Browser operation identity was reused with changed input.");
          const result = await active.result;
          await check();
          return result;
        }
        const execute = async () => {
          const previous = await ports.receipt(key);
          await check();
          if (previous) {
            if (previous.signature !== expected)
              throw new Error("Browser operation identity was reused with changed input.");
            return {
              requestId,
              ...previous,
              state: previous.state === "pending" ? "uncertain" : previous.state,
            };
          }
          await ports.saveReceipt(key, { signature: expected, state: "pending" });
          try {
            const backendRequestId = createHash("sha256")
              .update(JSON.stringify([credential, requestId]))
              .digest("hex");
            const result = await dispatch(action, { ...input, requestId: backendRequestId });
            const receipt: ManagementReceipt = { signature: expected, state: "completed", result };
            await ports.saveReceipt(key, receipt);
            return { requestId, ...receipt };
          } catch {
            const receipt: ManagementReceipt = {
              signature: expected,
              state: "uncertain",
              error:
                "Browser input delivery is unknown. Inspect the original operation before any new input.",
            };
            await ports.saveReceipt(key, receipt);
            return { requestId, ...receipt };
          }
        };
        const entry = { signature: expected, result: execute() };
        pending.set(key, entry);
        try {
          return await entry.result;
        } finally {
          if (pending.get(key) === entry) pending.delete(key);
        }
      }
      const result = await dispatch(action, input);
      return ["browser.status", "browser.claim", "browser.release"].includes(action)
        ? ports.describe(result as object)
        : result;
    },
  };
}
