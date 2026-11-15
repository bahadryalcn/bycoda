// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Alert } from "./Alert";

it("forwards the actual error surface ref so recovery can focus it without replacing native attributes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLDivElement>();
  try {
    await act(async () =>
      root.render(
        createElement(
          Alert,
          { ref, tone: "danger", tabIndex: -1, "aria-label": "Operation failed" },
          "Retry available",
        ),
      ),
    );
    const surface = ref.current!;
    expect(surface.getAttribute("role")).toBe("alert");
    surface.focus();
    expect(document.activeElement).toBe(surface);
    await act(async () =>
      root.render(
        createElement(
          Alert,
          { ref, tone: "danger", tabIndex: -1, "aria-label": "Operation failed" },
          "Retry failed again",
        ),
      ),
    );
    expect(ref.current).toBe(surface);
    expect(document.activeElement).toBe(surface);
    expect(surface.textContent).toContain("Retry failed again");
  } finally {
    await act(async () => root.unmount());
    expect(ref.current).toBeNull();
    container.remove();
    vi.unstubAllGlobals();
  }
});

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

it("renders structured actions after the copy as secondary buttons and keeps dismiss in its own slot", async () => {
  const onDismiss = vi.fn();
  const onRetry = vi.fn();
  const onOther = vi.fn();
  const { container, done } = await mount(
    createElement(Alert, {
      open: true,
      onDismiss,
      children: "Remote machine stopped 1 conversation.",
      action: { label: "Retry", onClick: onRetry },
      secondaryAction: { label: "Open", onClick: onOther },
    }),
  );
  try {
    const surface = container.querySelector('[role="status"]')!;
    const dismiss = surface.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!;
    const labels = [...surface.querySelectorAll("button:not([aria-label])")].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["Retry", "Open"]);
    expect(dismiss.closest("div > span")?.parentElement).toBe(surface);
    act(() => surface.querySelector<HTMLButtonElement>("button:not([aria-label])")!.click());
    act(() => dismiss.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    done();
  }
});

it("shows pending and disabled action state and renders one non-button extra control", async () => {
  const { container, done } = await mount(
    createElement(Alert, {
      tone: "danger",
      action: { label: "Retry", onClick: () => undefined, pending: true },
      extra: createElement("a", { href: "#details" }, "Details"),
      children: "Failed",
    }),
  );
  try {
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-busy") === "true" || button.disabled).toBe(true);
    expect(container.querySelector("a")?.textContent).toBe("Details");
  } finally {
    done();
  }
});

it("centres the glyph in a first-line box for one-line, wrapped and titled copy alike", async () => {
  const shapes = [
    createElement(Alert, { tone: "info" }, "One line"),
    createElement(Alert, { tone: "info" }, "A much longer message ".repeat(20)),
    createElement(Alert, { tone: "info", title: "Title" }, "Body"),
  ];
  const boxes: string[] = [];
  for (const node of shapes) {
    const { container, done } = await mount(node);
    try {
      const box = container.querySelector("svg")!.parentElement!.parentElement!;
      boxes.push(box.className);
      expect(box.className).toContain("h-(--ui-leading-secondary)");
      expect(box.className).toContain("items-center");
    } finally {
      done();
    }
  }
  expect(new Set(boxes).size).toBe(1);
});

it("gives every tone its own glyph, announces danger assertively and others politely", async () => {
  const glyphs = new Set<string>();
  for (const tone of ["info", "success", "warning", "danger"] as const) {
    const { container, done } = await mount(createElement(Alert, { tone, title: "Title" }, "Body"));
    try {
      const surface = container.firstElementChild!;
      expect(surface.getAttribute("role")).toBe(tone === "danger" ? "alert" : "status");
      glyphs.add(surface.querySelector("svg")!.innerHTML);
    } finally {
      done();
    }
  }
  expect(glyphs.size).toBe(4);
});

it("renders title above description and the action slot after them", async () => {
  const onRetry = vi.fn();
  const { container, done } = await mount(
    createElement(
      Alert,
      {
        tone: "danger",
        title: "Could not save",
        action: { label: "Retry", onClick: onRetry },
      },
      "The disk is full",
    ),
  );
  try {
    const text = container.textContent ?? "";
    expect(text.indexOf("Could not save")).toBeLessThan(text.indexOf("The disk is full"));
    expect(text.indexOf("The disk is full")).toBeLessThan(text.indexOf("Retry"));
    act(() => container.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  } finally {
    done();
  }
});

it("names the dismiss control with the title, or by default without one", async () => {
  const titled = await mount(
    createElement(Alert, { tone: "info", title: "Update", onDismiss: vi.fn() }, "Ready"),
  );
  try {
    expect(titled.container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Dismiss: Update",
    );
  } finally {
    titled.done();
  }
  const bare = await mount(createElement(Alert, { tone: "info", onDismiss: vi.fn() }, "Ready"));
  try {
    expect(bare.container.querySelector("button")?.getAttribute("aria-label")).toBe("Dismiss");
  } finally {
    bare.done();
  }
});
