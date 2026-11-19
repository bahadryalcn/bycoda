// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GithubStarPrompt } from "./GithubStarPrompt";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(), showToast: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../shared/ui/ToastRegion", () => ({ useToast: () => ({ show: mocks.showToast }) }));
vi.mock("../../shared/lib/productIdentity", () => ({
  PRODUCT_IDENTITY: { displayName: "bycoda", repositoryUrl: "https://github.com/example/bycoda" },
}));

it("reports a failed GitHub repository open and leaves the action available to retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.openUrl
    .mockRejectedValueOnce(new Error("browser unavailable"))
    .mockResolvedValueOnce(undefined);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(GithubStarPrompt)));
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="View bycoda on GitHub"]',
    );
    expect(button).not.toBeNull();

    await act(async () => button?.click());
    expect(mocks.showToast).toHaveBeenCalledWith({
      id: "github-star-open-failed",
      tone: "danger",
      message: "Could not open the link. Try again.",
    });
    await act(async () => button?.click());
    expect(mocks.openUrl).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
