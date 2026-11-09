// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantPresenceIndicator } from "./AssistantPresenceIndicator";
import type { AssistantPresenceState } from "../model/assistantPresencePresentation";

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["present", "Here", "success"],
  ["away", "Away", "warning"],
  ["idle", "Idle", "warning"],
  ["dnd", "Do not disturb", "danger"],
  ["locked", "Locked", "danger"],
  ["unknown", "Unknown", "neutral"],
] as const)(
  "keeps a visible %s label beside its color, without controls or effects",
  async (state, label, tone) => {
    await act(() =>
      root.render(
        createElement(AssistantPresenceIndicator, { state: state as AssistantPresenceState }),
      ),
    );
    expect(container.textContent).toBe(label);
    const indicator = container.querySelector("[data-presence-state]")!;
    expect(indicator.getAttribute("data-presence-tone")).toBe(tone);
    expect(indicator.getAttribute("aria-hidden")).toBeNull();
    expect(container.querySelector("button,input")).toBeNull();
  },
);

it("hides only a decorative menu mark from accessibility while the option owns its label", async () => {
  await act(() =>
    root.render(createElement(AssistantPresenceIndicator, { state: "away", markOnly: true })),
  );
  expect(container.textContent).toBe("");
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
});
