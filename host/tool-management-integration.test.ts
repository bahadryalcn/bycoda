import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  mcpCatalog,
  managedMcpCatalog,
  externalMcpCatalog,
  managedDiscoveryResult,
  toolAuthorizationScope,
} from "./mcp-http";
import { MCP_GROUPS, type McpGrant } from "./mcp-tokens";
import { runSocialMcp } from "./social-tools";
import { describeManagedTools, searchManagedTools } from "./tool-management";
import { DESKTOP_CONTROL_CONVERSATION_TOOLS } from "./conversation-desktop-control-tools";

const grant: McpGrant = {
  id: "inventory-test",
  name: "read-only fixture",
  projectId: "p",
  createdAt: 1,
  expiresAt: 2,
  scopes: { conversation: ["read", "write"], social: ["read", "write"], "runtime-logs": ["read"] },
};

describe("managed discovery across real tool catalogs", () => {
  it("covers every declared operation and all 30 conversation families without inventing readiness", () => {
    const catalog = managedMcpCatalog();
    const rawCount = MCP_GROUPS.reduce((sum, group) => sum + mcpCatalog(group).length, 0);
    expect(catalog).toHaveLength(rawCount);
    expect(rawCount).toBeGreaterThanOrEqual(206);
    expect(catalog.filter((entry) => !entry.supported).map((entry) => entry.id)).toEqual([]);
    const conversation = catalog.filter((entry) => entry.group === "conversation");
    const families = new Set(conversation.map((entry) => entry.family));
    expect(families.size).toBe(30);
    expect(families.has("desktop")).toBe(true);
    expect(
      conversation
        .filter((entry) => entry.family === "desktop")
        .map((entry) => entry.action)
        .sort(),
    ).toEqual(Object.keys(DESKTOP_CONTROL_CONVERSATION_TOOLS).sort());
    expect(catalog.every((entry) => entry.capability.state === "unknown")).toBe(true);
    const ids = new Set(catalog.map((entry) => entry.id));
    expect(
      catalog
        .flatMap((entry) => [...entry.readback, ...entry.cancellation])
        .every((id) => ids.has(id)),
    ).toBe(true);
    for (const entry of catalog)
      expect(entry.authorizationScope).toBe(toolAuthorizationScope(entry.group, entry.action));
  });

  it("keeps external discovery and workflow references inside the existing grant allowlist", () => {
    const catalog = managedMcpCatalog(grant);
    const allowed = new Set(
      MCP_GROUPS.flatMap((group) =>
        externalMcpCatalog(group, grant).map((entry) => `${group}:${entry.action}`),
      ),
    );
    expect(new Set(catalog.map((entry) => entry.id))).toEqual(allowed);
    expect(
      catalog
        .flatMap((entry) => [...entry.readback, ...entry.cancellation])
        .every((id) => allowed.has(id)),
    ).toBe(true);
    for (const id of [
      "conversation:browser.preview",
      "conversation:files.read",
      "social:messages.send",
      "social:campaigns.schedule",
    ]) {
      expect(catalog.some((entry) => entry.id === id)).toBe(false);
      const result = JSON.parse(describeManagedTools(catalog, { ids: [id] }).content);
      expect(result.tools).toEqual([
        { id, supported: false, capability: { state: "unsupported", evidence: null } },
      ]);
    }
    const readonly: McpGrant = {
      ...grant,
      scopes: { conversation: ["read"], social: ["read"], "runtime-logs": ["read"] },
    };
    expect(managedMcpCatalog(readonly).every((entry) => entry.authorizationScope === "read")).toBe(
      true,
    );
  });

  it("pages the actual inventory once per ID and exposes bounded search and full describe through routing", () => {
    const catalog = managedMcpCatalog();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = searchManagedTools(catalog, { cursor, limit: 20 });
      expect(page.tools.length).toBeLessThanOrEqual(20);
      ids.push(...page.tools.map((entry) => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(catalog.length);
    expect(new Set(ids).size).toBe(catalog.length);
    const result = managedDiscoveryResult(
      "tools.search",
      { family: "browser" },
      catalog,
    ) as ReturnType<typeof searchManagedTools>;
    expect(result.tools.every((entry) => entry.family === "browser")).toBe(true);
    expect(() => managedDiscoveryResult("tools.execute", {}, catalog)).toThrow("Unknown");
  });

  it("uses the same social metadata and schemas in stdio and HTTP discovery", async () => {
    let output = "";
    await runSocialMcp(
      Readable.from([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n"]),
      new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        },
      }),
    );
    expect(JSON.parse(output).result.tools).toEqual(mcpCatalog("social"));
    const catalog = managedMcpCatalog();
    const send = catalog.find((entry) => entry.id === "social:messages.send")!;
    expect(send.retry).toMatchObject({ mode: "same-request", identityFields: ["requestId"] });
    expect(send.authorization.requirement).toBe("owner-or-active-rule");
    expect(send.effects).toEqual(["external-write"]);
  });
});
