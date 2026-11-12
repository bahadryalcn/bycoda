// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), helper: vi.fn() }));
vi.mock("./desktopControlClient", () => ({
  desktopControlRequest: mock.request,
  desktopHelperRequest: mock.helper,
}));
import { DesktopControlSettings } from "./DesktopControlSettings";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const config = {
  enabled: false,
  binaryPath: "",
  binarySha256: "",
  allowedApps: [],
  allowPhysicalInput: false,
  permissionMode: "ask",
  allowAllApps: false,
  version: 0,
};
const state = {
  configuration: config,
  status: {
    installed: false,
    verified: false,
    enabled: false,
    stopped: false,
    active: false,
    upstreamRef: "pinned",
    protocol: "2.5",
  },
};
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const helper = {
  binaryPath: "/verified/helper.exe",
  binarySha256: "a".repeat(64),
  sourceRef: "pinned",
  protocol: "2.5",
  version: "1.0.2",
  manifestPath: "/verified/manifest.json",
};
beforeEach(() => {
  mock.request.mockReset().mockResolvedValue(state);
  mock.helper.mockReset().mockResolvedValue({ phase: "missing" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => {
    root.render(createElement(DesktopControlSettings));
  });
}
const helperPrepares = () =>
  mock.helper.mock.calls.filter(([input]) => input.op === "prepare").length;
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label || node.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("lists approved apps outside full access and saves the mode with the version", async () => {
  await render();
  expect(container.textContent).not.toContain("Approved apps");
  expect(container.textContent).not.toContain("Full access asks nothing");
  await act(() => root.unmount());
  root = createRoot(container);
  mock.request.mockReset().mockResolvedValue({
    ...state,
    configuration: { ...config, permissionMode: "auto", allowedApps: ["Chrome"], version: 3 },
  });
  await render();
  expect(container.textContent).toContain("Approved apps");
  expect(container.textContent).toContain("Chrome");
  await act(() => root.unmount());
  root = createRoot(container);
  mock.request.mockReset().mockResolvedValue({
    ...state,
    configuration: { ...config, permissionMode: "full", allowedApps: ["Chrome"], version: 4 },
  });
  await render();
  expect(container.textContent).toContain("Full access asks nothing");
  expect(container.textContent).not.toContain("Approved apps");
  await click("Save computer controls");
  const saved = mock.request.mock.calls.filter(([input]) => input.op === "configure").at(-1)?.[0];
  expect(saved).toMatchObject({
    expectedVersion: 4,
    configuration: { permissionMode: "full", allowedApps: ["Chrome"] },
  });
  expect(saved.configuration).not.toHaveProperty("allowAllApps");
});
it("does not observe the desktop or enable an uninstalled helper on mount", async () => {
  await render();
  expect(mock.request).toHaveBeenCalledExactlyOnceWith({ op: "status" });
  expect(container.textContent).toContain("Not installed");
  expect(
    container.querySelector<HTMLButtonElement>('[role="switch"]')?.getAttribute("aria-checked"),
  ).toBe("false");
});
it("distinguishes a verified helper from the saved permission and an ongoing operation", async () => {
  mock.request.mockResolvedValueOnce({
    ...state,
    status: { ...state.status, installed: true, verified: true },
  });
  await render();
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).not.toContain("Running");
  mock.request.mockResolvedValueOnce({
    ...state,
    status: { ...state.status, installed: true, verified: true, enabled: true, active: true },
  });
  await click("Refresh");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).toContain("Running");
  expect(container.textContent).toContain("Stop computer use");
});
it("clears stale status after a failed refresh", async () => {
  mock.request.mockResolvedValueOnce({
    ...state,
    status: { ...state.status, installed: true, verified: true, enabled: true, active: true },
  });
  await render();
  expect(container.textContent).toContain("Running");
  mock.request.mockRejectedValueOnce(new Error("Status failed"));
  await click("Refresh");
  expect(container.textContent).not.toContain("Running");
  expect(container.textContent).not.toContain("Stop computer use");
  expect(container.textContent).toContain("Status failed");
});
it("reports unsaved options and pending saves to its parent", async () => {
  const report = vi.fn();
  await act(async () =>
    root.render(createElement(DesktopControlSettings, { onDraftStateChange: report })),
  );
  expect(report).toHaveBeenLastCalledWith({ dirty: false, pending: false });
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
  let resolve!: (value: unknown) => void;
  mock.request.mockImplementation((input) =>
    input.op === "configure"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ ...state, configuration: { ...config, enabled: true, version: 1 } }),
  );
  await click("Save computer controls");
  expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: true });
  await act(async () =>
    resolve({ ...state, configuration: { ...config, enabled: true, version: 1 } }),
  );
  expect(report).toHaveBeenLastCalledWith({ dirty: false, pending: false });
  expect(
    [...container.querySelectorAll("button")].some((node) => node.textContent === "Saved"),
  ).toBe(true);
  expect(container.textContent).not.toContain("Computer controls saved.");
});
it("does not hold the settings dialog open while the helper prepares on the Host", async () => {
  mock.helper.mockResolvedValue({ phase: "preparing", stage: "building" });
  const report = vi.fn();
  await act(async () =>
    root.render(createElement(DesktopControlSettings, { onDraftStateChange: report })),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(container.textContent).toContain("Preparing helper…");
  expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
});
it("keeps emergency Stop available while a settings save is pending", async () => {
  mock.request.mockResolvedValueOnce({
    ...state,
    status: { ...state.status, installed: true, verified: true },
  });
  await render();
  let resolve!: (value: unknown) => void;
  mock.request.mockImplementation((input) =>
    input.op === "configure"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve(state),
  );
  await click("Save computer controls");
  await click("Stop computer use");
  expect(mock.request.mock.calls.map(([input]) => input.op)).toContain("stop");
  expect(container.textContent).toContain("Stopped");
  await act(async () => resolve(state));
});
it("ignores an accepted save response arriving after Stop and retains the Stop version and unsaved owner options", async () => {
  const enabled = { ...config, enabled: true, version: 1 };
  mock.request.mockResolvedValueOnce({
    ...state,
    configuration: enabled,
    status: { ...state.status, installed: true, verified: true },
  });
  await render();
  await act(async () => {
    container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1].click();
  });
  let resolve!: (value: unknown) => void;
  mock.request.mockImplementation((input) =>
    input.op === "configure"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ ...state, configuration: { ...config, version: 2 } }),
  );
  await click("Save computer controls");
  await click("Stop computer use");
  await act(async () => resolve({ ...state, configuration: enabled }));
  const switches = container.querySelectorAll('[role="switch"]');
  expect(switches[0].getAttribute("aria-checked")).toBe("false");
  expect(switches[1].getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Stopped");
  mock.request.mockResolvedValue({ ...state, configuration: { ...config, version: 3 } });
  await click("Save computer controls");
  expect(
    mock.request.mock.calls.filter(([input]) => input.op === "configure").at(-1)?.[0],
  ).toMatchObject({
    expectedVersion: 2,
    configuration: { enabled: false, allowPhysicalInput: true },
  });
});
it("does not let a save's older fallback status erase the newer Stop receipt", async () => {
  mock.request.mockResolvedValueOnce({
    ...state,
    status: { ...state.status, installed: true, verified: true },
  });
  await render();
  let resolve!: (value: unknown) => void;
  mock.request.mockImplementation((input) =>
    input.op === "configure"
      ? Promise.resolve({ ...state, configuration: { ...config, enabled: true, version: 1 } })
      : input.op === "stop"
        ? Promise.resolve({ ...state, configuration: { ...config, version: 2 } })
        : new Promise((done) => {
            resolve = done;
          }),
  );
  await click("Save computer controls");
  await click("Stop computer use");
  await act(async () =>
    resolve({
      ...state,
      status: { ...state.status, installed: true, verified: true, enabled: true, active: true },
    }),
  );
  expect(container.textContent).toContain("Stopped");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});
it("refreshes status without overwriting an unsaved enable choice or adopting another writer's configuration version", async () => {
  await render();
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
  });
  mock.request.mockResolvedValue({ ...state, configuration: { ...config, version: 9 } });
  await click("Refresh");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  await click("Save computer controls");
  expect(
    mock.request.mock.calls.filter(([input]) => input.op === "configure").at(-1)?.[0],
  ).toMatchObject({ expectedVersion: 0, configuration: { enabled: true } });
});
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
it("prepares a missing helper once when computer use is switched on, and never enables control", async () => {
  await render();
  expect(helperPrepares()).toBe(0);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await flush();
  expect(helperPrepares()).toBe(1);
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(mock.request.mock.calls.map(([input]) => input.op)).not.toContain("configure");
  expect(container.textContent).toContain("Helper not ready");
  await flush();
  expect(helperPrepares()).toBe(1);
});
it("applies an already prepared verified helper without preparing again", async () => {
  mock.request.mockResolvedValue({
    ...state,
    configuration: { ...config, enabled: true, version: 1 },
  });
  mock.helper.mockResolvedValue({ phase: "ready", helper });
  await render();
  await flush();
  expect(helperPrepares()).toBe(0);
  expect(mock.request.mock.calls.map(([input]) => input.op)).not.toContain("configure");
  expect(container.textContent).toContain("Ready");
});
it("registers the shell save and hides the local Save when a saveRef is supplied", async () => {
  const saveRef: { current: (() => Promise<void>) | null } = { current: null };
  await act(async () => root.render(createElement(DesktopControlSettings, { saveRef })));
  expect(typeof saveRef.current).toBe("function");
  expect(container.textContent).not.toContain("Save computer controls");
  expect(container.textContent).not.toContain("save separately");
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1].click(),
  );
  await act(() => saveRef.current!());
  // The save is followed by a status refresh, so the configure request is not the last call.
  expect(mock.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "configure",
      expectedVersion: 0,
      configuration: expect.objectContaining({ allowPhysicalInput: true, enabled: false }),
    }),
  );
});
it("makes the shell save throw on refusal and keeps the owner's unsaved choice", async () => {
  const saveRef: { current: (() => Promise<void>) | null } = { current: null };
  await act(async () => root.render(createElement(DesktopControlSettings, { saveRef })));
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1].click(),
  );
  mock.request.mockRejectedValueOnce(new Error("Desktop settings changed; reload before saving."));
  let failure: unknown;
  await act(async () => {
    try {
      await saveRef.current!();
    } catch (cause) {
      failure = cause;
    }
  });
  expect(String(failure)).toContain("Desktop settings changed");
  expect(container.querySelectorAll('[role="switch"]')[1].getAttribute("aria-checked")).toBe(
    "true",
  );
});
