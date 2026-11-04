// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  label: "main",
  listen: vi.fn(),
  emit: vi.fn(),
  probe: vi.fn(),
  receivers: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: mocks.probe,
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));
vi.mock("../../settings/model/settings", () => ({
  loadQuickComposerEnabled: () => false,
  subscribeQuickComposerEnabled: () => () => {},
}));
vi.mock("../model/quickComposer", () => ({
  quickComposerSupported: () => true,
  setQuickComposerShortcut: async () => {},
  liveQuickCatalog: () => ({ models: [] }),
  isHarnessId: () => false,
  QUICK_COMPOSER_CATALOG_EVENT: "catalog",
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT: "catalog-request",
  QUICK_COMPOSER_LAUNCH_EVENT: "launch",
}));
vi.mock("../model/launchDelivery", () => ({
  launchReceiver: () => {
    const receiver = Object.assign(
      vi.fn(async () => {}),
      { dispose: vi.fn() },
    );
    mocks.receivers.push(receiver);
    return receiver;
  },
}));
import { useQuickComposerLaunches } from "./useQuickComposerLaunches";

it("routes launch to one workspace while catalog requests fan out", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.receivers.length = 0;
  mocks.probe.mockResolvedValue(undefined);
  mocks.emit.mockResolvedValue(undefined);
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  mocks.listen.mockImplementation(
    async (
      event: string,
      callback: (event: { payload: unknown }) => void,
      options: { target: string },
    ) => {
      handlers.set(`${options.target}:${event}`, callback);
      return () => handlers.delete(`${options.target}:${event}`);
    },
  );
  function Harness() {
    useQuickComposerLaunches(async () => {});
    return null;
  }
  const main = createRoot(document.createElement("div"));
  const other = createRoot(document.createElement("div"));
  try {
    mocks.label = "main";
    await act(async () => main.render(createElement(Harness)));
    mocks.label = "other";
    await act(async () => other.render(createElement(Harness)));
    mocks.receivers.forEach((receiver) => receiver.mockClear());
    await act(async () => {
      handlers.get("main:launch")?.({ payload: null });
      await Promise.resolve();
    });
    expect(mocks.receivers[0]).toHaveBeenCalledOnce();
    expect(mocks.receivers[1]).not.toHaveBeenCalled();
    await act(async () => {
      handlers.get("main:catalog-request")?.({ payload: null });
      handlers.get("other:catalog-request")?.({ payload: null });
      await Promise.resolve();
    });
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => {
      main.unmount();
      other.unmount();
    });
    vi.unstubAllGlobals();
  }
});

it("cleans up registrations completed after unmount and tolerates rejection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (value: () => void) => void;
  const release = vi.fn();
  mocks.listen
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("registration failed"));
  function Harness() {
    useQuickComposerLaunches(async () => {});
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.unmount());
    await act(async () => {
      finish(release);
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
