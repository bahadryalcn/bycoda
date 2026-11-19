// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabVisitNav } from "./TitleBar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function renderNav(panelActive: boolean) {
  act(() =>
    root.render(
      createElement(TabVisitNav, {
        canGoBack: true,
        canGoForward: true,
        onGoBack: vi.fn(),
        onGoForward: vi.fn(),
        onTogglePanel: vi.fn(),
        panelActive,
      }),
    ),
  );
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

describe("sidebar toggle state", () => {
  it("names the project rail toggle Toggle Sidebar and reports its open state", () => {
    renderNav(true);
    expect(button("Toggle sidebar").getAttribute("aria-pressed")).toBe("true");
    renderNav(false);
    expect(button("Toggle sidebar").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps Back and Forward as plain buttons, without a pressed state", () => {
    renderNav(false);
    expect(button("Back").hasAttribute("aria-pressed")).toBe(false);
    expect(button("Forward").hasAttribute("aria-pressed")).toBe(false);
  });
});
