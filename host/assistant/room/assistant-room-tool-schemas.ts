/** Room-specific status schemas. Kept independent of Host dispatch modules. */
export const ROOM_BROWSER_STATUS_SCHEMA = {
  type: "object",
  properties: {
    operationId: { type: "string", minLength: 1, maxLength: 200 },
    originalInput: { type: "object", additionalProperties: true },
  },
  required: ["operationId", "originalInput"],
  additionalProperties: false,
} as const;
export const ROOM_DEV_SERVER_STATUS_SCHEMA = {
  type: "object",
  properties: {
    operationId: { type: "string", minLength: 1, maxLength: 200 },
    action: { enum: ["devServers.start", "devServers.stop", "devServers.restart"] },
    originalInput: { type: "object", additionalProperties: true },
  },
  required: ["operationId", "action", "originalInput"],
  additionalProperties: false,
} as const;
export const ROOM_FILE_STATUS_TOOL = {
  type: "object",
  properties: {
    operationId: { type: "string", minLength: 1, maxLength: 200 },
    action: {
      enum: [
        "files.create",
        "files.write",
        "files.rename",
        "files.move",
        "files.copy",
        "files.delete",
      ],
    },
    originalInput: { type: "object", additionalProperties: true },
  },
  required: ["operationId", "action", "originalInput"],
  additionalProperties: false,
} as const;
const terminalId = { type: "string", minLength: 1, maxLength: 200 } as const;
export const ROOM_REMOTE_SCHEMAS = {
  "remote.grants.list": { type: "object", properties: {}, additionalProperties: false },
  "remote.call": {
    type: "object",
    properties: {
      grantId: terminalId,
      requestId: terminalId,
      action: {
        enum: [
          "sessions.list",
          "sessions.read",
          "tasks.list",
          "tasks.get",
          "tasks.create",
          "tasks.update",
        ],
      },
      input: { type: "object", additionalProperties: true },
    },
    required: ["grantId", "requestId", "action", "input"],
    additionalProperties: false,
  },
  "remote.result": {
    type: "object",
    properties: { requestId: terminalId },
    required: ["requestId"],
    additionalProperties: false,
  },
} as const;
const socialScope = {
  accountId: terminalId,
  projectId: { type: ["string", "null"], maxLength: 200 },
};
export const ROOM_SOCIAL_SCHEMAS = {
  "social.send.propose": {
    type: "object",
    properties: {
      ...socialScope,
      requestId: terminalId,
      action: { enum: ["replies.send", "messages.send", "comments.send"] },
      entityId: terminalId,
    },
    required: ["accountId", "projectId", "requestId", "action", "entityId"],
    additionalProperties: false,
  },
  "social.send.status": {
    type: "object",
    properties: { ...socialScope, operationId: terminalId },
    required: ["accountId", "projectId", "operationId"],
    additionalProperties: false,
  },
} as const;
export const ROOM_TERMINAL_SCHEMAS = {
  "terminals.create": {
    type: "object",
    properties: { name: { type: "string", minLength: 1, maxLength: 80 }, profileId: terminalId },
    additionalProperties: false,
  },
  "terminals.interrupt": {
    type: "object",
    properties: { terminalId },
    required: ["terminalId"],
    additionalProperties: false,
  },
  "terminals.close": {
    type: "object",
    properties: { terminalId },
    required: ["terminalId"],
    additionalProperties: false,
  },
  "terminals.operation.status": {
    type: "object",
    properties: {
      operationId: terminalId,
      action: {
        enum: ["terminals.create", "terminals.write", "terminals.interrupt", "terminals.close"],
      },
      originalInput: { type: "object", additionalProperties: true },
    },
    required: ["operationId", "action", "originalInput"],
    additionalProperties: false,
  },
} as const;
