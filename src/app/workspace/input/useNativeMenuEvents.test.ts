// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceActions } from "./useWorkspaceActions";

const api = vi.hoisted(() => ({
  label: "first",
  handlers: [] as {
    name: string;
    target?: string;
    handler: (event: { payload: unknown }) => void;
    active: boolean;
  }[],
  saveAutosave: vi.fn((value: boolean) => value),
  gate: null as Promise<void> | null,
  lead: false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, handler, options) => {
    const entry = { name, handler, target: options?.target, active: true };
    api.handlers.push(entry);
    if (name === "new_tab" && api.gate) await api.gate;
    return () => {
      entry.active = false;
    };
  }),
  once: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: api.label }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    unminimize: async () => {},
    show: async () => {},
    setFocus: async () => {},
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false }));
vi.mock("../../../features/settings/model/settings", () => ({ saveAutosave: api.saveAutosave }));
vi.mock("../../../features/notifications/hooks/useBackgroundNotifications", () => ({
  isLeadWindow: async () => api.lead,
}));
vi.mock("../../model/updater", () => ({ runUpdateFlow: vi.fn() }));
import { useNativeMenuEvents } from "./useNativeMenuEvents";

let roots: Root[];
const calls = { first: vi.fn(), second: vi.fn() };
const openSession = vi.fn(async (_sessionId: string) => true);
function Probe({ name }: { name: "first" | "second" }) {
  const actions = {
    current: {
      onNew: calls[name],
      onOpenApprovalSession: openSession,
    } as unknown as WorkspaceActions,
  };
  useNativeMenuEvents({ actions, run: (_action, callback) => callback() });
  return null;
}
function emit(name: string, target?: string, payload?: unknown) {
  for (const item of api.handlers) {
    if (item.active && item.name === name && (!target || !item.target || item.target === target))
      item.handler({ payload });
  }
}
beforeEach(() => {
  api.handlers = [];
  api.gate = null;
  api.lead = false;
  openSession.mockClear();
  api.saveAutosave.mockClear();
  calls.first.mockClear();
  calls.second.mockClear();
  roots = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

it("ignores a queued menu event after unmount while registration is pending", async () => {
  let registered!: () => void;
  api.gate = new Promise<void>((resolve) => {
    registered = resolve;
  });
  api.label = "first";
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, { name: "first" })));
  await act(async () => root.unmount());
  roots = [];
  emit("new_tab", "first");
  expect(calls.first).not.toHaveBeenCalled();
  await act(async () => {
    registered();
    await Promise.resolve();
  });
  expect(api.handlers.find((entry) => entry.name === "new_tab")?.active).toBe(false);
});
afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount());
  });
  vi.unstubAllGlobals();
});

it("routes a targeted menu action to one window while retaining autosave broadcast", async () => {
  for (const name of ["first", "second"] as const) {
    api.label = name;
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    await act(async () => root.render(createElement(Probe, { name })));
  }
  emit("new_tab", "first");
  expect(calls.first).toHaveBeenCalledOnce();
  expect(calls.second).not.toHaveBeenCalled();
  emit("toggle_autosave", undefined, true);
  expect(api.saveAutosave).toHaveBeenCalledTimes(2);
  const notifications = api.handlers.filter((entry) => entry.name === "bycoda:notification-click");
  expect(notifications).toHaveLength(2);
  expect(notifications.map((entry) => entry.target)).toEqual(["first", "second"]);
  expect(
    api.handlers.filter((entry) => entry.name === "toggle_autosave").map((entry) => entry.target),
  ).toEqual(["first", "second"]);
});

async function mountClickWindow() {
  api.label = "first";
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, { name: "first" })));
}
const flush = () => act(async () => void (await Promise.resolve()));

it("opens a banner's session in the lead window even when no window holds it", async () => {
  api.lead = true;
  await mountClickWindow();
  emit("bycoda:notification-click", "first", "closed-session");
  await flush();
  expect(openSession).toHaveBeenCalledWith("closed-session");
});

it("leaves a banner for an unheld session to the lead window", async () => {
  await mountClickWindow();
  emit("bycoda:notification-click", "first", "closed-session");
  await flush();
  expect(openSession).not.toHaveBeenCalled();
});

it("opens the assistant for a banner that carries no session", async () => {
  api.lead = true;
  await mountClickWindow();
  const heard = vi.fn();
  window.addEventListener("bycoda:open-assistant", heard);
  emit("bycoda:notification-click", "first", "");
  await flush();
  window.removeEventListener("bycoda:open-assistant", heard);
  expect(openSession).not.toHaveBeenCalled();
  expect((heard.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual({ tab: "today" });
});
