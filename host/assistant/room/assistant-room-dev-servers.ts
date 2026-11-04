import { createHash } from "node:crypto";
import { ConversationManagementTools, managementPage, managementReceiptKey, type ManagementPorts } from "../../conversation/conversation-management-tools";
import type { DevServerProject } from "../../dev-servers";
import { scrubRuntimeLogText } from "../../runtime-logs";
import { roomOperationInput } from "./assistant-room-operation-input";

const reads = new Set(["devServers.list", "devServers.details", "devServers.logs", "devServers.operation.status"]);
const actions = new Set([...reads, "devServers.start", "devServers.stop", "devServers.restart"]);
export const isRoomDevServerAction = (action: string) => actions.has(action);
export { ROOM_DEV_SERVER_STATUS_SCHEMA } from "./assistant-room-tool-schemas";
type Input = Record<string, unknown>;
export type RoomDevServerPrincipal = { kind: "assistant-thread"; threadId: string; projectId: string; projectCwd: string; provider: "assistant" };
export type RoomDevServerPorts = Pick<ManagementPorts<string, RoomDevServerPrincipal>, "receipt" | "saveReceipt" | "approve"> & {
  project(id: string): Promise<{ id: string; name: string; cwd: string }>;
  handle(action: string, input: Input, projects: DevServerProject[], authorize: () => Promise<void>): Promise<unknown>;
};

/** Routes only to the existing process/port/guardian owner. No Room process pool. */
export function createRoomDevServerTools(ports: RoomDevServerPorts) {
  const tools = new ConversationManagementTools<string, RoomDevServerPrincipal>({
    receipt: ports.receipt,
    saveReceipt: ports.saveReceipt,
    approve: ports.approve,
    execute: async (action, input, principal, authorized) => {
      if (!isRoomDevServerAction(action)) throw new Error("Unsupported Room dev server operation.");
      const project = await ports.project(principal.projectId);
      if (project.id !== principal.projectId || !project.cwd || project.cwd !== principal.projectCwd) throw new Error("Dev server project identity changed.");
      if (["projectId", "cwd", "workspaceId", "sessionId"].some(key => Object.hasOwn(input, key)))
        throw new Error("Room dev server targets come from the qualified project.");
      const projects = [{ id: project.id, name: project.name, path: project.cwd }];
      const check = async () => {
        if (!(await authorized()) || (await ports.project(project.id)).cwd !== project.cwd)
          throw new Error("Dev server project authority changed.");
      };
      await check();
      if (action === "devServers.operation.status") {
        if (typeof input.operationId !== "string" || !input.operationId || input.operationId.length > 200 || !["devServers.start", "devServers.stop", "devServers.restart"].includes(String(input.action)) || !input.originalInput || typeof input.originalInput !== "object" || Array.isArray(input.originalInput))
          throw new Error("Original dev server operation identity is required.");
        const original = input.originalInput as Input;
        if (["requestId", "projectId", "cwd", "workspaceId", "sessionId"].some(key => Object.hasOwn(original, key))) throw new Error("Original dev server target must retain its source.");
        const receipt = await ports.receipt(managementReceiptKey(principal, input.operationId));
        await check();
        if (!receipt) return { operationId: input.operationId, state: "unknown" };
        const signature = createHash("sha256").update(JSON.stringify([input.action, roomOperationInput(original, input.operationId)])).digest("hex");
        if (receipt.signature !== signature) throw new Error("Original dev server operation input changed.");
        return { operationId: input.operationId, ...receipt, state: receipt.state === "pending" ? "uncertain" : receipt.state };
      }
      if (action === "devServers.list") {
        const result = await ports.handle(action, { projectId: project.id, refresh: input.refresh }, projects, check) as { servers?: { projectId?: string }[] };
        await check();
        const rows = (result.servers ?? []).filter(server => server.projectId === project.id);
        const page = managementPage(rows, input);
        return { ...result, ...page, servers: page.items };
      }
      if (action !== "devServers.start") {
        const details = await ports.handle("devServers.details", { ...input, projectId: project.id }, projects, check) as { server?: { projectId?: string } };
        await check();
        if (details.server?.projectId !== project.id) throw new Error("Dev server belongs to another project or has no verified project association.");
        if (action === "devServers.details") return details;
      }
      const result = await ports.handle(action, { ...input, projectId: project.id, cwd: project.cwd }, projects, check);
      await check();
      if (action !== "devServers.logs") return result;
      const logs = result as { available?: boolean; output?: string; truncated?: boolean };
      const maxBytes = Number(input.maxBytes ?? 32000);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64000) throw new Error("Invalid dev server log bound.");
      const bytes = Buffer.from(scrubRuntimeLogText(logs.output ?? "", Number.MAX_SAFE_INTEGER));
      return { available: logs.available === true, output: bytes.subarray(Math.max(0, bytes.length - maxBytes)).toString("utf8"), truncated: logs.truncated === true || bytes.length > maxBytes };
    },
  }, reads);
  return {
    call(action: string, input: Input, principal: RoomDevServerPrincipal, authorized: () => Promise<boolean>, qualify: <T>(effect: () => Promise<T>) => Promise<T>) {
      if (!isRoomDevServerAction(action)) throw new Error("Unsupported Room dev server operation.");
      if (!reads.has(action) && (typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 200)) throw new Error("Room dev server operation identity is required.");
      return tools.call(action, reads.has(action) ? input : roomOperationInput(input, String(input.requestId)), principal, authorized, qualify);
    },
  };
}
