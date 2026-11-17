// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GitGraphHoverCard } from "./GitGraphHoverCard";
import { copyText } from "../../../platform/tauri/clipboard";
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("./GitGraphParts", () => ({ GraphAvatar: () => null, RefPill: () => null }));

it("uses the shared clipboard path, reports failure, and clears it on retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(copyText)
    .mockRejectedValueOnce(new Error("Copy unavailable"))
    .mockResolvedValueOnce(undefined);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(GitGraphHoverCard, {
          commit: {
            sha: "abc123",
            shortSha: "abc",
            parents: [],
            author: "Test",
            timestamp: Date.now() / 1000,
            subject: "Subject",
            refs: [],
            head: false,
          },
          row: {
            sha: "abc123",
            parentIds: [],
            kind: "node",
            inputSwimlanes: [],
            outputSwimlanes: [],
            refs: [],
          },
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Copy commit ID"]')!.click(),
    );
    const button = document.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("data-copy-state")).toBe("failed");
    expect(button.getAttribute("aria-label")).toBe("Copy failed. Try again.");
    await act(async () => button.click());
    expect(copyText).toHaveBeenLastCalledWith("abc123");
    expect(button.getAttribute("data-copy-state")).toBe("copied");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
