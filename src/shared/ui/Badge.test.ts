// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Badge } from "./Badge";

async function render(node: ReturnType<typeof createElement>) {
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

it("names a text-less status dot for assistive technology", async () => {
  const { container, done } = await render(
    createElement(Badge, { variant: "dot", tone: "success", label: "Online" }),
  );
  try {
    const badge = container.querySelector('[role="img"]')!;
    expect(badge.getAttribute("aria-label")).toBe("Online");
  } finally {
    done();
  }
});

it("caps a count above max", async () => {
  const { container, done } = await render(
    createElement(Badge, { variant: "count", max: 99 }, 120),
  );
  try {
    expect(container.textContent).toBe("99+");
  } finally {
    done();
  }
});
