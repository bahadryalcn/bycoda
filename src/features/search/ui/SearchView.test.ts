// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("../../files/model/fileIndex", () => ({
  peekProjectFiles: () => [],
  loadProjectFiles: async () => [],
  rankProjectFiles: () => [],
  recentOpenedFiles: () => [],
}));
vi.mock("../model/useConversationSearch", () => ({
  useConversationSearch: () => ({
    result: { sessions: [], pending: 0, truncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock("../model/useProjectFileSearch", () => ({
  useProjectFileSearch: () => ({
    result: { matches: [], truncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => ({ useLockSnapshot: () => ({}) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = (cwd = "/repo", open = true) =>
  act(async () =>
    root.render(
      createElement(SearchView, {
        cwd,
        open,
        recents: [],
        history: [],
        sessions: [],
        onClose: vi.fn(),
        onOpenFile: vi.fn(),
        onOpenSession: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
it("retains workspace search text and category across close/reopen and remount with project isolation", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "needle",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .click();
  });
  await render("/repo", false);
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
  expect(
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .getAttribute("aria-checked"),
  ).toBe("true");
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
  await render("/other");
  expect(host.querySelector("input")!.value).toBe("");
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
});
