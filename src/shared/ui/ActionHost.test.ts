// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ActionHost, InlineMoreAction } from "./ActionHost";

async function mount(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

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
