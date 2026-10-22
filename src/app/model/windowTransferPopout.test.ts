import { describe, expect, it } from "vitest";
import { newTab } from "../../features/workspace/model/layout";
import type { Session } from "../../features/sessions/model/session";
import {
  busySessionsInTabs,
  dropWindowMoves,
  isPointerOutsideWindow,
  planTabMoveRemainder,
  popOutPosition,
  windowDropPointToClient,
  queueWindowMoves,
  settlePendingWindowMoves,
} from "./windowTransferPopout";

function session(id: string, cwd: string, busy = false): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy,
    model: "",
    modelSettings: {},
    runtimeMode: "default",
  };
}

describe("isPointerOutsideWindow", () => {
  it("retains an explicit return destination while work is queued", () => {
    const queued = queueWindowMoves({}, ["tab"], { targetWindowLabel: "main" });
    expect(queued.tab).toEqual({ targetWindowLabel: "main" });
    const tabs = [{ ...newTab("running"), id: "tab" }];
    expect(settlePendingWindowMoves(queued, tabs, [session("running", "/p", true)]).ready).toEqual(
      [],
    );
    expect(settlePendingWindowMoves(queued, tabs, [session("running", "/p")]).ready).toEqual([
      "tab",
    ]);
  });
  it("ignores the title bar interior and a small overshoot", () => {
    expect(isPointerOutsideWindow(400, 10, 800, 600)).toBe(false);
    expect(isPointerOutsideWindow(-3, 10, 800, 600)).toBe(false);
    expect(isPointerOutsideWindow(803, 603, 800, 600)).toBe(false);
  });

  it("detects any side past the margin", () => {
    expect(isPointerOutsideWindow(-20, 10, 800, 600)).toBe(true);
    expect(isPointerOutsideWindow(400, -20, 800, 600)).toBe(true);
    expect(isPointerOutsideWindow(900, 10, 800, 600)).toBe(true);
    expect(isPointerOutsideWindow(400, 700, 800, 600)).toBe(true);
  });
});

describe("popOutPosition", () => {
  it("offsets so the tab lands under the pointer", () => {
    expect(popOutPosition(1000.4, 500)).toEqual({ x: 880, y: 484 });
  });
});

describe("window drop coordinates", () => {
  it("accounts for destination webview zoom independently of monitor DPI", () => {
    expect(windowDropPointToClient({ x: 150, y: 90, scaleFactor: 1.5 }, 2.25)).toEqual({
      x: 100,
      y: 60,
    });
    const point = windowDropPointToClient({ x: 80, y: 60, scaleFactor: 2 }, 1.5);
    expect(point.x).toBeCloseTo((80 * 2) / 1.5);
    expect(point.y).toBe(80);
  });
  it("preserves legacy coordinates when scale metadata is absent", () => {
    expect(windowDropPointToClient({ x: 150, y: 90 }, 2)).toEqual({ x: 150, y: 90 });
  });
});

describe("planTabMoveRemainder", () => {
  const sessions = [session("a", "/p/one"), session("b", "/p/one"), session("c", "/p/two")];
  const tabs = [
    { ...newTab("a"), id: "ta" },
    { ...newTab("b"), id: "tb" },
    { ...newTab("c"), id: "tc" },
  ];

  it("activates a remaining tab of the same project", () => {
    expect(planTabMoveRemainder(tabs, sessions, ["ta"], "ta", "/p/one")).toEqual({
      remaining: [tabs[1], tabs[2]],
      closeWindow: false,
      needsSeed: false,
      nextActiveTabId: "tb",
    });
  });

  it("seeds a blank session when the project has nothing left", () => {
    const plan = planTabMoveRemainder(tabs, sessions, ["ta", "tb"], "ta", "/p/one");
    expect(plan.needsSeed).toBe(true);
    expect(plan.nextActiveTabId).toBeNull();
    expect(plan.remaining.map((tab) => tab.id)).toEqual(["tc"]);
  });

  it("keeps the active tab when another tab moves", () => {
    expect(planTabMoveRemainder(tabs, sessions, ["tb"], "ta", "/p/one").nextActiveTabId).toBeNull();
  });

  it("closes a drained secondary window without creating a new session", () => {
    const plan = planTabMoveRemainder([tabs[0]], sessions, ["ta"], "ta", "/p/one", true);
    expect(plan).toMatchObject({
      remaining: [],
      closeWindow: true,
      needsSeed: false,
    });
  });

  it("keeps a window alive while it owns an inbox turn outside its tab tree", () => {
    const plan = planTabMoveRemainder(
      [tabs[0]],
      [...sessions, session("inbox", "/p/one", true)],
      ["ta"],
      "ta",
      "/p/one",
      true,
    );
    expect(plan.closeWindow).toBe(false);
    expect(plan.needsSeed).toBe(true);
  });

  it("keeps a secondary window that still owns another project", () => {
    const plan = planTabMoveRemainder(tabs, sessions, ["ta", "tb"], "ta", "/p/one", true);
    expect(plan.closeWindow).toBe(false);
    expect(plan.remaining).toEqual([tabs[2]]);
  });
});

describe("busySessionsInTabs", () => {
  it("reports only busy sessions of the moving tabs", () => {
    const sessions = [session("a", "/p", true), session("b", "/p"), session("c", "/p", true)];
    const tabs = [
      { ...newTab("a"), id: "ta" },
      { ...newTab("b"), id: "tb" },
      { ...newTab("c"), id: "tc" },
    ];
    expect(busySessionsInTabs(tabs, sessions, ["ta", "tb"]).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("pending window moves", () => {
  it("queues a busy tab and releases it once its turn ends", () => {
    const tab = newTab("s1");
    const pending = queueWindowMoves({}, [tab.id], { x: 10, y: 20 });
    expect(pending).toEqual({ [tab.id]: { x: 10, y: 20 } });

    expect(settlePendingWindowMoves(pending, [tab], [session("s1", "/p", true)])).toEqual({
      ready: [],
      gone: [],
    });
    expect(settlePendingWindowMoves(pending, [tab], [session("s1", "/p")])).toEqual({
      ready: [tab.id],
      gone: [],
    });
  });

  it("forgets a queued tab that was closed meanwhile", () => {
    const pending = queueWindowMoves({}, ["closed"]);
    expect(settlePendingWindowMoves(pending, [], [])).toEqual({
      ready: [],
      gone: ["closed"],
    });
  });

  it("drops entries without touching an unrelated queue", () => {
    const pending = queueWindowMoves({}, ["a", "b"]);
    expect(dropWindowMoves(pending, ["a"])).toEqual({ b: null });
    expect(dropWindowMoves(pending, ["z"])).toBe(pending);
  });
});
