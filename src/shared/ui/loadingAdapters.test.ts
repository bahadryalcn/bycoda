// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Progress } from "./Progress";
import { Skeleton } from "./Skeleton";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("distinguishes unknown progress from zero and bounds accessible values", async () => {
  await act(async () => root.render(createElement(Progress, { label: "Preparing request" })));
  const bar = node.querySelector('[role="progressbar"]')!;
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(bar.hasAttribute("aria-valuetext")).toBe(false);
  await act(async () =>
    root.render(createElement(Progress, { value: 0, max: 20, label: "Sending request" })),
  );
  expect(bar.getAttribute("aria-valuenow")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("20");
  await act(async () =>
    root.render(
      createElement(Progress, {
        value: 70,
        max: 20,
        "aria-label": "Quota remaining",
        tone: "danger",
      }),
    ),
  );
  expect(bar.getAttribute("aria-valuenow")).toBe("20");
  expect(bar.getAttribute("aria-label")).toBe("Quota remaining");
  expect(bar.getAttribute("data-tone")).toBe("danger");
  await act(async () =>
    root.render(createElement(Progress, { value: Number.NaN, max: Number.NaN, label: "Waiting" })),
  );
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(bar.getAttribute("aria-valuemax")).toBe("100");
});
it("reveals real content and clears busy state when loading completes", async () => {
  await act(async () =>
    root.render(
      createElement(
        Skeleton,
        { label: "Loading records", loading: true },
        createElement("button", null, "Retry records"),
      ),
    ),
  );
  expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading records");
  expect(node.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(node.querySelector("button")).toBeNull();
  await act(async () =>
    root.render(
      createElement(
        Skeleton,
        { label: "Loading records", loading: false },
        createElement("button", null, "Retry records"),
      ),
    ),
  );
  await vi.waitFor(() => expect(node.querySelector("button")?.textContent).toBe("Retry records"));
  expect(node.querySelector('[aria-busy="true"]')).toBeNull();
});

it("keeps inline quota labels readable at zero and full capacity without a completion check", async () => {
  for (const value of [0, 100]) {
    await act(async () =>
      root.render(
        createElement(Progress, {
          value,
          showValue: true,
          valuePlacement: "inside",
          valueLabel: `${value}% remaining`,
          "aria-label": "Weekly remaining",
        }),
      ),
    );
    const bar = node.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe(String(value));
    expect(bar.getAttribute("data-value-inside")).toBe("true");
    expect(bar.textContent).toContain(`${value}% remaining`);
    expect(bar.querySelector("svg")).toBeNull();
  }
});
