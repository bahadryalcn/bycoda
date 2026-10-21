// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { claudeSessions } from "../../../platform/tauri/fs";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker";
vi.mock("../../../platform/tauri/fs", () => ({ claudeSessions: vi.fn() }));

it("distinguishes failed discovery from empty history and retries without closing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(claudeSessions)
    .mockRejectedValueOnce(new Error("History unavailable"))
    .mockResolvedValueOnce([]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ClaudeSessionPicker, { cwd: "/project", onPick: vi.fn(), onClose: close }),
      ),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("History unavailable");
    expect(document.body.textContent).not.toContain("has not recorded");
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("has not recorded");
    expect(close).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
