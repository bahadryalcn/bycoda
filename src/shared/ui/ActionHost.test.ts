// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ActionHost,
  InlineMoreAction,
  actionHostAttributes,
  actionContentAttributes,
  actionDragAttributes,
} from "./ActionHost";

async function mount(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    render: async (node: ReturnType<typeof createElement>) => {
      await act(async () => root.render(node));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("keeps compact control height independent from text size", async () => {
  const view = await mount(
    createElement(ActionHost, { controlHeight: "compact", size: "caption" }),
  );
  try {
    const host = view.host.querySelector<HTMLElement>("[data-action-host]")!;
    expect(host.dataset.controlHeight).toBe("compact");
    expect(host.dataset.size).toBe("caption");
    expect(host.hasAttribute("controlHeight")).toBe(false);
  } finally {
    await view.unmount();
  }
});

it("keeps primary and inline actions separate on a floating host", async () => {
  const primary = vi.fn();
  const onOpen = vi.fn();
  const view = await mount(
    createElement(
      ActionHost,
      { variant: "floating", onClick: primary },
      createElement(InlineMoreAction, { label: "Request actions", onOpen }),
    ),
  );
  try {
    const host = view.host.querySelector<HTMLElement>("[data-action-host]")!;
    expect(host.dataset.variant).toBe("floating");
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(primary).not.toHaveBeenCalled();
    await act(async () => host.click());
    expect(primary).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("InlineMoreAction is a named menu button that opens the row menu at its own anchor without reaching the row", async () => {
  const onOpen = vi.fn();
  const rowClick = vi.fn();
  const view = await mount(
    createElement(
      ActionHost,
      { onClick: rowClick },
      createElement(InlineMoreAction, {
        label: "Actions for server.ts",
        onOpen,
      }),
    ),
  );
  try {
    const button = view.host.querySelector<HTMLButtonElement>("[data-action-inline]")!;
    expect(button.getAttribute("aria-label")).toBe("Actions for server.ts");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    // Unknown open state is not reported as closed.
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    // Hover-revealed by default; keyboard focus, an open menu and touch always show it.
    expect(button.hasAttribute("data-action-reveal")).toBe(true);
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(button);
    expect(rowClick).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("InlineMoreAction reports an open menu, honours reveal=always and stays inert while disabled", async () => {
  const onOpen = vi.fn();
  const view = await mount(
    createElement(
      ActionHost,
      null,
      createElement(InlineMoreAction, {
        label: "Actions for a",
        expanded: true,
        reveal: "always",
        onOpen,
      }),
      createElement(InlineMoreAction, {
        label: "Actions for b",
        expanded: false,
        disabled: true,
        onOpen,
      }),
    ),
  );
  try {
    const [open, disabled] = [
      ...view.host.querySelectorAll<HTMLButtonElement>("[data-action-inline]"),
    ];
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.hasAttribute("data-action-reveal")).toBe(false);
    expect(disabled.getAttribute("aria-expanded")).toBe("false");
    await act(async () => disabled.click());
    expect(onOpen).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("hoverReveal marks the host so selection alone does not reveal its inline actions", async () => {
  const view = await mount(
    createElement(
      "div",
      null,
      createElement(ActionHost, { selected: true, hoverReveal: true, "data-row": "hover" }),
      createElement(ActionHost, { selected: true, "data-row": "default" }),
    ),
  );
  try {
    const hover = view.host.querySelector<HTMLElement>('[data-row="hover"]')!;
    const fallback = view.host.querySelector<HTMLElement>('[data-row="default"]')!;
    expect(hover.hasAttribute("data-selected")).toBe(true);
    expect(hover.hasAttribute("data-hover-reveal")).toBe(true);
    expect(fallback.hasAttribute("data-hover-reveal")).toBe(false);
  } finally {
    await view.unmount();
  }
});

it("keeps token padding, minimum height and fill separate from typography and ground", async () => {
  const view = await mount(
    createElement(ActionHost, {
      size: "caption",
      controlHeight: "fill",
      controlMinHeight: "control",
      padding: { inline: "lg", top: "xs", bottom: "lg" },
      ground: "var(--ui-surface)",
    }),
  );
  try {
    const host = view.host.querySelector<HTMLElement>("[data-action-host]")!;
    expect(host.dataset.controlHeight).toBe("fill");
    expect(host.dataset.controlMinHeight).toBe("control");
    expect(host.dataset.size).toBe("caption");
    expect(host.style.paddingInline).toBe("var(--control-padding-inline, var(--space-3))");
    expect(host.style.paddingTop).toBe("var(--space-1)");
    expect(host.style.paddingBottom).toBe("var(--space-3)");
    expect(host.style.getPropertyValue("--action-host-ground")).toBe("var(--ui-surface)");
    expect(host.hasAttribute("padding")).toBe(false);
  } finally {
    await view.unmount();
  }
});

it("retains an existing settings row and its focused draft when stacked layout removes appearance", async () => {
  const view = await mount(
    createElement(
      "div",
      { ...actionHostAttributes({ variant: "settings", separator: true }, "row-placement") },
      createElement("input", { defaultValue: "Draft", "aria-label": "Draft" }),
    ),
  );
  try {
    const row = view.host.firstElementChild!;
    const input = row.querySelector("input")!;
    input.value = "Unsaved draft";
    input.focus();
    expect(row.getAttribute("data-variant")).toBe("settings");
    await view.render(
      createElement(
        "div",
        { ...actionHostAttributes(undefined, "row-placement") },
        createElement("input", { defaultValue: "Draft", "aria-label": "Draft" }),
      ),
    );
    expect(view.host.firstElementChild).toBe(row);
    expect(row.hasAttribute("data-action-host")).toBe(false);
    // The recipe is used on the same element; changing its attributes never introduces a component boundary.
    expect(actionHostAttributes(undefined, "row-placement")).toEqual({
      className: "row-placement",
      style: undefined,
    });
    expect(row.querySelector("input")).toBe(input);
    expect(input.value).toBe("Unsaved draft");
    expect(document.activeElement).toBe(input);
    const status = actionContentAttributes({ phase: "rest", hide: "screen-reader" });
    expect(status["data-action-hide"]).toBe("screen-reader");
  } finally {
    await view.unmount();
  }
});

it("leaves sortable lifecycle on the same existing row while opting into lifted appearance", async () => {
  const view = await mount(
    createElement(
      "div",
      { ...actionDragAttributes({ appearance: "lifted" }), "data-dragging": "" },
      createElement("input", { defaultValue: "Queued draft" }),
    ),
  );
  try {
    const row = view.host.firstElementChild!;
    const draft = row.querySelector("input")!;
    draft.value = "Unsaved queued draft";
    draft.focus();
    await view.render(
      createElement(
        "div",
        actionDragAttributes({ appearance: "lifted" }),
        createElement("input", { defaultValue: "Queued draft" }),
      ),
    );
    expect(view.host.firstElementChild).toBe(row);
    expect(row.hasAttribute("data-dragging")).toBe(false);
    expect(row.getAttribute("data-action-drag-appearance")).toBe("lifted");
    expect(row.querySelector("input")).toBe(draft);
    expect(draft.value).toBe("Unsaved queued draft");
    expect(document.activeElement).toBe(draft);
    expect(row.hasAttribute("draggable")).toBe(false);
  } finally {
    await view.unmount();
  }
});

it("keeps hover overlay typing and popup visibility on the existing child", async () => {
  const view = await mount(
    createElement(
      "div",
      actionContentAttributes({ phase: "hover-overlay", hidden: true }),
      createElement("input", { defaultValue: "find draft" }),
    ),
  );
  try {
    const overlay = view.host.firstElementChild!;
    const input = overlay.querySelector("input")!;
    input.value = "unsaved search";
    await view.render(
      createElement(
        "div",
        actionContentAttributes({ phase: "hover-overlay", hidden: true, open: true }),
        createElement("input", { defaultValue: "find draft" }),
      ),
    );
    expect(view.host.firstElementChild).toBe(overlay);
    expect(overlay.getAttribute("data-action-content")).toBe("hover-overlay");
    expect(overlay.hasAttribute("data-action-open")).toBe(true);
    expect(overlay.hasAttribute("data-action-hidden")).toBe(true);
    expect(overlay.querySelector("input")).toBe(input);
    expect(input.value).toBe("unsaved search");
  } finally {
    await view.unmount();
  }
});

it("keeps selection disclosure as content presentation without owning list navigation", () => {
  const wrap = actionContentAttributes({ phase: "always", reveal: "wrap" });
  const preview = actionContentAttributes({ phase: "always", reveal: "preview" });
  expect(wrap["data-action-reveal"]).toBe("wrap");
  expect(preview["data-action-reveal"]).toBe("preview");
  expect(preview).not.toHaveProperty("role");
  expect(preview).not.toHaveProperty("tabIndex");
  expect(actionContentAttributes({ phase: "always" })["data-action-reveal"]).toBeUndefined();
});
