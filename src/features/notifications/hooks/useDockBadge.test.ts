// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { resetSessionsStore, setSessions } from "../../sessions/model/sessionsStore";
import { useDockBadge } from "./useDockBadge";

const sync = vi.hoisted(() => vi.fn());
vi.mock("../model/dockBadge", () => ({ syncDockBadge: sync }));
function Harness() {
  useDockBadge();
  return null;
}
it("updates from shell changes without rerendering and releases its subscription", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = newSession("claude", "/project");
  resetSessionsStore([session]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(sync).toHaveBeenLastCalledWith([session]);
    const next = { ...session, pendingQuestion: { requestId: 1, title: "Choose", questions: [] } };
    await act(async () => setSessions([next]));
    expect(sync).toHaveBeenLastCalledWith([next]);
    await act(async () => root.unmount());
    const count = sync.mock.calls.length;
    setSessions([]);
    expect(sync).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});
