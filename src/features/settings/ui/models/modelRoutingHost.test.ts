import { expect, it, vi } from "vitest";
import { machineCapabilities } from "../../../automations/public/hostMachines";
import { loadModelRoutingHost } from "./modelRoutingHost";
vi.mock("../../../automations/public/hostMachines", () => ({ machineCapabilities: vi.fn() }));
const machine = {
  id: "m",
  name: "Machine",
  endpoint: "https://remote.example",
  environmentId: "env",
};

it.each([true, false])("reads the capability of the chosen Host (%s)", async (supported) => {
  vi.mocked(machineCapabilities).mockResolvedValue(
    supported ? ["models.routing.v1"] : ["crews.modelPools"],
  );
  expect(await loadModelRoutingHost(machine)).toEqual({ machineId: "m", supported });
  expect(machineCapabilities).toHaveBeenLastCalledWith(machine);
});
it("keeps probe errors visible instead of reading them as unsupported", async () => {
  vi.mocked(machineCapabilities).mockRejectedValue(new Error("Host disconnected"));
  await expect(loadModelRoutingHost(machine)).rejects.toThrow("Host disconnected");
});
