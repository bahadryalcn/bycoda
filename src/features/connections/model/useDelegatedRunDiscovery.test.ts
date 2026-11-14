// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  delegatedDiscoveryFailure,
  listDelegatedRunSummaries,
  useDelegatedRunDiscovery,
} from "./useDelegatedRunDiscovery";
import { remoteRequest } from "./connections";
import { getSessions, resetSessionsStore, setSessions } from "../../sessions/model/sessionsStore";
import { registerRemoteSessionActions } from "./remoteSessionActions";
import type { Session } from "../../sessions/model/session";

const discover = vi.hoisted(() => vi.fn(async (_parent: { id: string }): Promise<Session[]> => []));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./delegatedRunDiscovery", () => ({ discoverDelegatedRuns: discover }));
vi.mock("./connections", () => ({ remoteRequest: vi.fn(), loadRemoteSession: vi.fn() }));
function Probe({ id }: { id: string }) {
  useDelegatedRunDiscovery(id, true);
  return null;
}

it("hydrates children and resumes background updates after the live sheet owner closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const parent = { id: "p", cwd: "/p", modelSettings: {} } as Session;
  const child = { id: "c", cwd: "/p", blocks: [], modelSettings: {} } as unknown as Session;
  const completed = {
    ...child,
    title: "Completed",
    blocks: [{ id: "done", role: "assistant", text: "Done" }],
  } as Session;
  resetSessionsStore([parent]);
  discover.mockResolvedValueOnce([child]);
  const root = createRoot(document.createElement("div"));
  let release = () => {};
  try {
    await act(async () => root.render(createElement(Probe, { id: "p" })));
    expect(getSessions()).toEqual([parent, child]);
    release = registerRemoteSessionActions(child.id, {} as never);
    discover.mockResolvedValueOnce([completed]);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(getSessions()[1]).toBe(child);
    release();
    discover.mockResolvedValueOnce([completed]);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(getSessions()[1]).toEqual(completed);
  } finally {
    release();
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it.each(["streamed", "owner", "removed", "arrived"])(
  "does not replace a child's %s state with a delayed discovery result",
  async (mode) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const parent = { id: "p", cwd: "/p", modelSettings: {} } as Session;
    const oldChild = {
      id: "c",
      cwd: "/p",
      modelSettings: {},
      blocks: [{ id: "reply", role: "assistant", text: "Old reply" }],
    } as Session;
    const latest = {
      ...oldChild,
      blocks: [{ id: "reply", role: "assistant", text: "Newest reply" }],
    } as Session;
    resetSessionsStore(
      mode === "arrived" ? [parent] : [parent, mode === "owner" ? latest : oldChild],
    );
    let resolve!: (children: Session[]) => void;
    discover.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const root = createRoot(document.createElement("div"));
    let release = () => {};
    try {
      await act(async () => root.render(createElement(Probe, { id: "p" })));
      if (mode === "owner") release = registerRemoteSessionActions("c", {} as never);
      else await act(async () => setSessions(mode === "removed" ? [parent] : [parent, latest]));
      await act(async () => resolve([oldChild]));
      expect(getSessions()).toEqual(mode === "removed" ? [parent] : [parent, latest]);
    } finally {
      release();
      await act(async () => root.unmount());
      resetSessionsStore([]);
      vi.unstubAllGlobals();
    }
  },
);
it("discovers historical children after delegation settings are removed, without querying a child as a parent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const marker = JSON.stringify({
    parentSessionId: "p",
    runId: "r",
    kind: "advisor",
    model: "m",
    startedAt: 1,
  });
  resetSessionsStore([
    { id: "p", cwd: "/p", modelSettings: {} } as Session,
    { id: "c", cwd: "/p", modelSettings: { delegationParent: marker } } as Session,
  ]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe, { id: "p" })));
    expect(discover).toHaveBeenCalledOnce();
    expect(discover.mock.calls[0][0].id).toBe("p");
    discover.mockClear();
    await act(async () => root.render(createElement(Probe, { id: "c" })));
    expect(discover).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});

it.each([
  "Host rejected request: Host read capacity is busy; retry later.",
  "RPC_WS_OVERLOAD: Host read capacity is busy; retry later.",
  "RPC_WS_INTERRUPTED: Host connection ended before the result was known",
  "Machine is unreachable. Check that it is on.",
])("leaves a busy or unreachable machine to the next poll: %s", (text) => {
  expect(delegatedDiscoveryFailure(new Error(text))).toBeUndefined();
});

it("reports a failure of the check itself without the Host prefix", () => {
  expect(delegatedDiscoveryFailure("Host rejected request: Project is not registered")).toBe(
    "Project is not registered",
  );
});

it("lists delegated runs with the last etag so an unchanged project costs the Host no scan", async () => {
  const summary = { id: "child", title: "Child" } as never;
  vi.mocked(remoteRequest)
    .mockResolvedValueOnce({ etag: "e1", sessions: [summary] } as never)
    .mockResolvedValueOnce({ unchanged: true, etag: "e1" } as never)
    .mockResolvedValueOnce({ etag: "e2", sessions: [] } as never);
  expect(await listDelegatedRunSummaries("m", "p", "parent")).toEqual([summary]);
  expect(remoteRequest).toHaveBeenLastCalledWith("m", "sessions.list", {
    projectId: "p",
    parentSessionId: "parent",
    known: "",
  });
  expect(await listDelegatedRunSummaries("m", "p", "parent")).toEqual([summary]);
  expect(remoteRequest).toHaveBeenLastCalledWith("m", "sessions.list", {
    projectId: "p",
    parentSessionId: "parent",
    known: "e1",
  });
  expect(await listDelegatedRunSummaries("m", "p", "parent")).toEqual([]);
});
