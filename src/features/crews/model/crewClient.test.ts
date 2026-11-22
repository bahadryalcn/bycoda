// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HOST_CREWS } from "./crew";
const fixture = vi.hoisted(() => ({
  options: undefined as any,
  data: undefined as any,
  request: vi.fn(),
  invalidate: vi.fn(),
  catalogArgs: undefined as any,
  catalogRead: {
    catalog: undefined as any,
    error: "",
    stale: false,
    loading: false,
    refresh: vi.fn(),
  },
}));
vi.mock("../../connections/model/useRemoteModelCatalog", () => ({
  useRemoteModelCatalog: (args: unknown) => {
    fixture.catalogArgs = args;
    return fixture.catalogRead;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    fixture.options = options;
    return { data: fixture.data };
  },
  useQueryClient: () => ({ invalidateQueries: fixture.invalidate }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: async () => [HOST_CREWS],
}));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachines: async () => [],
  backgroundMachineFor: () => ({ id: "local" }),
  hostProjectFor: async () => ({ id: "project" }),
}));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: fixture.request }));
import { useProjectCrews } from "./crewClient";
function projectCrews(cwd: string) {
  let state!: ReturnType<typeof useProjectCrews>;
  function Fixture() {
    state = useProjectCrews(cwd);
    return null;
  }
  renderToStaticMarkup(createElement(Fixture));
  return state;
}

const SCOPE_DATA = {
  machine: { id: "local", environmentId: "env-1" },
  project: { id: "project" },
  runs: [{ id: "running-work" }],
  definitions: [],
  agents: [],
};
function resetCatalog() {
  fixture.data = undefined;
  fixture.catalogArgs = undefined;
  Object.assign(fixture.catalogRead, { catalog: undefined, error: "", stale: false });
  fixture.catalogRead.refresh.mockClear();
}

it("polls only crews.list and never requests the model catalog from the run query", async () => {
  resetCatalog();
  fixture.request.mockReset();
  fixture.request.mockImplementation(async () => ({
    definitions: [],
    runs: [{ id: "running-work", tasks: [] }],
    agents: [],
  }));
  projectCrews("C:/project");
  const data = await fixture.options.queryFn();
  expect(fixture.request.mock.calls.map((call) => call[1])).toEqual(["crews.list"]);
  expect(data.runs).toEqual([{ id: "running-work", tasks: [] }]);
  expect(data).not.toHaveProperty("catalog");
  // A catalog that is still pending no longer speeds up the run poll.
  expect(fixture.options.refetchInterval({ state: { data } })).toBe(15000);
  expect(
    fixture.options.refetchInterval({
      state: { data: { ...data, runs: [{ status: "active", tasks: [] }] } },
    }),
  ).toBe(5000);
  expect(
    fixture.options.refetchInterval({
      state: {
        data: { ...data, runs: [{ status: "paused", coordinatorStatus: "running", tasks: [] }] },
      },
    }),
  ).toBe(5000);
});

it("reads the catalog under its own Host, environment and project scope", async () => {
  resetCatalog();
  fixture.request.mockReset();
  fixture.request.mockResolvedValue({ models: {}, errors: {} });
  fixture.data = SCOPE_DATA;
  fixture.catalogRead.catalog = { models: { claude: [] }, errors: {}, pending: ["codex"] };
  const state = projectCrews("C:/project");
  expect(fixture.catalogArgs.scope).toEqual({
    machineId: "local",
    environmentId: "env-1",
    projectId: "project",
  });
  expect(fixture.catalogArgs.enabled).toBe(true);
  expect(fixture.catalogArgs.hostEnvironmentId).toBe("env-1");
  await fixture.catalogArgs.request("models.list", { projectId: "project", progressive: true });
  expect(fixture.request).toHaveBeenCalledWith(
    "local",
    "models.list",
    { projectId: "project", progressive: true },
    false,
    false,
    "env-1",
  );
  expect(state.data?.catalog.pending).toEqual(["codex"]);
  // Explicit retry refreshes the catalog read only, not the crew list.
  state.refreshCatalog();
  expect(fixture.catalogRead.refresh).toHaveBeenCalledTimes(1);
  resetCatalog();
});

it("does not read a catalog before the crew host is known", () => {
  resetCatalog();
  projectCrews("C:/project");
  expect(fixture.catalogArgs.enabled).toBe(false);
  expect(fixture.catalogArgs.scope).toEqual({ machineId: "", environmentId: "", projectId: "" });
});

it("keeps work controls available when only the model catalog fails", () => {
  resetCatalog();
  fixture.data = SCOPE_DATA;
  fixture.catalogRead.catalog = { models: { claude: [] }, errors: {} };
  fixture.catalogRead.error = "Error: Catalog offline";
  fixture.catalogRead.stale = true;
  const data = projectCrews("C:/project").data!;
  expect(data.runs).toEqual([{ id: "running-work" }]);
  // A remembered catalog that could not be refreshed is not offered for model choices.
  expect(data.catalog).toEqual({ models: {}, errors: {} });
  expect(data.catalogError).toBe("Catalog offline");
  resetCatalog();
});

it("refreshes partial Stop results after failure without sending Stop again", async () => {
  fixture.data = {
    machine: { id: "local" },
    project: { id: "project" },
    runs: [],
    definitions: [],
    agents: [],
    catalog: { models: {}, errors: {} },
  };
  fixture.invalidate.mockClear();
  fixture.request.mockClear();
  fixture.request.mockRejectedValueOnce(new Error("Some conversations could not be stopped"));
  const state = projectCrews("C:/project");
  await expect(state.call("crews.stop", { runId: "run" })).rejects.toThrow("could not be stopped");
  expect(fixture.request).toHaveBeenCalledTimes(1);
  expect(fixture.invalidate).toHaveBeenCalledWith({ queryKey: ["crews.v1", "C:/project"] });
  expect(fixture.invalidate).toHaveBeenCalledWith({
    queryKey: ["crews.v1", "managed", "C:/project"],
  });
  fixture.data = undefined;
});

it("keeps one crew data object across renders until the fetched result changes", async () => {
  // A new object on every render re-ran the sidebar's effects, whose connection report
  // re-rendered the sidebar again: React #185 on the Mac's remote project.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.data = { machine: { id: "m" }, project: { id: "p" }, runs: [{ id: "r" }] };
  const seen: unknown[] = [];
  let rerender!: () => void;
  function Fixture() {
    const [, setTick] = useState(0);
    rerender = () => setTick((tick) => tick + 1);
    seen.push(useProjectCrews("C:/project").data);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Fixture)));
  await act(async () => rerender());
  expect(seen.length).toBeGreaterThan(1);
  expect(new Set(seen).size).toBe(1);
  fixture.data = { ...fixture.data, runs: [{ id: "r2" }] };
  await act(async () => rerender());
  expect((seen.at(-1) as { runs: unknown[] }).runs).toEqual([{ id: "r2" }]);
  await act(async () => root.unmount());
  fixture.data = undefined;
});
