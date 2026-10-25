import { expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { McpTokens } from "./mcp-tokens";

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
