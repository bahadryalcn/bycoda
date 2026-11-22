// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { RemoteDataStatus } from "./RemoteDataStatus";
import { ToastRegion, type ToastAnnouncement } from "../../../shared/ui/ToastRegion";
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
        state: {
          phase: "error",
          error: "Host rejected request: SSH connection failed for this operation",
        },
        connectionIssueHandled: true,
        onRefresh,
      }),
    ),
  );
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    "SSH connection failed for this operation",
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

it("shows the classified reason after the grace and keeps raw text behind Details", async () => {
  vi.useFakeTimers();
  try {
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
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(3_000));
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This computer is busy right now. Try again in a moment.");
    expect(alert?.textContent).not.toContain("RPC_TIMEOUT");
    expect(alert?.textContent).toContain("Details");
  } finally {
    vi.useRealTimers();
  }
});

it("keeps an open conversation's retained data quiet through a declared five-second restart", async () => {
  vi.useFakeTimers();
  try {
    const onRecord = vi.fn();
    let online = false;
    const refresh = vi.fn(() =>
      render(
        online
          ? { phase: "ready", updatedAt: 6_000 }
          : {
              phase: "stale",
              updatedAt: 1_000,
              error: "Machine is unreachable",
            },
      ),
    );
    const render = (state: RemoteDataState) =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ToastRegion, { onRecord }),
          createElement(RemoteDataStatus, {
            state,
            presentation: "indicator",
            onRefresh: refresh,
            autoRetry: false,
          }),
          createElement(RemoteDataStatus, { state, presentation: "notice", onRefresh: refresh }),
        ),
      );
    act(() => render({ phase: "error", error: "Host is stopping.", updatedAt: 1_000 }));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(onRecord).not.toHaveBeenCalled();
    online = true;
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
    expect(onRecord).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("names the machine and data of a stale notice and keeps separate notices apart", async () => {
  const { noticeDetailLines } = await import("./RemoteDataStatus");
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        createElement(RemoteDataStatus, {
          state: { phase: "stale", updatedAt: 1000 },
          presentation: "notice",
          machineLabel: "Office Mac",
          label: "conversation",
          onRefresh: vi.fn(),
        }),
        createElement(RemoteDataStatus, {
          state: { phase: "stale", updatedAt: 9000 },
          presentation: "notice",
          machineLabel: "Office Mac",
          label: "Jira board",
          onRefresh: vi.fn(),
        }),
      ),
    ),
  );
  const text = document.body.querySelector("[data-toast-region]")?.textContent ?? "";
  expect(text).toContain("Showing last loaded conversation.");
  expect(text).toContain("Showing last loaded Jira board.");
  expect(text.match(/Office Mac/g)).toHaveLength(2);
  const details = noticeDetailLines({
    machine: "Office Mac",
    data: "conversation",
    verifiedAt: 1000,
    reason: "Machine is unreachable",
  });
  expect(details).toBe(
    "machine: Office Mac\ndata: conversation\nlast verified: 1970-01-01T00:00:01.000Z\nreason: Machine is unreachable",
  );
});

it("records a sustained stale read's verification time and sanitized reason in history", async () => {
  vi.useFakeTimers();
  try {
    const record = vi.fn<(entry: ToastAnnouncement) => void>();
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ToastRegion, { onRecord: record }),
          createElement(RemoteDataStatus, {
            state: {
              phase: "stale",
              updatedAt: 1000,
              error: "Host rejected request: [RPC_TIMEOUT] token=private-test-value",
            },
            machineLabel: "Office Mac",
            presentation: "notice",
            label: "conversation",
          }),
        ),
      ),
    );
    expect(record).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    const entry = record.mock.calls.at(-1)?.[0];
    expect(entry?.title).toBe("Office Mac");
    expect(entry?.message).toContain("1970-01-01T00:00:01.000Z");
    expect(entry?.message).toContain("RPC_TIMEOUT");
    expect(entry?.message).not.toContain("private-test-value");
  } finally {
    vi.useRealTimers();
  }
});
