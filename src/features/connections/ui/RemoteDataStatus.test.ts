// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteDataStatus } from "./RemoteDataStatus";
import type { RemoteDataState } from "../model/remoteDataState";

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

it("puts routine verification in one named refresh action without a banner", () => {
  const onRefresh = vi.fn();
  act(() =>
    root.render(
      createElement(RemoteDataStatus, { state: { phase: "ready", updatedAt: 1000 }, onRefresh }),
    ),
  );
  const button = container.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("Refresh conversation");
  expect(button.title).toContain("Last verified");
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
        state: { phase: "error", error: "Offline" },
        connectionIssueHandled: true,
      }),
    ),
  );
  expect(container.textContent).toBe("");
});
