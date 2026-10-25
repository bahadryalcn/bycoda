// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePanel } from "./DevicePanel";
import type { DeviceFrame, DeviceHostStatus, DevicePanelApi } from "./types";

const status: DeviceHostStatus = {
  running: true,
  installed: true,
  agentInstalled: true,
  platform: "win32",
  platforms: [{ platform: "android", available: true }],
};
const device = {
  id: "emulator",
  name: "Android emulator",
  platform: "android" as const,
  version: "16",
  booted: true,
  physical: false,
};
const makeApi = (): DevicePanelApi => ({
  status: vi.fn().mockResolvedValue(status),
  setup: vi.fn().mockResolvedValue(status),
  start: vi.fn().mockResolvedValue(status),
  stop: vi.fn().mockResolvedValue({ ...status, running: false }),
  list: vi.fn().mockResolvedValue({ devices: [device], errors: [] }),
  boot: vi.fn().mockResolvedValue(device),
  capture: vi.fn().mockResolvedValue({ mime: "image/png", base64: "frame", capturedAt: "now" }),
  action: vi.fn().mockResolvedValue("Done"),
});
let root: Root;
let container: HTMLDivElement;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === text,
  )!;
const devicePicker = () =>
  container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("requires a booted device for capture and prevents booting a physical device", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValue({
    devices: [{ ...device, booted: false, physical: true }],
    errors: [],
  });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(button("Capture").disabled).toBe(true);
  expect(button("Boot").disabled).toBe(true);
  expect(container.textContent).toContain("Boot the selected device");
  expect(api.capture).not.toHaveBeenCalled();
});

it("connects an installed runtime and follows a connected phone without controlling it", async () => {
  const api = makeApi();
  vi.mocked(api.status).mockResolvedValue({ ...status, running: false });
  vi.mocked(api.list).mockResolvedValue({
    devices: [device, { ...device, id: "phone", name: "Galaxy S24", physical: true }],
    errors: [],
  });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(api.start).toHaveBeenCalledOnce();
  expect(api.list).toHaveBeenCalledOnce();
  expect(devicePicker().textContent).toContain("Galaxy S24");
  expect(api.setup).not.toHaveBeenCalled();
  expect(api.capture).toHaveBeenCalledWith("phone");
  expect(api.action).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLButtonElement>('[role="switch"]')?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(container.querySelector(".device-panel-setup")?.hasAttribute("open")).toBe(false);
});

it("requires explicit setup when the runtime is not installed", async () => {
  const api = makeApi();
  vi.mocked(api.status).mockResolvedValue({ ...status, running: false, installed: false });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(api.start).not.toHaveBeenCalled();
  expect(api.setup).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  await act(async () => button("Set up and connect").click());
  expect(api.setup).toHaveBeenCalledWith(false);
  expect(api.start).toHaveBeenCalledOnce();
  expect(devicePicker().textContent).toContain(device.name);
});

it("keeps discovery retry available when the running host finds no devices", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValueOnce({ devices: [], errors: [] });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(button("Refresh devices").disabled).toBe(false);
  await act(async () => button("Refresh devices").click());
  expect(devicePicker().textContent).toContain(device.name);
});

it("shows capture progress in its button and identifies capture failure without discovery advice", async () => {
  const api = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api })));
  let reject!: (error: Error) => void;
  vi.mocked(api.capture).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const captureButton = button("Capture");
  captureButton.focus();
  await act(async () => {
    captureButton.click();
    captureButton.click();
  });
  expect(api.capture).toHaveBeenCalledTimes(2); // initial live frame plus one explicit capture
  expect(captureButton.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(captureButton);
  expect(button("Refresh devices").hasAttribute("aria-busy")).toBe(false);
  await act(async () => reject(new Error("Device screenshot exceeds 4 MiB")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Device screenshot exceeds 4 MiB",
  );
  expect(container.textContent).not.toContain("Could not load devices");
  expect(container.textContent).not.toContain("Reconnect the device");
  expect(captureButton.hasAttribute("aria-busy")).toBe(false);
  await act(async () => captureButton.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("adds the selected device to a draft only on request and blocks duplicate attachment", async () => {
  const api = makeApi();
  let finish!: () => void;
  const onAddDevice = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api, onAddDevice })));
  expect(onAddDevice).not.toHaveBeenCalled();
  await act(async () => {
    button("Add device to conversation").click();
    button("Add device to conversation").click();
  });
  expect(onAddDevice).toHaveBeenCalledOnce();
  expect(onAddDevice).toHaveBeenCalledWith(device);
  expect(button("Add device to conversation").getAttribute("aria-busy")).toBe("true");
  expect(button("Add device to conversation").getAttribute("aria-disabled")).toBe("true");
  expect(button("Add device to conversation").disabled).toBe(false);
  await act(async () => finish());
  expect(container.textContent).toContain("Device added to draft.");
  expect(api.capture).toHaveBeenCalledWith(device.id);
  expect(api.action).not.toHaveBeenCalled();
});

it("replaces a disconnected selection and clears a stale discovery error on refresh", async () => {
  const api = makeApi();
  vi.mocked(api.list)
    .mockResolvedValueOnce({ devices: [device], errors: ["temporary discovery warning"] })
    .mockResolvedValueOnce({
      devices: [{ ...device, id: "new-phone", name: "Connected phone", physical: true }],
      errors: [],
    });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "temporary discovery warning",
  );
  await act(async () => button("Refresh devices").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(devicePicker().textContent).toContain("Connected phone");
  expect(api.capture).toHaveBeenLastCalledWith("new-phone");
});

it("waits for a live capture before stopping and never installs its late frame", async () => {
  vi.useFakeTimers();
  const api = makeApi();
  let finish!: (value: DeviceFrame) => void;
  vi.mocked(api.capture).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(api.capture).toHaveBeenCalledTimes(1);
  await act(async () => button("Stop device host").click());
  expect(api.stop).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(3000));
  expect(api.capture).toHaveBeenCalledTimes(1);
  await act(async () => finish({ mime: "image/png", base64: "old-frame", capturedAt: "now" }));
  expect(api.stop).toHaveBeenCalledTimes(1);
  expect(container.querySelector("img")).toBeNull();
});

it("retains successful action output when the follow-up screenshot fails", async () => {
  const api = makeApi();
  vi.mocked(api.action).mockResolvedValue("Action result");
  vi.mocked(api.capture).mockRejectedValue(new Error("Screenshot unavailable"));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => button("Home").click());
  expect(container.querySelector(".device-panel-output")?.textContent).toBe("Action result");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Action completed");
  expect(api.action).toHaveBeenCalledOnce();
});

it("does not request an old host's screenshot after an action finishes in a different scope", async () => {
  const api = makeApi();
  let finish!: (value: string) => void;
  vi.mocked(api.action).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => button("Home").click());
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi() })));
  await act(async () => finish("Old host result"));
  expect(api.capture).toHaveBeenCalledTimes(1);
  expect(container.querySelector("pre")).toBeNull();
});

it("loads devices from an already-running host and offers status retry", async () => {
  const api = makeApi();
  let finish!: (value: DeviceHostStatus) => void;
  vi.mocked(api.status)
    .mockRejectedValueOnce(new Error("Host unavailable"))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  const retry = button("Retry");
  retry.focus();
  await act(async () => retry.click());
  expect(button("Retry")).toBe(retry);
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(retry);
  await act(async () => retry.click());
  expect(api.status).toHaveBeenCalledTimes(2);
  await act(async () => finish(status));
  expect(api.list).toHaveBeenCalledOnce();
  expect(devicePicker().textContent).toContain("Android emulator");
});

it("ignores capture completion from a previous host and blocks device switching during capture", async () => {
  const api = makeApi();
  let resolve!: (frame: DeviceFrame) => void;
  vi.mocked(api.capture).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api })));
  act(() => button("Capture").click());
  expect(devicePicker().disabled).toBe(true);
  const next = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api: next })));
  await act(async () =>
    resolve({ mime: "image/png", base64: "previous-host-frame", capturedAt: "now" }),
  );
  expect(container.querySelector("img")?.src).toContain("frame");
  expect(devicePicker().getAttribute("aria-label")).toContain(device.name);
  expect(devicePicker().disabled).toBe(false);
});

it("does not let an old host's stalled capture block the new host", async () => {
  const api = makeApi();
  vi.mocked(api.capture).mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () => button("Capture").click());
  const next = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api: next })));
  await act(async () => button("Capture").click());
  expect(next.capture).toHaveBeenCalledWith(device.id);
  expect(container.querySelector("img")?.src).toContain("frame");
});

it("refreshes support and setup state without restarting the device host", async () => {
  const api = makeApi();
  vi.mocked(api.status).mockResolvedValueOnce({ ...status, agentInstalled: false });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(container.textContent).toContain("Run setup with control enabled");
  await act(async () => button("Status").click());
  expect(container.textContent).not.toContain("Run setup with control enabled");
  expect(api.status).toHaveBeenCalledTimes(2);
  expect(api.start).not.toHaveBeenCalled();
});

it("opens only an explicitly chosen iOS app and captures its screen after the action", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValue({ devices: [{ ...device, platform: "ios" }], errors: [] });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(button("Open app")).toBeUndefined();
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(button("Open app").disabled).toBe(true);
  await act(async () => button("Help").click());
  expect(document.body.textContent).toContain("open the target app before interacting");
  await act(async () => button("Help").click());
  expect(api.action).not.toHaveBeenCalled();
  vi.mocked(api.capture).mockClear();
  const input = (
    [...container.querySelectorAll("label")].find(
      (label) => label.textContent === "App name or bundle ID",
    )! as HTMLLabelElement
  ).control as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "  com.example.target  ",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Open app").click());
  expect(api.action).toHaveBeenCalledWith(device.id, {
    type: "openApp",
    app: "com.example.target",
  });
  expect(api.capture).toHaveBeenCalledWith(device.id);
  expect(vi.mocked(api.action).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(api.capture).mock.invocationCallOrder[0],
  );
  expect(container.querySelector("img")?.src).toContain("frame");
  await act(async () => button("Home").click());
  expect(input.value).toBe("com.apple.springboard");
  expect(api.action).toHaveBeenLastCalledWith(device.id, { type: "home" });
});

it("clears the app target when selecting another device or changing the host", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValue({
    devices: [device, { ...device, id: "second" }],
    errors: [],
  });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  const selectDevice = async (id: string) => {
    await act(async () => devicePicker().click());
    const options = document.body.querySelectorAll<HTMLButtonElement>('[role="option"]');
    await act(async () => options[id === "second" ? 1 : 0].click());
  };
  const target = () =>
    (
      [...container.querySelectorAll("label")].find(
        (label) => label.textContent === "App name or bundle ID",
      )! as HTMLLabelElement
    ).control as HTMLInputElement;
  const enterApp = () =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        target(),
        "My App",
      );
      target().dispatchEvent(new Event("input", { bubbles: true }));
    });
  await selectDevice(device.id);
  await enterApp();
  await selectDevice("second");
  expect(
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("false");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(target().value).toBe("");
  expect(button("Open app").disabled).toBe(true);
  await enterApp();
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi() })));
  await selectDevice(device.id);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(target().value).toBe("");
  expect(api.action).not.toHaveBeenCalled();
});

it("keeps platform-specific control help available without filling the device panel", async () => {
  const renderDevice = async (hostPlatform: string, devicePlatform: "android" | "ios") => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...status, platform: hostPlatform });
    vi.mocked(api.list).mockResolvedValue({
      devices: [{ ...device, platform: devicePlatform }],
      errors: [],
    });
    await act(async () => root.render(createElement(DevicePanel, { api })));
    return api;
  };
  const api = await renderDevice("win32", "android");
  expect(container.textContent).not.toContain("Android text input supports");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(container.textContent).not.toContain("Android text input supports");
  await act(async () => button("Help").click());
  expect(document.body.textContent).toContain("For Android, enter Settings or an app package ID");
  expect(document.body.textContent).toContain(
    "Android text input supports printable ASCII characters.",
  );
  expect(button("Open app").disabled).toBe(true);
  expect(api.action).not.toHaveBeenCalled();
  for (const [hostPlatform, devicePlatform] of [
    ["darwin", "android"],
    ["win32", "ios"],
  ] as const) {
    await renderDevice(hostPlatform, devicePlatform);
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(container.textContent).not.toContain("For Android, enter Settings");
    expect(container.textContent).not.toContain("Android text input supports");
  }
});

it("retires the old device capture error after selecting a healthy device", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValue({
    devices: [device, { ...device, id: "healthy", name: "Healthy phone" }],
    errors: [],
  });
  vi.mocked(api.capture).mockImplementation(async (id) => {
    if (id === device.id) throw new Error("Old device capture failed");
    return { mime: "image/png", base64: "healthy", capturedAt: "now" };
  });
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(container.textContent).toContain("Old device capture failed");
  await act(async () => devicePicker().click());
  const options = document.body.querySelectorAll<HTMLButtonElement>('[role="option"]');
  await act(async () => options[1].click());
  expect(api.capture).toHaveBeenCalledWith("healthy");
  expect(container.textContent).not.toContain("Old device capture failed");
});

it("preserves a new discovery warning when refresh replaces a device with an old capture error", async () => {
  const api = makeApi();
  vi.mocked(api.capture).mockRejectedValue(new Error("Old capture failed"));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  vi.mocked(api.list).mockResolvedValue({
    devices: [{ ...device, id: "replacement", booted: false }],
    errors: ["Discovery incomplete"],
  });
  await act(async () => button("Refresh devices").click());
  expect(container.textContent).toContain("Discovery incomplete");
  expect(container.textContent).not.toContain("Old capture failed");
});
