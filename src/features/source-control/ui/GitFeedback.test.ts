// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GitFeedback } from "./GitFeedback";
import { copyText } from "../../../platform/tauri/clipboard";
import { OPEN_WORKTREE_MANAGEMENT } from "../model/worktreeManagement";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => {
  await act(async () => root.render(null));
  vi.clearAllMocks();
});

it("shows the original failure output and routes worktree recovery to the same machine and checkout", async () => {
  const detail =
    "error: cannot delete branch 'feature' used by worktree at 'remote path'\nsecond line";
  const request = vi.fn();
  window.addEventListener(OPEN_WORKTREE_MANAGEMENT, request);
  try {
    await act(async () =>
      root.render(
        createElement(GitFeedback, {
          title: "Git operation failed",
          detail,
          cwd: "remote://host/repo",
        }),
      ),
    );
    expect(host.querySelector("details")?.open).toBe(true);
    expect(host.querySelector("pre")?.textContent).toBe(detail);
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Copy output")!
        .click(),
    );
    expect(copyText).toHaveBeenCalledWith(detail);
    expect(host.textContent).toContain("Copied");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Manage worktrees…")!
        .click(),
    );
    expect((request.mock.calls[0][0] as CustomEvent).detail).toEqual({
      cwd: "remote://host/repo",
      deletePath: undefined,
    });
  } finally {
    window.removeEventListener(OPEN_WORKTREE_MANAGEMENT, request);
  }
});

it("keeps the original output when copying fails", async () => {
  vi.mocked(copyText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await act(async () =>
    root.render(createElement(GitFeedback, { title: "Failed", detail: "original output" })),
  );
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Copy output")!
      .click(),
  );
  expect(host.querySelector("pre")?.textContent).toBe("original output");
  expect(host.textContent).toContain("Clipboard unavailable");
  expect(host.textContent).not.toContain("Copied");
});
