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

function Probe({
  ids,
  keyText,
  scope = "/repo",
  onRender,
}: {
  ids: readonly string[];
  keyText: string;
  scope?: string;
  onRender?: () => void;
}) {
  onRender?.();
  selection = useSessionSelection({
    scope,
    navigationIds: ids,
    navigationKey: keyText,
    canDelete: true,
    onDismissMenu,
    bulkDelete: {} as SessionSelectionOptions["bulkDelete"],
  });
  return null;
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

it("changes a thousand-row filter in one render without reading rows for an empty selection", () => {
  const counts = { renders: 0, rowReads: 0 };
  const ids = Array.from({ length: 1000 }, (_, index) => String(index));
  const filteredIds = new Proxy(ids.slice(1), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) counts.rowReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const onRender = () => {
    counts.renders++;
  };
  act(() => root.render(createElement(Probe, { ids, keyText: "all", onRender })));
  counts.renders = 0;
  act(() => root.render(createElement(Probe, { ids: filteredIds, keyText: "filtered", onRender })));
  expect(counts).toEqual({ renders: 1, rowReads: 0 });
  expect(selection.selectedOrderedIds).toEqual([]);
});

it("prunes an anchor without a selection and clears contextual selection when the project changes", () => {
  const all = ["a", "b", "c", "d"];
  const event = { shiftKey: false, ctrlKey: false, metaKey: false };
  const show = (ids: string[], scope = "/repo") =>
    act(() => root.render(createElement(Probe, { ids, keyText: ids.join(","), scope })));
  show(all);
  act(() => {
    selection.select("b", event, all);
  });
  show(["c", "d"]);
  show(all);
  act(() => {
    selection.select("d", { ...event, shiftKey: true }, all, "c");
  });
  expect(selection.selectedOrderedIds).toEqual(["c", "d"]);
  show(["a", "d"]);
  expect(selection.selectedOrderedIds).toEqual(["d"]);
  act(() => selection.beginContextMenu("a"));
  expect(selection.contextSelection).toBe(true);
  show(["a"], "/other");
  expect(selection.contextSelection).toBe(false);
  expect(selection.selectedOrderedIds).toEqual([]);
});
