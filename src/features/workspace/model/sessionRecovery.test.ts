// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { markTurnInterrupted } from "../../sessions/model/inFlight";
import { newTab, splitPane, leafIds } from "./layout";
import { collectWorkspaceSnapshot } from "./workspaceSnapshot";
import {
  captureSessionRecovery,
  getSessionRecovery,
  isRecoverySessionHeld,
  mergeRecoveryTabs,
  parseSessionRecovery,
  recoveryStatus,
  recoveryNeedsAttention,
  sessionRecoveryTabs,
  setSessionRecovery,
  removeRecoverySessions,
  dropRecoverySessions,
} from "./sessionRecovery";
import { saveWorkspaceSnapshot } from "../../sessions/data/sessionStore";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const chat = (id: string) => ({
  ...newSession("codex", `/${id}`),
  id,
  title: id,
  blocks: [{ id: `user-${id}`, role: "user" as const, text: "hello" }],
});
const snapshot = (ids: string[]) => {
  const sessions = ids.map(chat);
  const tabs = sessions.map((s) => ({ ...newTab(s.id), id: `tab-${s.id}` }));
  return collectWorkspaceSnapshot(tabs, sessions, tabs[0].id, sessions[0].cwd, new Map());
};

describe("durable session recovery", () => {
  it("drops never-sent entries without resolving them, so a later sent turn is still captured", () => {
    const initial = captureSessionRecovery(null, snapshot(["a", "b"]), 100)!;
    const dropped = dropRecoverySessions(initial, ["a", "missing"]);
    expect(dropped.workspace.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(dropped.workspace.tabs.flatMap((tab) => leafIds(tab.layout))).toEqual(["b"]);
    expect(dropped.resolvedIds ?? []).toEqual([]);
    expect(dropRecoverySessions(initial, ["missing"])).toBe(initial);
    const parsed = parseSessionRecovery(JSON.parse(JSON.stringify(dropped)))!;
    const next = captureSessionRecovery(parsed, snapshot(["a", "b"]), 200)!;
    expect(next.workspace.sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("keeps removed entries out across restarts without releasing automatic work", () => {
    const initial = captureSessionRecovery(null, snapshot(["a", "b"]), 100)!;
    const removed = removeRecoverySessions(initial, ["a", "not-in-list"]);
    expect(removed.workspace.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(removed.workspace.tabs.flatMap((tab) => leafIds(tab.layout))).toEqual(["b"]);
    expect(removed.resolvedIds).toEqual(["a"]);
    const parsed = parseSessionRecovery(JSON.parse(JSON.stringify(removed)))!;
    const next = captureSessionRecovery(parsed, snapshot(["a", "b", "c"]), 200)!;
    expect(next.workspace.sessions.map((s) => s.id)).toEqual(["b", "c"]);
    setSessionRecovery(next);
    expect(isRecoverySessionHeld("a")).toBe(true);
    expect(initial.workspace.sessions).toHaveLength(2);
    const empty = removeRecoverySessions(next, ["b", "c"]);
    expect(empty.workspace.tabs).toEqual([]);
    expect(empty.workspace.activeTabId).toBe("");
    const roundtrip = parseSessionRecovery(JSON.parse(JSON.stringify(empty)))!;
    expect(captureSessionRecovery(roundtrip, snapshot(["a", "b", "c"]))).toBe(roundtrip);
  });
  beforeEach(() => {
    localStorage.clear();
    setSessionRecovery(null);
    vi.clearAllMocks();
  });
  it("rejects malformed journals and sanitizes saved layouts", () => {
    expect(parseSessionRecovery({ capturedAt: NaN, workspace: snapshot(["a"]) })).toBeNull();
    expect(parseSessionRecovery({ capturedAt: 1, workspace: { tabs: "bad" } })).toBeNull();
    expect(
      parseSessionRecovery({ capturedAt: 1, dismissed: "yes", workspace: snapshot(["a"]) })
        ?.dismissed,
    ).toBe(false);
  });
  it("preserves closed recovery entries and the first layout after a second crash", () => {
    const first = captureSessionRecovery(null, snapshot(["a", "b"]), 100)!;
    first.dismissed = true;
    const second = captureSessionRecovery(
      parseSessionRecovery(JSON.parse(JSON.stringify(first))),
      snapshot(["b", "c"]),
      200,
    )!;
    expect(second.capturedAt).toBe(100);
    expect(second.workspace.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(second.workspace.tabs.map((t) => t.id)).toEqual(["tab-a", "tab-b", "tab-c"]);
    expect(second.dismissed).toBe(false);
    expect(captureSessionRecovery(second, snapshot(["b"]))).toBe(second);
  });
  it("retains the journal through ordinary and quit workspace writes", async () => {
    const journal = captureSessionRecovery(null, snapshot(["a", "b"]), 100)!;
    setSessionRecovery(journal);
    await saveWorkspaceSnapshot(snapshot(["b"]));
    await saveWorkspaceSnapshot(snapshot(["c"]));
    const last = vi.mocked(invoke).mock.calls.at(-1)?.[1] as {
      snapshot: { sessionRecovery: unknown };
    };
    expect(
      parseSessionRecovery(last.snapshot.sessionRecovery)?.workspace.sessions.map((s) => s.id),
    ).toEqual(["a", "b"]);
    expect(getSessionRecovery()).toBe(journal);
  });
  it("freezes journal data when queuing each write", async () => {
    const first = captureSessionRecovery(null, snapshot(["a"]), 100)!;
    setSessionRecovery(first);
    const writing = saveWorkspaceSnapshot(snapshot(["a"]));
    setSessionRecovery(captureSessionRecovery(first, snapshot(["b"]), 200));
    await writing;
    const args = vi.mocked(invoke).mock.calls.at(-1)?.[1] as {
      snapshot: { sessionRecovery: unknown };
    };
    expect(
      parseSessionRecovery(args.snapshot.sessionRecovery)?.workspace.sessions.map((s) => s.id),
    ).toEqual(["a"]);
  });
  it("restores split conversations without losing newly opened work", () => {
    const previous = { ...newTab("a"), layout: splitPane(newTab("a").layout, "a", "right", "b") };
    const old = sessionRecoveryTabs([previous], new Set(["a", "b"]));
    const current = [
      { ...newTab("a"), layout: splitPane(newTab("a").layout, "a", "down", "new-chat") },
      newTab("new-project"),
    ];
    const merged = mergeRecoveryTabs(current, old);
    expect(merged.flatMap((t) => leafIds(t.layout)).sort()).toEqual([
      "a",
      "b",
      "new-chat",
      "new-project",
    ]);
    expect(merged.at(-1)?.layout).toEqual(previous.layout);
  });
  it("merges all forty recovered tabs without limiting or duplicating conversations", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `recovered-${index}`);
    const tabs = mergeRecoveryTabs([newTab("new-work"), newTab(ids[0])], ids.map(newTab));
    expect(tabs).toHaveLength(41);
    expect(new Set(tabs.flatMap((tab) => leafIds(tab.layout))).size).toBe(41);
    expect(tabs.flatMap((tab) => leafIds(tab.layout))).toEqual(["new-work", ...ids]);
  });
  it("does not reopen stale non-conversation panes", () => {
    const mixed = {
      ...newTab("a"),
      layout: splitPane(newTab("a").layout, "a", "right", "stale-terminal"),
    };
    expect(sessionRecoveryTabs([mixed], new Set(["a"])).flatMap((t) => leafIds(t.layout))).toEqual([
      "a",
    ]);
  });
  it("never treats a cached remote state as verified", () => {
    expect(recoveryStatus({ ...chat("a"), busy: true }, true, false)).toBe("unknown");
    expect(recoveryStatus({ ...chat("a"), busy: true }, true, true)).toBe("working");
    expect(recoveryStatus(undefined, false, false)).toBe("unknown");
    expect(recoveryStatus(markTurnInterrupted(chat("a")), false, true)).toBe("interrupted");
    expect(recoveryStatus(chat("a"), false, true)).toBe("unknown");
  });
  it("keeps an interruption visible through trailing status rows, but not a new finished turn", () => {
    const interrupted = markTurnInterrupted(chat("a"));
    interrupted.blocks.push({ id: "status", role: "system", text: "Restored from disk" });
    expect(recoveryStatus(interrupted, false, true)).toBe("interrupted");
    interrupted.blocks.push({
      id: "next",
      role: "user",
      text: "Next task",
      startedAt: 10,
      durationMs: 20,
    });
    interrupted.blocks.push({ id: "reply", role: "assistant", text: "Finished" });
    expect(recoveryStatus(interrupted, false, true)).toBe("done");
    expect(recoveryNeedsAttention("done")).toBe(false);
    expect(recoveryNeedsAttention("idle")).toBe(false);
  });
  it("keeps failed and unfinished turns separate from completed sessions", () => {
    const failed = chat("a");
    failed.blocks.push({ id: "error", role: "system", text: "Provider failed", notice: "error" });
    expect(recoveryStatus(failed, false, true)).toBe("failed");
    expect(recoveryNeedsAttention("failed")).toBe(true);
    expect(recoveryNeedsAttention("interrupted")).toBe(true);
    expect(recoveryNeedsAttention("working")).toBe(true);
    expect(recoveryStatus({ ...chat("a"), blocks: [] }, false, true)).toBe("idle");
  });
  it("holds recovered conversations from automatic sends even after acknowledgment", () => {
    const recovery = captureSessionRecovery(null, snapshot(["a"]), 100)!;
    setSessionRecovery(recovery);
    expect(isRecoverySessionHeld("a")).toBe(true);
    setSessionRecovery({ ...recovery, dismissed: true });
    expect(isRecoverySessionHeld("a")).toBe(true);
    expect(isRecoverySessionHeld("new-chat")).toBe(false);
  });
});
