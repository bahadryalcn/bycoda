// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTooltip, type TooltipContent } from "./Tooltip";

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function Anchor({ content, text }: { content: TooltipContent; text: string }) {
  const hint = useTooltip(content);
  return createElement(
    "div",
    null,
    createElement("button", { ...hint.trigger, id: "anchor", type: "button" }, text),
    hint.tooltip,
  );
}

async function hover(content: TooltipContent, text: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(Anchor, { content, text })));
  await act(async () => {
    host
      .querySelector("#anchor")!
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

it("keeps only the key caps when the control already shows the label", async () => {
  const tooltip = await hover({ label: "Notes", shortcut: "Ctrl+Shift+L" }, "Notes");
  expect(tooltip).not.toBeNull();
  expect(tooltip!.textContent).not.toContain("Notes");
  expect(tooltip!.querySelector('[role="img"]')).not.toBeNull();
});

it("does not open an always tooltip that would only repeat the visible label", async () => {
  expect(await hover({ label: "Notes" }, "Notes")).toBeNull();
});

it("still shows a label the control does not display, with its key caps", async () => {
  const tooltip = await hover({ label: "Open notes", shortcut: "Ctrl+Shift+L" }, "Notes");
  expect(tooltip!.textContent).toContain("Open notes");
});

it("keeps detail lines for a visible label", async () => {
  const tooltip = await hover({ label: "Notes", details: ["3 unread"] }, "Notes");
  expect(tooltip!.textContent).toBe("3 unread");
});
