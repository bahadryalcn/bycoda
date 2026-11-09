// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSearch } from "./ProjectSearch";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

const overlay = vi.hoisted(() => ({ active: false }));
vi.mock("../../../shared/ui/overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/overlay")>()),
  hasActiveOverlay: () => overlay.active,
}));
vi.mock("../../search/model/search", () => ({
  cancelProjectSearch: vi.fn(async () => {}),
  searchProject: vi.fn(async () => ({ matches: [], truncated: false })),
}));

let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  overlay.active = false;
  onClose.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(createElement(ProjectSearch, { cwd: "/project", onClose, onOpenFile: vi.fn() })),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function escape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => void window.dispatchEvent(event));
  return event;
}

it("closes on a plain Escape", () => {
  escape();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("leaves Escape to an open child overlay, then closes on the next one", () => {
  overlay.active = true;
  const event = escape();
  expect(onClose).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  overlay.active = false;
  escape();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not close while an IME composition owns Escape", () => {
  escape({ isComposing: true });
  expect(onClose).not.toHaveBeenCalled();
});
