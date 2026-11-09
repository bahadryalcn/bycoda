// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportPanel, type ReportPanelProps } from "./ReportPanel";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(props: Partial<ReportPanelProps> = {}) {
  const onLoad = vi.fn();
  act(() =>
    root.render(createElement(ReportPanel, { report: undefined, busy: false, onLoad, ...props })),
  );
  return onLoad;
}

const create = () =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Create report");
const period = (label: string) =>
  [...element.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (node) => node.textContent?.trim() === label,
  );
const titles = () =>
  [...element.querySelectorAll(".command-report-title")].map((n) => n.textContent);

it("shows no report body before one is created", () => {
  render();
  expect(element.querySelector(".command-report-body")).toBeNull();
  expect(period("Day")?.getAttribute("aria-checked")).toBe("true");
});

it("asks for the day report by default and the week report after switching", () => {
  const onLoad = render();
  act(() => create()?.click());
  expect(onLoad).toHaveBeenLastCalledWith("day");
  act(() => period("Week")?.click());
  expect(period("Week")?.getAttribute("aria-checked")).toBe("true");
  act(() => create()?.click());
  expect(onLoad).toHaveBeenLastCalledWith("week");
  expect(onLoad).toHaveBeenCalledTimes(2);
});

it("lists what was done, the results and the suggestions", () => {
  render({
    report: {
      period: "day",
      data: {
        done: ["Replied to 3 comments"],
        results: ["2 replies got an answer"],
        suggestions: ["Pin the launch post"],
      },
    },
  });
  expect(titles()).toEqual(["Done", "Results", "Suggestions"]);
  expect(element.textContent).toContain("Replied to 3 comments");
  expect(element.textContent).toContain("2 replies got an answer");
  expect(element.textContent).toContain("Pin the launch post");
  expect(element.textContent).not.toContain("No AI activity in this period.");
});

it("says so when a period had no AI activity, and still shows suggestions", () => {
  render({
    report: {
      period: "week",
      data: { done: [], results: [], suggestions: ["Connect an account"] },
    },
  });
  expect(element.textContent).toContain("No AI activity in this period.");
  expect(titles()).toEqual(["Suggestions"]);
});

it("blocks a second request while a report is being created", () => {
  const onLoad = render({ busy: true });
  expect(create()?.getAttribute("aria-busy")).toBe("true");
  act(() => create()?.click());
  expect(onLoad).not.toHaveBeenCalled();
});
