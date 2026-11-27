// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiSetupCard } from "./AiSetupCard";

/** A control with a reason stays focusable: blocked is `disabled` or `aria-disabled`. */
const isBlocked = (
  node: { disabled?: boolean; getAttribute(name: string): string | null } | null | undefined,
) => Boolean(node?.disabled) || node?.getAttribute("aria-disabled") === "true";

// The app's model picker is a large session control; this card only needs its onChange contract.
vi.mock("../../../sessions/public/ModelPicker", async () => {
  const { createElement: h } = await import("react");
  return {
    ModelPicker: (props: { onChange: (harness: string, model: string) => void }) =>
      h(
        "div",
        null,
        h("button", { onClick: () => props.onChange("codex", "fixture-model") }, "Pick model"),
        h("button", { onClick: () => props.onChange("codex", "") }, "Pick provider only"),
      ),
  };
});

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(busy = false) {
  const onSave = vi.fn();
  act(() => root.render(createElement(AiSetupCard, { busy, onSave })));
  return onSave;
}

const button = (text: string) =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

it("explains why a model is needed and blocks saving until one is chosen", () => {
  const onSave = render();
  expect(element.textContent).toContain("Choose an AI model");
  act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Help"]')!.click());
  expect(document.body.textContent).toContain(
    "AI needs a model before it can plan or write reports.",
  );
  expect(isBlocked(button("Use this model"))).toBe(true);
  expect(element.textContent).not.toContain("Choose a model first.");
  act(() => button("Use this model")?.click());
  expect(onSave).not.toHaveBeenCalled();
});

it("saves the chosen provider and model once", () => {
  const onSave = render();
  act(() => button("Pick model")?.click());
  expect(button("Use this model")?.disabled).toBe(false);
  expect(element.textContent).not.toContain("Choose a model first.");
  act(() => button("Use this model")?.click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ provider: "codex", model: "fixture-model" });
});

it("leaves the model out when only a provider was chosen", () => {
  const onSave = render();
  act(() => button("Pick provider only")?.click());
  act(() => button("Use this model")?.click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ provider: "codex" });
});

it("ignores presses while the choice is being saved", () => {
  const onSave = render(true);
  act(() => button("Pick model")?.click());
  expect(button("Use this model")?.getAttribute("aria-busy")).toBe("true");
  act(() => button("Use this model")?.click());
  expect(onSave).not.toHaveBeenCalled();
});
