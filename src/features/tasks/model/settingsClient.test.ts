import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { HOST_SETTINGS } from "./hostSettings";
import { settingsMachine } from "./settingsClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../automations/public/hostMachines", () => ({ machineCapabilities: vi.fn() }));

const local = { id: "local", name: "This computer", endpoint: "http://127.0.0.1:7777" };
const offline = { id: "phone", name: "Phone", endpoint: "https://phone.example" };

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue([offline, local]);
  vi.mocked(machineCapabilities).mockReset();
});

it("asks only the requested machine, so an unreachable one never delays it", async () => {
  vi.mocked(machineCapabilities).mockResolvedValue([HOST_SETTINGS]);
  expect(await settingsMachine("local")).toEqual(local);
  expect(machineCapabilities).toHaveBeenCalledTimes(1);
  expect(machineCapabilities).toHaveBeenCalledWith(local);
});

it("returns nothing for an unknown machine or an older Host", async () => {
  expect(await settingsMachine("missing")).toBeUndefined();
  expect(machineCapabilities).not.toHaveBeenCalled();
  vi.mocked(machineCapabilities).mockResolvedValue(["automations.v1"]);
  expect(await settingsMachine("local")).toBeUndefined();
});
