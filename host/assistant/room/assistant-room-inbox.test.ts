import { expect, it, vi } from "vitest";
import { AssistantRoomInbox } from "./assistant-room-inbox";

const source = { environmentId: "host", threadId: "room", projectId: "project", projectCwd: "/actual/project", deviceHash: "a".repeat(64) };
it("revalidates the Native account before redisclosing cached Inbox data", async () => {
  const rows = new Map<string, any>(); let current = true;
  const execute = vi.fn(async input => {
    if (input.operation.action === "source-check") { if (!current) throw new Error("Account changed"); return { current: true }; }
    return { accountProof: "native-opaque", items: [{ id: "record" }] };
  });
  const inbox = new AssistantRoomInbox({ read: async key => rows.get(key), write: async (key, value) => { rows.set(key, value); }, execute });
  const input = { provider: "jira", requestId: "list" };
  expect(await inbox.call("inbox.providers.list", input, source, "list", async () => true)).toMatchObject({ state: "completed" });
  current = false;
  await expect(inbox.call("inbox.result", { requestId: "list" }, source, "read", async () => true)).rejects.toThrow("Account changed");
  await expect(inbox.call("inbox.result", { requestId: "list" }, { ...source, projectCwd: "/retargeted" }, "read", async () => true)).rejects.toThrow("source identity changed");
});

it("retains uncertain Native writes without replay and rejects changed original input", async () => {
  const rows = new Map<string, any>();
  const execute = vi.fn(async () => { throw new Error("Native effect reply lost"); });
  const inbox = new AssistantRoomInbox({ read: async key => rows.get(key), write: async (key, value) => { rows.set(key, value); }, execute });
  const input = { requestId: "comment", accountProof: "native-proof", item: { provider: "github", kind: "issue", number: 1, repo: "owner/repo", projectPath: source.projectCwd }, body: "Reviewed body" };
  expect(await inbox.call("inbox.comment", input, source, "comment", async () => true)).toMatchObject({ state: "uncertain" });
  expect(await inbox.call("inbox.comment", input, source, "comment", async () => true)).toMatchObject({ state: "uncertain" });
  await expect(inbox.call("inbox.comment", { ...input, body: "Changed" }, source, "comment", async () => true)).rejects.toThrow("changed input");
  expect(execute).toHaveBeenCalledOnce();
});

it("supplies the captured CWD for canonical list items and rejects foreign item paths", async () => {
  const rows = new Map<string, any>();
  const execute = vi.fn(async (_input: Record<string, unknown>) => ({ accepted: true }));
  const inbox = new AssistantRoomInbox({ read: async key => rows.get(key), write: async (key, value) => { rows.set(key, value); }, execute });
  const input = { requestId: "canonical-comment", accountProof: "native-proof", item: { provider: "github", kind: "issue", number: 1, repo: "owner/repo" }, body: "Owner reviewed" };
  await inbox.call("inbox.comment", input, source, input.requestId, async () => true);
  expect(execute.mock.calls[0][0]).toMatchObject({ operation: { action: "comment", item: { projectPath: source.projectCwd } } });
  await expect(inbox.call("inbox.comment", { ...input, requestId: "foreign", item: { ...input.item, projectPath: "/foreign" } }, source, "foreign", async () => true)).rejects.toThrow("another project");
  expect(execute).toHaveBeenCalledOnce();
});
