// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Alert } from "./Alert";

it("forwards the actual error surface ref so recovery can focus it without replacing native attributes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLDivElement>();
  try {
    await act(async () =>
      root.render(
        createElement(
          Alert,
          { ref, tone: "danger", tabIndex: -1, "aria-label": "Operation failed" },
          "Retry available",
        ),
      ),
    );
    const surface = ref.current!;
    expect(surface.getAttribute("role")).toBe("alert");
    surface.focus();
    expect(document.activeElement).toBe(surface);
    await act(async () =>
      root.render(
        createElement(
          Alert,
          { ref, tone: "danger", tabIndex: -1, "aria-label": "Operation failed" },
          "Retry failed again",
        ),
      ),
    );
    expect(ref.current).toBe(surface);
    expect(document.activeElement).toBe(surface);
    expect(surface.textContent).toContain("Retry failed again");
  } finally {
    await act(async () => root.unmount());
    expect(ref.current).toBeNull();
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("renders the inline form with its tone icon and message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(Alert, { tone: "warning", inline: true }, "Disk almost full")),
    );
    const surface = container.querySelector('[role="status"]')!;
    expect(surface.textContent).toContain("Disk almost full");
    expect(surface.querySelector("svg")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
