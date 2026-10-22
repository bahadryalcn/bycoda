// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GitFeedback } from "./GitFeedback";
import { copyText } from "../../../platform/tauri/clipboard";
import { OPEN_WORKTREE_MANAGEMENT } from "../model/worktreeManagement";
import { createNote } from "../../notes";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("../../notes", () => ({ createNote: vi.fn().mockResolvedValue({ id: "note" }) }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

async function click(label: string) {
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click();
  });
}
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
    expect(document.querySelector("pre")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Git operation failed");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("pre")?.textContent).toBe(detail);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Copy output")!
        .click(),
    );
    expect(copyText).toHaveBeenCalledWith(detail);
    expect(document.body.textContent).toContain("Copied");
    await act(async () =>
      [...document.querySelectorAll("button")]
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
  await click("Failed");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Copy output")!
      .click(),
  );
  expect(document.querySelector("pre")?.textContent).toBe("original output");
  expect(document.body.textContent).toContain("Clipboard unavailable");
  expect(document.body.textContent).not.toContain("Copied");
});

it("saves the full diagnostic to notes and adds it to the chat draft", async () => {
  const request = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, request);
  try {
    await act(async () =>
      root.render(
        createElement(GitFeedback, {
          title: "Failed",
          detail: "fatal: index.lock exists\nsecond line",
          cwd: "remote://host/repo",
        }),
      ),
    );
    await click("Failed");
    await click("Add to notes");
    const text = "Failed\n\nremote://host/repo\n\nfatal: index.lock exists\nsecond line";
    expect(createNote).toHaveBeenCalledWith({
      title: "Failed",
      body: text,
      sourceCwd: "remote://host/repo",
    });
    expect(document.body.textContent).toContain("Saved");
    await click("Add to chat");
    expect((request.mock.calls[0][0] as CustomEvent).detail).toEqual({ text, mode: "quote" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("Failed");
  } finally {
    window.removeEventListener(ADD_TO_CHAT_EVENT, request);
  }
});

it("shows note failures without losing the diagnostic and allows retry", async () => {
  vi.mocked(createNote).mockRejectedValueOnce(new Error("Notes unavailable"));
  await act(async () =>
    root.render(createElement(GitFeedback, { title: "Failed", detail: "output" })),
  );
  await click("Failed");
  await click("Add to notes");
  expect(document.body.textContent).toContain("Notes unavailable");
  expect(document.querySelector("pre")?.textContent).toBe("output");
  await click("Add to notes");
  expect(document.body.textContent).toContain("Saved");
});
