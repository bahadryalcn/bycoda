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

it("labels the three kinds and announces only the ones that change under the user", async () => {
  const expected = { empty: null, filtered: "status", unavailable: "alert" } as const;
  for (const kind of ["empty", "filtered", "unavailable"] as const) {
    const { container, done } = await mount(
      createElement(EmptyState, { kind, description: "Nothing" }),
    );
    try {
      const section = container.querySelector("section")!;
      expect(section.getAttribute("data-kind")).toBe(kind);
      expect(section.getAttribute("role")).toBe(expected[kind]);
    } finally {
      done();
    }
  }
});

it("lets the caller override the implied role", async () => {
  const { container, done } = await mount(
    createElement(EmptyState, { kind: "unavailable", role: "status", description: "Offline" }),
  );
  try {
    expect(container.querySelector("section")?.getAttribute("role")).toBe("status");
  } finally {
    done();
  }
});

it("offers a reset action for a filtered state after the caller's own action", async () => {
  const onReset = vi.fn();
  const { container, done } = await mount(
    createElement(EmptyState, {
      kind: "filtered",
      description: "No match",
      action: createElement("button", null, "Create"),
      onReset,
    }),
  );
  try {
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Create", "Reset filters"]);
    await act(async () => buttons[1]!.click());
    expect(onReset).toHaveBeenCalledTimes(1);
  } finally {
    done();
  }
});

it("uses the caller's reset and retry labels and shows no actions when none are given", async () => {
  const labelled = await mount(
    createElement(EmptyState, {
      kind: "unavailable",
      description: "Offline",
      onReset: () => undefined,
      resetLabel: "Clear search",
      onRetry: () => undefined,
      retryLabel: "Refresh",
    }),
  );
  try {
    expect([...labelled.container.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Clear search",
      "Refresh",
    ]);
  } finally {
    labelled.done();
  }
  const bare = await mount(createElement(EmptyState, { kind: "empty", description: "Nothing" }));
  try {
    expect(bare.container.querySelector("button")).toBeNull();
    expect(bare.container.querySelector("[class*='action']")).toBeNull();
  } finally {
    bare.done();
  }
});

it("blocks a second retry press while the retry is pending", async () => {
  const onRetry = vi.fn();
  const { container, done } = await mount(
    createElement(EmptyState, {
      kind: "unavailable",
      description: "Offline",
      onRetry,
      retrying: true,
    }),
  );
  try {
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-busy") === "true" || button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onRetry).not.toHaveBeenCalled();
  } finally {
    done();
  }
});

it("picks a kind-specific default icon and still honors an explicit icon or null", async () => {
  const icon = async (props: Record<string, unknown>) => {
    const mounted = await mount(createElement(EmptyState, { description: "x", ...props }));
    try {
      return mounted.container.querySelector("svg")?.getAttribute("class") ?? null;
    } finally {
      mounted.done();
    }
  };
  const empty = await icon({ kind: "empty" });
  const filtered = await icon({ kind: "filtered" });
  const unavailable = await icon({ kind: "unavailable" });
  expect(new Set([empty, filtered, unavailable]).size).toBe(3);
  expect(await icon({ kind: "unavailable", icon: null })).toBeNull();
  expect(
    await icon({ kind: "filtered", icon: createElement("svg", { className: "custom" }) }),
  ).toBe("custom");
});
