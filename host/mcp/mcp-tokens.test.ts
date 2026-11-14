import { expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { McpTokens } from "./mcp-tokens";

it.each([
  { expiresAt: "2000" },
  { createdAt: null },
  { id: "different-row" },
  { scopes: { conversation: ["admin"] } },
  { scopes: { unknown: ["read"] } },
  { revokedAt: null },
])("rejects corrupt persisted metadata without replacing it: %j", async (patch) => {
  const store = new HostStore(":memory:");
  const tokens = new McpTokens(store, () => 1000);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    const { token: _token, ...grant } = issued;
    const raw = JSON.stringify({ ...grant, ...patch });
    await store.db.prepare("UPDATE mcp_tokens SET value=? WHERE id=?").run(raw, issued.id);
    expect(await tokens.get(issued.token)).toBeUndefined();
    await expect(tokens.list()).rejects.toThrow("Stored MCP grant is invalid.");
    await expect(tokens.revoke(issued.id)).rejects.toThrow("Stored MCP grant is invalid.");
    expect(
      (await store.db.prepare("SELECT value FROM mcp_tokens WHERE id=?").get(issued.id))?.value,
    ).toBe(raw);
  } finally {
    await store.close();
  }
});

it("projects only grant metadata from stored rows and hides malformed JSON details", async () => {
  const store = new HostStore(":memory:");
  const tokens = new McpTokens(store, () => 1000);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    const { token, ...grant } = issued;
    await store.db
      .prepare("UPDATE mcp_tokens SET value=? WHERE id=?")
      .run(JSON.stringify({ ...grant, token, privateField: "private" }), issued.id);
    expect(await tokens.list()).toEqual([grant]);
    expect(await tokens.get(token)).toEqual(grant);
    await store.db
      .prepare("UPDATE mcp_tokens SET value=? WHERE id=?")
      .run("private malformed data", issued.id);
    expect(await tokens.get(token)).toBeUndefined();
    await expect(tokens.list()).rejects.toThrow(/^Stored MCP grant is invalid\.$/);
  } finally {
    await store.close();
  }
});

it("keeps the original revocation time even at epoch zero", async () => {
  const store = new HostStore(":memory:");
  let now = 0;
  const tokens = new McpTokens(store, () => now);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    await tokens.revoke(issued.id);
    now = 10;
    await tokens.revoke(issued.id);
    expect((await tokens.list())[0].revokedAt).toBe(0);
    expect(await tokens.get(issued.token)).toBeUndefined();
  } finally {
    await store.close();
  }
});

it("does not issue a grant that expired during project validation", async () => {
  const store = new HostStore(":memory:");
  let now = 1000;
  const tokens = new McpTokens(store, () => now);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const original = store.project.bind(store);
    vi.spyOn(store, "project").mockImplementationOnce(async (id) => {
      const result = await original(id);
      now = 2000;
      return result;
    });
    await expect(
      tokens.create({
        name: "Test",
        projectId: project.id,
        scopes: { conversation: ["read"] },
        expiresAt: 2000,
      }),
    ).rejects.toThrow();
    expect(await tokens.list()).toEqual([]);
  } finally {
    await store.close();
  }
});

it("does not return a grant revoked during project validation", async () => {
  const store = new HostStore(":memory:");
  const tokens = new McpTokens(store, () => 1000);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    const original = store.project.bind(store);
    vi.spyOn(store, "project").mockImplementationOnce(async (id) => {
      const result = await original(id);
      await tokens.revoke(issued.id);
      return result;
    });
    expect(await tokens.get(issued.token)).toBeUndefined();
  } finally {
    await store.close();
  }
});

it("rejects persisted grants without a valid expiry", async () => {
  const store = new HostStore(":memory:");
  const tokens = new McpTokens(store, () => 1000);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    const { token: _token, expiresAt: _expiresAt, ...broken } = issued;
    await store.db
      .prepare("UPDATE mcp_tokens SET value=? WHERE id=?")
      .run(JSON.stringify(broken), issued.id);
    expect(await tokens.get(issued.token)).toBeUndefined();
  } finally {
    await store.close();
  }
});

it("does not return a scoped token that expires during asynchronous project validation", async () => {
  const store = new HostStore(":memory:");
  let now = 1000;
  const tokens = new McpTokens(store, () => now);
  try {
    const project = await store.addProject("/token-project", "Token project");
    const issued = await tokens.create({
      name: "Test",
      projectId: project.id,
      scopes: { conversation: ["read"] },
      expiresAt: 2000,
    });
    const original = store.project.bind(store);
    const projectRead = vi.spyOn(store, "project").mockImplementation(async (id) => {
      const result = await original(id);
      now = 2000;
      return result;
    });
    expect(await tokens.get(issued.token)).toBeUndefined();
    projectRead.mockRestore();
  } finally {
    await store.close();
  }
});
