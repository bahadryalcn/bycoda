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
