// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ListRow } from "./ListRow";

it("renders one native button with the option contract, slots and state attributes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(
          ListRow,
          {
            ref,
            role: "option",
            "aria-selected": true,
            size: "md",
            danger: true,
            icon: "i",
            trailing: "t",
            onClick: click,
          },
          "label",
        ),
      ),
    );
    const node = ref.current!;
    expect(node.tagName).toBe("BUTTON");
    expect(node.type).toBe("button");
    expect(node.getAttribute("role")).toBe("option");
    expect(node.getAttribute("aria-selected")).toBe("true");
    expect(node.dataset.danger).toBe("true");
    expect(node.dataset.rowSize).toBe("md");
    expect(node.children).toHaveLength(2);
    expect(node.textContent).toBe("ilabelt");
    act(() => node.click());
    expect(click).toHaveBeenCalledOnce();

    // #1047 derives selection for options and preserves explicit overrides.
    await act(async () =>
      root.render(createElement(ListRow, { ref, role: "option", active: true })),
    );
    expect(ref.current?.getAttribute("aria-selected")).toBe("true");
    await act(async () => root.render(createElement(ListRow, { ref, role: "option" })));
    expect(ref.current?.getAttribute("aria-selected")).toBe("false");
    await act(async () => root.render(createElement(ListRow, { ref, active: true })));
    expect(ref.current?.hasAttribute("aria-selected")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("paints hover, keyboard-active and selected from the state roles only", () => {
  const css = readFileSync("src/shared/ui/ListRow.module.css", "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  expect(css).toContain("--ui-surface-hover");
  expect(css).toContain("--ui-surface-selected");
  expect(css).toContain("--ui-radius-row");
  expect(css).not.toContain("--color-selection");
  expect(css).not.toMatch(/outline:(?![ ]*none)/);
});

async function renderRow(props: Record<string, unknown>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<HTMLButtonElement>();
  await act(async () => root.render(createElement(ListRow, { ref, ...props }, "label")));
  return {
    node: ref.current!,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

it.each([
  ["option, active", { role: "option", active: true }, "true"],
  ["option, inactive", { role: "option", active: false }, "false"],
  [
    "option, active, explicit false wins",
    { role: "option", active: true, "aria-selected": false },
    "false",
  ],
  ["option, inactive, explicit true wins", { role: "option", "aria-selected": true }, "true"],
  ["menuitem, active: no aria-selected", { role: "menuitem", active: true }, null],
  ["no role, active: no aria-selected", { active: true }, null],
  [
    "treeitem, explicit aria-selected passes through",
    { role: "treeitem", "aria-selected": true },
    "true",
  ],
])("aria-selected for %s is %s", async (_name, props, expected) => {
  const row = await renderRow(props);
  try {
    expect(row.node.getAttribute("aria-selected")).toBe(expected);
  } finally {
    await row.unmount();
  }
});
