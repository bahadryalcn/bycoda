// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantChatComposer, AssistantChatMessage } from "./AssistantChat";

vi.mock("../../../sessions/public/AgentMarkdown", () => ({ AgentMarkdown: () => null }));
vi.mock("../../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

it("preserves literal user source through the session text renderer", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const text = "<button>literal</button>\n**keep these markers**";
  await act(async () => root!.render(createElement(AssistantChatMessage, { role: "user", text })));
  expect(container.querySelector("pre")?.textContent).toBe(text);
  expect(container.querySelector("strong")).toBeNull();
});

async function render(
  options: { pending?: boolean; readOnly?: boolean; sendDisabled?: boolean } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onSend = vi.fn();
  const onValueChange = vi.fn();
  await act(async () =>
    root!.render(
      createElement(AssistantChatComposer, {
        value: "Keep this draft\nwith technical details",
        label: "Message Arif",
        onSend,
        onValueChange,
        ...options,
      }),
    ),
  );
  return { onSend, onValueChange, input: container.querySelector("textarea")! };
}

it("keeps multiline and IME input local, dispatches plain Enter without clearing the owner draft", async () => {
  const { input, onSend, onValueChange } = await render();
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  });
  expect(onSend).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onSend).toHaveBeenCalledOnce();
  expect(onValueChange).not.toHaveBeenCalled();
  expect(input.value).toBe("Keep this draft\nwith technical details");
});

it.each([{ pending: true }, { readOnly: true }, { sendDisabled: true }])(
  "does not bypass pending, native draft readiness or domain admission with Enter: %j",
  async (state) => {
    const { input, onSend } = await render(state);
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
  },
);
