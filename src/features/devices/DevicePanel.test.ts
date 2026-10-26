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
  // Command surfaces use the shared Popover portal outside the panel container.
  [...document.body.querySelectorAll("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === text,
  )!;
const devicePicker = () =>
  container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const clickButton = async (name: string) => act(async () => button(name).click());
const openOptions = async () => {
  if (!document.querySelector('[role="dialog"][aria-label="Device options"]'))
    await clickButton("Device options");
};
const openSetup = async () => {
  await openOptions();
  await clickButton("Setup and access");
  const summary = document.querySelector<HTMLElement>(".device-panel-setup > summary")!;
  await act(async () => summary.click());
};
const appInput = () =>
  (
    [...document.querySelectorAll("label")].find(
      (label) => label.textContent === "App name or bundle ID",
    )! as HTMLLabelElement
  ).control as HTMLInputElement;
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
  expect(document.querySelector(".device-panel-setup")).toBeNull();
  expect(button("Device options").getAttribute("aria-expanded")).toBe("false");
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
  act(() => captureButton.focus());
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

it("clears a capture error after live view successfully resumes", async () => {
  const api = makeApi();
  vi.mocked(api.capture).mockRejectedValueOnce(new Error("Host unavailable"));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  const live = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Live view"]',
  )!;
  expect(live.getAttribute("aria-checked")).toBe("false");
  await act(async () => live.click());
  expect(api.capture).toHaveBeenCalledTimes(2);
  expect(container.querySelector("img")?.src).toContain("frame");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(live.getAttribute("aria-checked")).toBe("true");
});

it("does not clear a failed device action when live capture succeeds", async () => {
  vi.useFakeTimers();
  const api = makeApi();
  vi.mocked(api.action).mockRejectedValueOnce(new Error("Home action failed"));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[role="switch"][aria-label="Allow device control"]')!
      .click(),
  );
  await act(async () => button("Home").click());
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.capture).toHaveBeenCalledTimes(2);
  expect(api.action).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Home action failed");
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
  await openOptions();
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
  await openSetup();
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
  await openOptions();
  await clickButton("Device action result");
  expect(document.querySelector(".device-panel-output")?.textContent).toBe("Action result");
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
  await openSetup();
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
  await openOptions();
  await act(async () => button("Help").click());
  expect(document.body.textContent).toContain("open the target app before interacting");
  await act(async () => button("Help").click());
  await clickButton("Choose app to open");
  expect(button("Open app").disabled).toBe(true);
  expect(api.action).not.toHaveBeenCalled();
  vi.mocked(api.capture).mockClear();
  const input = appInput();
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
  const target = appInput;
  const enterApp = () =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        target(),
        "My App",
      );
      target().dispatchEvent(new Event("input", { bubbles: true }));
    });
  await selectDevice(device.id);
  await clickButton("Choose app to open");
  await enterApp();
  await selectDevice("second");
  expect(
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("false");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await clickButton("Choose app to open");
  expect(target().value).toBe("");
  expect(button("Open app").disabled).toBe(true);
  await enterApp();
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi() })));
  await selectDevice(device.id);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await clickButton("Choose app to open");
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
  await openOptions();
  await act(async () => button("Help").click());
  expect(document.body.textContent).toContain("For Android, enter Settings or an app package ID");
  expect(document.body.textContent).toContain(
    "Android text input supports printable ASCII characters.",
  );
  await clickButton("Choose app to open");
  expect(button("Open app").disabled).toBe(true);
  expect(api.action).not.toHaveBeenCalled();
  for (const [hostPlatform, devicePlatform] of [
    ["darwin", "android"],
    ["win32", "ios"],
  ] as const) {
    await renderDevice(hostPlatform, devicePlatform);
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await openOptions();
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

it("freezes the source frame while marking and never turns annotation gestures into device input", async () => {
  vi.useFakeTimers();
  const api = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await clickButton("Allow device control");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("true");
  const originalFrame = container.querySelector("img")!.getAttribute("src");
  let finishCapture!: (frame: DeviceFrame) => void;
  vi.mocked(api.capture).mockReturnValueOnce(
    new Promise((resolve) => {
      finishCapture = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.capture).toHaveBeenCalledTimes(2);
  await clickButton("Mark device screen");
  await act(async () =>
    finishCapture({ mime: "image/png", base64: "later-live-frame", capturedAt: "later" }),
  );
  expect(container.textContent).toContain("Marking · Frozen frame");
  expect(button("Home").disabled).toBe(true);
  expect(button("Capture").disabled).toBe(true);
  expect(button("Device text input").disabled).toBe(true);
  await clickButton("Add numbered pin");
  const canvas = container.querySelector<SVGSVGElement>(".image-annotation-canvas-layer")!;
  await act(async () =>
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(container.querySelector(".image-annotation-canvas-pin text")?.textContent).toBe("1");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(api.capture).toHaveBeenCalledTimes(2);
  expect(container.querySelector("img")!.getAttribute("src")).toBe(originalFrame);
  expect(api.action).not.toHaveBeenCalled();
  await clickButton("Undo annotation");
  expect(container.querySelector(".image-annotation-canvas-pin")).toBeNull();
  await clickButton("Redo annotation");
  expect(container.querySelector(".image-annotation-canvas-pin text")?.textContent).toBe("1");
  await clickButton("Finish marking");
  expect(container.querySelector(".image-annotation-canvas-layer")).toBeNull();
  expect(button("Live view").getAttribute("aria-checked")).toBe("false");
  expect(api.action).not.toHaveBeenCalled();
});

it("retains each device's frozen annotation and note when switching away and returning", async () => {
  const api = makeApi();
  vi.mocked(api.list).mockResolvedValue({
    devices: [device, { ...device, id: "second", name: "Second device" }],
    errors: [],
  });
  let frameNumber = 0;
  vi.mocked(api.capture).mockImplementation(async (id) => ({
    mime: "image/png",
    base64: `${id}-frame-${++frameNumber}`,
    capturedAt: `frame-${frameNumber}`,
  }));
  await act(async () => root.render(createElement(DevicePanel, { api })));
  const selectDevice = async (index: number) => {
    await act(async () => devicePicker().click());
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    await act(async () => options[index].click());
  };
  const annotationNote = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
  const enterNote = async (text: string) =>
    act(async () => {
      const input = annotationNote();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        text,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await clickButton("Mark device screen");
  const firstFrame = container.querySelector("img")!.getAttribute("src");
  await clickButton("Add numbered pin");
  await act(async () =>
    container
      .querySelector<SVGSVGElement>(".image-annotation-canvas-layer")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await clickButton("Annotation note");
  await enterNote("Keep this first-device note");
  await selectDevice(1);
  await clickButton("Mark device screen");
  expect(container.querySelector(".image-annotation-canvas-pin")).toBeNull();
  await clickButton("Annotation note");
  expect(annotationNote().value).toBe("");
  await enterNote("Second-device note");
  await selectDevice(0);
  await clickButton("Mark device screen");
  expect(container.querySelector("img")!.getAttribute("src")).toBe(firstFrame);
  expect(container.querySelector(".image-annotation-canvas-pin text")?.textContent).toBe("1");
  await clickButton("Annotation note");
  expect(annotationNote().value).toBe("Keep this first-device note");
  expect(api.action).not.toHaveBeenCalled();
});

it("requires control permission for Android screen gestures and maps tap and swipe to source pixels", async () => {
  const api = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api })));
  const image = container.querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 400 },
    naturalHeight: { configurable: true, value: 800 },
    setPointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 420,
    width: 200,
    height: 400,
    toJSON: () => ({}),
  });
  const pointer = async (type: string, x: number, y: number) =>
    act(async () =>
      image.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }),
      ),
    );
  await pointer("pointerdown", 60, 120);
  await pointer("pointerup", 60, 120);
  expect(api.action).not.toHaveBeenCalled();
  await clickButton("Allow device control");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("true");
  await pointer("pointerdown", 60, 120);
  await pointer("pointerup", 60, 120);
  expect(api.action).toHaveBeenLastCalledWith(device.id, { type: "press", x: 100, y: 200 });
  await pointer("pointerdown", 60, 120);
  await pointer("pointerup", 160, 320);
  expect(api.action).toHaveBeenLastCalledWith(device.id, {
    type: "swipe",
    x: 100,
    y: 200,
    endX: 300,
    endY: 600,
  });
  await pointer("pointerdown", 60, 120);
  await pointer("pointercancel", 60, 120);
  await pointer("pointerup", 160, 320);
  expect(api.action).toHaveBeenCalledTimes(2);
  await clickButton("Allow device control");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("false");
});

it("returns from annotation to pointer control without revoking the already enabled permission", async () => {
  const api = makeApi();
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await clickButton("Allow device control");
  await clickButton("Mark device screen");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("true");
  expect(button("Home").disabled).toBe(true);
  await clickButton("Allow device control");
  expect(container.querySelector(".image-annotation-canvas-layer")).toBeNull();
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("true");
  expect(button("Home").disabled).toBe(false);
  await clickButton("Home");
  expect(api.action).toHaveBeenCalledWith(device.id, { type: "home" });
  await clickButton("Allow device control");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("false");
  expect(button("Home").disabled).toBe(true);
});

it("restores a scoped annotation after remount without sharing its image, note or control permission with another scope", async () => {
  const draftScope = `annotation-remount-${crypto.randomUUID()}`;
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(), draftScope })));
  await clickButton("Allow device control");
  await clickButton("Mark device screen");
  const frozenFrame = container.querySelector("img")!.getAttribute("src");
  await clickButton("Add numbered pin");
  await act(async () =>
    container
      .querySelector<SVGSVGElement>(".image-annotation-canvas-layer")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await clickButton("Annotation note");
  await act(async () => {
    const note = document.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      note,
      "Keep through tool switches",
    );
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.render(null));
  const restored = makeApi();
  vi.mocked(restored.capture).mockResolvedValue({
    mime: "image/png",
    base64: "fresh-after-remount",
    capturedAt: "later",
  });
  await act(async () => root.render(createElement(DevicePanel, { api: restored, draftScope })));
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector("img")!.getAttribute("src")).toContain("fresh-after-remount");
  await clickButton("Mark device screen");
  expect(container.querySelector("img")!.getAttribute("src")).toBe(frozenFrame);
  expect(container.querySelector(".image-annotation-canvas-pin text")?.textContent).toBe("1");
  expect(button("Undo annotation").disabled).toBe(false);
  await clickButton("Annotation note");
  expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "Keep through tool switches",
  );
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      createElement(DevicePanel, { api: makeApi(), draftScope: `${draftScope}-other-machine` }),
    ),
  );
  await clickButton("Mark device screen");
  expect(container.querySelector(".image-annotation-canvas-pin")).toBeNull();
  expect(button("Undo annotation").disabled).toBe(true);
  await clickButton("Annotation note");
  expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
  expect(button("Allow device control").getAttribute("aria-checked")).toBe("false");
  expect(restored.action).not.toHaveBeenCalled();
});

it("holds the unavailable-host control gate through a local draft action until a fresh capture succeeds", async () => {
  const api = makeApi();
  const onAddDevice = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(createElement(DevicePanel, { api, onAddDevice })));
  await clickButton("Allow device control");
  expect(button("Home").disabled).toBe(false);
  vi.mocked(api.capture).mockRejectedValueOnce(
    new Error("RPC_HOST_UNAVAILABLE: host connection closed"),
  );
  await clickButton("Capture");
  expect(button("Home").disabled).toBe(true);
  expect(button("Device text input").disabled).toBe(true);
  await openOptions();
  await clickButton("Add device to conversation");
  expect(onAddDevice).toHaveBeenCalledOnce();
  expect(api.capture).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Device added to draft.");
  expect(button("Home").disabled).toBe(true);
  expect(button("Device text input").disabled).toBe(true);
  let finishCapture!: (frame: DeviceFrame) => void;
  vi.mocked(api.capture).mockReturnValueOnce(
    new Promise((resolve) => {
      finishCapture = resolve;
    }),
  );
  await clickButton("Capture");
  expect(button("Home").disabled).toBe(true);
  await act(async () =>
    finishCapture({
      mime: "image/png",
      base64: "verified-reconnected-frame",
      capturedAt: "reconnected",
    }),
  );
  expect(container.querySelector("img")!.getAttribute("src")).toContain(
    "verified-reconnected-frame",
  );
  expect(button("Home").disabled).toBe(false);
  expect(button("Device text input").disabled).toBe(false);
  expect(api.action).not.toHaveBeenCalled();
});
