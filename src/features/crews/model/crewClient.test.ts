import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ options: undefined as any, request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    fixture.options = options;
    return {};
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineCapabilities: async () => [] }));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachines: async () => [],
  backgroundMachineFor: () => ({ id: "local" }),
  hostProjectFor: async () => ({ id: "project" }),
}));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: fixture.request }));
import { useProjectCrews } from "./crewClient";

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
});
