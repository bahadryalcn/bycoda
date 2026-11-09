// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BadgeList, fitBadgeCount, type BadgeListItem } from "./BadgeList";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const items = (names: string[]): BadgeListItem[] =>
  names.map((name) => ({ id: name, label: name }));
const names = ["Ada", "Grace", "Linus", "Margaret", "Dennis"];
const render = (props: Partial<Parameters<typeof BadgeList>[0]> & { items: BadgeListItem[] }) =>
  act(async () => root.render(createElement(BadgeList, { label: "Specialists", ...props })));
const list = () => host.querySelector<HTMLElement>('ul[aria-label="Specialists"]');
const more = () => list()?.querySelector<HTMLButtonElement>("button") ?? null;
const card = () => document.querySelector<HTMLElement>('[role="dialog"]');

it("renders nothing without items", async () => {
  await render({ items: [] });
  expect(host.innerHTML).toBe("");
});

it("shows every badge and no trigger when max covers all items", async () => {
  await render({ items: items(names), max: 5 });
  expect(list()?.querySelectorAll(":scope > li")).toHaveLength(5);
  expect(more()).toBeNull();
});

it("collapses the rest into a +N trigger named with its list", async () => {
  await render({ items: items(names), max: 2 });
  expect(list()?.querySelectorAll(":scope > li")).toHaveLength(3);
  expect(list()?.textContent).toContain("Ada");
  expect(list()?.textContent).not.toContain("Linus");
  const trigger = more()!;
  expect(trigger.textContent).toBe("+3");
  expect(trigger.getAttribute("aria-label")).toBe("3 more");
  // The name reads "Specialists 3 more": the list's own name, then the button's.
  expect(trigger.getAttribute("aria-labelledby")?.split(" ")).toEqual([list()!.id, trigger.id]);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("falls back to showing all items where there is no layout", async () => {
  await render({ items: items(names), max: "fit" });
  expect(list()?.querySelectorAll(":scope > li")).toHaveLength(5);
  expect(more()).toBeNull();
});

it("pins the hidden items open from the keyboard and closes them with Escape", async () => {
  await render({ items: items(names), max: 2 });
  await act(async () => more()!.click());
  expect(more()!.getAttribute("aria-expanded")).toBe("true");
  expect(card()?.getAttribute("aria-label")).toBe("Specialists");
  expect(card()?.textContent).toContain("Linus");
  expect(card()?.textContent).toContain("Dennis");
  expect(card()?.textContent).not.toContain("Ada");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(card()).toBeNull();
  expect(more()!.getAttribute("aria-expanded")).toBe("false");
});

it("packs whole badges into the available lines and reserves the trigger", () => {
  const widths = [60, 60, 60, 60];
  // 100px line: 60 + gap 4 + trigger 30 fits one badge.
  expect(fitBadgeCount(widths, 30, 100, 4, 1)).toBe(1);
  // Everything fits on one line without a trigger.
  expect(fitBadgeCount([20, 20, 20], 30, 100, 4, 1)).toBe(3);
  // Two lines hold three badges plus the trigger.
  expect(fitBadgeCount([...widths, 60], 30, 130, 4, 2)).toBe(3);
  // A label wider than its line truncates and still leaves room for the trigger.
  expect(fitBadgeCount([400, 60], 30, 100, 4, 1)).toBe(1);
});
