import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { executeAssistantObservationTool, type ObservationToolPorts } from "./assistant-observation-tools";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-tools-"));
  const store = new HostStore(join(dir, "host.db"));
  const journal = new AssistantObservationJournal(store);
  await journal.ready;
  cleanup.push(async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { source: "task" as const, sourceId: "task", sourceRevision: "db:1", change: "updated" as const, projectIds: ["project"], occurredAt: 1 };
  await store.transaction(() => journal.append(event));
  let live = true;
  const ports: ObservationToolPorts = { journal, authorizeScope: vi.fn(async (thread, scope) => thread === "room" && "projectId" in scope && scope.projectId === "project"), authorizeEvent: vi.fn(async (_thread, _scope, event) => event.projectIds.every((id) => id === "project")), guard: () => () => live, resnapshot: vi.fn(async () => ({ complete: true, value: { items: [] } })) };
  const admission = { environmentId: store.environmentId, deviceHash: "device", authorized: async () => true };
  const call = (action: string, input: Record<string, unknown> = {}) => executeAssistantObservationTool(ports, { threadId: "room", projectId: "project", action, input }, admission);
  return { store, journal, ports, admission, call, revoke: () => { live = false; } };
}
it("binds durable cursor to actual Room and checks scope on every read and ack", async () => {
  const f = await fixture();
  const page = await f.call("observations.read") as { nextCursor: number; events: unknown[] };
  expect(page.events).toHaveLength(1);
  await expect(f.call("observations.read", { consumer: "other" })).rejects.toThrow();
  await expect(executeAssistantObservationTool(f.ports, { threadId: "other", projectId: "project", action: "observations.read", input: {} }, f.admission)).rejects.toThrow("revoked");
  await expect(executeAssistantObservationTool(f.ports, { threadId: "room", projectId: "project", accountId: "account", action: "observations.read", input: {} }, f.admission)).rejects.toThrow();
  f.revoke();
  await expect(f.call("observations.ack", { cursor: page.nextCursor })).rejects.toThrow("revoked");
});
it("projects shared-source metadata onto the admitted project only", async () => {
  const f = await fixture();
  await f.store.transaction(() => f.journal.append({ source: "goal", sourceId: "shared", sourceRevision: "db:1", change: "updated", projectIds: ["project", "private-project"], occurredAt: 2 }));
  vi.mocked(f.ports.authorizeEvent).mockResolvedValue(true);
  const page = await f.call("observations.read") as { events: { sourceId: string; projectIds: string[] }[] };
  expect(page.events.find(event => event.sourceId === "shared")?.projectIds).toEqual(["project"]);
  expect(JSON.stringify(page)).not.toContain("private-project");
});
it("isolates source cursors, acknowledgement and gap recovery from aggregate and other sources", async () => {
  const f = await fixture();
  await f.store.transaction(() => f.journal.append({ source: "session", sourceId: "s", sourceRevision: "db:1", change: "created", projectIds: ["project"], occurredAt: 2 }));
  const task = await f.call("observations.read", { source: "task" }) as { nextCursor: number; events: { source: string }[] };
  expect(task.events.map(item => item.source)).toEqual(["task"]);
  await expect(f.call("observations.ack", { source: "session", cursor: task.nextCursor })).rejects.toThrow("not offered");
  await f.call("observations.ack", { source: "task", cursor: task.nextCursor });
  const session = await f.call("observations.read", { source: "session" }) as { events: { source: string }[] };
  expect(session.events.map(item => item.source)).toEqual(["session"]);
  expect((await f.call("observations.read") as { events: unknown[] }).events).toHaveLength(2);
  await f.journal.pruneBefore(2);
  vi.mocked(f.ports.resnapshot).mockResolvedValueOnce({ complete: true, value: { coverage: ["session"], pagesDelivered: true } });
  await expect(f.call("observations.resnapshot", { source: "task" })).rejects.toThrow("coverage is incomplete");
  vi.mocked(f.ports.resnapshot).mockResolvedValueOnce({ complete: true, value: { coverage: ["task"], pagesDelivered: true } });
  expect(await f.call("observations.resnapshot", { source: "task" })).toMatchObject({ state: "resnapshotted", observationSource: "task" });
  expect(vi.mocked(f.ports.resnapshot).mock.calls.at(-1)?.[6]).toBe("task");
  expect(await f.call("observations.read", { source: "task" })).toMatchObject({ status: "ok" });
  expect(await f.call("observations.read", { source: "session" })).toMatchObject({ status: "gap" });
  expect(await f.call("observations.read")).toMatchObject({ status: "gap" });
});
it("derives Native library identity only from the captured port and fails closed", async () => {
  const f = await fixture();
  await f.store.transaction(() => f.journal.append({ source: "note", sourceId: "native-note", sourceRevision: "native:1", change: "created", projectIds: [], nativeInstallationId: "native-one", occurredAt: 2 }));
  const call = { threadId: "room", action: "observations.read", input: { nativeLibrary: true, source: "note" } };
  await expect(executeAssistantObservationTool(f.ports, call, f.admission)).rejects.toThrow("capture is unavailable");
  const ports: ObservationToolPorts = { ...f.ports, nativeInstallationId: "native-one", consumerGeneration: "capture-one", nativeSourceGap: async () => false, authorizeScope: async (_thread, scope) => "nativeInstallationId" in scope && scope.nativeInstallationId === "native-one", authorizeEvent: async (_thread, _scope, event) => event.nativeInstallationId === "native-one" };
  expect(await executeAssistantObservationTool(ports, call, f.admission)).toMatchObject({ observationSource: "note", events: [{ nativeInstallationId: "native-one" }] });
  await expect(executeAssistantObservationTool(ports, { ...call, input: { ...call.input, nativeInstallationId: "native-two" } }, f.admission)).rejects.toThrow();
  await expect(executeAssistantObservationTool(ports, { ...call, projectId: "project" }, f.admission)).rejects.toThrow("ambiguous");
  ports.nativeSourceGap = async () => true;
  expect(await executeAssistantObservationTool(ports, call, f.admission)).toMatchObject({ status: "source-gap", events: [] });
  await expect(executeAssistantObservationTool(ports, { ...call, action: "observations.ack", input: { ...call.input, cursor: 1 } }, f.admission)).rejects.toThrow("requires resnapshot");
  ports.resnapshot = async () => ({ complete: true, value: { coverage: ["note"], pagesDelivered: true } });
  expect(await executeAssistantObservationTool(ports, { ...call, action: "observations.resnapshot" }, f.admission)).toMatchObject({ state: "resnapshotted", cursor: 0 });
});
it("never offers unseen events while inspecting Native or ordinary resnapshot eligibility", async () => {
  const f = await fixture();
  await expect(f.call("observations.resnapshot")).rejects.toThrow("only after a retention gap");
  await expect(f.call("observations.ack", { cursor: 1 })).rejects.toThrow("not offered");
  await f.store.transaction(() => f.journal.append({ source: "note", sourceId: "n", sourceRevision: "native:1", change: "created", projectIds: [], nativeInstallationId: "desktop", occurredAt: 1 }));
  let gap = true;
  const ports: ObservationToolPorts = { ...f.ports, nativeInstallationId: "desktop", consumerGeneration: "generation", nativeSourceGap: async () => gap,
    authorizeScope: async () => true, authorizeEvent: async () => true, resnapshot: async () => ({ complete: true, value: { coverage: ["note"], pagesDelivered: true } }) };
  const call = { threadId: "room", action: "observations.resnapshot", input: { nativeLibrary: true, source: "note" } };
  expect(await executeAssistantObservationTool(ports, call, f.admission)).toMatchObject({ state: "resnapshotted", cursor: 0 });
  gap = false;
  await expect(executeAssistantObservationTool(ports, { ...call, action: "observations.ack", input: { ...call.input, cursor: 2 } }, f.admission)).rejects.toThrow("not offered");
});
it("never acknowledges an incomplete or revoked resnapshot", async () => {
  const f = await fixture();
  await f.journal.pruneBefore(1);
  vi.mocked(f.ports.resnapshot).mockResolvedValueOnce({ complete: false, value: { truncated: true } });
  expect(await f.call("observations.resnapshot")).toMatchObject({ state: "incomplete" });
  expect(await f.call("observations.read")).toMatchObject({ status: "gap" });
  expect(await f.call("observations.resnapshot")).toMatchObject({ state: "resnapshotted", cursor: 1 });
  expect(await f.call("observations.read")).toMatchObject({ status: "ok" });
});

it("does not disclose events or advance a cursor after authorization changes during a wait", async () => {
  const f = await fixture();
  vi.mocked(f.ports.authorizeEvent).mockImplementationOnce(async () => { f.revoke(); return true; });
  await expect(f.call("observations.read")).rejects.toThrow("revoked");
  expect((await f.journal.read("another-consumer", { projectId: "project" }, async () => true, async () => true, () => true)).events).toHaveLength(1);
});

it("requires separate account authorization and never borrows a project identity", async () => {
  const f = await fixture();
  await f.store.transaction(() => f.journal.append({ source: "social", sourceId: "thread", sourceRevision: "db:1", change: "created", projectIds: [], accountId: "account-a", occurredAt: 1 }));
  vi.mocked(f.ports.authorizeScope).mockImplementation(async (thread, scope) => thread === "room" && "accountId" in scope && scope.accountId === "account-a");
  vi.mocked(f.ports.authorizeEvent).mockImplementation(async (_thread, _scope, event) => event.accountId === "account-a" && event.projectIds.length === 0);
  const read = { threadId: "room", accountId: "account-a", action: "observations.read", input: {} };
  const page = await executeAssistantObservationTool(f.ports, read, f.admission) as { events: unknown[] };
  expect(page.events).toHaveLength(1);
  await expect(executeAssistantObservationTool(f.ports, { ...read, accountId: "account-b" }, f.admission)).rejects.toThrow("revoked");
});

it("offers only records actually delivered within the Room response budget", async () => {
  const f = await fixture();
  await f.store.transaction(async () => {
    for (let index = 0; index < 100; index++) await f.journal.append({ source: "task", sourceId: `task-${index}`, sourceRevision: "db:1", change: "updated", projectIds: ["project"], occurredAt: index });
  });
  const page = await f.call("observations.read") as { nextCursor: number; events: { sequence: number }[] };
  expect(page.events).toHaveLength(3);
  expect(page.nextCursor).toBe(page.events.at(-1)!.sequence);
  expect(JSON.stringify(page).length).toBeLessThan(6000);
  await expect(f.call("observations.ack", { cursor: page.nextCursor + 1 })).rejects.toThrow("not offered");
  await f.call("observations.ack", { cursor: page.nextCursor });
  const next = await f.call("observations.read") as { events: { sequence: number }[] };
  expect(next.events[0].sequence).toBeGreaterThan(page.nextCursor);
});
it("never offers an oversized first record or advances an oversized resnapshot", async () => {
  const f = await fixture();
  const first = await f.call("observations.read") as { nextCursor: number };
  await f.call("observations.ack", { cursor: first.nextCursor });
  await f.store.transaction(() => f.journal.append({ source: "goal", sourceId: "large", sourceRevision: "db:1", change: "updated", projectIds: ["project", ...Array.from({ length: 40 }, (_, index) => `${index}-${"x".repeat(100)}`)], occurredAt: 1 }));
  vi.mocked(f.ports.authorizeEvent).mockResolvedValue(true);
  const oversized = await f.call("observations.read") as { events: unknown[]; nextCursor: number; truncated?: boolean };
  expect(oversized.events).toEqual([]);
  expect(oversized).toMatchObject({ nextCursor: first.nextCursor, truncated: true });
  await expect(f.call("observations.ack", { cursor: first.nextCursor + 1 })).rejects.toThrow("not offered");
  expect(await f.call("observations.resnapshot")).toMatchObject({ state: "resnapshotted", cursor: first.nextCursor + 1 });
  expect((await f.call("observations.read") as { events: unknown[] }).events).toEqual([]);
  await f.store.transaction(() => f.journal.append({ source: "task", sourceId: "after", sourceRevision: "db:1", change: "updated", projectIds: ["project"], occurredAt: 2 }));
  await f.journal.pruneBefore(first.nextCursor + 2);
  vi.mocked(f.ports.resnapshot).mockResolvedValueOnce({ complete: true, value: { text: "x".repeat(4000) } });
  expect(await f.call("observations.resnapshot")).toMatchObject({ state: "incomplete" });
  expect(await f.call("observations.read")).toMatchObject({ status: "gap" });
});
it("recovers an oversized event without consuming another source", async () => {
  const f = await fixture();
  await f.store.transaction(() => f.journal.append({ source: "goal", sourceId: "large", sourceRevision: "db:1", change: "updated", projectIds: ["project", ...Array.from({ length: 40 }, (_, index) => `${index}-${"x".repeat(100)}`)], occurredAt: 2 }));
  vi.mocked(f.ports.authorizeEvent).mockResolvedValue(true);
  expect(await f.call("observations.read", { source: "goal" })).toMatchObject({ events: [], truncated: true });
  vi.mocked(f.ports.resnapshot).mockResolvedValueOnce({ complete: true, value: { coverage: ["goal"], pagesDelivered: true } });
  expect(await f.call("observations.resnapshot", { source: "goal" })).toMatchObject({ state: "resnapshotted", observationSource: "goal" });
  expect((await f.call("observations.read", { source: "task" }) as { events: unknown[] }).events).toHaveLength(1);
});
