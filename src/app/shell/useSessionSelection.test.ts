// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./useSessionBulkDelete", () => ({
  useSessionBulkDelete: () => ({ bulkDeleteSessions: vi.fn() }),
}));
import { useSessionSelection, type SessionSelectionOptions } from "./useSessionSelection";

let root: Root;
let container: HTMLDivElement;
let selection!: ReturnType<typeof useSessionSelection>;
const onDismissMenu = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    selection = useSessionSelection({
      scope: "/repo",
      navigationIds: ["a", "b"],
      navigationKey: "a,b",
      canDelete: true,
      onDismissMenu,
      bulkDelete: {} as SessionSelectionOptions["bulkDelete"],
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  act(() => selection.startSelecting("a"));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onDismissMenu.mockClear();
  vi.unstubAllGlobals();
});

function escape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

// Issue #1248: Escape that cancels an IME candidate or was already consumed keeps the selection.
it("keeps the selection for an IME-composing or already-handled Escape", () => {
  expect(selection.selectedSessionIds.size).toBe(1);
  escape({ isComposing: true });
  expect(selection.selectedSessionIds.size).toBe(1);
  escape({ keyCode: 229 });
  expect(selection.selectedSessionIds.size).toBe(1);
  const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  consumed.preventDefault();
  act(() => {
    window.dispatchEvent(consumed);
  });
  expect(selection.selectedSessionIds.size).toBe(1);
  expect(onDismissMenu).not.toHaveBeenCalled();
});

it("clears the selection on a plain Escape", () => {
  escape();
  expect(selection.selectedSessionIds.size).toBe(0);
  expect(selection.selectionMode).toBe(false);
  expect(onDismissMenu).toHaveBeenCalledOnce();
});
