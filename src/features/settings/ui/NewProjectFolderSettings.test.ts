// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NewProjectFolderGroup } from "./NewProjectFolderSettings";
const mocks = vi.hoisted(() => ({ pick: vi.fn(), home: vi.fn(async () => "C:/home") }));
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: mocks.home, pickFolders: mocks.pick }));
vi.mock("../../projects/public/recents", () => ({ loadRecents: () => [] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("keeps an unreadable native home directory recoverable instead of crashing", async () => {
  mocks.home.mockResolvedValueOnce(undefined as never);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(NewProjectFolderGroup)));
    expect(container.textContent).toContain("Could not read your home folder.");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(container.textContent).toContain("C:/home/Projects");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
it("owns one pending picker and clears cancellation without changing the saved folder", async () => {
  let cancel!: (paths: string[]) => void;
  mocks.pick
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          cancel = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("picker failed"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(NewProjectFolderGroup)));
    const choose = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Choose folder…",
    )!;
    await act(async () => {
      choose.click();
      choose.click();
    });
    expect(mocks.pick).toHaveBeenCalledOnce();
    expect(choose.getAttribute("aria-busy")).toBe("true");
    await act(async () => cancel([]));
    expect(choose.disabled).toBe(false);
    await act(async () => choose.click());
    expect(container.textContent).toContain("picker failed");
    expect(container.textContent).toContain("C:/home/Projects");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
