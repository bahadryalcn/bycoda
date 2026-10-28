// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

async function mount(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    done: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("defaults to the page context so existing callers keep their presentation", async () => {
  const { container, done } = await mount(
    createElement(EmptyState, { description: "Nothing here" }),
  );
  try {
    expect(container.querySelector("section")?.getAttribute("data-context")).toBe("page");
  } finally {
    done();
  }
});

it.each(["panel", "list"] as const)(
  "applies the %s context through the same adapter",
  async (context) => {
    const { container, done } = await mount(
      createElement(EmptyState, {
        context,
        title: "No sessions",
        description: "Clear the filters",
        label: "Sessions",
        action: createElement("button", null, "Clear"),
      }),
    );
    try {
      const section = container.querySelector("section")!;
      expect(section.getAttribute("data-context")).toBe(context);
      expect(section.getAttribute("aria-label")).toBe("Sessions");
      expect(section.classList.contains("bycoda-arc")).toBe(true);
      expect(section.querySelector("h3")?.textContent).toBe("No sessions");
      expect(section.querySelector("button")?.textContent).toBe("Clear");
    } finally {
      done();
    }
  },
);

it("keeps the icon optional: a null icon renders none and an omitted one renders the default", async () => {
  const none = await mount(createElement(EmptyState, { description: "Empty", icon: null }));
  try {
    expect(none.container.querySelector("svg")).toBeNull();
  } finally {
    none.done();
  }
  const fallback = await mount(createElement(EmptyState, { description: "Empty" }));
  try {
    expect(fallback.container.querySelector("svg")).not.toBeNull();
  } finally {
    fallback.done();
  }
});
