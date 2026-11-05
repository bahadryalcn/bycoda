import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { callFileConversationTool } from "../../conversation/conversation-file-tools";
import { validateConversationTool } from "../../conversation/conversation-tools";
import { ConversationManagementTools, managementReceiptKey, type ManagementReceipt } from "../../conversation/conversation-management-tools";
import { roomOperationInput } from "./assistant-room-operation-input";
export { ROOM_FILE_STATUS_TOOL } from "./assistant-room-tool-schemas";
import type { AssistantThreadPrincipal } from "../../sessions/session-authority";

const reads = new Set(["files.inspect", "files.list", "files.index", "files.search", "files.searchContent", "files.read"]);
const writes = new Set(["files.create", "files.write", "files.rename", "files.move", "files.copy", "files.delete"]);
const statusSchema = z.strictObject({ operationId: z.string().min(1).max(200), action: z.enum(["files.create", "files.write", "files.rename", "files.move", "files.copy", "files.delete"]), originalInput: z.record(z.string(), z.unknown()) });
export function isRoomFileAction(action: string): boolean { return action === "files.operation.status" || reads.has(action) || writes.has(action); }
export function isRoomFileWrite(action: string): boolean { return writes.has(action); }

export type RoomFilePrincipal = AssistantThreadPrincipal & { projectCwd: string };
type Ports = {
  approve(operation: { action: string; input: Record<string, unknown>; operationHash: string }, principal: RoomFilePrincipal, authorized: () => Promise<boolean>): Promise<{ approved?: boolean; operationHash?: string }>;
  receipt(key: string): Promise<ManagementReceipt | undefined>;
  saveReceipt(key: string, receipt: ManagementReceipt): Promise<void>;
  run(principal: RoomFilePrincipal, command: unknown, input: unknown, authorized: () => Promise<boolean>): Promise<unknown>;
};

/** Owner approves a stable operation and the exact project scope remains held
 * until the canonical filesystem operation settles. Unknown writes never replay. */
export function createRoomFileTools(ports: Ports) {
  const tools = new ConversationManagementTools<string, RoomFilePrincipal>({
    ...ports,
    execute: async (action, args, principal, authorized) => {
      if (!isRoomFileAction(action) || !isAbsolute(principal.projectCwd)) throw new Error("Room file target is invalid.");
      const { requestId: _requestId, ...input } = args;
      validateConversationTool(action, input);
      const result = await callFileConversationTool(principal.projectCwd, action, input,
        async (command, value) => {
          if (!(await authorized())) throw new Error("Room file authority revoked.");
          return ports.run(principal, command, value, authorized);
        }, authorized);
      if (!(await authorized())) throw new Error("Room file authority revoked; inspect the original operation.");
      return result;
    },
  }, reads);
  return {
    async call(action: string, input: Record<string, unknown>, principal: RoomFilePrincipal,
      authorized: () => Promise<boolean>, qualify: <T>(effect: () => Promise<T>) => Promise<T>) {
      if (!isRoomFileAction(action) || principal.kind !== "assistant-thread" || !principal.threadId || !principal.projectId || !isAbsolute(principal.projectCwd))
        throw new Error("Room file target is invalid.");
      if (action === "files.operation.status") {
        const query = statusSchema.parse(input);
        if (Object.hasOwn(query.originalInput, "requestId")) throw new Error("Original file input must not contain requestId.");
        validateConversationTool(query.action, query.originalInput);
        const signature = createHash("sha256").update(JSON.stringify([query.action, roomOperationInput(query.originalInput, query.operationId)])).digest("hex");
        const key = managementReceiptKey(principal, query.operationId);
        return qualify(async () => {
          if (!(await authorized())) throw new Error("Room file authority revoked.");
          const receipt = await ports.receipt(key);
          if (!(await authorized())) throw new Error("Room file authority revoked.");
          if (!receipt) return { operationId: query.operationId, state: "unknown" };
          if (receipt.signature !== signature) throw new Error("Original file operation identity changed.");
          return { operationId: query.operationId, ...receipt, state: receipt.state === "pending" ? "uncertain" : receipt.state };
        });
      }
      const { requestId, ...original } = input;
      validateConversationTool(action, original);
      if (writes.has(action) && (typeof requestId !== "string" || !requestId || requestId.length > 200))
        throw new Error("Room file request identity required.");
      return tools.call(action, writes.has(action) ? roomOperationInput(original, requestId as string) : original, principal, authorized, qualify);
    },
  };
}
