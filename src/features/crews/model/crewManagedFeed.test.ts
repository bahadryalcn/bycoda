// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewManagedSessionsFeed, feedRefetchInterval } from "./crewManagedFeed";
import { HOST_CREWS } from "./crew";
const hostRead = vi.hoisted(() => vi.fn(async () => ({ runs: [] })));

vi.mock("../../automations/public/hostMachines", () => ({
  backgroundMachines: async () => [{ id: "m" }],
  backgroundMachineFor: (machines: unknown[]) => machines[0],
  machineCapabilities: async () => ["crews.v1"],
  machineProjects: async () => [{ id: "p" }],
  hostProjectCwd: () => "/a",
}));
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: hostRead,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cwds = ["/a"];

afterEach(() => {
  document.body.innerHTML = "";
});

it("backs off only projects that confirmed no managed session", () => {
  const managed = [{ sessionId: "coord", runId: "run" }] as unknown as Parameters<
    typeof feedRefetchInterval
  >[0];
  expect(feedRefetchInterval(undefined)).toBe(10_000); // not answered yet: discover quickly
  expect(feedRefetchInterval(managed)).toBe(10_000);
  expect(feedRefetchInterval([])).toBe(30_000);
});

it("polling with unchanged data does not re-render the host component", async () => {
  expect(HOST_CREWS).toBe("crews.v1");
  notifyManager.setScheduler((cb) => cb());
  const client = new QueryClient();
  let hostRenders = 0;
  function Host() {
    hostRenders += 1;
    return createElement(CrewManagedSessionsFeed, { cwds });
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Host)));
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: [HOST_CREWS, "managed", "/a"] });
  });
  const settled = hostRenders;
  await act(async () => {
    await client.refetchQueries({ queryKey: [HOST_CREWS, "managed", "/a"] });
    await client.refetchQueries({ queryKey: [HOST_CREWS, "managed", "/a"] });
  });
  expect(client.getQueryState([HOST_CREWS, "managed", "/a"])?.data).toEqual([]);
  expect(hostRenders).toBe(settled);
  expect(hostRenders).toBe(1);
  await act(async () => root.unmount());
});

it("keeps one idle feed interval through equal replies and pauses it while hidden", async () => {
  vi.useFakeTimers();
  hostRead.mockClear();
  const arm = vi.spyOn(globalThis, "setInterval");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const client = new QueryClient();
  const renders = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            Profiler,
            { id: "feed", onRender: renders },
            createElement(CrewManagedSessionsFeed, { cwds }),
          ),
        ),
      );
    });
    expect(hostRead).toHaveBeenCalledOnce();
    expect(arm.mock.calls.map(([, ms]) => ms)).toEqual([10_000, 30_000]);
    renders.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(hostRead).toHaveBeenCalledTimes(2);
    expect(arm).toHaveBeenCalledTimes(2);
    expect(renders).not.toHaveBeenCalled();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(hostRead).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(hostRead).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    arm.mockRestore();
    hidden.mockRestore();
    vi.useRealTimers();
  }
});
