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

it("keeps the real number of a capped count and names context through label", async () => {
  const capped = await render(createElement(Badge, { variant: "count", max: 9 }, 128));
  try {
    expect(capped.container.textContent).toBe("9+");
    expect(capped.container.firstElementChild?.getAttribute("aria-label")).toBe("128");
  } finally {
    capped.done();
  }
  const named = await render(createElement(Badge, { variant: "count", label: "12 unread" }, 12));
  try {
    expect(named.container.firstElementChild?.getAttribute("aria-label")).toBe("12 unread");
  } finally {
    named.done();
  }
});

it("treats a dot without text or name as decoration, never as a colour-only status", async () => {
  const bare = await render(createElement(Badge, { variant: "dot", tone: "danger" }));
  try {
    const badge = bare.container.firstElementChild!;
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.getAttribute("role")).toBeNull();
  } finally {
    bare.done();
  }
  const labelled = await render(createElement(Badge, { variant: "dot", tone: "danger" }, "Failed"));
  try {
    expect(labelled.container.firstElementChild?.getAttribute("aria-hidden")).toBeNull();
    expect(labelled.container.textContent).toBe("Failed");
  } finally {
    labelled.done();
  }
});
