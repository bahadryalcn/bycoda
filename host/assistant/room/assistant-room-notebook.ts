import { z } from "zod";
import {
  ConversationManagementTools,
  managementPage,
  type GlobalManagementPrincipal,
  type ManagementPorts,
} from "../../conversation/conversation-management-tools";
import type { HostAssistant } from "../service";
import { describeRoomPrWatchTool, ROOM_PR_WATCH_TOOLS } from "./assistant-room-pr-watch";

const id = z.string().min(1).max(300);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schemas = {
  "notebook.list": z.strictObject({
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  "notebook.get": z.strictObject({ id }),
  "notebook.create": z.strictObject({
    requestId: id,
    title: z.string().min(1).max(300),
    body: z.string().max(100000),
  }),
  "notebook.update": z.strictObject({
    requestId: id,
    id,
    expectedUpdatedAt: revision,
    title: z.string().min(1).max(300),
    body: z.string().max(100000),
  }),
  "notebook.delete": z.strictObject({ requestId: id, id, expectedUpdatedAt: revision }),
};
export type RoomNotebookAction = keyof typeof schemas;
export const isRoomNotebookAction = (action: string): action is RoomNotebookAction =>
  Object.hasOwn(schemas, action);
const text = { type: "string", minLength: 1, maxLength: 300 };
const body = { type: "string", maxLength: 100000 };
const version = { type: "integer", minimum: 0 };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
/** Also carries the Room-only PR watch schemas so they register wherever the notebook does. */
export const ROOM_NOTEBOOK_TOOLS = {
  ...ROOM_PR_WATCH_TOOLS,
  "notebook.list": object(
    { offset: version, limit: { type: "integer", minimum: 1, maximum: 100 } },
    [],
  ),
  "notebook.get": object({ id: text }, ["id"]),
  "notebook.create": object({ requestId: text, title: text, body }, ["requestId", "title", "body"]),
  "notebook.update": object(
    { requestId: text, id: text, expectedUpdatedAt: version, title: text, body },
    ["requestId", "id", "expectedUpdatedAt", "title", "body"],
  ),
  "notebook.delete": object({ requestId: text, id: text, expectedUpdatedAt: version }, [
    "requestId",
    "id",
    "expectedUpdatedAt",
  ]),
} as const;
export function describeRoomNotebookTool(action: string) {
  if (!isRoomNotebookAction(action)) return describeRoomPrWatchTool(action);
  return "Manage personal Assistant notebook on this Host. List and get before updating or deleting; use the exact updatedAt revision. Writes require native owner review and stable requestId. Unknown results must be inspected, never replayed under a new identity.";
}

type NotebookOwner = Pick<
  HostAssistant,
  "roomNotebookList" | "roomNotebookGet" | "roomNotebookSave" | "roomNotebookDelete"
>;
type Ports = Omit<ManagementPorts<RoomNotebookAction, GlobalManagementPrincipal>, "execute">;
export class AssistantRoomNotebook {
  private readonly management: ConversationManagementTools<
    RoomNotebookAction,
    GlobalManagementPrincipal
  >;
  constructor(owner: NotebookOwner, ports: Ports) {
    this.management = new ConversationManagementTools(
      {
        ...ports,
        execute: async (action, raw, _principal, authorized) => {
          const input = schemas[action].parse(raw);
          switch (action) {
            case "notebook.list": {
              const page = managementPage(await owner.roomNotebookList(), input);
              return {
                ...page,
                items: page.items.map(({ id, title, tags, createdAt, updatedAt }) => ({
                  id,
                  title,
                  tags,
                  createdAt,
                  updatedAt,
                })),
                scopeLimit: 100,
              };
            }
            case "notebook.get":
              return owner.roomNotebookGet((input as z.infer<(typeof schemas)["notebook.get"]>).id);
            case "notebook.create": {
              const value = input as z.infer<(typeof schemas)["notebook.create"]>;
              return owner.roomNotebookSave(
                { title: value.title, body: value.body, expectedUpdatedAt: 0 },
                authorized,
              );
            }
            case "notebook.update": {
              const value = input as z.infer<(typeof schemas)["notebook.update"]>;
              if (value.expectedUpdatedAt === 0)
                throw new Error("Read the existing note revision first.");
              return owner.roomNotebookSave(value, authorized);
            }
            case "notebook.delete": {
              const value = input as z.infer<(typeof schemas)["notebook.delete"]>;
              return owner.roomNotebookDelete(value.id, value.expectedUpdatedAt, authorized);
            }
          }
        },
      },
      new Set(["notebook.list", "notebook.get"]),
    );
  }
  call(
    action: RoomNotebookAction,
    raw: Record<string, unknown>,
    principal: GlobalManagementPrincipal,
    authorized: () => Promise<boolean>,
    requestId: string,
  ) {
    const input = schemas[action].parse(raw);
    if ("requestId" in input && input.requestId !== requestId)
      throw new Error("Notebook operation identity changed.");
    return this.management.call(action, input, principal, authorized);
  }
}
