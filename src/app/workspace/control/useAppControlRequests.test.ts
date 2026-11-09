// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  label: "main",
  listen: vi.fn(),
  invoke: vi.fn(),
  handle: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.label }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { handle: mocks.handle },
}));
vi.mock("./useHistorySourceRegistration", () => ({ useHistorySourceRegistration: () => {} }));
import { useAppControlRequests, type AppControlRequestDeps } from "./useAppControlRequests";

it("delivers control to the intended window and disposes a late registration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  let complete!: (release: () => void) => void;
  const release = vi.fn();
  mocks.listen.mockImplementation(
    (
      _event: string,
      callback: (event: { payload: unknown }) => void,
      options: { target: string },
    ) => {
      handlers.set(options.target, callback);
      if (options.target === "other")
        return new Promise((resolve) => {
          complete = resolve;
        });
      return Promise.resolve(vi.fn());
    },
  );
  mocks.handle.mockResolvedValue("accepted");
  mocks.invoke.mockResolvedValue(undefined);
  const deps = {
    launchQuickSessionRef: { current: vi.fn() },
    submitSessionRef: { current: vi.fn() },
    ensureOpenSessionRef: { current: vi.fn() },
    saveDraftRef: { current: vi.fn() },
  } as unknown as AppControlRequestDeps;
  function Harness() {
    useAppControlRequests(deps);
    return null;
  }
  const first = createRoot(document.createElement("div"));
  const second = createRoot(document.createElement("div"));
  try {
    mocks.label = "main";
    await act(async () => first.render(createElement(Harness)));
    mocks.label = "other";
    await act(async () => second.render(createElement(Harness)));
    await act(async () => second.unmount());
    handlers.get("other")?.({
      payload: {
        id: "x",
        namespace: "control",
        sessionId: "s",
        requestId: "r",
        action: "go",
        input: {},
      },
    });
    expect(mocks.handle).not.toHaveBeenCalled();
    complete(release);
    await act(async () => {
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledOnce();
    handlers.get("main")?.({
      payload: {
        id: "x",
        namespace: "control",
        sessionId: "s",
        requestId: "r",
        action: "go",
        input: {},
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith("control_reply", {
      id: "x",
      response: { ok: true, result: "accepted" },
    });
  } finally {
    await act(async () => first.unmount());
    vi.unstubAllGlobals();
  }
});

it("handles failed registration without an unhandled rejection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.listen.mockRejectedValueOnce(new Error("registration failed"));
  const root = createRoot(document.createElement("div"));
  function Harness() {
    useAppControlRequests({} as AppControlRequestDeps);
    return null;
  }
  try {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    warn.mockRestore();
    vi.unstubAllGlobals();
  }
});
