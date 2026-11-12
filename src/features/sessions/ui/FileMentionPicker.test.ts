// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileMentionPicker } from "./FileMentionPicker";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.unstubAllGlobals();
});

it("keeps composer focus and ignores stationary pointer events after keyboard navigation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const files = ["first.ts", "second.ts"].map((name) => ({
    path: `/repo/${name}`,
    relative: name,
    name,
    score: 0,
    positions: [],
  }));
  const onActive = vi.fn();
  const onPick = vi.fn();
  const editor = document.createElement("input");
  document.body.append(editor);
  editor.focus();
  const render = (active: number) =>
    act(() =>
      root.render(
        createElement(FileMentionPicker, {
          files,
          active,
          query: "",
          onActive,
          onPick,
        }),
      ),
    );
  render(0);
  const first = host.querySelector<HTMLButtonElement>('[role="option"]')!;
  act(() =>
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }),
    ),
  );
  render(1);
  act(() => {
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }),
    );
  });
  expect(onActive).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(editor);
  act(() =>
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 21, clientY: 20 }),
    ),
  );
  expect(onActive).toHaveBeenCalledExactlyOnceWith(0);
  act(() => first.click());
  expect(onPick).toHaveBeenCalledExactlyOnceWith(files[0]);
  editor.remove();
});
