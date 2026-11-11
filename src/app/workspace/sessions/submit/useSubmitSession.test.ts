// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSubmitSession } from "./useSubmitSession";
import type { SubmitDeps } from "./submitTypes";

it("keeps onSubmit stable when only the navigation object identity changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const isSwitching = vi.fn(() => false);
  const stable = {
    applyProjectLocationChange: vi.fn(),
    dismissNoticesForContinuedSession: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    runSessionShell: vi.fn(),
  };
  const seen: ReturnType<typeof useSubmitSession>[] = [];
  function Harness() {
    // A fresh object per render, like a hook that returns an object literal.
    const workspaceNavigation = { isSwitching, pending: null, revision: 0 };
    seen.push(useSubmitSession({ ...stable, workspaceNavigation } as unknown as SubmitDeps));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Harness)));
    act(() => root.render(createElement(Harness)));
    expect(seen).toHaveLength(2);
    expect(seen[1].onSubmit).toBe(seen[0].onSubmit);
    expect(seen[1].submitSession).toBe(seen[0].submitSession);
  } finally {
    act(() => root.unmount());
  }
});
