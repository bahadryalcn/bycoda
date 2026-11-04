import { describe, expect, it, vi } from "vitest";
import { AssistantRoomNotebook } from "./assistant-room-notebook";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

const principal = { kind: "assistant-thread" as const, threadId: "room", environmentId: "host" };
function fixture() {
  const receipts = new Map<string, ManagementReceipt>();
  const owner = {
    roomNotebookList: vi.fn(async () => [{ id: "n", title: "Note", body: "private", tags: ["assistant"], createdAt: 1, updatedAt: 2 }]),
    roomNotebookGet: vi.fn(async () => ({ id: "n", title: "Note", body: "private", tags: ["assistant"], createdAt: 1, updatedAt: 2 })),
    roomNotebookSave: vi.fn(async (input) => ({ ...input, id: input.id ?? "new", tags: ["assistant"], createdAt: 1, updatedAt: 3 })),
    roomNotebookDelete: vi.fn(async () => ({ ok: true, trashId: "backup" })),
  };
  const approve = vi.fn(async (operation) => ({ approved: true, operationHash: operation.operationHash }));
  const tools = new AssistantRoomNotebook(owner, { approve, receipt: async key => receipts.get(key), saveReceipt: async (key, value) => { receipts.set(key, value); } });
  return { owner, approve, tools };
}
const authorized = async () => true;
describe("Assistant Room personal notebook", () => {
  it("bounds metadata listing and requires exact operation identity", async () => {
    const { tools } = fixture();
    const page = await tools.call("notebook.list", {}, principal, authorized, "read");
    expect(page).toMatchObject({ total: 1, scopeLimit: 100, items: [{ id: "n" }] });
    expect(JSON.stringify(page)).not.toContain("private");
    expect(() => tools.call("notebook.create", { requestId: "other", title: "A", body: "B" }, principal, authorized, "one")).toThrow("identity changed");
  });
  it("reviews the exact write once and refuses changed input with the same identity", async () => {
    const { tools, owner, approve } = fixture();
    const input = { requestId: "one", id: "n", expectedUpdatedAt: 2, title: "New", body: "Body" };
    expect(await tools.call("notebook.update", input, principal, authorized, "one")).toMatchObject({ state: "completed" });
    expect(await tools.call("notebook.update", input, principal, authorized, "one")).toMatchObject({ state: "completed" });
    await expect(tools.call("notebook.update", { ...input, body: "changed" }, principal, authorized, "one")).rejects.toThrow("reused with different input");
    expect(approve).toHaveBeenCalledOnce();
    expect(owner.roomNotebookSave).toHaveBeenCalledOnce();
  });
  it("does not replay an uncertain effect or perform denied writes", async () => {
    const { tools, owner, approve } = fixture();
    owner.roomNotebookDelete.mockRejectedValueOnce(new Error("lost acknowledgement"));
    const input = { requestId: "one", id: "n", expectedUpdatedAt: 2 };
    expect(await tools.call("notebook.delete", input, principal, authorized, "one")).toMatchObject({ state: "uncertain" });
    expect(await tools.call("notebook.delete", input, principal, authorized, "one")).toMatchObject({ state: "uncertain" });
    expect(owner.roomNotebookDelete).toHaveBeenCalledOnce();
    approve.mockResolvedValueOnce({ approved: false, operationHash: "" });
    expect(await tools.call("notebook.delete", { ...input, requestId: "two" }, principal, authorized, "two")).toMatchObject({ state: "failed" });
    expect(owner.roomNotebookDelete).toHaveBeenCalledOnce();
  });
});
