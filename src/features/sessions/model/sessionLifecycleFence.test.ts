// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRemoteSessionLifecycleLists } from "../hooks/useSessionLifecycle";
import type { SessionLifecycleView } from "./sessionLifecycle";
import {
  applyLifecycleListRead,
  applyLifecycleViewRead,
  beginLifecycleRead,
  sessionLifecycleClient,
  setSessionLifecycle,
  setSessionLifecycleList,
  useSessionLifecycleSnapshot,
} from "./sessionLifecycleClient";

const remoteRequest = vi.hoisted(() => vi.fn());
vi.mock("../../connections/public/connections", () => ({ remoteRequest }));

const owner = [{ userId: null, role: "owner" as const }];
const autoSettle = { afterDays: 7, archiveAfterDays: 30 };
const active = (sessionId: string): SessionLifecycleView => ({
  sessionId,
  state: "active",
  participants: owner,
});
const settled = (sessionId: string, settledAt = 10): SessionLifecycleView => ({
  sessionId,
  state: "settled",
  participants: owner,
  settledAt,
  settledBy: "owner",
});

let root: Root;
let snapshots: ReturnType<typeof useSessionLifecycleSnapshot>[];
function Probe() {
  snapshots.push(useSessionLifecycleSnapshot());
  return null;
}
const stateOf = (id: string) => snapshots.at(-1)!.views.get(id)?.state;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  remoteRequest.mockReset();
  root = createRoot(document.createElement("div"));
  snapshots = [];
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function confirmSettle(id: string, view = settled(id)) {
  remoteRequest.mockResolvedValueOnce(view);
  const confirmed = await sessionLifecycleClient("local").settle(id);
  await act(async () => setSessionLifecycle(confirmed));
}

async function confirmUnsettle(id: string) {
  remoteRequest.mockResolvedValueOnce(active(id));
  const confirmed = await sessionLifecycleClient("local").unsettle(id);
  await act(async () => setSessionLifecycle(confirmed));
}

it("ignores a list requested before a confirmed settle that does not know the settle yet", async () => {
  await act(async () => setSessionLifecycleList({ records: [active("fence-1")], autoSettle }));
  const readAt = beginLifecycleRead();
  await confirmSettle("fence-1");
  expect(stateOf("fence-1")).toBe("settled");

  await act(async () =>
    applyLifecycleListRead({ records: [], autoSettle: { afterDays: 3 } }, readAt),
  );

  expect(stateOf("fence-1")).toBe("settled");
  expect(snapshots.at(-1)!.views.get("fence-1")?.settledAt).toBe(10);
});

it("ignores a stale list that still shows the session in an older record", async () => {
  await act(async () =>
    setSessionLifecycleList({
      records: [
        { sessionId: "fence-2", state: "settling", participants: owner, settleRequestedAt: 5 },
      ],
      autoSettle,
    }),
  );
  const readAt = beginLifecycleRead();
  await confirmSettle("fence-2", settled("fence-2", 40));

  await act(async () =>
    applyLifecycleListRead(
      {
        records: [
          { sessionId: "fence-2", state: "settling", participants: owner, settleRequestedAt: 5 },
        ],
        autoSettle,
      },
      readAt,
    ),
  );

  expect(stateOf("fence-2")).toBe("settled");
  expect(snapshots.at(-1)!.views.get("fence-2")?.settledAt).toBe(40);
});

it("ignores a stale list that still shows the session settled after a confirmed un-settle", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("fence-3")], autoSettle }));
  const readAt = beginLifecycleRead();
  await confirmUnsettle("fence-3");
  expect(stateOf("fence-3")).toBe("active");

  await act(async () =>
    applyLifecycleListRead({ records: [settled("fence-3")], autoSettle }, readAt),
  );

  expect(stateOf("fence-3")).toBe("active");
});

it("applies a list requested after the confirmed settle, including a later wake", async () => {
  await act(async () => setSessionLifecycleList({ records: [active("fence-4")], autoSettle }));
  await confirmSettle("fence-4");
  const readAt = beginLifecycleRead();

  await act(async () => applyLifecycleListRead({ records: [], autoSettle }, readAt));

  expect(stateOf("fence-4")).toBe("active");
});

it("keeps other sessions and the windows of a stale list while fencing the confirmed one", async () => {
  await act(async () =>
    setSessionLifecycleList({ records: [active("fence-5"), active("fence-6")], autoSettle }),
  );
  const readAt = beginLifecycleRead();
  await confirmSettle("fence-5");

  await act(async () =>
    applyLifecycleListRead(
      { records: [settled("fence-6", 20), settled("fence-7", 30)], autoSettle: { afterDays: 3 } },
      readAt,
    ),
  );

  expect(stateOf("fence-5")).toBe("settled");
  expect(stateOf("fence-6")).toBe("settled");
  expect(stateOf("fence-7")).toBe("settled");
  expect(snapshots.at(-1)!.autoSettle).toEqual({ afterDays: 3 });
});

it("fences only the session that was confirmed, so an older read still demotes the others", async () => {
  await act(async () =>
    setSessionLifecycleList({ records: [settled("fence-8"), active("fence-9")], autoSettle }),
  );
  const readAt = beginLifecycleRead();
  await confirmSettle("fence-9");

  await act(async () => applyLifecycleListRead({ records: [], autoSettle }, readAt));

  expect(stateOf("fence-9")).toBe("settled");
  expect(stateOf("fence-8")).toBe("active");
});

it("ignores a single-session read begun before the confirmed settle and applies a later one", async () => {
  await act(async () => setSessionLifecycle(active("fence-10")));
  const early = beginLifecycleRead();
  await confirmSettle("fence-10");

  await act(async () => applyLifecycleViewRead(active("fence-10"), early));
  expect(stateOf("fence-10")).toBe("settled");

  const late = beginLifecycleRead();
  await act(async () => applyLifecycleViewRead(active("fence-10"), late));
  expect(stateOf("fence-10")).toBe("active");
});

it("fences a read begun while the settle request was still in flight", async () => {
  await act(async () => setSessionLifecycle(active("fence-11")));
  let answer: (view: SessionLifecycleView) => void = () => undefined;
  remoteRequest.mockReturnValueOnce(
    new Promise<SessionLifecycleView>((resolve) => (answer = resolve)),
  );
  const settling = sessionLifecycleClient("local").settle("fence-11");
  const readAt = beginLifecycleRead();

  answer(settled("fence-11"));
  await act(async () => setSessionLifecycle(await settling));
  await act(async () => applyLifecycleViewRead(active("fence-11"), readAt));

  expect(stateOf("fence-11")).toBe("settled");
});

it("does not fence reads when the settle request failed", async () => {
  await act(async () => setSessionLifecycle(settled("fence-12")));
  const readAt = beginLifecycleRead();
  remoteRequest.mockRejectedValueOnce(new Error("Host refused"));
  await expect(sessionLifecycleClient("local").unsettle("fence-12")).rejects.toThrow(
    "Host refused",
  );

  await act(async () => applyLifecycleListRead({ records: [], autoSettle }, readAt));

  expect(stateOf("fence-12")).toBe("active");
});

it("keeps the snapshot object when a fenced list changes nothing", async () => {
  await act(async () => setSessionLifecycleList({ records: [active("fence-13")], autoSettle }));
  const readAt = beginLifecycleRead();
  await confirmSettle("fence-13");
  const before = snapshots.at(-1)!;
  const others = [...before.views.values()].filter(
    (view) => view.state !== "active" && view.sessionId !== "fence-13",
  );
  const renders = snapshots.length;

  await act(async () =>
    applyLifecycleListRead({ records: others, autoSettle: { ...before.autoSettle! } }, readAt),
  );

  expect(snapshots.at(-1)).toBe(before);
  expect(snapshots.length).toBe(renders);
});

it("shares a remote lifecycle read and keeps the confirmed settle across both consumers", async () => {
  const machineId = "remote-fence-machine";
  const sessionId = "remote-fence-session";
  const { promise, resolve } = Promise.withResolvers<{
    records: SessionLifecycleView[];
    autoSettle: typeof autoSettle;
  }>();
  remoteRequest.mockReturnValueOnce(promise);
  const readers = new Map<string, ReturnType<typeof useRemoteSessionLifecycleLists>>();
  function RemoteProbe({ name }: { name: string }) {
    readers.set(name, useRemoteSessionLifecycleLists(JSON.stringify([machineId])));
    return null;
  }
  await act(async () =>
    root.render([
      createElement(RemoteProbe, { name: "sidebar", key: "sidebar" }),
      createElement(RemoteProbe, { name: "header", key: "header" }),
    ]),
  );
  expect(remoteRequest).toHaveBeenCalledExactlyOnceWith(machineId, "sessions.lifecycle.list", {});

  remoteRequest.mockResolvedValueOnce(settled(sessionId));
  await act(async () => readers.get("header")!.change(machineId, sessionId, false));
  await act(async () => resolve({ records: [], autoSettle }));

  expect(remoteRequest).toHaveBeenLastCalledWith(
    machineId,
    "sessions.lifecycle.settle",
    { sessionId },
    false,
    true,
  );
  for (const reader of readers.values())
    expect(reader.lists.get(machineId)?.get(sessionId)).toEqual(settled(sessionId));
});
