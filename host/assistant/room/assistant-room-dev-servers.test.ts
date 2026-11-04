import { expect, it, vi } from "vitest";
import { createRoomDevServerTools } from "./assistant-room-dev-servers";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

function fixture() {
  let allowed = true, cwd = "/real/project", physical = false;
  const receipts = new Map<string, ManagementReceipt>();
  const handle = vi.fn(async (action: string, input: Record<string, unknown>, projects: unknown[], authorize: () => Promise<void>) => {
    expect(physical).toBe(true);
    await authorize();
    expect(projects).toEqual([{ id: "project", name: "Project", path: "/real/project" }]);
    if (action === "devServers.list") return { servers: [{ id: "ours", projectId: "project" }, { id: "foreign", projectId: "other" }] };
    if (action === "devServers.details") return { server: { projectId: input.id === "foreign" ? "other" : "project" } };
    return { state: "started", output: "bounded fixture log", available: true };
  });
  const approve = vi.fn(async (operation: { operationHash: string }) => ({ approved: true, operationHash: operation.operationHash }));
  const service = createRoomDevServerTools({ receipt: async key => receipts.get(key), saveReceipt: async (key, receipt) => { receipts.set(key, receipt); }, approve, project: async () => ({ id: "project", name: "Project", cwd }), handle });
  const principal = { kind: "assistant-thread" as const, threadId: "room", projectId: "project", projectCwd: "/real/project", provider: "assistant" as const };
  const call = (action: string, input: Record<string, unknown>) => service.call(action, input, principal, async () => allowed, async effect => { physical = true; try { return await effect(); } finally { physical = false; } });
  return { call, handle, approve, revoke: () => { allowed = false; }, move: () => { cwd = "/moved"; } };
}
it("lists only the qualified project's servers with bounded paging and no approval", async () => {
  const f = fixture();
  expect(await f.call("devServers.list", { limit: 1 })).toMatchObject({ items: [{ id: "ours" }], total: 1 });
  expect(f.approve).not.toHaveBeenCalled();
  await expect(f.call("devServers.details", { id: "foreign" })).rejects.toThrow("another project");
  await expect(f.call("devServers.list", { cwd: "/foreign" })).rejects.toThrow("qualified project");
});
it("retains reviewed startup receipts and never repeats the same physical command", async () => {
  const f = fixture(), input = { requestId: "start-once", command: "node fixture.mjs" };
  const result = await f.call("devServers.start", input);
  expect(result).toMatchObject({ state: "completed", result: { state: "started" } });
  expect(await f.call("devServers.start", input)).toEqual(result);
  expect(f.handle).toHaveBeenCalledOnce();
  expect(f.approve).toHaveBeenCalledOnce();
  expect(await f.call("devServers.operation.status", { operationId: "start-once", action: "devServers.start", originalInput: { command: "node fixture.mjs" } })).toMatchObject({ state: "completed", result: { state: "started" } });
  expect(await f.call("devServers.operation.status", { operationId: "absent", action: "devServers.start", originalInput: { command: "node fixture.mjs" } })).toMatchObject({ state: "unknown" });
  await expect(f.call("devServers.operation.status", { operationId: "start-once", action: "devServers.start", originalInput: { command: "changed" } })).rejects.toThrow("input changed");
  expect(f.handle).toHaveBeenCalledOnce();
  await expect(f.call("devServers.start", { ...input, command: "changed" })).rejects.toThrow("different input");
});
it("rechecks revocation after native review and refuses foreign stop targets", async () => {
  const f = fixture();
  f.approve.mockImplementationOnce(async operation => { f.revoke(); return { approved: true, operationHash: operation.operationHash }; });
  expect(await f.call("devServers.start", { requestId: "revoked", command: "node fixture.mjs" })).toMatchObject({ state: "failed" });
  expect(f.handle).not.toHaveBeenCalled();
  const next = fixture();
  expect(await next.call("devServers.stop", { requestId: "foreign", id: "foreign" })).toMatchObject({ state: "uncertain" });
  expect(next.handle.mock.calls.map(call => call[0])).toEqual(["devServers.details"]);
  const moved = fixture();
  moved.approve.mockImplementationOnce(async operation => { moved.move(); return { approved: true, operationHash: operation.operationHash }; });
  expect(await moved.call("devServers.start", { requestId: "moved", command: "node fixture.mjs" })).toMatchObject({ state: "uncertain" });
  expect(moved.handle).not.toHaveBeenCalled();
});
