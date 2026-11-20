// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { withQueryClient } from "../../../tests/browser/support/queryTest";
import { UsageFooter as QueryComponent } from "./UsageFooter";

vi.mock("../../features/settings/public/useKeybindingShortcut", () => ({
  useKeybindingShortcut: (command: string) => (command === "Terminal: New" ? "Alt+Shift+T" : null),
}));

const UsageFooter = withQueryClient(QueryComponent);

it("shows the live Terminal: New binding in the button tooltip instead of the hard-coded MOD shortcut", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no ResizeObserver; the shared tooltip's Popover observes its frame.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: [], onNewTerminal: vi.fn() })),
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-usage-guide="terminal-toggle"]',
    )!;
    await act(async () => {
      button.dispatchEvent(new Event("pointerover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 520));
    });
    const tooltip = document.querySelector('[role="tooltip"]')?.textContent ?? "";
    expect(tooltip).toContain("New Terminal");
    expect(tooltip).toContain("Alt");
    expect(tooltip).toContain("Shift");
    expect(tooltip).toContain("T");
    expect(tooltip).not.toContain("`");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
