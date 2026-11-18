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
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  act(() => button.click());
  expect(onRefresh).toHaveBeenCalledOnce();
});

it.each(["ready", "empty", "loading", "refreshing", "stale", "error"] as const)(
  "keeps machine identity visible for %s without a success checkmark",
  async (phase) => {
    const onRefresh = vi.fn();
    act(() =>
      root.render(
        createElement(RemoteDataStatus, {
          state: { phase, error: phase === "error" ? "Machine is unreachable" : undefined },
          presentation: "indicator",
          machineName: "Office Mac",
          connectionIssueHandled: phase === "error",
          onRefresh,
        }),
      ),
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(await tooltipText(button!)).toContain("Office Mac");
    if (phase === "ready") {
      expect(button!.querySelector(".lucide-server")).not.toBeNull();
      expect(button!.querySelector(".lucide-check")).toBeNull();
      act(() => button!.click());
      expect(onRefresh).toHaveBeenCalledOnce();
    }
  },
);

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
      expect(document.body.querySelectorAll("[data-remote-data-state]")).toHaveLength(0);
      act(() => vi.advanceTimersByTime(LOADING_DELAY_MS));
    }
    vi.useRealTimers();
    expect(document.body.querySelectorAll("[data-remote-data-state]")).toHaveLength(1);
    // A notice is a floating card in the shared alert stack, outside the pane.
    const attention = phase === "error" || phase === "stale";
    expect(container.querySelectorAll("[data-remote-data-state]")).toHaveLength(attention ? 0 : 1);
    const button = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${phase === "error" ? "Retry loading conversation" : "Refresh conversation"}"]`,
    )!;
    expect(button.disabled).toBe(phase === "loading" || phase === "refreshing");
    // The toast button stays short; the data name lives in the aria-label and the copy.
    if (attention) expect(button.textContent).toBe(phase === "error" ? "Retry" : "Refresh");
    if (phase === "error")
      expect(document.body.querySelector("[data-toast-region]")?.textContent).toContain(
        "Read failed",
      );
    act(() => button.click());
    expect(onRefresh).toHaveBeenCalledTimes(button.disabled ? 0 : 1);
  },
);

it("closes a floating notice until its state changes", () => {
  const render = (state: RemoteDataState) =>
    act(() =>
      root.render(
        createElement(RemoteDataStatus, { state, onRefresh: vi.fn(), presentation: "notice" }),
      ),
    );
  render({ phase: "error", updatedAt: 1000, error: "Read failed" });
  const close = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Dismiss notice"]',
  )!;
  act(() => close.click());
  expect(document.body.querySelector("[data-remote-data-state]")).toBeNull();
  render({ phase: "error", updatedAt: 1000, error: "Read failed" });
  expect(document.body.querySelector("[data-remote-data-state]")).toBeNull();
  render({ phase: "error", updatedAt: 2000, error: "Another failure" });
  expect(document.body.querySelector("[data-remote-data-state]")).not.toBeNull();
});

it("defers to the common connection warning instead of duplicating it", () => {
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "error", error: "Machine is unreachable" },
        connectionIssueHandled: true,
      }),
    ),
  );
  expect(document.body.textContent).toBe("");
});

it("does not call retained data current while the owning connection is unavailable", async () => {
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "ready", updatedAt: 1000 },
        presentation: "indicator",
        machineName: "Office Mac",
        connectionIssueHandled: true,
        onRefresh: vi.fn(),
      }),
    ),
  );
  const detail = await tooltipText(container.querySelector("button")!);
  expect(detail).toContain("Office Mac");
  expect(detail).toContain("Updates have not been verified");
  expect(detail).not.toContain("Up to date");
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
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
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
    expect(document.body.textContent).toContain("The machine is busy. Retrying…");
    expect(document.body.textContent).not.toContain("Couldn’t refresh");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(onRefresh).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("shows the classified reason after quiet retries and keeps the raw text behind Details", () => {
  const raw = "Host rejected request: [RPC_TIMEOUT] request timed out";
  act(() =>
    root.render(
      createElement(RemoteDataStatus, {
        state: { phase: "error", error: raw },
        onRefresh: vi.fn(),
        disabled: true,
      }),
    ),
  );
  const alert = document.body.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("This computer is busy right now. Try again in a moment.");
  expect(alert?.textContent).not.toContain("RPC_TIMEOUT");
  expect(alert?.textContent).toContain("Details");
});
