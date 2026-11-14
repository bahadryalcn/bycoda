// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Tab, TabList, Tabs, TabStrip } from "./Tabs";

let root: Root;
let host: HTMLDivElement;

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

it("keeps icon-only view navigation labelled and keyboard selectable", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(TabStrip, {
        label: "Document view",
        value: "preview",
        onValueChange,
        items: [
          { value: "preview", label: "Preview", iconOnly: true, icon: createElement("svg") },
          { value: "source", label: "Source", iconOnly: true, icon: createElement("svg") },
        ],
      }),
    ),
  );
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const reveal = vi.spyOn(tabs[1], "scrollIntoView");
  expect(tabs[0].getAttribute("aria-label")).toBe("Preview");
  expect(tabs[0].querySelector("svg")).not.toBeNull();
  expect(tabs[0].textContent).toBe("");
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(onValueChange).toHaveBeenLastCalledWith("source");
  expect(document.activeElement).toBe(tabs[1]);
  expect(reveal).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" });
});

function rail(onValueChange: (v: string) => void, onKeyDown?: (e: unknown) => void) {
  return act(async () =>
    root.render(
      createElement(
        Tabs,
        { value: "a", onValueChange, orientation: "vertical", variant: "tab", panels: "none" },
        createElement(
          TabList,
          { label: "Providers" },
          ["a", "b", "c"].map((v) =>
            createElement(
              Tab,
              { key: v, value: v, iconOnly: true, label: `Provider ${v}`, onKeyDown },
              createElement("svg"),
            ),
          ),
        ),
      ),
    ),
  );
}

const key = (el: Element, init: KeyboardEventInit) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

it("renders an icon-only vertical rail with accessible names and one tab stop", async () => {
  await rail(() => {});
  const list = host.querySelector('[role="tablist"]')!;
  expect(list.getAttribute("aria-orientation")).toBe("vertical");
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
    "Provider a",
    "Provider b",
    "Provider c",
  ]);
  expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
});

it("moves with Up/Down and selects, but leaves Alt+Arrow to the caller", async () => {
  const picked: string[] = [];
  await rail((v) => picked.push(v));
  const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  await key(tabs[0], { key: "ArrowDown" });
  expect(picked).toEqual(["b"]);
  expect(document.activeElement).toBe(tabs[1]);
  await key(tabs[0], { key: "ArrowDown", altKey: true });
  expect(picked).toEqual(["b"]);
});
