// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: { displayName: "bycoda", repositoryUrl: null as string | null },
  openUrl: vi.fn(),
  star: vi.fn(),
  starStatus: vi.fn(),
}));
vi.mock("../../shared/lib/productIdentity", () => ({ PRODUCT_IDENTITY: mocks.identity }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../features/inbox/model/githubTasks", () => ({
  githubBycodaStarStatus: mocks.starStatus,
  starBycodaOnGithub: mocks.star,
}));
import { GithubStarPrompt } from "./GithubStarPrompt";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.identity.repositoryUrl = null;
  vi.clearAllMocks();
  mocks.openUrl.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("renders nothing and performs no upstream action without a configured repository", async () => {
  await act(async () => root.render(createElement(GithubStarPrompt)));
  window.dispatchEvent(new Event("focus"));
  expect(container.innerHTML).toBe("");
  expect(mocks.starStatus).not.toHaveBeenCalled();
  expect(mocks.star).not.toHaveBeenCalled();
  expect(mocks.openUrl).not.toHaveBeenCalled();
});
it("opens only the configured repository without starring through an account", async () => {
  mocks.identity.repositoryUrl = "https://github.com/example/bycoda";
  await act(async () => root.render(createElement(GithubStarPrompt)));
  const button = container.querySelector<HTMLButtonElement>('[aria-label="View bycoda on GitHub"]');
  expect(button).not.toBeNull();
  await act(async () => button?.click());
  expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/example/bycoda");
  expect(mocks.star).not.toHaveBeenCalled();
  expect(mocks.starStatus).not.toHaveBeenCalled();
});
it("persists dismissal without touching the configured repository", async () => {
  mocks.identity.repositoryUrl = "https://github.com/example/bycoda";
  await act(async () => root.render(createElement(GithubStarPrompt)));
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Dismiss GitHub repository prompt"]')
      ?.click(),
  );
  expect(container.innerHTML).toBe("");
  expect(localStorage.getItem("bycoda.githubStarPrompt.dismissed.v1")).toBe("1");
  expect(mocks.openUrl).not.toHaveBeenCalled();
});
