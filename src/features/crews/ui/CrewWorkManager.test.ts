// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewWorkManager } from "./CrewWorkManager";
import type { useProjectCrews } from "../model/crewClient";

vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (cwd: string, state: unknown) => ({
    cwd,
    state,
    picker: () => null,
    projectPicker: () => null,
  }),
}));
vi.mock("./CrewWorkDetail", () => ({ CrewWorkDetail: () => null }));
vi.mock("./CrewWorkList", () => ({ CrewWorkList: () => null }));

it("offers retry only after a load failure and preserves its pending state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish!: () => void;
  const refetch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const state = { data: undefined, error: null, refetch };
  const render = () =>
    root.render(
      createElement(CrewWorkManager, {
        cwd: "/repo",
        state: state as unknown as ReturnType<typeof useProjectCrews>,
      }),
    );
  try {
    await act(async () => render());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Try again");
    Object.assign(state, { error: new Error("Machine is unreachable"), pendingFailure: true });
    await act(async () => render());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    Object.assign(state, { pendingFailure: false, visibleError: "Machine is unreachable" });
    await act(async () => render());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Try again"),
    )!;
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    await act(async () => retry.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
