// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
import { newTab } from "../../../features/workspace/model/layout";
import { useRailSessionLists, type RailSessionLists } from "./useRailSessionLists";

const titleTab = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../helpers/tabHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers/tabHelpers")>();
  return {
    ...actual,
    toTitleTab: (...args: Parameters<typeof actual.toTitleTab>) => {
      titleTab.calls += 1;
      return actual.toTitleTab(...args);
    },
  };
});

function session(id: string, text = "hi"): Session {
  return {
    id,
    cwd: "/repo",
    title: id,
    harness: "claude",
    model: "m",
    blocks: [{ id: `${id}-u`, role: "user", text, startedAt: 1_000 }],
  } as unknown as Session;
}

it("rebuilds only what changed when sessions or unrelated App state update", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const tab = newTab("a");
  const tabProjectsRef = { current: new Map<string, string>() };
  const stable = {
    unseenFinishedIds: new Set<string>(),
    unopenedRemote: [],
    history: [],
    onPinHistorySession: async () => {},
    deckProjectTabs: [tab],
    dirtyFiles: new Set<string>(),
    pendingWindowMoves: {},
    windowTransferPending: false,
    movingWindows: new Set<string>(),
    tabProjectsRef,
  };
  let result!: RailSessionLists;
  function Harness(props: { sessions: Session[]; history: unknown[] }) {
    result = useRailSessionLists({ ...stable, ...props } as never);
    return null;
  }
  const a = session("a");
  const b = session("b");
  const sessions = [a, b];
  try {
    await act(async () => root.render(createElement(Harness, { sessions, history: [] })));
    const first = result;
    const calls = titleTab.calls;

    // Unrelated App state (history) changes: no title-tab rebuild, same rail list.
    await act(async () =>
      root.render(createElement(Harness, { sessions, history: [{ id: "h" }] })),
    );
    expect(titleTab.calls).toBe(calls);
    expect(result.railLiveSessions).toBe(first.railLiveSessions);
    expect(result.titleTabs).toBe(first.titleTabs);

    // One session changes: the others keep their rail entries.
    const b2 = session("b", "changed");
    b2.title = "renamed";
    await act(async () =>
      root.render(createElement(Harness, { sessions: [a, b2], history: [{ id: "h" }] })),
    );
    expect(result.railLiveSessions.map((info) => info.title)).toEqual(["a", "renamed"]);
    expect(result.railLiveSessions[0]).toBe(first.railLiveSessions[0]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
