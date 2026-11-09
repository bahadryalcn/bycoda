// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  persistQuitState: vi.fn().mockResolvedValue(undefined),
  reapUnloadRuntime: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../model/appLifecycle", () => ({
  ...lifecycle,
  isAppQuitting: () => false,
  bindResumedSessions: vi.fn(),
}));
vi.mock("../../../integrations/harness", () => ({
  startHarnessBridge: () => () => {},
  probeHarnessAvailability: vi.fn(),
  refreshHarnessCatalogs: vi.fn().mockResolvedValue(undefined),
  isLiveHarness: () => false,
}));

import { useHarnessLifecycle } from "./useHarnessLifecycle";

it("persists and reaps once when both unload events fire", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  const readProjectReturnMemory = () => new Map();
  function Harness() {
    useHarnessLifecycle({
      resumed: null,
      harnessQueue: { cancelScheduled: vi.fn() } as never,
      tabsRef: useRef([]),
      activeTabIdRef: useRef(""),
      projectCwdRef: useRef(""),
      projectTerminalsRef: useRef([]),
      lastDockSideRef: useRef(null),
      keepWorkspaceTab: () => true,
      readProjectReturnMemory,
    });
    return null;
  }
  try {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    expect(lifecycle.persistQuitState).toHaveBeenCalledOnce();
    expect(lifecycle.reapUnloadRuntime).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  }
});
