// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Alert } from "./Alert";
import { InlineMessage } from "./InlineError";

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

it("renders the inline form with its tone icon and message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(Alert, { tone: "warning", inline: true }, "Disk almost full")),
    );
    const surface = container.querySelector('[role="status"]')!;
    expect(surface.textContent).toContain("Disk almost full");
    expect(surface.querySelector("svg")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("uses InlineMessage presentation for legacy inline alerts", async () => {
  const { container, done } = await mount(
    createElement(
      "div",
      null,
      createElement(Alert, { tone: "warning", inline: true }, "Disk almost full"),
      createElement(InlineMessage, { tone: "warning", children: "Disk almost full" }),
    ),
  );
  try {
    const inline = container.querySelector('[data-tone="warning"]')!;
    const direct = container.querySelectorAll('[data-tone="warning"]')[1];
    expect(inline.className).toBe(direct.className);
    expect(inline.querySelector("svg")?.outerHTML).toBe(direct.querySelector("svg")?.outerHTML);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  } finally {
    done();
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
        action: createElement("button", { onClick: onRetry }, "Retry"),
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
