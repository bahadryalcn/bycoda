// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MOD } from "../../../platform/tauri/platform";
import { saveKeybindingOverride } from "../../settings/model/settings";
import { TranscriptFind } from "./TranscriptFind";

it("exposes the current find binding and keeps mouse access after it is disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(TranscriptFind, {
          blocks: [],
          visible: true,
          focused: true,
          onNavigate: () => true,
        }),
      ),
    );
    const launcher = () => container.querySelector<HTMLButtonElement>("button")!;
    expect(launcher().title).toBe(`Find in conversation (${MOD}F)`);
    await act(async () => {
      saveKeybindingOverride("Editor: Find", { shortcut: "Control+Shift+KeyM" });
    });
    expect(launcher().title).toContain("M)");
    await act(async () => {
      saveKeybindingOverride("Editor: Find", { disabled: true });
    });
    expect(launcher().title).toBe("Find in conversation");
    await act(async () => launcher().click());
    expect(container.querySelector('[role="search"]')).not.toBeNull();
    expect(container.querySelector('[title="Next match (Enter / F3)"]')).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>('[title="Close find (Esc)"]')!;
    await act(async () => close.click());
    expect(launcher().title).toBe("Find in conversation");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
