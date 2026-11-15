// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsPageHelp } from "./settingsControls";

it("keeps page reset inside keyboard-reachable help and returns focus on Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onReset = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(SettingsPageHelp, {
          description: "Page help",
          reset: { label: "Restore defaults", onClick: onReset },
        }),
      ),
    );
    expect(document.body.textContent).not.toContain("Restore defaults");
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    const reset = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    expect(reset.textContent).toContain("Restore defaults");
    expect(reset.tabIndex).toBe(0);
    await act(async () => reset.focus());
    await act(async () =>
      reset.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click(),
    );
    expect(onReset).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
