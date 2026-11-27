// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ButtonGroup, type ExpandingButtonGroupItem } from "../../../shared/ui/ButtonGroup";
import { setLanguagePreference } from "../../../shared/i18n";
import type { Block } from "../model/session";
import { PromptOutline } from "./PromptOutline";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguagePreference("en");
  // Reports every observed element once, as a real observer does right after observe().
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: (entries: unknown[]) => void) {}
      observe(target: Element) {
        this.callback([{ target }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const prompt = (id: string, text: string) => ({ id, role: "user", text }) as unknown as Block;

it("mounts a bounded prompt menu from the narrow pane header", async () => {
  const scope = createRef<HTMLDivElement>();
  const blocks = Array.from({ length: 500 }, (_, i) => prompt(String(i), `Prompt ${i}`));
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  const rowHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(28);
  function Pane() {
    const [action, setAction] = useState<ExpandingButtonGroupItem | null>(null);
    return createElement(
      "div",
      { ref: scope },
      action &&
        createElement(ButtonGroup, { variant: "expanding", label: "Actions", items: [action] }),
      createElement(PromptOutline, { blocks, scope, onTriggerChange: setAction }),
    );
  }
  try {
    await act(async () => root.render(createElement(Pane)));
    const trigger = host.querySelector<HTMLButtonElement>('[data-id="prompt-outline"]')!;
    await act(async () => trigger.click());
    const rows = document.querySelectorAll('[role="menuitemradio"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(64);
    expect(rows[0].getAttribute("aria-setsize")).toBe("500");
  } finally {
    height.mockRestore();
    rowHeight.mockRestore();
  }
});

it("offers a header menu of prompts when the rail is hidden, and removes it with the prompts", async () => {
  const scope = createRef<HTMLDivElement>();
  const onTriggerChange = vi.fn<(item: ExpandingButtonGroupItem | null) => void>();
  const render = (blocks: Block[]) =>
    act(async () =>
      root.render(
        createElement(
          "div",
          { ref: scope },
          createElement(PromptOutline, { blocks, scope, onTriggerChange }),
        ),
      ),
    );
  // happy-dom reports a zero-width container, which is narrower than the rail breakpoint.
  await render([prompt("a", "First"), prompt("b", "Second")]);
  const item = onTriggerChange.mock.calls.map(([value]) => value).findLast(Boolean);
  expect(item?.id).toBe("prompt-outline");
  expect(item?.label).toBe("Prompts");
  await render([prompt("a", "First")]);
  expect(onTriggerChange.mock.lastCall?.[0]).toBeNull();
});
