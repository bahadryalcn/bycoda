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
        action: { label: "Clear", onClick: () => undefined },
      }),
    );
    try {
      const section = container.querySelector("section")!;
      expect(section.getAttribute("data-context")).toBe(context);
      expect(section.getAttribute("aria-label")).toBe("Sessions");
      expect(section.classList.contains("bycoda-arc")).toBe(true);
      expect(section.querySelector("h3")?.textContent).toBe("No sessions");
      expect(section.querySelector('button[aria-label="Help"]')).not.toBeNull();
      expect(section.querySelector("button:not([aria-label])")?.textContent).toBe("Clear");
    } finally {
      done();
    }
  },
);

it("draws a glyph only when one is passed (no default folder)", async () => {
  const none = await mount(createElement(EmptyState, { description: "Empty" }));
  try {
    expect(none.container.querySelector("svg")).toBeNull();
  } finally {
    none.done();
  }
  const given = await mount(
    createElement(EmptyState, {
      description: "Empty",
      icon: createElement("svg", { "data-testid": "glyph" }),
    }),
  );
  try {
    expect(given.container.querySelector("svg")).not.toBeNull();
  } finally {
    given.done();
  }
});

it("maps inset to the Surface padding scale for block and inline states", async () => {
  for (const size of ["block", "inline"] as const) {
    const row = await mount(
      createElement(EmptyState, { size, description: "Empty", inset: "row" }),
    );
    const panel = await mount(
      createElement(EmptyState, { size, description: "Empty", inset: "panel" }),
    );
    const none = await mount(createElement(EmptyState, { size, description: "Empty" }));
    try {
      expect(row.container.firstElementChild?.className).toContain("px-3 py-2");
      expect(panel.container.firstElementChild?.className).toContain("px-4 py-3");
      expect(none.container.firstElementChild?.className).not.toMatch(/\bpx-\d/);
    } finally {
      row.done();
      panel.done();
      none.done();
    }
  }
});

it("labels the kinds and announces only the one that changes under the user", async () => {
  const expected = { empty: null, filtered: "status" } as const;
  for (const kind of ["empty", "filtered"] as const) {
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
    createElement(EmptyState, { kind: "filtered", role: "alert", description: "Offline" }),
  );
  try {
    expect(container.querySelector("section")?.getAttribute("role")).toBe("alert");
  } finally {
    done();
  }
});

it("tucks a titled description behind the info affordance unless it states scope", async () => {
  const tucked = await mount(
    createElement(EmptyState, { kind: "empty", title: "No crews", description: "Create a crew." }),
  );
  try {
    expect(tucked.container.querySelector("p")).toBeNull();
    expect(tucked.container.querySelector('button[aria-label="Help"]')).not.toBeNull();
  } finally {
    tucked.done();
  }
  for (const props of [{ showDescription: true }, { kind: "filtered" as const }]) {
    const shown = await mount(
      createElement(EmptyState, { title: "No crews", description: "Create a crew.", ...props }),
    );
    try {
      expect(shown.container.querySelector("p")?.textContent).toBe("Create a crew.");
      expect(shown.container.querySelector('button[aria-label="Help"]')).toBeNull();
    } finally {
      shown.done();
    }
  }
  const untitled = await mount(createElement(EmptyState, { description: "Nothing here" }));
  try {
    expect(untitled.container.querySelector("p")?.textContent).toBe("Nothing here");
  } finally {
    untitled.done();
  }
});

it("renders structured actions as secondary buttons in a block and links in a row", async () => {
  const onClick = vi.fn();
  const block = await mount(
    createElement(EmptyState, {
      description: "None",
      action: { label: "Create", onClick },
      secondaryAction: { label: "Browse", onClick: () => undefined },
    }),
  );
  try {
    expect([...block.container.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Create",
      "Browse",
    ]);
    act(() => block.container.querySelector("button")!.click());
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    block.done();
  }
  const row = await mount(
    createElement(EmptyState, {
      size: "inline",
      description: "None",
      action: { label: "Create", onClick },
    }),
  );
  try {
    expect(row.container.querySelector("button")?.textContent).toBe("Create");
  } finally {
    row.done();
  }
});

it("offers a reset action for a filtered state after the caller's own action", async () => {
  const onReset = vi.fn();
  const { container, done } = await mount(
    createElement(EmptyState, {
      kind: "filtered",
      description: "No match",
      action: { label: "Create", onClick: () => undefined },
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
      kind: "filtered",
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
      kind: "empty",
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
  expect(empty).not.toBe(filtered);
  expect(await icon({ kind: "empty", icon: null })).toBeNull();
  expect(
    await icon({ kind: "filtered", icon: createElement("svg", { className: "custom" }) }),
  ).toBe("custom");
});
