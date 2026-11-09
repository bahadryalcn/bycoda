// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { RemoteDataStatus } from "./RemoteDataStatus";
import type { RemoteDataState } from "../model/remoteDataState";

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("puts routine verification in one named refresh action without a banner", async () => {
  const onRefresh = vi.fn();
  act(() =>
    root.render(
      createElement(RemoteDataStatus, { state: { phase: "ready", updatedAt: 1000 }, onRefresh }),
    ),
  );
  const button = container.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("Refresh conversation");
  expect(button.title).toBe("");
  expect(await tooltipText(button)).toContain("Last verified");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => button.click());
  expect(onRefresh).toHaveBeenCalledOnce();
});

it.each(["ready", "empty", "loading", "refreshing", "stale", "error"] as const)(
  "shows %s in exactly one of the toolbar and notice locations",
  (phase) => {
    const state: RemoteDataState = {
      phase,
      updatedAt: 1000,
      error: phase === "error" ? "Read failed" : undefined,
    };
    const onRefresh = vi.fn();
    vi.useFakeTimers();
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(RemoteDataStatus, { state, onRefresh, presentation: "indicator" }),
          createElement(RemoteDataStatus, { state, onRefresh, presentation: "notice" }),
        ),
      ),
    );
    if (phase === "loading") {
      // A first load that finishes quickly shows nothing at all.
      expect(container.querySelectorAll("[data-remote-data-state]")).toHaveLength(0);
      act(() => vi.advanceTimersByTime(LOADING_DELAY_MS));
    }
    vi.useRealTimers();
    expect(container.querySelectorAll("[data-remote-data-state]")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(phase === "loading" || phase === "refreshing");
    if (phase === "error") {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Read failed");
      expect(button.getAttribute("aria-label")).toBe("Retry loading conversation");
      act(() => button.click());
      expect(onRefresh).toHaveBeenCalledOnce();
    }
  },
);

it("defers to the common connection warning instead of duplicating it", () => {
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "error", error: "Machine is unreachable" },
        connectionIssueHandled: true,
      }),
    ),
  );
  expect(container.textContent).toBe("");
});

it("keeps an independent data error actionable beside a shared connection warning", () => {
  const onRefresh = vi.fn();
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "error", error: "Host rejected request: Queue storage unavailable" },
        connectionIssueHandled: true,
        onRefresh,
      }),
    ),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Queue storage unavailable",
  );
  act(() => container.querySelector("button")!.click());
  expect(onRefresh).toHaveBeenCalledOnce();
});

it("shows a background refresh only inside the refresh button", () => {
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "refreshing", updatedAt: 1000 },
        onRefresh: vi.fn(),
        presentation: "indicator",
      }),
    ),
  );
  expect(container.querySelector("button span")).not.toBeNull();
});

it("retries a busy machine in the toolbar instead of showing an error", async () => {
  vi.useFakeTimers();
  try {
    const onRefresh = vi.fn();
    act(() =>
      root.render(
        createElement(RemoteDataStatus, {
          state: {
            phase: "error",
            updatedAt: 1000,
            error: "Host rejected request: Host read capacity is busy; retry later.",
          },
          onRefresh,
        }),
      ),
    );
    expect(container.querySelector("[data-remote-data-state]")?.tagName).toBe("SPAN");
    expect(container.textContent).toContain("The machine is busy. Retrying…");
    expect(container.textContent).not.toContain("Couldn’t refresh");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(onRefresh).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
