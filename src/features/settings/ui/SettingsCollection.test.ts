// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionToolbar } from "./SettingsCollection";

afterEach(() => vi.unstubAllGlobals());

it("announces a zero collection count and keeps its controlled query", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
        createElement(CollectionToolbar, {
          label: "Search collection",
          count: 0,
          query: "custom filter",
          onQueryChange: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe("0");
    expect(container.querySelector("input")?.value).toBe("custom filter");
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
