import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { readSessionUsage, usageParams } from "./usage-report";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { Block } from "../src/features/sessions/model/session";
const stores: HostStore[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close(); vi.useRealTimers(); });
function setup() { const store = new HostStore(":memory:"); stores.push(store); return { store, project: store.addProject("/usage", "Usage") }; }
function session(projectId: string, id: string, blocks: Block[]): HostSession {
  return { projectId, revision: 1, updatedAt: 200, status: "idle", session: { id, cwd: "/usage", title: "PRIVATE TITLE", harness: "codex", model: "test", runtimeMode: "supervised", modelSettings: {}, blocks } };
}
const turn = (id: string, startedAt = 100): Block => ({ id, role: "user", text: "PRIVATE PROMPT", startedAt, durationMs: 20, turnMetrics: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } });
it("projects real SQLite metadata without JS transcript parsing; uses UTC half-open turn starts", () => {
  const { store, project } = setup();
  store.save(session(project.id, "a", [turn("before", 99), turn("start", 100), turn("end", 200), { ...turn("draft"), draft: true }, { ...turn("continuation"), continuationOf: "start" }]), {});
  const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("Full JSON parse forbidden"); });
  const report = readSessionUsage(store, { projectId: project.id, sinceMs: 100, untilMs: 200 }, 300);
  expect(parse).not.toHaveBeenCalled();
  expect(report).toMatchObject({ environmentId: store.environmentId, projectId: project.id, scope: "host-observed-sessions", sampledAt: 300, window: { timeZone: "UTC", attribution: "turn-start" }, totals: { turns: 1, durationMs: 20, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cost: null }, nextCursor: null });
  expect(JSON.stringify(report)).not.toContain("PRIVATE");
});
it("reads current pending timing/metrics then the flushed sparse journal without stale snapshot totals", () => {
  vi.useFakeTimers();
  const { store, project } = setup();
  const first = store.save(session(project.id, "a", [turn("turn")]), {});
  const updated = { ...first.session.blocks[0], durationMs: 40, turnMetrics: { inputTokens: 19, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  store.save({ ...first, revision: 2, session: { ...first.session, blocks: [updated] } }, {}, { deferred: true, blockChanges: new Map([[updated.id, updated]]) });
  const params = { projectId: project.id, sinceMs: 100, untilMs: 200 };
  expect(readSessionUsage(store, params).totals).toMatchObject({ durationMs: 40, inputTokens: 19 });
  vi.advanceTimersByTime(1000);
  expect(store.db.prepare("SELECT revision FROM session_journal WHERE session_id='a'").get()?.revision).toBe(2);
  const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("Full JSON parse forbidden"); });
  expect(readSessionUsage(store, params).totals).toMatchObject({ durationMs: 40, inputTokens: 19 });
  expect(parse).not.toHaveBeenCalled();
});
it("does not turn missing metrics or running duration into true zero; marks undated coverage", () => {
  const { store, project } = setup();
  store.save(session(project.id, "a", [turn("known"), { id: "unknown", role: "user", text: "PRIVATE", startedAt: 150 }, { id: "undated", role: "user", text: "PRIVATE" }]), {});
  const report = readSessionUsage(store, { projectId: project.id, sinceMs: 100, untilMs: 200 });
  expect(report.totals).toMatchObject({ turns: 2, timedTurns: 1, durationMs: null, inputTokens: null, outputTokens: null, cost: null });
  expect(report.coverage.undatedTurns).toBe(1);
  expect(report.coverage.unavailableFields).toContain("inputTokens");
});
it("paginates only the registered project and labels page totals/truncation", () => {
  const { store, project } = setup(); const other = store.addProject("/other", "Other");
  for (const id of ["a", "b"]) store.save(session(project.id, id, [turn(id)]), {});
  store.save(session(other.id, "c", [turn("private")]), {});
  const params = { projectId: project.id, sinceMs: 100, untilMs: 200, limit: 1 };
  const first = readSessionUsage(store, params);
  expect(first.rows.map((row) => row.sessionId)).toEqual(["a"]); expect(first.nextCursor).toBe("a"); expect(first.coverage.truncated).toBe(true);
  const second = readSessionUsage(store, { ...params, cursor: first.nextCursor });
  expect(second.rows.map((row) => row.sessionId)).toEqual(["b"]); expect(second.nextCursor).toBe(null);
  expect(() => readSessionUsage(store, { ...params, projectId: "missing" })).toThrow();
});
it("bounds oversized snapshots and validates intervals/page parameters before store access", () => {
  const { store, project } = setup();
  store.save(session(project.id, "a", [{ ...turn("large"), text: "x".repeat(4 * 1024 * 1024) }]), {});
  const report = readSessionUsage(store, { projectId: project.id, sinceMs: 100, untilMs: 200 });
  expect(report.rows).toEqual([]); expect(report.coverage).toMatchObject({ skippedSessions: 1, truncated: true });
  expect(report.totals.inputTokens).toBe(null); expect(report.totals.durationMs).toBe(null);
  for (const patch of [{ sinceMs: NaN }, { untilMs: 100 }, { untilMs: 32 * 86400000 }, { limit: 101 }, { cursor: "" }, { projectId: "" }]) {
    expect(() => usageParams({ projectId: project.id, sinceMs: 100, untilMs: 200, ...patch })).toThrow();
  }
});
it("does not present undated-only coverage or an oversized journal ID list as a known zero", () => {
  const { store, project } = setup();
  store.save(session(project.id, "a", [{ id: "undated", role: "user", text: "private" }]), {});
  const params = { projectId: project.id, sinceMs: 100, untilMs: 200 };
  expect(readSessionUsage(store, params)).toMatchObject({ totals: { inputTokens: null, durationMs: null }, coverage: { truncated: true, undatedTurns: 1 } });
  store.db.prepare("INSERT INTO session_journal VALUES (?,?,?,?)").run("a", 2, JSON.stringify({ session: { harness: "codex" } }), JSON.stringify(["x".repeat(4 * 1024 * 1024)]));
  const report = readSessionUsage(store, params);
  expect(report.coverage).toMatchObject({ skippedSessions: 1, truncated: true }); expect(report.totals.inputTokens).toBe(null);
  store.db.prepare("DELETE FROM session_journal WHERE session_id='a'").run();
});
it("honors structural journal block IDs and caps pending turn scans", () => {
  vi.useFakeTimers();
  const { store, project } = setup();
  const first = store.save(session(project.id, "a", [turn("remove"), turn("keep")]), {});
  const changed = [first.session.blocks[1], { ...turn("added"), turnMetrics: { inputTokens: 2 } }];
  store.save({ ...first, revision: 2, session: { ...first.session, blocks: changed } }, {}, { deferred: true });
  vi.advanceTimersByTime(1000);
  const params = { projectId: project.id, sinceMs: 100, untilMs: 200 };
  expect(readSessionUsage(store, params).totals).toMatchObject({ turns: 2, inputTokens: 12 });
  const large = Array.from({ length: 4001 }, (_, index) => turn(String(index)));
  store.save({ ...first, revision: 3, session: { ...first.session, blocks: large } }, {}, { deferred: true });
  const capped = readSessionUsage(store, params);
  expect(capped.totals.turns).toBe(4000); expect(capped.totals.inputTokens).toBe(null); expect(capped.coverage.truncated).toBe(true);
});
