import { expect, it } from "vitest";
import { ProviderInboxBridge } from "../../providers/provider-inbox";
import { StoreDatabase } from "../../store-db";

it("does not admit a projectless Jira result from another project's discovery", async () => {
  const db = new StoreDatabase(":memory:");
  try {
    const bridge = new ProviderInboxBridge(db);
    await bridge.beat("native", "desktop", { version: 1 });
    const receipt = await bridge.request("thread", "list", {
      action: "list", projects: [{ path: "/first" }],
      query: { assignedToMe: false, state: "open", search: "" },
    });
    await bridge.beat("native", "desktop", { version: 1 });
    const item = { provider: "jira" as const, kind: "jira" as const, number: 1, repo: "", projectPath: "", identifier: "TEST-1" };
    await bridge.beat("native", "desktop", { version: 1, replies: [{ id: receipt.id, result: { items: [item], errors: {} } }] });
    await expect(bridge.assertListedTarget("thread", item, "/first")).resolves.toBeUndefined();
    await expect(bridge.assertListedTarget("thread", item, "/second")).rejects.toThrow("Discover this project's Inbox");
  } finally {
    await db.close();
  }
});
