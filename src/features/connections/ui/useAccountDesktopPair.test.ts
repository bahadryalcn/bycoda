// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { accountDeviceInfo, requestDesktopPair } from "../../account";
import { useAccountDesktopPair } from "./useAccountDesktopPair";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../account", () => ({
  accountApi: () => ({}),
  accountDeviceInfo: vi.fn(),
  isSignedIn: () => true,
  reportAccountFailure: vi.fn(async () => {}),
  requestDesktopPair: vi.fn(),
  useAccountState: () => ({ deviceId: "me" }),
}));

const plan = {
  deviceId: "target",
  environmentId: "env",
  name: "PC",
  routes: ["https://pc.example"],
};
function Probe() {
  useAccountDesktopPair(plan);
  return null;
}

it("closing during device setup never starts pairing", async () => {
  let release!: (value: Awaited<ReturnType<typeof accountDeviceInfo>>) => void;
  vi.mocked(accountDeviceInfo).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => root.unmount());
  release({
    name: "Laptop",
    platform: "windows",
    osVersion: "test",
    appVersion: "test",
    channel: "stable",
  });
  await act(async () => {});
  expect(requestDesktopPair).not.toHaveBeenCalled();
});

it("closing while request setup waits aborts the full flow before redeem", async () => {
  vi.mocked(accountDeviceInfo).mockResolvedValue({
    name: "Laptop",
    platform: "windows",
    osVersion: "test",
    appVersion: "test",
    channel: "stable",
  });
  let release!: (value: Awaited<ReturnType<typeof requestDesktopPair>>) => void;
  vi.mocked(requestDesktopPair).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  const signal = vi.mocked(requestDesktopPair).mock.calls.at(-1)![1].signal!;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  const cancel = vi.fn();
  release({
    code: "123456",
    expiresAt: "",
    cancel,
    outcome: Promise.resolve({ state: "sealed", ticketJson: "{}" }),
  });
  await act(async () => {});
  expect(cancel).toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
