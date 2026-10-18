// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useServerInventory, refreshServerInventory, type ServerRecord } from "./serverInventory";
import { invoke } from "@tauri-apps/api/core";
import { adoptRemoteMachineInventory } from "./connections";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./connections", () => ({ adoptRemoteMachineInventory: vi.fn() }));
const host = {
  id: "host-stable",
  name: "Host",
  environmentId: "real-env",
  endpoint: "https://host.invalid",
};
const records: ServerRecord[] = [
  {
    id: host.id,
    name: host.name,
    kind: "host",
    machine: host,
    metadata: { tags: [], favorite: false },
  },
  {
    id: "ssh-only",
    name: "SSH",
    kind: "ssh",
    sshEndpoint: { host: "ssh.invalid", port: 22 },
    metadata: { tags: [], favorite: false },
  },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("primes host health identity before exposing canonical rows and never adopts SSH-only records", async () => {
  vi.mocked(invoke).mockResolvedValue(records);
  function View() {
    const inventory = useServerInventory();
    if (inventory.loaded) {
      expect(adoptRemoteMachineInventory).toHaveBeenCalledWith([host]);
    }
    return createElement("p", null, inventory.servers.map((server) => server.id).join(","));
  }
  await act(async () => root.render(createElement(View)));
  expect(adoptRemoteMachineInventory).toHaveBeenCalledExactlyOnceWith([host]);
  expect(container.textContent).toBe("host-stable,ssh-only");
});
it("keeps the last canonical rows when refresh fails rather than reporting an empty inventory", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(records).mockRejectedValueOnce(new Error("read failed"));
  function View() {
    const inventory = useServerInventory();
    return createElement(
      "p",
      null,
      `${inventory.loaded}:${inventory.servers.length}:${inventory.error ?? ""}`,
    );
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => refreshServerInventory());
  expect(container.textContent).toContain("true:2:Error: read failed");
  expect(adoptRemoteMachineInventory).toHaveBeenCalledOnce();
});
