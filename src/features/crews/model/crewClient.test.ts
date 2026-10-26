import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  options: undefined as any,
  data: undefined as any,
  request: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    fixture.options = options;
    return { data: fixture.data };
  },
  useQueryClient: () => ({ invalidateQueries: fixture.invalidate }),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineCapabilities: async () => [] }));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachines: async () => [],
  backgroundMachineFor: () => ({ id: "local" }),
  hostProjectFor: async () => ({ id: "project" }),
}));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: fixture.request }));
import { useProjectCrews } from "./crewClient";

it("keeps work controls available when only the model catalog fails", async () => {
  fixture.request.mockImplementation(async (_machine, method) => {
    if (method === "models.list") throw new Error("Catalog offline");
    return { definitions: [], runs: [{ id: "running-work" }], agents: [] };
  });
  useProjectCrews("C:/project");
  const data = await fixture.options.queryFn();
  expect(data.runs).toEqual([{ id: "running-work" }]);
  expect(data.catalog).toEqual({ models: {}, errors: {} });
  expect(data.catalogError).toBe("Catalog offline");
});

it("loads crew state with a progressive catalog and revisits pending providers", async () => {
  fixture.request.mockImplementation(async (_machine, method) =>
    method === "models.list"
      ? { models: {}, errors: {}, pending: ["claude"] }
      : { definitions: [], runs: [], agents: [] },
  );
  useProjectCrews("C:/project");
  const data = await fixture.options.queryFn();
  expect(fixture.request).toHaveBeenCalledWith("local", "models.list", {
    projectId: "project",
    progressive: true,
  });
  expect(data.runs).toEqual([]);
  expect(fixture.options.refetchInterval({ state: { data } })).toBe(1000);
  expect(
    fixture.options.refetchInterval({
      state: { data: { ...data, catalog: { models: {}, errors: {} } } },
    }),
  ).toBe(15000);
  expect(
    fixture.options.refetchInterval({
      state: {
        data: {
          ...data,
          catalog: { models: {}, errors: {} },
          runs: [{ status: "paused", coordinatorStatus: "running", tasks: [] }],
        },
      },
    }),
  ).toBe(5000);
});

it("refreshes partial Stop results after failure without sending Stop again", async () => {
  fixture.data = { machine: { id: "local" }, project: { id: "project" } };
  fixture.invalidate.mockClear();
  fixture.request.mockClear();
  fixture.request.mockRejectedValueOnce(new Error("Some conversations could not be stopped"));
  const state = useProjectCrews("C:/project");
  await expect(state.call("crews.stop", { runId: "run" })).rejects.toThrow("could not be stopped");
  expect(fixture.request).toHaveBeenCalledTimes(1);
  expect(fixture.invalidate).toHaveBeenCalledWith({ queryKey: ["crews.v1", "C:/project"] });
  fixture.data = undefined;
});
