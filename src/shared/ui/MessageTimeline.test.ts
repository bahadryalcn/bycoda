// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { MessageTimeline, messageDayLabel } from "./MessageTimeline";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
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
