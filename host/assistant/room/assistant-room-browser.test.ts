import { expect, it, vi } from "vitest";
import { SessionBrowserRegistry, type BrowserLoader } from "../../shared-browser";
import { RuntimeLogsService } from "../../runtime-logs";
import { createRoomBrowserTools } from "./assistant-room-browser";
import { ConversationPreviewWorkflow } from "../../conversation/conversation-preview";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

it("requires the qualified native panel acknowledgement separately from page readiness", async () => {
  let valid = true;
  const dispatch = vi.fn(async () => ({ open: true, controlling: true, leaseId: "lease", url: "https://example.test/", data: "ZmFrZQ==", mimeType: "image/jpeg", width: 800, height: 600 }));
  const room = createRoomBrowserTools({ registry: { dispatchForRoom: dispatch }, previews: new ConversationPreviewWorkflow(), describe: async value => value, receipt: async () => undefined, saveReceipt: async () => {} });
  const source = { environmentId: "host", projectId: "project", projectCwd: "/real/project", threadId: "room", deviceHash: "a".repeat(64) };
  const ui = { open: true, panels: [{ id: "panel", tab: "browser", machine: "project", mounted: true }] };
  const acknowledged = vi.fn(async () => ui);
  const result = await room.call("browser.preview", { requestId: "preview", url: "https://example.test/", show: true }, source, "preview", async () => valid, undefined, acknowledged);
  expect(result).toMatchObject({ execution: { state: "succeeded" }, presentation: { state: "mounted", panelId: "panel" } });
  expect(acknowledged).toHaveBeenCalledOnce();
  const revoked = vi.fn(async () => { valid = false; return ui; });
  await expect(room.call("browser.preview", { requestId: "revoked", url: "https://example.test/", show: true }, source, "revoked", async () => valid, undefined, revoked)).rejects.toThrow("authority changed");
  expect(revoked).toHaveBeenCalledOnce();
});

it("retains one browser input across overlapping retries and queries unknown without resending", async () => {
  const receipts = new Map<string, ManagementReceipt>();
  const gate = Promise.withResolvers<void>();
  const dispatch = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    expect(params).toMatchObject({ threadId: "room", projectId: "project", environmentId: "host" });
    expect(params).not.toHaveProperty("sessionId");
    await gate.promise;
    throw new Error("Synthetic acknowledgement lost");
  });
  const room = createRoomBrowserTools({ registry: { dispatchForRoom: dispatch }, previews: new ConversationPreviewWorkflow(), describe: async value => value, receipt: async key => receipts.get(key), saveReceipt: async (key, value) => { receipts.set(key, value); } });
  const source = { environmentId: "host", projectId: "project", projectCwd: "/real/project", threadId: "room", deviceHash: "a".repeat(64) };
  const input = { leaseId: "real-lease", kind: "click", x: 10, y: 20 };
  const first = room.call("browser.input", input, source, "original", async () => true);
  const repeated = room.call("browser.input", input, source, "original", async () => true);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  gate.resolve();
  expect(await first).toMatchObject({ state: "uncertain" });
  expect(await repeated).toEqual(await first);
  expect(await room.call("browser.input", input, source, "original", async () => true)).toMatchObject({ state: "uncertain" });
  expect(await room.call("browser.operation.status", { operationId: "original", originalInput: input }, source, "status", async () => true)).toMatchObject({ state: "uncertain" });
  expect(await room.call("browser.operation.status", { operationId: "absent", originalInput: input }, source, "absent-status", async () => true)).toMatchObject({ state: "unknown" });
  await expect(room.call("browser.operation.status", { operationId: "original", originalInput: { ...input, x: 11 } }, source, "changed-status", async () => true)).rejects.toThrow("changed");
  expect(dispatch).toHaveBeenCalledOnce();
});

it("keeps real Room browser identity separate from projects, sessions and other Rooms", async () => {
  let count = 0;
  const logs = new RuntimeLogsService();
  const loader: BrowserLoader = async () => ({ chromium: { launch: async () => ({
    newContext: async () => {
      const id = ++count;
      return { newPage: async () => ({ goto: async () => {}, url: () => `https://example.test/${id}`, screenshot: async () => Buffer.from(`room-frame-${id}`), mouse: { click: async () => {}, wheel: async () => {} }, keyboard: { type: async () => {}, press: async () => {} } }) };
    }, close: async () => {},
  }) } });
  const registry = new SessionBrowserRegistry(loader, Date.now, { runtimeLogs: logs });
  const room = { environmentId: "host", projectId: "project", roomProjectCwd: "/real/project", threadId: "room" };
  try {
    const claim = await registry.dispatchForRoom("browser.claim", room, "actual-room-owner");
    const params = { ...room, leaseId: claim.leaseId };
    await registry.dispatchForRoom("browser.open", { ...params, url: "https://example.test/room" }, "actual-room-owner");
    expect((await registry.dispatchForRoom("browser.frame", params, "actual-room-owner")).data).toBeTruthy();
    const other = await registry.dispatchForRoom("browser.status", { ...room, threadId: "other" }, "actual-room-owner");
    expect(other.open).toBe(false);
    expect(other.url).toBeNull();
    await expect(registry.dispatchForRoom("browser.frame", params, "another-device")).rejects.toThrow();
    await expect(registry.dispatchForRoom("browser.frame", { ...params, sessionId: "borrowed" }, "actual-room-owner")).rejects.toThrow("real Room");
    await expect(registry.dispatchForSession("browser.claim", room, "session-owner")).rejects.toThrow();
    const session = await registry.dispatchForSession("browser.status", { projectId: "project", sessionId: "room" }, "session-owner");
    expect(session.open).toBe(false);
    const sources = logs.sources({ projectId: "project" });
    expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({ assistantThreadId: "room" })]));
    expect(sources[0]).not.toHaveProperty("sessionId");
  } finally { await registry.close(); }
});
