// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionRecoveryControl } from "./SessionRecoveryControl";
import { setRecoverySaveFailure } from "../../features/workspace/model/sessionRecovery";

it("dismisses the recovered list only after confirmation, under one label in both modes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClear = vi.fn(async () => {});
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent === label || element.getAttribute("aria-label") === label,
    );
  const render = (includeFiles: boolean) =>
    act(async () =>
      root.render(
        createElement(SessionRecoveryControl, {
          count: 2,
          onOpen: vi.fn(),
          onClear,
          includeFiles,
        }),
      ),
    );
  const openOptions = (label: string) =>
    act(async () =>
      button(label)!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  try {
    await render(false);
    expect(button("Dismiss recovered sessions")).toBeUndefined();
    await openOptions("Recovered sessions (2)");
    expect(button("Dismiss recovered sessions")).toBeDefined();
    expect(button("Clear list")).toBeUndefined();
    await render(true);
    expect(button("Clear conversation recovery list")).toBeUndefined();
    const trigger = button("Dismiss recovered sessions")!;
    // A single click only asks; nothing is cleared yet.
    await act(async () => trigger.click());
    expect(onClear).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Dismiss recovered sessions?");
    // Cancel keeps the list.
    await act(async () => button("Cancel")!.click());
    expect(onClear).not.toHaveBeenCalled();
    // Confirm clears.
    await openOptions("Recovered work (2)");
    await act(async () => button("Dismiss recovered sessions")!.click());
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((element) => element.textContent === "Dismiss recovered sessions")
      .at(-1)!;
    await act(async () => confirm.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("hides an empty icon and keeps a failed dismissal retry reachable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpen = vi.fn();
  const retry = vi.fn(async () => setRecoverySaveFailure(null));
  try {
    await act(async () => root.render(createElement(SessionRecoveryControl, { count: 0, onOpen })));
    expect(container.querySelector("button")).toBeNull();
    await act(async () => setRecoverySaveFailure({ owner: {}, retry }));
    expect(container.querySelector('[data-variant="count"]')).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Recovery dismissal was not saved.",
    );
    const tryAgain = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    await act(async () => tryAgain!.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelector("button")).toBeNull();
  } finally {
    act(() => {
      root.unmount();
      setRecoverySaveFailure(null);
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});
