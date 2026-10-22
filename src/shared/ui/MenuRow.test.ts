// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MenuRow, menuRowClassName } from "./MenuRow";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("forwards native refs, submenu semantics and domain pointer/key handlers without another controller", async () => {
  const ref = createRef<HTMLButtonElement>(),
    click = vi.fn(),
    key = vi.fn(),
    pointer = vi.fn();
  await act(async () =>
    root.render(
      createElement(MenuRow, {
        ref,
        role: "menuitem",
        "aria-haspopup": "menu",
        "aria-expanded": true,
        branchWidth: 260,
        destructive: true,
        onClick: click,
        onKeyDown: key,
        onPointerMove: pointer,
        children: "Delete group",
      }),
    ),
  );
  expect(ref.current?.tagName).toBe("BUTTON");
  expect(ref.current?.getAttribute("aria-haspopup")).toBe("menu");
  expect(ref.current?.dataset.branchSide).toBe("right");
  await act(async () => {
    ref.current!.click();
    ref.current!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    ref.current!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
  });
  expect(click).toHaveBeenCalledOnce();
  expect(key).toHaveBeenCalledOnce();
  expect(pointer).toHaveBeenCalledOnce();
  expect(typeof menuRowClassName).toBe("string");
});
it("keeps disabled native rows discoverable without executing them", async () => {
  const pick = vi.fn();
  await act(async () =>
    root.render(
      createElement(MenuRow, {
        disabled: true,
        onClick: pick,
        title: "Save before transfer",
        children: "Copy to machine",
      }),
    ),
  );
  const row = host.querySelector("button")!;
  expect(row.disabled).toBe(true);
  await act(async () => row.click());
  expect(pick).not.toHaveBeenCalled();
  expect(row.title).toBe("Save before transfer");
});
