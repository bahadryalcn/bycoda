import { describe, expect, it } from "vitest";
import {
  callConversationTool,
  conversationToolCatalog,
  isRoomOnlyConversationAction,
  sessionConversationToolCatalog,
  validateConversationTool,
  validateSessionConversationTool,
} from "./conversation-tools";

describe("Room and coding-session tool catalogs", () => {
  const roomOnly = [
    "files.operation.status",
    "devServers.operation.status",
    "browser.operation.status",
    "terminals.create",
    "terminals.interrupt",
    "terminals.close",
    "terminals.operation.status",
    "sessions.create",
    "sessions.submit",
    "sessions.submit.status",
    "sessions.stop",
    "workspace.projects.select",
    "workspace.operation.status",
    "notebook.list",
  ];
  it("keeps Room-only contracts discoverable to Room but not to coding sessions", () => {
    const all = new Set(conversationToolCatalog().map((tool) => tool.action));
    const session = new Set(sessionConversationToolCatalog().map((tool) => tool.action));
    for (const action of roomOnly) {
      expect(all.has(action), action).toBe(true);
      expect(session.has(action), action).toBe(false);
      expect(isRoomOnlyConversationAction(action), action).toBe(true);
    }
    for (const action of [
      "files.read",
      "files.write",
      "devServers.logs",
      "browser.status",
      "terminals.list",
      "terminals.read",
      "terminals.write",
      "sessions.list",
      "sessions.read",
    ])
      expect(session.has(action), action).toBe(true);
  });
  it("rejects a direct Room-only Session call before any network effect", async () => {
    const fetcher = () => {
      throw new Error("must not reach network");
    };
    expect(() =>
      validateSessionConversationTool("workspace.projects.select", { requestId: "x" }),
    ).toThrow("Room source");
    expect(() =>
      validateConversationTool("workspace.projects.select", { requestId: "x" }),
    ).not.toThrow();
    await expect(
      callConversationTool(
        "workspace.projects.select",
        { requestId: "x" },
        {},
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("Room source");
  });
  it("preserves the established Session dev-server log bound", () => {
    expect(() =>
      validateSessionConversationTool("devServers.logs", { id: "server", maxBytes: 100000 }),
    ).not.toThrow();
    expect(() =>
      validateSessionConversationTool("devServers.logs", { id: "server", maxBytes: 100001 }),
    ).toThrow();
  });
});
