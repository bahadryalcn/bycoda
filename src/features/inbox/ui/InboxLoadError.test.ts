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
    expect(host.textContent).not.toContain("G:/repo-0");
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await act(async () => toggle.click());
    const details = host.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)!;
    expect(details.textContent).toBe(error);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const retry = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Retry"),
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
