import { z } from "zod";
const id = z.string().min(1).max(300);
const schemas = {
  "workspace.operation.status": z.strictObject({ operationId: id, action: z.enum(["workspace.projects.select", "workspace.sessions.create", "workspace.sessions.open", "workspace.sessions.submit", "workspace.sessions.stop", "organization.patch"]), originalInput: z.record(z.string(), z.unknown()) }),
  "workspace.projects.select": z.strictObject({ requestId: id }),
  "workspace.sessions.create": z.strictObject({ requestId: id, harness: id.optional(), model: id.optional(), prompt: z.string().max(16000).optional(), submit: z.literal(false).optional() }),
  "workspace.sessions.open": z.strictObject({ requestId: id, sessionId: id }),
  "workspace.sessions.submit": z.strictObject({ requestId: id.regex(/^[A-Za-z0-9_-]+$/), sessionId: id, text: z.string().min(1).max(16000) }),
  "workspace.sessions.submit.status": z.strictObject({ submissionId: id.regex(/^[A-Za-z0-9_-]+$/), sessionId: id }),
  "workspace.sessions.stop": z.strictObject({ requestId: id, sessionId: id }),
  "organization.patch": z.strictObject({ requestId: id, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), change: z.record(z.string(), z.unknown()) }),
};
export type RoomWorkspaceAction = keyof typeof schemas;
export const isRoomWorkspaceAction = (action: string): action is RoomWorkspaceAction => Object.hasOwn(schemas, action);
export function validateRoomWorkspaceAction(action: RoomWorkspaceAction, input: Record<string, unknown>, requestId: string) {
  const parsed = schemas[action].parse(input);
  if ("requestId" in parsed && parsed.requestId !== requestId) throw new Error("Workspace operation identity changed.");
  if (action === "workspace.operation.status" && "operationId" in parsed) {
    const original = parsed as { action: Exclude<RoomWorkspaceAction, "workspace.operation.status" | "workspace.sessions.submit.status">; originalInput: Record<string, unknown>; operationId: string };
    schemas[original.action].parse(original.originalInput);
    if (original.originalInput.requestId !== original.operationId) throw new Error("Original workspace operation identity changed.");
  }
  return parsed;
}
const text = { type: "string", minLength: 1, maxLength: 300 };
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
export const ROOM_WORKSPACE_TOOLS = {
  "workspace.operation.status": object({ operationId: text, action: { enum: ["workspace.projects.select", "workspace.sessions.create", "workspace.sessions.open", "workspace.sessions.submit", "workspace.sessions.stop", "organization.patch"] }, originalInput: { type: "object", additionalProperties: true } }, ["operationId", "action", "originalInput"]),
  "workspace.projects.select": object({ requestId: text }, ["requestId"]),
  "workspace.sessions.create": object({ requestId: text, harness: text, model: text, prompt: { type: "string", maxLength: 16000 }, submit: { enum: [false] } }, ["requestId"]),
  "workspace.sessions.open": object({ requestId: text, sessionId: text }, ["requestId", "sessionId"]),
  "workspace.sessions.submit": object({ requestId: text, sessionId: text, text: { type: "string", minLength: 1, maxLength: 16000 } }, ["requestId", "sessionId", "text"]),
  "workspace.sessions.submit.status": object({ submissionId: text, sessionId: text }, ["submissionId", "sessionId"]),
  "workspace.sessions.stop": object({ requestId: text, sessionId: text }, ["requestId", "sessionId"]),
  "organization.patch": object({ requestId: text, expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }, change: { type: "object" } }, ["requestId", "expectedRevision", "change"]),
} as const;
export function describeRoomWorkspaceTool(action: string) {
  if (!isRoomWorkspaceAction(action)) return undefined;
  if (action === "workspace.operation.status") return "Read the original native workspace operation receipt by its exact operation ID and original input. Unknown remains unknown; never resend automatically.";
  if (action === "workspace.sessions.submit.status") return "Read-only reconciliation for an exact original desktop session submission ID. Returns recorded or unknown; never resends. Requires the original visible project and a live native Room source.";
  return "Request this exact desktop workspace operation for a visible project. Native owner approval and a live qualified desktop are required. An accepted owner transfer is not the final UI result; inspect workspace.operation.status with the original operation ID and input. Unknown outcomes are not resent automatically.";
}
