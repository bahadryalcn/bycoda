// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewManagedSessionsFeed } from "./crewManagedFeed";
import { HOST_CREWS } from "./crew";

vi.mock("../../automations/public/hostMachines", () => ({
  backgroundMachines: async () => [{ id: "m" }],
  backgroundMachineFor: (machines: unknown[]) => machines[0],
  machineCapabilities: async () => ["crews.v1"],
  machineProjects: async () => [{ id: "p" }],
  hostProjectCwd: () => "/a",
}));
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: async () => ({ runs: [] }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cwds = ["/a"];

afterEach(() => {
  document.body.innerHTML = "";
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
