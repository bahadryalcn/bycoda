import { describe, expect, it } from "vitest";
import {
  roomManagementDiscovery,
  roomManagementToolAllowed,
} from "../management/assistant-management-dispatch";
import { MANAGEMENT_CONVERSATION_TOOLS } from "../../conversation/conversation-management-tools";
import { voiceToolCatalog } from "../../voice/voice-tools";

const catalog = voiceToolCatalog();

describe("Room management capability contract", () => {
  it("can discover global settings and Servers without a placeholder project", () => {
    const actions = [
      "tools.search",
      "tools.describe",
      "tools.status",
      "projects.organization.read",
      "preferences.read",
      "preferences.patch",
      "preferences.status",
      "providers.status",
      "providers.quota.refresh",
      "providers.operation.status",
      "servers.list",
      "servers.get",
      "servers.ssh.save",
      "servers.ssh.remove",
      "servers.ssh.execute",
      "servers.ssh.status",
      "servers.ssh.cancel",
    ];
    for (const action of actions) {
      expect(roomManagementToolAllowed("conversation", action), action).toBe(true);
      const described = roomManagementDiscovery("tools.describe", {
        ids: [`conversation:${action}`],
        maxChars: 24000,
      });
      expect(described.tools[0], action).toHaveProperty("inputSchema");
    }
  });

  it("keeps every finite project management action reachable from a real Room thread", () => {
    // These are the canonical implemented management owners, not an arbitrary RPC proxy.
    // Adding a source route while forgetting the Room allowlist must fail this contract.
    // History import receipts belong to a real focused session/native window; a Room
    // must not borrow that session or claim its receipt until a separate owner port exists.
    const sessionOwned = new Set(["history.import.status"]);
    for (const action of Object.keys(MANAGEMENT_CONVERSATION_TOOLS)) {
      expect(roomManagementToolAllowed("conversation", action, "verified-project"), action).toBe(
        !sessionOwned.has(action),
      );
      expect(
        catalog.some((tool) => tool.family === "conversation" && tool.action === action),
        action,
      ).toBe(true);
    }
  });

  it("retains project work, Crew and granted account/log discovery", () => {
    for (const action of [
      "tasks.create",
      "tasks.start",
      "goals.create",
      "automations.create",
      "crews.save",
      "crews.start",
      "crews.resolve",
    ]) {
      expect(roomManagementToolAllowed("conversation", action, "verified-project"), action).toBe(
        true,
      );
      const described = roomManagementDiscovery(
        "tools.describe",
        { ids: [`conversation:${action}`], maxChars: 24000 },
        "verified-project",
      );
      expect(described.tools[0], action).toHaveProperty("inputSchema");
    }
    for (const family of ["social", "runtime-logs"]) {
      const tool = catalog.find((candidate) => candidate.family === family)!;
      expect(tool).toBeDefined();
      expect(roomManagementToolAllowed(family, tool.action, "verified-project")).toBe(true);
      expect(roomManagementToolAllowed(family, tool.action)).toBe(family === "social");
    }
  });

  it("does not turn catalog discovery into owner or cross-project authority", () => {
    for (const action of [
      "git.push",
      "git.merge",
      "crews.respond",
      "workspaces.cleanup.apply",
      "providers.signIn",
      "credentials.read",
    ]) {
      expect(roomManagementToolAllowed("conversation", action), action).toBe(false);
      expect(roomManagementToolAllowed("conversation", action, "verified-project"), action).toBe(
        false,
      );
      expect(
        roomManagementDiscovery(
          "tools.describe",
          { ids: [`conversation:${action}`] },
          "verified-project",
        ).missing,
      ).toContain(`conversation:${action}`);
    }
    for (const action of [
      "tasks.start",
      "crews.start",
      "sessions.contextual.create",
      "notes.list",
    ]) {
      expect(roomManagementToolAllowed("conversation", action), action).toBe(false);
    }
  });
});
