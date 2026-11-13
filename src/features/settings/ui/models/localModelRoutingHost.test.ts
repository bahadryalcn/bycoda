import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { machineCapabilities } from "../../../automations/model/machineSnapshot";
import { loadLocalModelRoutingHost } from "./localModelRoutingHost";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../automations/model/machineSnapshot", () => ({ machineCapabilities: vi.fn() }));
const local = {
  id: "local",
  localHost: true,
  name: "This computer",
  endpoint: "http://127.0.0.1:7777",
};

it.each([true, false])(
  "uses only the local Host and its advertised capability (%s)",
  async (supported) => {
    vi.mocked(invoke).mockResolvedValue([
      { ...local, id: "remote", endpoint: "https://remote.example" },
      local,
    ]);
    vi.mocked(machineCapabilities).mockResolvedValue(
      supported ? ["models.routing.v1"] : ["crews.modelPools"],
    );
    expect(await loadLocalModelRoutingHost()).toEqual({ machineId: "local", supported });
    expect(machineCapabilities).toHaveBeenLastCalledWith(local);
  },
);
it("does not infer support or fall back to a remote Host", async () => {
  vi.mocked(invoke).mockResolvedValue([{ ...local, endpoint: "https://remote.example" }]);
  expect(await loadLocalModelRoutingHost()).toEqual({ machineId: undefined, supported: false });
});
it("keeps discovery errors visible to the Settings query", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Host disconnected"));
  await expect(loadLocalModelRoutingHost()).rejects.toThrow("Host disconnected");
});
