// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MessageTimeline, messageDayLabel } from "./MessageTimeline";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

const at = (day: number, hour: number) => new Date(2026, 4, day, hour, 0).getTime();

it("labels today and yesterday and falls back to a date", () => {
  const now = at(10, 15);
  expect(messageDayLabel(at(10, 1), now, (key) => key, "en")).toBe("Today");
  expect(messageDayLabel(at(9, 23), now, (key) => key, "en")).toBe("Yesterday");
  expect(messageDayLabel(at(2, 12), now, (key) => key, "en")).toContain("2");
});

it("starts a day separator on each new local day and marks the owner's messages", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const item = (id: string, time: number, own = false) => ({
    id,
    time,
    own,
    body: id,
  });
  await act(async () =>
    root!.render(
      createElement(MessageTimeline, {
        label: "Messages",
        items: [item("a", at(1, 9)), item("b", at(1, 23), true), item("c", at(2, 0))],
      }),
    ),
  );
  expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-own="true"]')).toHaveLength(1);
  expect(container.textContent).not.toContain("You");
});

function mockLayout() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : this.hasAttribute("data-timeline-day") ? 24 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
}

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    time: at(1, 9),
    body: `Message ${index}`,
  }));

async function renderInScroller(count: number, windowed: boolean) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(
        "div",
        { style: { overflowY: "auto" } },
        createElement(MessageTimeline, { label: "Messages", items: many(count), windowed }),
      ),
    ),
  );
}

it("mounts only the rows near the viewport of a long windowed list", async () => {
  mockLayout();
  await renderInScroller(300, true);
  const rows = container.querySelectorAll("li[data-message-id]");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(60);
  expect(rows[0].getAttribute("data-message-id")).toBe("m0");
  expect(rows[0].getAttribute("aria-posinset")).toBe("1");
  expect(rows[0].getAttribute("aria-setsize")).toBe("300");
  const list = container.querySelector("ol")!;
  expect(parseFloat(list.style.paddingBlockEnd)).toBeGreaterThan(0);
  vi.restoreAllMocks();
});

it("renders every row of a short or unwindowed list", async () => {
  mockLayout();
  await renderInScroller(40, true);
  expect(container.querySelectorAll("li[data-message-id]")).toHaveLength(40);
  expect(container.querySelector("li[aria-setsize]")).toBeNull();
  await act(async () => root?.unmount());
  container.remove();
  await renderInScroller(300, false);
  expect(container.querySelectorAll("li[data-message-id]")).toHaveLength(300);
  vi.restoreAllMocks();
});
