// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InlineError, InlineMessage } from "./InlineError";

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

it("puts the glyph in a first-line box and keeps copy neutral for every non-danger tone", async () => {
  for (const tone of ["info", "success", "warning", "neutral"] as const) {
    const { container, done } = await mount(
      createElement(InlineMessage, { tone, children: "Saved" }),
    );
    try {
      const root = container.firstElementChild!;
      const box = root.querySelector("svg")!.parentElement!.parentElement!;
      expect(box.className).toContain("h-(--ui-leading-caption)");
      expect(box.className).toContain("items-center");
      expect(root.className).toContain("text-(--ui-text-secondary)");
      expect(root.className).not.toContain("--ui-tone-");
    } finally {
      done();
    }
  }
});

it("lets only the danger sentence tint", async () => {
  const { container, done } = await mount(createElement(InlineError, null, "Failed"));
  try {
    expect(container.firstElementChild!.className).toContain("text-(--ui-tone-danger-fg)");
    expect(container.firstElementChild!.getAttribute("role")).toBe("alert");
  } finally {
    done();
  }
});

it("renders structured actions as text links after the copy, in order", async () => {
  const onClick = vi.fn();
  const onOther = vi.fn();
  const { container, done } = await mount(
    createElement(InlineMessage, {
      tone: "info",
      action: { label: "Add models", onClick },
      secondaryAction: { label: "Dismiss", onClick: onOther },
      retry: { onRetry: () => undefined, label: "Retry" },
      children: "Model order is empty.",
    }),
  );
  try {
    const text = container.textContent ?? "";
    expect(text.indexOf("Model order is empty.")).toBeLessThan(text.indexOf("Add models"));
    expect(text.indexOf("Add models")).toBeLessThan(text.indexOf("Dismiss"));
    expect(text.indexOf("Dismiss")).toBeLessThan(text.indexOf("Retry"));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(3);
    // Text links sit in the copy span, never as a separate sized control beside it.
    for (const button of buttons) expect(button.closest("span.min-w-0")).not.toBeNull();
    act(() => buttons[0]!.click());
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    done();
  }
});

it("blocks a pending action and shows details behind a link only when needed", async () => {
  const pending = await mount(
    createElement(
      InlineError,
      { action: { label: "Retry", onClick: () => undefined, pending: true } },
      "Failed",
    ),
  );
  try {
    const button = pending.container.querySelector("button")!;
    expect(button.getAttribute("aria-busy") === "true" || button.disabled).toBe(true);
  } finally {
    pending.done();
  }
  const short = await mount(createElement(InlineError, { details: "Port in use" }));
  try {
    expect(short.container.textContent).toBe("Port in use");
    expect(short.container.querySelector("button")).toBeNull();
  } finally {
    short.done();
  }
});

it("re-inks copy and glyph with the overlay ink on a dark scrim", async () => {
  const { container, done } = await mount(
    createElement(InlineError, { overlay: true, children: "Could not load" }),
  );
  try {
    const root = container.firstElementChild!;
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.className).toContain("--ui-overlay-ink");
    expect(root.className).not.toContain("--ui-tone-danger-fg");
    expect(root.querySelector("svg")!.parentElement!.parentElement!.className).toContain(
      "--ui-overlay-ink",
    );
  } finally {
    done();
  }
});
