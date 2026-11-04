import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { ConversationManagementTools, managementPage, managementReceiptKey, type ManagementPorts } from "../../conversation/conversation-management-tools";
import { roomOperationInput } from "./assistant-room-operation-input";
import { scrubRuntimeLogText } from "../../runtime-logs";
import type { HostTerminals } from "../../terminals";

const id = z.string().min(1).max(200);
const page = { offset: z.number().int().nonnegative().safe().optional(), limit: z.number().int().min(1).max(100).optional() };
const schemas = {
  "terminals.list": z.strictObject(page),
  "terminals.read": z.strictObject({ terminalId: id, after: z.number().int().nonnegative().safe().optional(), limit: z.number().int().min(1).max(500).optional() }),
  "terminals.create": z.strictObject({ name: z.string().min(1).max(80).optional(), profileId: id.optional() }),
  "terminals.write": z.strictObject({ terminalId: id, data: z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 16384) }),
  "terminals.interrupt": z.strictObject({ terminalId: id }),
  "terminals.close": z.strictObject({ terminalId: id }),
} as const;
const writes = ["terminals.create", "terminals.write", "terminals.interrupt", "terminals.close"] as const;
const reads = new Set(["terminals.list", "terminals.read", "terminals.operation.status"]);
const status = z.strictObject({ operationId: id, action: z.enum(writes), originalInput: z.record(z.string(), z.unknown()) });
export const isRoomTerminalAction = (action: string) => action === "terminals.operation.status" || Object.hasOwn(schemas, action);
export const isRoomTerminalWrite = (action: string) => (writes as readonly string[]).includes(action);
export type RoomTerminalPrincipal = { kind: "assistant-thread"; threadId: string; projectId: string; projectCwd: string; environmentId: string; deviceHash: string; provider: "assistant" };
export type RoomTerminalPorts = Pick<ManagementPorts<string, RoomTerminalPrincipal>, "receipt" | "saveReceipt" | "approve"> & {
  project(id: string): Promise<{ id: string; cwd: string }>;
  terminals: Pick<HostTerminals, "list" | "read" | "create" | "write" | "interrupt" | "remove">;
};
const ownerFor = (p: RoomTerminalPrincipal) => `room:${createHash("sha256").update(JSON.stringify([p.environmentId, p.threadId, p.deviceHash])).digest("hex")}`;
function parse(action: string, value: unknown): Record<string, unknown> {
  const schema = schemas[action as keyof typeof schemas];
  if (!schema) throw new Error("Unsupported Room terminal operation.");
  return schema.parse(value);
}

/** Room owns only its own Host pipe processes. The admission permit spans the
 * actual process call, including asynchronous write/stop settlement. */
export function createRoomTerminalTools(ports: RoomTerminalPorts) {
  const tools = new ConversationManagementTools<string, RoomTerminalPrincipal>({
    receipt: ports.receipt, saveReceipt: ports.saveReceipt, approve: ports.approve,
    execute: async (action, input, principal, authorized) => {
      const project = await ports.project(principal.projectId);
      if (project.id !== principal.projectId || project.cwd !== principal.projectCwd) throw new Error("Terminal project changed.");
      const owner = ownerFor(principal);
      const check = async () => { if (!(await authorized()) || (await ports.project(project.id)).cwd !== project.cwd) throw new Error("Room terminal authority changed."); };
      await check();
      if (action === "terminals.operation.status") {
        const query = status.parse(input); parse(query.action, query.originalInput);
        const receipt = await ports.receipt(managementReceiptKey(principal, query.operationId));
        await check();
        if (!receipt) return { operationId: query.operationId, state: "unknown" };
        const signature = createHash("sha256").update(JSON.stringify([query.action, roomOperationInput({ ...query.originalInput, roomTerminalOwner: owner }, query.operationId)])).digest("hex");
        if (receipt.signature !== signature) throw new Error("Original terminal operation identity changed.");
        const state = receipt.state === "pending" ? "uncertain" : receipt.state;
        return query.action === "terminals.write" && state === "completed"
          ? { operationId: query.operationId, ...receipt, state: "accepted", receiptState: "completed" }
          : { operationId: query.operationId, ...receipt, state };
      }
      const { requestId, roomTerminalOwner, ...raw } = input;
      if (isRoomTerminalWrite(action) && (roomTerminalOwner !== owner || typeof requestId !== "string")) throw new Error("Terminal owner changed.");
      const value = parse(action, raw);
      if (action === "terminals.list") { const result = ports.terminals.list(project.id, owner); const page = managementPage(result.terminals, value); return { ...result, ...page, terminals: page.items, transport: "pipe" }; }
      if (action === "terminals.read") {
        const result = ports.terminals.read(project.id, { id: value.terminalId, after: value.after, limit: value.limit }, owner);
        await check(); return { ...result, output: scrubRuntimeLogText(result.output, Number.MAX_SAFE_INTEGER), transport: "pipe" };
      }
      await check();
      if (action === "terminals.create") return ports.terminals.create(project, { requestId: createHash("sha256").update(JSON.stringify([owner, requestId])).digest("hex"), name: value.name, profileId: value.profileId }, owner, authorized);
      if (action === "terminals.write") {
        const accepted = await ports.terminals.write(project.id, { id: value.terminalId, data: value.data }, owner);
        return { ...accepted, delivery: "pipe-written", commandCompletion: "unobserved", transport: "pipe" };
      }
      if (action === "terminals.interrupt") return ports.terminals.interrupt(project.id, value.terminalId, owner);
      if (action === "terminals.close") return ports.terminals.remove(project.id, value.terminalId, owner);
      throw new Error("Unsupported Room terminal operation.");
    },
  }, reads);
  return { async call(action: string, input: Record<string, unknown>, principal: RoomTerminalPrincipal, authorized: () => Promise<boolean>, qualify: <T>(effect: () => Promise<T>) => Promise<T>) {
    if (!isRoomTerminalAction(action) || !principal.threadId || !principal.projectId || !isAbsolute(principal.projectCwd) || !principal.environmentId || !/^[a-f0-9]{64}$/.test(principal.deviceHash)) throw new Error("Invalid Room terminal source.");
    if (action === "terminals.operation.status") status.parse(input);
    else { const { requestId, ...original } = input; parse(action, original); if (isRoomTerminalWrite(action) && (typeof requestId !== "string" || !requestId || requestId.length > 200)) throw new Error("Terminal operation identity required."); }
    const result = await tools.call(action, isRoomTerminalWrite(action) ? roomOperationInput({ ...input, roomTerminalOwner: ownerFor(principal) }, String(input.requestId)) : input, principal, authorized, qualify);
    if (action === "terminals.write" && result && typeof result === "object" && "state" in result && result.state === "completed")
      return { ...result, state: "accepted", receiptState: "completed" };
    return result;
  } };
}
