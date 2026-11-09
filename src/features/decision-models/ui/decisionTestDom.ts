import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/** Test-only DOM helpers for the decision-model screens. Not imported by production code. */
export function mountDecisionUi(element: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

export function unmountDecisionUi(mounted: { container: HTMLDivElement; root: Root } | null) {
  if (!mounted) return;
  act(() => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}

/** Lets pending RPC promises and their state updates settle inside act. */
export async function settleDecisionUi() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function bodyText(): string {
  return document.body.textContent ?? "";
}

/** Finds a button by its visible text, across portals (dialogs and menus render into the body). */
export function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

export function clickButton(text: string) {
  const button = buttonByText(text);
  if (!button) throw new Error(`Button not found: ${text}`);
  act(() => {
    button.click();
  });
}

/** Sets a controlled input's value the way the browser does, so React's onChange runs. */
export function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
