// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionRecoveryControl } from "./SessionRecoveryControl";

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
  try {
    await render(false);
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
    await act(async () => trigger.click());
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
