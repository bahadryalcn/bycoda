// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxLoadError } from "./InboxLoadError";

it("keeps long errors collapsed, exposes all details and retains retry state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onRetry = vi.fn();
  const error = Array.from(
    { length: 20 },
    (_, index) => `G:/repo-${index}: network unavailable`,
  ).join("\n");
  try {
    await act(async () =>
      root.render(
        createElement(InboxLoadError, { error, retrying: false, disabled: false, onRetry }),
      ),
    );
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).not.toContain(error);
    const details = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Details"),
    )!;
    await act(async () => details.click());
    expect(document.querySelector("pre")?.textContent).toBe(error);
    await act(async () => details.click());
    const retry = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Try again"),
    )!;
    await act(async () => retry.click());
    expect(onRetry).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(InboxLoadError, { error, retrying: false, disabled: true, onRetry }),
      ),
    );
    expect(retry.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("never prints a short raw error as title or body", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const error = "Cannot read properties of undefined (reading 'invoke')";
  try {
    await act(async () =>
      root.render(createElement(InboxLoadError, { error, title: "Could not load this item." })),
    );
    expect(host.textContent).toContain("Could not load this item.");
    expect(host.textContent).not.toContain(error);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
