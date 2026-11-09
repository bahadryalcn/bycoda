// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewSessionProjectDialog } from "./NewSessionProjectDialog";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => null),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("does not create on mount or cancel", async () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(NewSessionProjectDialog, {
        projects: [{ path: "/current", openedAt: 1 }],
        onPick,
        onClose,
      }),
    ),
  );
  expect(onPick).not.toHaveBeenCalled();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

it("blocks duplicate picks while pending and keeps errors retryable", async () => {
  let reject!: (reason: Error) => void;
  const onPick = vi.fn().mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(NewSessionProjectDialog, {
        projects: [{ path: "/current", openedAt: 1 }],
        onPick,
        onClose,
      }),
    ),
  );
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((el) =>
    el.textContent?.includes("/current"),
  )!;
  await act(async () => {
    option.click();
    option.click();
  });
  expect(onPick).toHaveBeenCalledExactlyOnceWith("/current");
  expect(option.disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Project unavailable")));
  expect(document.body.textContent).toContain("Project unavailable");
  expect(option.disabled).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => option.click());
  expect(onPick).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

it("lists No project first, picks the ~ sentinel and filters it with the search", async () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(NewSessionProjectDialog, {
        projects: [{ path: "/current", openedAt: 1 }],
        onPick,
        onClose,
      }),
    ),
  );
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options()[0]?.textContent).toContain("No project");
  expect(document.body.textContent).not.toContain("No projects yet");
  await act(async () => options()[0]!.click());
  expect(onPick).toHaveBeenCalledExactlyOnceWith("~");
  expect(onClose).toHaveBeenCalledOnce();
});
