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
  const root = createRoot(document.createElement("div"));
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
          anchor: { x: 10, y: 10 },
          side: "right",
          onEnter: vi.fn(),
          onLeave: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Copy commit ID"]')!.click(),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Copy unavailable");
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Copy commit ID"]')!.click(),
    );
    expect(copyText).toHaveBeenLastCalledWith("abc123");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
