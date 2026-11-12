// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Tab, TabList, Tabs } from "./Tabs";
import { TabLabel } from "./TabLabel";

async function mount(node: ReactElement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    done: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

/** Attributes and class names of an element, for "renders as before" comparisons. */
const shape = (element: Element) =>
  JSON.stringify({
    attributes: element.getAttributeNames().sort(),
    className: element.className,
  });

const ROLE_ATTRIBUTES = ["data-truncate", "data-leading", "data-size", "data-tone"];

it("renders a Button without label roles exactly as before", async () => {
  const plain = await mount(createElement(Button, { variant: "tab", motion: "none" }, "Label"));
  const off = await mount(
    createElement(Button, { variant: "tab", motion: "none", truncate: false }, "Label"),
  );
  try {
    const button = plain.container.querySelector("button")!;
    for (const name of ROLE_ATTRIBUTES) expect(button.hasAttribute(name)).toBe(false);
    expect(shape(off.container.querySelector("button")!)).toBe(shape(button));
  } finally {
    await off.done();
    await plain.done();
  }
});

it("truncates a Button on the control itself", async () => {
  const { container, done } = await mount(
    createElement(Button, { truncate: true, tooltipWhen: "overflow", tooltip: "Long" }, "Label"),
  );
  try {
    const button = container.querySelector("button")!;
    expect(button.hasAttribute("data-truncate")).toBe(true);
    expect(button.hasAttribute("data-leading")).toBe(false);
    expect(button.className).toContain("text");
  } finally {
    await done();
  }
});

it("sets the line height of a Button without truncating it", async () => {
  const { container, done } = await mount(createElement(Button, { leading: "none" }, "Label"));
  try {
    const button = container.querySelector("button")!;
    expect(button.getAttribute("data-leading")).toBe("none");
    expect(button.hasAttribute("data-truncate")).toBe(false);
  } finally {
    await done();
  }
});

it("renders a Badge without label roles exactly as before", async () => {
  const plain = await mount(createElement(Badge, { tone: "info" }, "Label"));
  const off = await mount(createElement(Badge, { tone: "info", truncate: false }, "Label"));
  try {
    const badge = plain.container.firstElementChild!;
    expect(badge.hasAttribute("data-leading")).toBe(false);
    expect(badge.querySelector("[data-truncate]")).toBeNull();
    expect(plain.container.innerHTML).toBe(off.container.innerHTML);
  } finally {
    await off.done();
    await plain.done();
  }
});

it("truncates the text of a Badge and keeps the badge attributes", async () => {
  const { container, done } = await mount(
    createElement(Badge, { tone: "info", truncate: true }, "Organisation"),
  );
  try {
    const badge = container.firstElementChild!;
    const text = badge.querySelector("[data-truncate]")!;
    expect(text.textContent).toBe("Organisation");
    expect(badge.textContent).toBe("Organisation");
    expect(badge.getAttribute("data-tone")).toBe("info");
    expect(badge.hasAttribute("data-truncate")).toBe(false);
  } finally {
    await done();
  }
});

it("never truncates a capped count", async () => {
  const { container, done } = await mount(
    createElement(Badge, { variant: "count", truncate: true }, 120),
  );
  try {
    expect(container.querySelector("[data-truncate]")).toBeNull();
    expect(container.textContent).toBe("99+");
  } finally {
    await done();
  }
});

it("sets the line height of a Badge on the badge", async () => {
  const { container, done } = await mount(
    createElement(Badge, { leading: "none", size: "xs" }, "Label"),
  );
  try {
    const badge = container.firstElementChild!;
    expect(badge.getAttribute("data-leading")).toBe("none");
    expect(badge.getAttribute("data-size")).toBe("xs");
    expect(badge.querySelector("[data-truncate]")).toBeNull();
  } finally {
    await done();
  }
});

const strip = (tab: object, list: object = {}) =>
  createElement(
    Tabs,
    { value: "a", onValueChange: () => {}, panels: "none", children: null },
    createElement(
      TabList,
      { label: "Views", ...list },
      createElement(Tab, { value: "a", ...tab }, "Alpha"),
    ),
  );

it("renders a Tab and TabList without label roles exactly as before", async () => {
  const { container, done } = await mount(strip({}));
  try {
    const list = container.querySelector('[role="tablist"]')!;
    const tab = container.querySelector('[role="tab"]')!;
    expect(list.hasAttribute("data-scrollbar")).toBe(false);
    for (const name of ROLE_ATTRIBUTES) expect(tab.hasAttribute(name)).toBe(false);
  } finally {
    await done();
  }
});

it("clips a Tab on the tab element that tooltipWhen measures, and sets its line height", async () => {
  const { container, done } = await mount(
    strip({ truncate: true, leading: "tight", tooltipWhen: "overflow", tooltip: "Alpha view" }),
  );
  try {
    const tab = container.querySelector('[role="tab"]')!;
    expect(tab.hasAttribute("data-truncate")).toBe(true);
    expect(tab.getAttribute("data-leading")).toBe("tight");
    expect(tab.hasAttribute("data-tooltip-owner")).toBe(true);
  } finally {
    await done();
  }
});

it("hides the scrollbar of a TabList", async () => {
  const { container, done } = await mount(strip({}, { scrollbar: "hidden" }));
  try {
    expect(container.querySelector('[role="tablist"]')!.getAttribute("data-scrollbar")).toBe(
      "hidden",
    );
  } finally {
    await done();
  }
});

it("renders a TabLabel without a leading exactly as before and applies one on request", async () => {
  const plain = await mount(createElement(TabLabel, { children: "Name" }));
  const led = await mount(createElement(TabLabel, { leading: "tight", children: "Name" }));
  try {
    const span = plain.container.querySelector("span")!;
    expect(span.hasAttribute("data-leading")).toBe(false);
    expect(span.hasAttribute("data-size")).toBe(false);
    expect(led.container.querySelector("span")!.getAttribute("data-leading")).toBe("tight");
  } finally {
    await led.done();
    await plain.done();
  }
});
