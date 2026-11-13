// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BuilderInterview } from "./BuilderInterview";

vi.mock("../../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

async function render(busy = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onAnswer = vi.fn();
  const onDraftChange = vi.fn();
  await act(async () =>
    root!.render(
      createElement(BuilderInterview, {
        transcript: [{ role: "assistant", text: "What should change?" }],
        options: ["Short voice replies"],
        busy,
        failure: null,
        draft: "Keep voice replies brief",
        onDraftChange,
        onAnswer,
        onRetry: vi.fn(),
      }),
    ),
  );
  return { onAnswer, onDraftChange, input: container.querySelector("textarea")! };
}

it("uses a multiline composer and preserves Shift+Enter and IME composition", async () => {
  const { input, onAnswer, onDraftChange } = await render();
  expect(input).not.toBeNull();
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  });
  expect(onAnswer).not.toHaveBeenCalled();
  expect(onDraftChange).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("Keep voice replies brief");
  expect(onDraftChange).toHaveBeenCalledExactlyOnceWith("");
});

it("keeps the draft editable but prevents duplicate sending while a reply is pending", async () => {
  const { input, onAnswer, onDraftChange } = await render(true);
  expect(input.disabled).toBe(false);
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label="Send answer"]')?.disabled,
  ).toBe(true);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onAnswer).not.toHaveBeenCalled();
  expect(onDraftChange).not.toHaveBeenCalled();
});
